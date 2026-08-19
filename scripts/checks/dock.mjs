/**
 * Docking windows: panels are cards in a split/tab tree the user rearranges
 * by dragging tabs, and the arrangement survives a reload.
 *
 * Needs u-and-i's dev server (`npx vite`, 4400). The live mirror is nice to
 * have (the canvas pane is livelier with it) but nothing here depends on it.
 *
 *   node scripts/checks/dock.mjs [screenshot-prefix]
 */
import { playwright, reporter } from "./_shared.mjs";

const { chromium } = playwright();
const { check, done } = reporter();
const shot = process.argv[2] ?? null;

const URL = "http://localhost:4400/";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

/** Tab ids in visual (left-to-right, top-to-bottom) order, grouped by leaf. */
const leafMap = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-dock-leaf]")].map((l) => ({
      leaf: l.getAttribute("data-dock-leaf"),
      tabs: [...l.querySelectorAll("[data-dock-tab]")].map((t) => t.getAttribute("data-dock-tab")),
    })),
  );

const box = async (sel) => await page.locator(sel).first().boundingBox();

/** Pointer-event drag — the dock listens to pointer events, not HTML5 dnd. */
async function dragTabTo(tabId, x, y) {
  const b = await box(`[data-dock-tab="${tabId}"]`);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  // Two moves: the first clears the drag threshold, the second aims.
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-dock-leaf]", { timeout: 15000 });
  await page.waitForTimeout(1500);

  // --- the default arrangement reproduces the old three columns ------------
  const start = await leafMap();
  const flat = start.flatMap((l) => l.tabs);
  check(
    JSON.stringify(flat) === JSON.stringify(["insert", "canvas", "outliner", "properties"]),
    `default layout is the old three columns: ${JSON.stringify(flat)}`,
  );
  check(start.length === 4, `each panel starts in its own leaf (${start.length})`);

  // The Canvas tab can't be closed away — it is the workspace's reason to be.
  const closers = await page.evaluate(() =>
    [...document.querySelectorAll("[data-dock-tab]")].map((t) => [
      t.getAttribute("data-dock-tab"),
      t.children.length > 0,
    ]),
  );
  check(
    closers.every(([id, hasX]) => (id === "canvas" ? !hasX : hasX)),
    `only the canvas tab lacks a close button: ${JSON.stringify(closers)}`,
  );

  // --- drag a tab onto another leaf's tab strip: they stack as tabs --------
  const propsBar = await box('[data-dock-leaf] [data-dock-tab="properties"]');
  await dragTabTo("insert", propsBar.x + propsBar.width + 30, propsBar.y + propsBar.height / 2);
  const stacked = await leafMap();
  const together = stacked.find((l) => l.tabs.includes("properties"));
  check(
    together?.tabs.includes("insert") && stacked.length === 3,
    `dropping on a tab strip stacks the panels: ${JSON.stringify(stacked.map((l) => l.tabs))}`,
  );

  // Insert became the active tab, so its search box is the one on screen.
  check(
    await page.locator('input[placeholder="Search components"]').first().isVisible(),
    "the dropped panel becomes the active tab",
  );

  // --- switching tabs keeps both mounted (the canvas iframe must not reload)
  await page.locator('[data-dock-tab="properties"]').first().click();
  await page.waitForTimeout(150);
  const bothMounted = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll("[data-dock-leaf]")].find((l) =>
      [...l.querySelectorAll("[data-dock-tab]")].some((t) => t.getAttribute("data-dock-tab") === "insert"),
    );
    // Tab strip + one body div per tab, inactive ones display:none.
    const bodies = [...leaf.children].slice(1);
    return { bodies: bodies.length, shown: bodies.filter((b) => getComputedStyle(b).display !== "none").length };
  });
  check(
    bothMounted.bodies === 2 && bothMounted.shown === 1,
    `inactive tabs stay mounted but hidden: ${JSON.stringify(bothMounted)}`,
  );

  // --- drag a tab to a leaf's edge: it splits ------------------------------
  const canvasLeaf = await page.evaluate(() => {
    const l = [...document.querySelectorAll("[data-dock-leaf]")].find((n) =>
      [...n.querySelectorAll("[data-dock-tab]")].some((t) => t.getAttribute("data-dock-tab") === "canvas"),
    );
    const r = l.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await dragTabTo("insert", canvasLeaf.x + canvasLeaf.w / 2, canvasLeaf.y + canvasLeaf.h - 12);
  const afterSplit = await leafMap();
  check(
    afterSplit.length === 4 && afterSplit.some((l) => l.tabs.length === 1 && l.tabs[0] === "insert"),
    `dropping on an edge splits the pane: ${JSON.stringify(afterSplit.map((l) => l.tabs))}`,
  );

  // --- the arrangement is remembered per project --------------------------
  const before = await leafMap();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-dock-leaf]", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const after = await leafMap();
  check(
    JSON.stringify(after.map((l) => l.tabs)) === JSON.stringify(before.map((l) => l.tabs)),
    `layout survives a reload: ${JSON.stringify(after.map((l) => l.tabs))}`,
  );

  // --- a second canvas pane -----------------------------------------------
  // "View" is also a canvas mode button, so reach the menu by its data hook.
  const viewMenuItem = async (label) => {
    await page.locator('[data-menu="View"]').click();
    await page.locator("button", { hasText: label }).last().click();
    await page.waitForTimeout(400);
  };
  await viewMenuItem("New canvas pane");
  const twoCanvases = (await leafMap()).flatMap((l) => l.tabs).filter((t) => t.startsWith("canvas"));
  check(twoCanvases.length === 2, `a second canvas pane docks: ${JSON.stringify(twoCanvases)}`);

  // --- Reset layout puts everything back ----------------------------------
  await viewMenuItem("Reset layout");
  const reset = (await leafMap()).flatMap((l) => l.tabs);
  check(
    JSON.stringify(reset) === JSON.stringify(["insert", "canvas", "outliner", "properties"]),
    `Reset layout restores the default: ${JSON.stringify(reset)}`,
  );

  if (shot) await page.screenshot({ path: `${shot}-dock.png` });
} catch (err) {
  // Without this an exception would skip the remaining checks and still exit
  // 0 — a green run that tested half of what it claims.
  check(false, `check script threw: ${err?.message ?? err}`);
} finally {
  await browser.close();
  done();
}
