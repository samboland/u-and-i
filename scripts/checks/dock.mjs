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

  // Blender-style header: exactly one type dropdown per pane, and the panel's
  // own controls sit in that same row rather than a title bar below it.
  const headers = await page.evaluate(() =>
    [...document.querySelectorAll("[data-dock-leaf]")].map((l) => {
      const bar = l.querySelector("[data-dock-tabbar]");
      return {
        active: bar.querySelector("[data-dock-type]")?.getAttribute("data-dock-tab"),
        types: bar.querySelectorAll("[data-dock-type]").length,
        closable: !!bar.querySelector(".hv-close"),
        height: Math.round(bar.getBoundingClientRect().height),
      };
    }),
  );
  check(
    headers.every((h) => h.types === 1),
    `one type dropdown per pane: ${JSON.stringify(headers.map((h) => h.active))}`,
  );
  check(
    headers.every((h) => h.height <= 34),
    `pane headers stay one row tall: ${JSON.stringify(headers.map((h) => h.height))}`,
  );
  // The Canvas pane can't be closed away — it is the workspace's reason to be.
  check(
    headers.every((h) => (h.active === "canvas" ? !h.closable : h.closable)),
    `only the canvas pane lacks a close button: ${JSON.stringify(headers.map((h) => [h.active, h.closable]))}`,
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

  // Insert became the active panel, so its search box — which lives in the
  // pane header now — is the one on screen.
  check(
    await page.locator('[data-dock-tabbar] input[aria-label="Search components"]').first().isVisible(),
    "the dropped panel becomes active, and its controls are in the pane header",
  );

  // The panel it landed on is still there, as a bare icon beside the dropdown.
  // Material Symbols are a ligature font, so a tab's textContent IS its icon
  // name — anything beyond that (and the dropdown caret) would be a label.
  const sharing = await page.evaluate(() => {
    const bar = [...document.querySelectorAll("[data-dock-tabbar]")].find(
      (b) => b.querySelectorAll("[data-dock-tab]").length > 1,
    );
    return [...bar.querySelectorAll("[data-dock-tab]")].map((t) => ({
      id: t.getAttribute("data-dock-tab"),
      isType: t.hasAttribute("data-dock-type"),
      glyph: t.querySelector(".material-symbols-rounded")?.textContent ?? "",
      text: t.textContent.replace("▼", "").trim(),
    }));
  });
  check(
    sharing.length === 2 &&
      sharing.filter((t) => t.isType).length === 1 &&
      sharing.every((t) => t.text === t.glyph && t.glyph !== ""),
    `the other panel shows as a bare icon, no label: ${JSON.stringify(sharing)}`,
  );

  // The type dropdown names the panels and switches which one the pane shows.
  const sharedType = page
    .locator("[data-dock-leaf]", { has: page.locator("[data-dock-tab]").nth(1) })
    .locator("[data-dock-type]")
    .last();
  await sharedType.click();
  await page.waitForTimeout(250);
  // Menu rows read "<bullet><icon-ligature><Name>" for the same font reason.
  const menuNames = await page.evaluate(() =>
    [...document.querySelectorAll("[data-dock-typemenu] button")].map((b) =>
      [...b.children].at(-1).textContent.trim(),
    ),
  );
  check(
    ["Insert", "Canvas", "Outliner", "Properties"].every((n) => menuNames.includes(n)),
    `type dropdown lists panels by name: ${JSON.stringify(menuNames)}`,
  );

  await page.locator("[data-dock-typemenu] button", { hasText: "Properties" }).last().click();
  await page.waitForTimeout(300);
  const nowActive = await page.evaluate(() => {
    const bar = [...document.querySelectorAll("[data-dock-tabbar]")].find(
      (b) => b.querySelectorAll("[data-dock-tab]").length > 1,
    );
    return bar?.querySelector("[data-dock-type]")?.getAttribute("data-dock-tab");
  });
  check(nowActive === "properties", `picking from the dropdown switches the pane: ${nowActive}`);

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

  // --- a header inside the outer-edge band still stacks --------------------
  // The top row's headers sit within the dock's outer-edge drop band. The
  // edge used to win there, so those panes could never be stacked onto.
  const insertHdr = await box('[data-dock-leaf] [data-dock-tab="insert"]');
  await dragTabTo("outliner", insertHdr.x + insertHdr.width + 40, insertHdr.y + insertHdr.height / 2);
  const topStack = await leafMap();
  check(
    topStack.length === 3 && topStack.some((l) => l.tabs.includes("insert") && l.tabs.includes("outliner")),
    `a top-row header stacks rather than splitting: ${JSON.stringify(topStack.map((l) => l.tabs))}`,
  );
  await viewMenuItem("Reset layout");

  if (shot) await page.screenshot({ path: `${shot}-dock.png` });
} catch (err) {
  // Without this an exception would skip the remaining checks and still exit
  // 0 — a green run that tested half of what it claims.
  check(false, `check script threw: ${err?.message ?? err}`);
} finally {
  await browser.close();
  done();
}
