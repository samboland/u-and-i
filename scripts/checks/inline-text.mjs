/**
 * In-place text editing on the component canvas: F2 and Alt+double-click both
 * open a caret, Enter commits through /api/edit, Escape discards, Ctrl+Z
 * restores the exact prior bytes. Asserts the touched files are git-clean at
 * the end — a `git checkout` needed to clean up is a test failure.
 *
 * Needs u-and-i's dev server on 4400. Edits real files in the target and
 * undoes them through the tool's own restore.
 *
 *   node scripts/checks/inline-text.mjs
 *
 * FILE/NODE below are adventure-alerts specific: node 29 of footer.tsx is a
 * <p> whose whole content is one text child, which is what inline editing
 * requires. Re-point them if the target changes.
 */
import { playwright, reporter, readTarget, isDirty } from "./_shared.mjs";

const FILE = "src/components/layout/footer.tsx";
const NODE = 29;

const { chromium } = playwright();
const { check, done } = reporter();

const before = readTarget(FILE);
if (isDirty(FILE)) throw new Error(`${FILE} is already dirty — refusing to test`);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
try {
  await page.goto("http://localhost:4400", { waitUntil: "domcontentloaded" });
  await page.click(`[title="Open ${FILE}"]`);
  await page.waitForTimeout(1500);

  const el = page.frameLocator("iframe").locator(`[data-uai="app:${FILE}::${NODE}"]`);
  await el.waitFor({ timeout: 15000 });
  await el.scrollIntoViewIfNeeded();
  await el.dblclick({ modifiers: ["Alt"] });
  await page.waitForTimeout(400);
  check((await el.getAttribute("class"))?.includes("uai-editing"), "Alt+dblclick opens a caret");
  check(!isDirty(FILE), "opening an edit writes nothing");

  await page.keyboard.press("Control+A");
  await page.keyboard.type("Salt spray and open water.");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  const after = readTarget(FILE);
  check(after.includes("Salt spray and open water."), "Enter commits the new text");
  const a = before.split("\n");
  const b = after.split("\n");
  check(a.length === b.length, "line count unchanged");
  const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i != null);
  check(changed.length === 1, `exactly one line changed (got ${changed.length})`);
  check(/^\s+Salt spray and open water\.$/.test(b[changed[0]] ?? ""), "indentation preserved");

  await page.click("body");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1500);
  check(readTarget(FILE) === before, "Ctrl+Z restores the file byte-for-byte");
  check(!isDirty(FILE), `${FILE} is git-clean after undo`);
} finally {
  if (isDirty(FILE)) check(false, `LEFT DIRTY: ${FILE} — undo did not restore it`);
  await browser.close();
  done();
}
