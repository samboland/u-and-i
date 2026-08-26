/**
 * The outliner's Blender behaviors: arrow-key walk (up/down along visible
 * rows, left = close-or-parent, right = open-or-descend), Shift-click on a
 * caret opening/closing the whole subtree, a collapsed parent summarizing its
 * hidden children as icons, and reveal-on-focus — an edit's re-anchored
 * selection must never land inside a collapsed branch invisibly.
 *
 * Needs u-and-i's dev server (`npx vite`, 4400). The reveal test moves an
 * element in the target's policy-view.tsx and undoes it via the tool's own
 * Ctrl+Z; it is skipped if that file has WIP.
 *
 *   node scripts/checks/outliner.mjs
 */
import { playwright, reporter, isDirty } from "./_shared.mjs";

const FILE = "src/app/(legal)/policy-view.tsx";

const { chromium } = playwright();
const { check, done } = reporter();

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

/** Visible outliner rows: label + whether the row draws as selected. */
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".hv-row")]
      .filter((r) => r.offsetParent !== null)
      .map((r) => ({
        label:
          [...r.querySelectorAll("span")]
            .find((s) => !s.className.includes("material-symbols") && s.textContent.trim())
            ?.textContent.trim() ?? "",
        selected: getComputedStyle(r).backgroundColor === "rgb(43, 51, 66)",
      })),
  );
const labels = async () => (await rows()).map((r) => r.label);
const selectedLabel = async () => (await rows()).find((r) => r.selected)?.label ?? null;

async function press(key, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}

try {
  await page.goto("http://localhost:4400/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hv-row", { timeout: 20000 });
  await page.waitForTimeout(1500);

  // Route tree → terms → open the page's view component (policy-view.tsx).
  await page.locator('.hv-row:has-text("(legal)")').first().click();
  await page.waitForTimeout(300);
  await page.locator('.hv-row:has-text("terms")').first().click();
  await page.waitForTimeout(600);
  await page.locator("button:has-text(\"the page's view\")").first().click();
  await page.waitForTimeout(2000);

  const FULL = ["main", "div", "LegalBackButton", "LegalDocSelector", "span", "LegalPdfButton", "article"];
  check(
    JSON.stringify(await labels()) === JSON.stringify(FULL),
    `file opens fully expanded: ${JSON.stringify(await labels())}`,
  );

  // Walk: down lands on the first row, then moves along visible rows.
  await press("ArrowDown");
  check((await selectedLabel()) === "main", `ArrowDown from nothing selects the first row: ${await selectedLabel()}`);
  await press("ArrowDown", 2);
  check((await selectedLabel()) === "LegalBackButton", `ArrowDown walks into the tree: ${await selectedLabel()}`);

  // Left on a leaf climbs to the parent; left on an open parent closes it.
  await press("ArrowLeft");
  check((await selectedLabel()) === "div", `ArrowLeft on a leaf selects its parent: ${await selectedLabel()}`);
  await press("ArrowLeft");
  check(
    JSON.stringify(await labels()) === JSON.stringify(["main", "div", "article"]),
    `ArrowLeft on an open parent closes it: ${JSON.stringify(await labels())}`,
  );

  // A closed parent summarizes its hidden subtree as icons.
  const summary = await page.evaluate(() => {
    const div = [...document.querySelectorAll(".hv-row")].find((r) => r.textContent.includes("div"));
    return [...(div?.querySelectorAll(".material-symbols-rounded") ?? [])].map((s) => s.textContent.trim());
  });
  check(
    summary.includes("deployed_code") && summary.includes("notes"),
    `a closed parent shows its hidden children's icons: ${JSON.stringify(summary)}`,
  );

  // Right reopens, right again descends to the first child.
  await press("ArrowRight");
  check((await labels()).length === 7, "ArrowRight on a closed parent opens it");
  await press("ArrowRight");
  check((await selectedLabel()) === "LegalBackButton", `ArrowRight on an open parent descends: ${await selectedLabel()}`);

  // Shift-click the root caret: the whole subtree closes in one gesture,
  // and a plain reopen shows the descendants kept their closed state.
  await page.locator('.hv-row:has-text("main") button').first().click({ modifiers: ["Shift"] });
  await page.waitForTimeout(200);
  check(JSON.stringify(await labels()) === JSON.stringify(["main"]), `Shift-click caret closes the whole subtree: ${JSON.stringify(await labels())}`);
  await page.locator('.hv-row:has-text("main") button').first().click();
  await page.waitForTimeout(200);
  check(
    JSON.stringify(await labels()) === JSON.stringify(["main", "div", "article"]),
    `plain reopen leaves descendants closed: ${JSON.stringify(await labels())}`,
  );

  // Reveal-on-focus, driven by a real edit: focus a node, bury it by closing
  // the root recursively, then Alt+Down. The edit's re-anchored focus must
  // expand its ancestors and come back on screen. Ctrl+Z restores the file.
  if (isDirty(FILE)) {
    check(true, `SKIP: ${FILE} has uncommitted WIP; edit-driven reveal not exercised`);
  } else {
    await page.locator('.hv-row:has-text("div")').first().click();
    await press("ArrowRight"); // open div
    await page.locator('.hv-row:has-text("LegalDocSelector")').first().click();
    await page.locator('.hv-row:has-text("main") button').first().click({ modifiers: ["Shift"] });
    await page.waitForTimeout(200);
    check(JSON.stringify(await labels()) === JSON.stringify(["main"]), "focused row buried before the edit");

    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForTimeout(1200);
    const after = await rows();
    check(
      after.some((r) => r.label === "LegalDocSelector" && r.selected),
      `the edit's focus is revealed and selected: ${JSON.stringify(after)}`,
    );

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(1200);
    check(!isDirty(FILE), "undo leaves the target file git-clean");
  }
} catch (err) {
  check(false, `check script threw: ${err?.message ?? err}`);
} finally {
  await browser.close();
  done();
}
