/**
 * The editor chrome: one strip above the dock, nothing below it, and every
 * function that used to sit on a strip still reachable from a menu.
 *
 * Sam stripped the document row, the status bar and the top bar's right-hand
 * cluster (2026-08-25). The rule he gave for it: "anything that had actual
 * function that becomes unreachable belongs under the menu bar dropdowns."
 * These checks are that rule, written down.
 *
 * Needs u-and-i's dev server (`npx vite`, 4400).
 *
 *   node scripts/checks/chrome.mjs
 */
import { playwright, reporter, isDirty } from "./_shared.mjs";

/** Any openable file in the target; the edit below is forced to fail, so
 *  nothing is ever written to it. */
const FILE = "src/components/layout/footer.tsx";

const { chromium } = playwright();
const { check, done } = reporter();

const URL = "http://localhost:4400/";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

/** Every button in one top-bar dropdown, by label. */
async function menuItems(name) {
  await page.locator(`[data-menu="${name}"]`).click();
  await page.waitForTimeout(200);
  const items = await page.evaluate((n) => {
    const btn = document.querySelector(`[data-menu="${n}"]`);
    const panel = btn?.parentElement?.querySelector("div");
    if (!panel) return [];
    return [...panel.querySelectorAll("button")].map((b) => ({
      label: [...b.children].length ? b.children[1]?.textContent.trim() : b.textContent.trim(),
      disabled: b.disabled,
    }));
  }, name);
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 400);
  await page.waitForTimeout(150);
  return items;
}

try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const geom = await page.evaluate(() => {
    const r = document.querySelector("[data-dock-root]").getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
  });
  // One strip above, none below: the dock runs to the bottom of the window.
  check(geom.top <= 36, `a single strip sits above the dock: dock starts at ${geom.top}px`);
  check(
    geom.vh - geom.bottom <= 1,
    `nothing sits below the dock: ${(geom.vh - geom.bottom).toFixed(1)}px left over`,
  );

  // The strip carries menus and workspace tabs, and nothing else — no target
  // chip, no path, no status text, no undo/redo/Preview buttons.
  const bar = await page.evaluate(() => {
    const strip = document.querySelector("[data-menu]").parentElement.parentElement;
    return [...strip.children].map((c) => c.textContent.trim()).filter(Boolean);
  });
  check(
    JSON.stringify(bar) ===
      JSON.stringify(["u—i", "File", "Edit", "Insert", "View", "Canvas", "Help", "LayoutStyleWorkshopComponent"]),
    `the strip carries only menus and workspace tabs: ${JSON.stringify(bar)}`,
  );

  // Everything that lost its button kept a menu home.
  const canvas = await menuItems("Canvas");
  check(
    canvas.some((i) => i.label === "Preview in new window"),
    `Preview survived the button, in the Canvas menu: ${JSON.stringify(canvas.map((i) => i.label))}`,
  );
  const edit = await menuItems("Edit");
  check(
    edit.some((i) => i.label === "Undo") && edit.some((i) => i.label === "Redo"),
    `Undo and Redo survived their buttons, in the Edit menu: ${JSON.stringify(edit.map((i) => i.label))}`,
  );
  const file = await menuItems("File");
  check(
    file.some((i) => (i.label ?? "").startsWith("Target:")),
    `the target survived its chip, in the File menu: ${JSON.stringify(file.map((i) => i.label))}`,
  );

  // Canvas zoom moved off the status bar into the header that owns the
  // device controls it modifies.
  const zoomHome = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll("[data-dock-leaf]")].find((l) =>
      l.querySelector('[data-dock-tab="canvas"]'),
    );
    const bar = leaf?.querySelector("[data-dock-tabbar]");
    return /\d+%/.test(bar?.textContent ?? "");
  });
  check(zoomHome, "canvas zoom lives in the canvas pane header");

  // A rejected edit is the one thing the old status strip reported that has no
  // menu home, so it has to surface on its own. Force a rejection at the wire
  // rather than trusting that it would be shown: nothing reaches the target,
  // so there is nothing to clean up either.
  await page.route("**/api/edit", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "forced rejection, chrome check" }),
    }),
  );
  await page.click(`[title="Open ${FILE}"]`);
  await page.waitForTimeout(1200);
  await page.locator('[data-menu="Insert"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-menu="Insert"]').locator("xpath=../div").locator("button").first().click();
  await page.waitForTimeout(800);

  const shown = await page.locator("[data-uai-editerror]").textContent().catch(() => null);
  check(
    (shown ?? "").includes("forced rejection, chrome check"),
    `a rejected edit still reports itself: ${JSON.stringify(shown)}`,
  );
  check(!isDirty(FILE), "a rejected edit writes nothing to the target");
} catch (err) {
  check(false, `check script threw: ${err?.message ?? err}`);
} finally {
  await browser.close();
  done();
}
