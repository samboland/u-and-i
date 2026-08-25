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
    [...document.querySelectorAll("[data-dock-leaf]")].map((l) => {
      const r = l.getBoundingClientRect();
      return {
        leaf: l.getAttribute("data-dock-leaf"),
        tabs: [...l.querySelectorAll("[data-dock-tab]")].map((t) => t.getAttribute("data-dock-tab")),
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    }),
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

/** The persisted tree, as a compact shape string. */
const shape = () =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).find((s) => s.startsWith("uai:proj:"));
    const t = JSON.parse(localStorage.getItem(k)).layouts.edit;
    const s = (n) => (n.kind === "leaf" ? n.tabs.join("+") : `${n.dir}[${n.children.map(s).join(", ")}]`);
    return s(t);
  });

/** Hold a drag over a point and report the drop zone the dock computed. */
async function zoneAt(x, y) {
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.move(x + 0.5, y);
  await page.waitForTimeout(110);
  return page.evaluate(() => {
    const el = document.querySelector("[data-dock-zone]");
    return el && { zone: el.getAttribute("data-dock-zone"), target: el.getAttribute("data-dock-target") };
  });
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

  // Panes are rounded cards separated by a real gap, with a grip on the sash
  // — the barrier is the space, not a drawn line.
  const cards = await page.evaluate(() => {
    const leaf = document.querySelector("[data-dock-leaf]");
    const s = getComputedStyle(leaf);
    const sash = document.querySelector("[data-dock-splitter]");
    return {
      radius: parseInt(s.borderTopLeftRadius, 10),
      outlined: parseInt(s.borderTopWidth, 10) === 1,
      gap: Math.round(sash?.getBoundingClientRect().width ?? 0),
      grips: document.querySelectorAll("[data-dock-grip]").length,
      splitters: document.querySelectorAll("[data-dock-splitter]").length,
    };
  });
  check(
    cards.radius >= 6 && cards.outlined && cards.gap >= 6 && cards.grips === cards.splitters && cards.grips > 0,
    `panes are rounded cards with a gap and a sash grip: ${JSON.stringify(cards)}`,
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

  // --- every pane can still be stacked onto --------------------------------
  // A top-row pane's header lies under the dock's top edge strip, which now
  // wins there. Nothing is lost: a pane's middle means "add a tab" too, so
  // the arrangement is still reachable — which is the property worth pinning.
  const ins = await page.evaluate(() => {
    const l = [...document.querySelectorAll("[data-dock-leaf]")].find((n) =>
      [...n.querySelectorAll("[data-dock-tab]")].some((t) => t.getAttribute("data-dock-tab") === "insert"),
    );
    const r = l.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await dragTabTo("outliner", ins.x, ins.y);
  const topStack = await leafMap();
  check(
    topStack.length === 3 && topStack.some((l) => l.tabs.includes("insert") && l.tabs.includes("outliner")),
    `a top-row pane can still be stacked onto, via its middle: ${JSON.stringify(topStack.map((l) => l.tabs))}`,
  );
  await viewMenuItem("Reset layout");

  // --- drop zones stay live over the canvas iframe -------------------------
  // A pointer over an iframe delivers events to that document, so the preview
  // used to freeze at whatever it read before the cursor crossed the frame.
  // A shield over the dock during the drag keeps the moves coming.
  const cv = await page.evaluate(() => {
    const l = [...document.querySelectorAll("[data-dock-leaf]")].find((n) =>
      [...n.querySelectorAll("[data-dock-tab]")].some((t) => t.getAttribute("data-dock-tab") === "canvas"),
    );
    const r = l.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const outlinerTab = await box('[data-dock-tab="outliner"]');
  await page.mouse.move(outlinerTab.x + outlinerTab.width / 2, outlinerTab.y + outlinerTab.height / 2);
  await page.mouse.down();
  const zones = {};
  for (const [name, u, v] of [
    ["centre", 0.5, 0.5],
    ["top", 0.5, 0.12],
    ["bottom", 0.5, 0.88],
    ["left", 0.12, 0.5],
    ["right", 0.88, 0.5],
  ]) {
    zones[name] = (await zoneAt(cv.x + cv.w * u, cv.y + cv.h * v))?.zone;
  }
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(200);
  check(
    JSON.stringify(zones) === JSON.stringify({ centre: "center", top: "top", bottom: "bottom", left: "left", right: "right" }),
    `drop zones track the pointer across the canvas iframe: ${JSON.stringify(zones)}`,
  );

  // --- the outer strips reach every full-span arrangement ------------------
  // The dock root, not the split container inside its gutter — the outer drop
  // zone is measured from the root's border.
  const root = await page.evaluate(() => {
    const r = document.querySelector("[data-dock-root]").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (const [name, x, y, want] of [
    ["top", root.x + root.w / 2, root.y + 4, "col[outliner, row[insert, canvas, properties]]"],
    ["bottom", root.x + root.w / 2, root.y + root.h - 4, "col[row[insert, canvas, properties], outliner]"],
    ["left", root.x + 4, root.y + root.h / 2, "row[outliner, insert, canvas, properties]"],
  ]) {
    await viewMenuItem("Reset layout");
    await dragTabTo("outliner", x, y);
    const got = await shape();
    check(got === want, `outer ${name} strip makes a full-span band: ${got}`);
  }
  await viewMenuItem("Reset layout");

  // --- header drops carry a position, so tabs can be re-ordered ------------
  const olHdr = await box('[data-dock-tab="outliner"]');
  await dragTabTo("properties", olHdr.x + olHdr.width + 20, olHdr.y + olHdr.height / 2);
  check((await shape()).includes("outliner+properties"), `a header drop lands after the icon it passed: ${await shape()}`);

  const bar = await page.evaluate(() => {
    const l = [...document.querySelectorAll("[data-dock-leaf]")].find(
      (n) => n.querySelectorAll("[data-dock-tab]").length > 1,
    );
    const r = l.querySelector("[data-dock-tabbar]").getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2 };
  });
  await dragTabTo("properties", bar.x + 8, bar.y);
  check((await shape()).includes("properties+outliner"), `dragging a tab to the front re-orders it: ${await shape()}`);
  await viewMenuItem("Reset layout");

  // --- the overlay is one element that eases between targets ---------------
  const cvTab = await box('[data-dock-tab="canvas"]');
  await page.mouse.move(cvTab.x + cvTab.width / 2, cvTab.y + cvTab.height / 2);
  await page.mouse.down();
  await zoneAt(root.x + root.w * 0.4, root.y + root.h * 0.8);
  const overlay = await page.evaluate(() => {
    const els = document.querySelectorAll("[data-dock-zone]");
    const s = els[0]?.style;
    return { count: els.length, background: s?.background, transition: s?.transition };
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(200);
  check(
    overlay.count === 1 && /70ms ease-out/.test(overlay.transition ?? "") && /150ms ease-out/.test(overlay.transition ?? ""),
    `one overlay, easing on VS Code's timings: ${JSON.stringify(overlay)}`,
  );

  // --- Blender's Area Options, on right-click of a sash --------------------
  const openSash = async (sel, offset = 0) => {
    const s = await box(sel);
    await page.mouse.click(s.x + s.width / 2 + offset, s.y + s.height / 2, { button: "right" });
    await page.waitForTimeout(250);
  };
  const areaItems = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-dock-areamenu] button")].map((b) => ({
        label: [...b.children].at(-1).textContent.trim(),
        disabled: b.disabled,
      })),
    );
  const pick = async (label) => {
    await page.locator("[data-dock-areamenu] button", { hasText: label }).click();
    await page.waitForTimeout(350);
  };

  await openSash('[data-dock-splitter="vertical"]');
  const vItems = await areaItems();
  check(
    vItems.map((i) => i.label).join("|") === "Vertical Split|Horizontal Split|Join Right|Join Left|Swap Areas",
    `a vertical sash offers Blender's area options: ${JSON.stringify(vItems.map((i) => i.label))}`,
  );
  // Split is always offered now: it arms a phantom you place by hand, so
  // there is no seam-side target to name or grey out.
  check(
    vItems.every((i) => !i.disabled),
    `every area option is live; Split is placed by hand: ${JSON.stringify(vItems)}`,
  );

  await pick("Swap Areas");
  check((await shape()) === "row[canvas, insert, col[outliner, properties]]", `Swap Areas trades the pair: ${await shape()}`);
  await viewMenuItem("Reset layout");

  await openSash('[data-dock-splitter="vertical"]');
  // Blender's label is the direction the survivor GROWS: "Join Right" keeps
  // the left pane (Insert) and expands it over Canvas.
  await pick("Join Right");
  check(
    (await shape()) === "row[insert+canvas, col[outliner, properties]]",
    `Join Right keeps the left pane and moves the other's panels in: ${await shape()}`,
  );
  await viewMenuItem("Reset layout");

  // A horizontal sash names its directions Up/Down, not Left/Right.
  await openSash('[data-dock-splitter="horizontal"]');
  const hItems = await areaItems();
  check(
    hItems.some((i) => i.label === "Join Up") && hItems.some((i) => i.label === "Join Down"),
    `a horizontal sash joins Up/Down: ${JSON.stringify(hItems.map((i) => i.label))}`,
  );
  // "Join Up" keeps the BOTTOM pane (Properties) and grows it upward.
  await pick("Join Up");
  check((await shape()) === "row[insert, canvas, properties+outliner]", `Join Up keeps the lower pane and grows it up: ${await shape()}`);
  await viewMenuItem("Reset layout");

  // --- Blender's modal split: a phantom you place, then click to commit ----
  const canvasBox = async () => {
    const m = await leafMap();
    return m.find((l) => l.tabs.includes("canvas")).box;
  };

  // Arming it draws a phantom that follows the cursor rather than cutting.
  await openSash('[data-dock-splitter="vertical"]');
  await page.locator("[data-dock-areamenu] button", { hasText: "Vertical Split" }).click();
  const cb = await canvasBox();
  await page.mouse.move(cb.x + cb.width * 0.25, cb.y + cb.height / 2);
  await page.waitForTimeout(120);
  const armed = await page.evaluate(() => ({
    ghosts: [...document.querySelectorAll("[data-dock-splitghost]")].map((g) => g.dataset.dockSplitghost),
    aim: document.querySelector("[data-dock-splitaim]")?.dataset.dockSplitaim,
  }));
  check(
    armed.ghosts.join("|") === "first|second" && armed.aim === "row",
    `Vertical Split arms a two-part phantom over the hovered pane: ${JSON.stringify(armed)}`,
  );
  check((await shape()) === "row[insert, canvas, col[outliner, properties]]", `the phantom cuts nothing until you click: ${await shape()}`);

  // Tab flips the axis mid-flight, exactly as area_split_modal does.
  await page.keyboard.press("Tab");
  await page.waitForTimeout(120);
  const flipped = await page.evaluate(() => document.querySelector("[data-dock-splitaim]")?.dataset.dockSplitaim);
  check(flipped === "col", `Tab flips the pending split's axis: ${flipped}`);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(120);

  // Escape backs out without touching the layout.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const gone = await page.locator("[data-dock-splitghost]").count();
  check(gone === 0 && (await shape()) === "row[insert, canvas, col[outliner, properties]]", `Escape cancels the pending split: ${gone}, ${await shape()}`);

  // Click commits, at the fraction the phantom showed — a quarter across the
  // canvas means the new pane takes the larger, right-hand share.
  await openSash('[data-dock-splitter="vertical"]');
  await page.locator("[data-dock-areamenu] button", { hasText: "Vertical Split" }).click();
  const cb2 = await canvasBox();
  await page.mouse.move(cb2.x + cb2.width * 0.25, cb2.y + cb2.height / 2);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(350);
  check(
    (await shape()) === "row[insert, canvas, canvas#2, col[outliner, properties]]",
    `clicking commits the split where the phantom sat: ${await shape()}`,
  );
  const widths = (await leafMap()).filter((l) => l.tabs[0].startsWith("canvas")).map((l) => Math.round(l.box.width));
  check(
    widths.length === 2 && widths[1] > widths[0] * 1.8,
    `the split lands at the cursor's fraction, not at half: ${JSON.stringify(widths)}`,
  );
  await viewMenuItem("Reset layout");

  // Ctrl snaps to twelfths of the pane — Blender's div_array in
  // area_split_snap_calc_location. 0.30 across is not a twelfth; 4/12 is.
  await openSash('[data-dock-splitter="vertical"]');
  await page.locator("[data-dock-areamenu] button", { hasText: "Vertical Split" }).click();
  const cb3 = await canvasBox();
  const ghostFrac = async () => {
    const w = await page.evaluate(() => {
      const g = document.querySelector('[data-dock-splitghost="first"]');
      return g ? g.getBoundingClientRect().width : null;
    });
    return w === null ? null : w / cb3.width;
  };
  await page.mouse.move(cb3.x + cb3.width * 0.3, cb3.y + cb3.height / 2);
  await page.waitForTimeout(120);
  const loose = await ghostFrac();
  await page.keyboard.down("Control");
  await page.waitForTimeout(120);
  const snapped = await ghostFrac();
  await page.keyboard.up("Control");
  check(
    Math.abs(loose - 0.3) < 0.02 && Math.abs(snapped - 1 / 3) < 0.02,
    `Ctrl snaps the phantom to twelfths: free ${loose?.toFixed(3)} -> snapped ${snapped?.toFixed(3)}`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // A pane too small to halve, or holding a lone un-duplicable panel, refuses
  // with a whole-area ghost — Blender's area_split_allowed.
  await openSash('[data-dock-splitter="vertical"]');
  await page.locator("[data-dock-areamenu] button", { hasText: "Vertical Split" }).click();
  const ib = (await leafMap()).find((l) => l.tabs.includes("insert")).box;
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.waitForTimeout(120);
  const blocked = await page.evaluate(() => ({
    ghosts: [...document.querySelectorAll("[data-dock-splitghost]")].map((g) => g.dataset.dockSplitghost),
    aim: document.querySelector("[data-dock-splitaim]")?.dataset.dockSplitaim,
  }));
  check(
    blocked.ghosts.join("|") === "whole" && blocked.aim === "blocked",
    `a pane that can't be split shows one whole-area ghost: ${JSON.stringify(blocked)}`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await viewMenuItem("Reset layout");

  // --- overlays must survive the app's CSS zoom ----------------------------
  // The shell carries `zoom: appZoom`, so getBoundingClientRect reports visual
  // pixels while an absolutely-positioned overlay is laid out in local ones.
  // At 1.3 the split phantom used to sit 75px right of the pane it described.
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("uai:prefs") ?? "{}");
    localStorage.setItem("uai:prefs", JSON.stringify({ ...p, appZoom: 1.3 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const zCanvas = (await leafMap()).find((l) => l.tabs.includes("canvas")).box;

  // the drop overlay, aimed at a pane's middle, should cover that pane exactly
  const zTab = await box('[data-dock-tab="outliner"]');
  await page.mouse.move(zTab.x + zTab.width / 2, zTab.y + zTab.height / 2);
  await page.mouse.down();
  await page.mouse.move(zCanvas.x + zCanvas.width / 2, zCanvas.y + zCanvas.height / 2, { steps: 6 });
  await page.mouse.move(zCanvas.x + zCanvas.width / 2, zCanvas.y + zCanvas.height / 2);
  await page.waitForTimeout(200);
  const zOverlay = await page.evaluate(() => {
    const o = document.querySelector("[data-dock-zone]");
    const r = o.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(200);
  check(
    Math.abs(zOverlay.x - zCanvas.x) < 1.5 && Math.abs(zOverlay.w - zCanvas.width) < 1.5,
    `zoomed: the drop overlay covers the pane it targets: overlay ${zOverlay.x.toFixed(1)}/${zOverlay.w.toFixed(1)} vs pane ${zCanvas.x.toFixed(1)}/${zCanvas.width.toFixed(1)}`,
  );

  // and the split phantom should start exactly at that pane's edge
  await openSash('[data-dock-splitter="vertical"]');
  await page.locator("[data-dock-areamenu] button", { hasText: "Horizontal Split" }).click();
  await page.mouse.move(zCanvas.x + zCanvas.width / 2, zCanvas.y + zCanvas.height * 0.3);
  await page.waitForTimeout(150);
  const zGhost = await page.evaluate(() => {
    const g = document.querySelector('[data-dock-splitghost="first"]');
    const r = g.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check(
    Math.abs(zGhost.x - zCanvas.x) < 1.5 && Math.abs(zGhost.w - zCanvas.width) < 1.5,
    `zoomed: the split phantom sits on the pane it splits: ghost ${zGhost.x.toFixed(1)}/${zGhost.w.toFixed(1)} vs pane ${zCanvas.x.toFixed(1)}/${zCanvas.width.toFixed(1)}`,
  );

  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("uai:prefs") ?? "{}");
    localStorage.setItem("uai:prefs", JSON.stringify({ ...p, appZoom: 1 }));
  });

  if (shot) await page.screenshot({ path: `${shot}-dock.png` });
} catch (err) {
  // Without this an exception would skip the remaining checks and still exit
  // 0 — a green run that tested half of what it claims.
  check(false, `check script threw: ${err?.message ?? err}`);
} finally {
  await browser.close();
  done();
}
