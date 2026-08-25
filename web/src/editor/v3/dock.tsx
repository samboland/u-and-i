/**
 * Docking layout — Blender/VS Code style, for the editor chrome.
 *
 * A layout is a tree of splits and leaves; a leaf is a tab strip holding one
 * or more panel ids. Panels are never free-standing: every card lives in a
 * leaf, so there are no floating windows to lose behind the canvas.
 *
 * The tree is plain data (`DockNode`), so App owns it as state and writes it
 * into the per-project session verbatim. All mutations here are pure
 * functions returning a new tree — never mutate in place.
 *
 * Panel ids are unique within a tree. A panel that may appear more than once
 * (the canvas) gets instance ids: "canvas", "canvas#2", … — `basePanel()`
 * strips the suffix so the caller can render by kind.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { C, MONO } from "./chrome";
import { Sym } from "./controls";

// ---------------------------------------------------------------- the tree

export interface DockLeaf {
  kind: "leaf";
  tabs: string[];
  active: string;
}
export interface DockSplit {
  kind: "split";
  dir: "row" | "col";
  /** Fractions, one per child, summing to 1. */
  sizes: number[];
  children: DockNode[];
}
export type DockNode = DockLeaf | DockSplit;

/** Where a dragged tab would land relative to a leaf (or the whole dock). */
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

/** `"canvas#2"` → `"canvas"`. Instance suffixes are a rendering detail. */
export function basePanel(id: string): string {
  const hash = id.indexOf("#");
  return hash === -1 ? id : id.slice(0, hash);
}

export function leaf(tabs: string[], active?: string): DockLeaf {
  return { kind: "leaf", tabs, active: active ?? tabs[0] ?? "" };
}
export function split(dir: "row" | "col", children: DockNode[], sizes?: number[]): DockSplit {
  return { kind: "split", dir, children, sizes: sizes ?? children.map(() => 1 / children.length) };
}

// ------------------------------------------------------------- tree walking

type Path = number[];

function nodeAt(root: DockNode, path: Path): DockNode | null {
  let n: DockNode = root;
  for (const i of path) {
    if (n.kind !== "split" || !n.children[i]) return null;
    n = n.children[i];
  }
  return n;
}

function replaceAt(root: DockNode, path: Path, next: DockNode): DockNode {
  if (path.length === 0) return next;
  if (root.kind !== "split") return root;
  const [i, ...rest] = path;
  const children = root.children.map((c, ci) => (ci === i ? replaceAt(c, rest, next) : c));
  return { ...root, children };
}

/** Every panel id currently in the tree, in visual order. */
export function panelsIn(root: DockNode): string[] {
  return root.kind === "leaf" ? [...root.tabs] : root.children.flatMap(panelsIn);
}

function mapLeaves(root: DockNode, f: (l: DockLeaf) => DockNode): DockNode {
  if (root.kind === "leaf") return f(root);
  return { ...root, children: root.children.map((c) => mapLeaves(c, f)) };
}

/**
 * Prune empty leaves, collapse single-child splits, flatten same-direction
 * nesting, and renormalize sizes. Returns null when nothing is left.
 */
export function normalize(root: DockNode | null): DockNode | null {
  if (!root) return null;
  if (root.kind === "leaf") {
    if (root.tabs.length === 0) return null;
    return root.tabs.includes(root.active) ? root : { ...root, active: root.tabs[0] };
  }

  const kept: DockNode[] = [];
  const sizes: number[] = [];
  root.children.forEach((child, i) => {
    const n = normalize(child);
    if (!n) return;
    const size = root.sizes[i] ?? 1 / root.children.length;
    // Same-direction nesting is invisible to the user; flatten so splitter
    // drags act on siblings that actually sit next to each other.
    if (n.kind === "split" && n.dir === root.dir) {
      n.children.forEach((gc, gi) => {
        kept.push(gc);
        sizes.push(size * (n.sizes[gi] ?? 1 / n.children.length));
      });
    } else {
      kept.push(n);
      sizes.push(size);
    }
  });

  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0];
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { kind: "split", dir: root.dir, children: kept, sizes: sizes.map((s) => s / total) };
}

function renameTab(root: DockNode, from: string, to: string): DockNode {
  return mapLeaves(root, (l) =>
    l.tabs.includes(from)
      ? { ...l, tabs: l.tabs.map((t) => (t === from ? to : t)), active: l.active === from ? to : l.active }
      : l,
  );
}

function dropTabFrom(root: DockNode, id: string): DockNode {
  return mapLeaves(root, (l) =>
    l.tabs.includes(id) ? { ...l, tabs: l.tabs.filter((t) => t !== id) } : l,
  );
}

/** Fraction a freshly split-off pane takes from its neighbour. */
const NEW_PANE = 0.32;

function insertInto(root: DockNode, path: Path, zone: DropZone, id: string, index?: number): DockNode {
  const target = nodeAt(root, path);
  if (!target) return root;
  if (zone === "center") {
    if (target.kind !== "leaf") return root;
    const tabs = [...target.tabs];
    tabs.splice(index ?? tabs.length, 0, id);
    return replaceAt(root, path, { kind: "leaf", tabs, active: id });
  }
  const dir = zone === "left" || zone === "right" ? "row" : "col";
  const first = zone === "left" || zone === "top";
  const added = leaf([id]);
  const next = split(
    dir,
    first ? [added, target] : [target, added],
    first ? [NEW_PANE, 1 - NEW_PANE] : [1 - NEW_PANE, NEW_PANE],
  );
  return replaceAt(root, path, next);
}

/**
 * Move `id` onto the leaf at `path` (or, with an empty path, onto the whole
 * dock's outer edge). Insert-then-remove via a sentinel keeps `path` valid:
 * removing first could restructure the tree under our feet.
 */
export function dockTab(root: DockNode, id: string, path: Path, zone: DropZone, index?: number): DockNode {
  const SENTINEL = "__uai_moving__";
  const marked = renameTab(root, id, SENTINEL);
  // The sentinel still occupies the source slot here, which is exactly what
  // keeps `index` honest when a tab is being re-ordered inside its own pane.
  const inserted = insertInto(marked, path, zone, id, index);
  return normalize(dropTabFrom(inserted, SENTINEL)) ?? leaf([id]);
}

/** Remove a panel from the layout entirely. Never returns an empty tree. */
export function closePanel(root: DockNode, id: string): DockNode {
  return normalize(dropTabFrom(root, id)) ?? root;
}

/** Add a panel next to (as a tab beside) the first leaf that will take it. */
export function addPanel(root: DockNode, id: string, near?: string): DockNode {
  if (panelsIn(root).includes(id)) return focusPanel(root, id);
  const path = near ? findLeaf(root, near) : null;
  return normalize(insertInto(root, path ?? findFirstLeaf(root), "center", id)) ?? leaf([id]);
}

/** Make `id` the active tab in whichever leaf holds it. */
export function focusPanel(root: DockNode, id: string): DockNode {
  return mapLeaves(root, (l) => (l.tabs.includes(id) ? { ...l, active: id } : l));
}

/** Next free instance id for a duplicable panel, e.g. "canvas#3". */
export function nextInstanceId(root: DockNode, base: string): string {
  const taken = new Set(panelsIn(root));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}#${n}`;
    if (!taken.has(id)) return id;
  }
}

// ------------------------------------------------- area options (the sash)

/** Append tabs to the first leaf of a subtree — the top-left one. */
function addTabsToFirstLeaf(n: DockNode, ids: string[]): DockNode {
  if (ids.length === 0) return n;
  if (n.kind === "leaf") return { ...n, tabs: [...n.tabs, ...ids] };
  return { ...n, children: n.children.map((c, k) => (k === 0 ? addTabsToFirstLeaf(c, ids) : c)) };
}

/**
 * Blender's Join: the two areas either side of a sash become one. `keep` says
 * which side survives and takes the combined space — note the MENU labels the
 * direction the survivor grows, so "Join Right" keeps the *left* pane.
 *
 * One deliberate departure from `screen_area_join_aligned`, which calls
 * `screen_delarea(sa2)`: we move the other side's panels in as tabs instead of
 * destroying them. Blender can afford to delete an editor because any area can
 * become any editor; our panel ids are unique, so a destroyed panel would have
 * to be hunted back out of the type dropdown.
 */
export function joinAt(root: DockNode, path: Path, i: number, keep: "first" | "second"): DockNode {
  const s = nodeAt(root, path);
  if (s?.kind !== "split" || !s.children[i + 1]) return root;
  const keepIdx = keep === "first" ? i : i + 1;
  const dropIdx = keep === "first" ? i + 1 : i;
  const survivor = addTabsToFirstLeaf(s.children[keepIdx], panelsIn(s.children[dropIdx]));

  const children: DockNode[] = [];
  const sizes: number[] = [];
  for (let k = 0; k < s.children.length; k++) {
    if (k === dropIdx) continue;
    children.push(k === keepIdx ? survivor : s.children[k]);
    sizes.push(k === keepIdx ? s.sizes[i] + s.sizes[i + 1] : s.sizes[k]);
  }
  const next: DockNode = children.length === 1 ? children[0] : { kind: "split", dir: s.dir, children, sizes };
  return normalize(replaceAt(root, path, next)) ?? root;
}

/**
 * Blender's Swap Areas: the two panes trade places. Sizes stay with the
 * POSITION, not the pane, so the geometry is untouched and only the contents
 * move — which is what "swap areas" looks like on screen.
 */
export function swapAt(root: DockNode, path: Path, i: number): DockNode {
  const s = nodeAt(root, path);
  if (s?.kind !== "split" || !s.children[i + 1]) return root;
  const children = [...s.children];
  [children[i], children[i + 1]] = [children[i + 1], children[i]];
  return replaceAt(root, path, { ...s, children });
}

/**
 * Blender's Split. Blender clones the editor into the new half; our panels are
 * unique instances, so instead the pane's ACTIVE tab moves into the new half
 * — tearing a stacked tab out into its own area. A pane holding a single
 * panel can only be split if that panel is duplicable (the canvas), for which
 * the caller supplies a fresh instance id.
 */
export function splitLeafAt(
  root: DockNode,
  path: Path,
  dir: "row" | "col",
  newId?: string | null,
  factor = 0.5,
): DockNode {
  const l = nodeAt(root, path);
  if (l?.kind !== "leaf") return root;

  let moved: string;
  let rest: DockNode;
  if (l.tabs.length > 1) {
    moved = l.active;
    const tabs = l.tabs.filter((t) => t !== moved);
    rest = { kind: "leaf", tabs, active: tabs[0] };
  } else if (newId) {
    moved = newId;
    rest = l;
  } else {
    return root;
  }
  // Caller-side clamping is the meaningful one (it knows the pane's pixels);
  // this only keeps a degenerate value out of the tree.
  const f = Math.min(0.98, Math.max(0.02, factor));
  return normalize(replaceAt(root, path, split(dir, [rest, leaf([moved])], [f, 1 - f]))) ?? root;
}

/** Can `splitLeafAt` do anything here? Drives the menu's disabled state. */
export function canSplit(root: DockNode, path: Path, duplicable: boolean): boolean {
  const l = nodeAt(root, path);
  return l?.kind === "leaf" && (l.tabs.length > 1 || duplicable);
}

function findLeaf(root: DockNode, id: string, path: Path = []): Path | null {
  if (root.kind === "leaf") return root.tabs.includes(id) ? path : null;
  for (let i = 0; i < root.children.length; i++) {
    const hit = findLeaf(root.children[i], id, [...path, i]);
    if (hit) return hit;
  }
  return null;
}
function findFirstLeaf(root: DockNode, path: Path = []): Path {
  return root.kind === "leaf" ? path : findFirstLeaf(root.children[0], [...path, 0]);
}

/** Cheap structural check for layouts coming back from persisted session JSON. */
export function isDockNode(v: unknown): v is DockNode {
  if (!v || typeof v !== "object") return false;
  const n = v as Partial<DockSplit> & Partial<DockLeaf>;
  if (n.kind === "leaf") {
    return Array.isArray(n.tabs) && n.tabs.every((t) => typeof t === "string") && typeof n.active === "string";
  }
  if (n.kind === "split") {
    return (
      (n.dir === "row" || n.dir === "col") &&
      Array.isArray(n.children) &&
      n.children.length > 0 &&
      Array.isArray(n.sizes) &&
      n.sizes.length === n.children.length &&
      n.sizes.every((s) => typeof s === "number" && s > 0) &&
      n.children.every(isDockNode)
    );
  }
  return false;
}

// ------------------------------------------------------------------ drag UI

/** Smallest a pane may be squeezed to by a splitter drag. */
const MIN_PANE = 120;
/** Pointer travel before a tab press becomes a drag. */
const DRAG_SLOP = 5;

/**
 * How close to the dock's outer border buys a band spanning the whole dock,
 * and the gutter that keeps most of that zone off the panes themselves. The
 * top row's headers start at the dock's top edge, so without the gutter the
 * edge zone sat right on them and made a caret drop there nearly unhittable.
 */
const EDGE = 10;
/**
 * The space between panes — the panes are rounded cards, and this gap is what
 * separates them. The sash's grab area is widened past it (see Splitter) so a
 * seam this narrow stays easy to catch.
 *
 * The gutter is the ring around the grid. It was dead space — the one border
 * in the dock that belonged to no sash, visible but unclickable (Sam,
 * 2026-08-25). It is now LIVE: right-click it for the adjoining pane's Split
 * options (see EdgeBorders). That matters beyond tidiness — a dock reduced to
 * a single pane has no sashes at all, so without a clickable outer border
 * there is no way to ever split again.
 *
 * Blender reaches the same place by a different route: its
 * `screen_geom_area_map_find_active_scredge` skips edges on the window
 * bounds, but the top and bottom edges of the work area are shared with the
 * global topbar/status areas, so they ARE real edges you can act on.
 *
 * Both numbers came down from 6 (Sam: "still too much space").
 */
const GUTTER = 4;
const GAP = 4;
/** How far the sash's grab area reaches past the gap, each side. */
const GRAB = 4;
/** Card corner radius. */
const RADIUS = 8;

/**
 * Is a dock modal (the split phantom) running? Blender lets a running modal
 * operator eat events before the keymap gets them; we have no keymap layer,
 * so the editor's global chord handler asks this first. Without it Tab stays
 * owned by App (toggle interact), which `stopPropagation`s it before the
 * modal's own window listener — registered later — ever runs.
 */
let modalRunning = false;
export const dockModalActive = () => modalRunning;

interface DragState {
  id: string;
  x: number;
  y: number;
  /** null until the pointer clears the slop threshold. */
  over: {
    path: Path;
    zone: DropZone;
    rect: DOMRect;
    /** Where in the target pane's tab order the panel lands. */
    index?: number;
    /** Insertion caret, when the drop is aimed at a pane's header. */
    line?: { left: number; top: number; height: number };
  } | null;
}

/**
 * The app shell carries a CSS `zoom` (App.tsx, from the appZoom pref). Under
 * `zoom`, `getBoundingClientRect()` reports VISUAL pixels while a style value
 * on an absolutely-positioned child is read as LOCAL ones — so every measured
 * length has to come back through here before it can be used as a style, or
 * the overlays drift further from the panes the further they are from the
 * dock's origin. Anything already written as a constant (GAP, RADIUS) is
 * local by construction and must NOT be divided.
 */
function zoomOf(el: HTMLElement | null | undefined): number {
  if (!el) return 1;
  // Chrome exposes the accumulated ancestor zoom directly; the ratio is the
  // fallback (clientWidth is integral, so it is very slightly lossy).
  const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
  if (typeof z === "number" && z > 0) return z;
  const r = el.getBoundingClientRect();
  return el.clientWidth > 0 ? r.width / el.clientWidth : 1;
}

/** A measured rect, expressed in the dock root's own layout pixels. */
function localRect(rect: DOMRect, root: DOMRect, scale: number) {
  return {
    left: (rect.left - root.left) / scale,
    top: (rect.top - root.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** A leaf's key is its path joined by dots — "" for a lone root leaf. */
function pathOfKey(key: string): Path {
  return key === "" ? [] : key.split(".").map(Number);
}

/**
 * Which zone of a pane the pointer is in, as proportions rather than pixel
 * bands. Fixed bands behaved differently in a 240px sidebar than in a 900px
 * canvas — in a narrow pane the two side bands nearly met and the middle
 * was a sliver. Proportions make every zone the same shape everywhere:
 * the middle two-fifths is "dock as a tab", the rest belongs to the nearest
 * edge.
 */
function zoneOf(rect: DOMRect, x: number, y: number): DropZone {
  const u = (x - rect.left) / (rect.width || 1);
  const v = (y - rect.top) / (rect.height || 1);
  if (u >= 0.3 && u <= 0.7 && v >= 0.3 && v <= 0.7) return "center";
  const m = Math.min(u, 1 - u, v, 1 - v);
  if (m === u) return "left";
  if (m === 1 - u) return "right";
  if (m === v) return "top";
  return "bottom";
}

/**
 * The drop feedback, modelled on VS Code's editor drop target
 * (`editordroptarget.css` + `editorDropTarget.ts`): one flat translucent
 * panel that glides between targets rather than four competing highlights.
 *
 * Their numbers, kept deliberately: fill `#53595D` at 50% for dark themes —
 * a neutral wash, not an accent colour; no border and no radius; position
 * and size ease at 70ms, opacity at 150ms. The move transition is switched
 * on only AFTER the overlay has appeared, so it fades in where it belongs
 * instead of sliding in from wherever it last sat.
 */
function DropOverlay({ over, root, scale }: { over: DragState["over"]; root: DOMRect; scale: number }) {
  const [eased, setEased] = useState(false);
  const visible = !!over;
  const lastBox = useRef<CSSProperties>({ left: 0, top: 0, width: 0, height: 0 });
  if (over) lastBox.current = previewBox(over.rect, root, over.zone, scale);

  useEffect(() => {
    if (!visible) {
      setEased(false);
      return;
    }
    const f = requestAnimationFrame(() => setEased(true));
    return () => cancelAnimationFrame(f);
  }, [visible]);

  const move = "top 70ms ease-out, left 70ms ease-out, width 70ms ease-out, height 70ms ease-out, ";
  return (
    <>
      <div
        data-dock-zone={over?.zone ?? ""}
        data-dock-target={over ? (over.path.length === 0 ? "dock" : over.path.join(".")) : ""}
        style={{
          position: "absolute",
          ...lastBox.current,
          background: "rgba(83,89,93,0.5)",
          opacity: visible ? 1 : 0,
          pointerEvents: "none",
          zIndex: 60,
          transition: `${eased ? move : ""}opacity 150ms ease-out`,
        }}
      />
      {/* Aimed at a header: a caret showing exactly where in the tab order it
          lands. This is also the only way to re-order tabs. */}
      <div
        data-dock-caret={over?.index ?? ""}
        style={{
          position: "absolute",
          left: ((over?.line?.left ?? 0) - root.left) / scale,
          top: ((over?.line?.top ?? 0) - root.top) / scale,
          width: 2,
          height: (over?.line?.height ?? 0) / scale,
          background: C.blueLight,
          borderRadius: 1,
          opacity: over?.line ? 1 : 0,
          pointerEvents: "none",
          zIndex: 61,
          transition: `${eased ? move : ""}opacity 100ms ease-out`,
        }}
      />
    </>
  );
}

/** Preview rectangle (in the dock root's layout pixels) for a pending drop. */
function previewBox(rect: DOMRect, root: DOMRect, zone: DropZone, scale: number): CSSProperties {
  const { left, top, width: w, height: h } = localRect(rect, root, scale);
  if (zone === "center") return { left, top, width: w, height: h };
  if (zone === "left") return { left, top, width: w * NEW_PANE, height: h };
  if (zone === "right") return { left: left + w * (1 - NEW_PANE), top, width: w * NEW_PANE, height: h };
  if (zone === "top") return { left, top, width: w, height: h * NEW_PANE };
  return { left, top: top + h * (1 - NEW_PANE), width: w, height: h * NEW_PANE };
}

// ------------------------------------------------------- the split preview

/**
 * Picking a Split from Area Options doesn't cut anything yet — it arms a
 * phantom, exactly as Blender's `area_split_modal` does. Move to place the
 * line, click to commit, Escape or right-click to back out.
 */
interface SplitAim {
  dir: "row" | "col";
  /** The leaf under the cursor. Re-picked on every move: Blender's modal calls
   *  `BKE_screen_find_area_xy(event->xy)` each time, so sliding into a
   *  neighbouring pane re-targets the split rather than clamping to the pane
   *  you started in. */
  path: Path | null;
  rect: DOMRect | null;
  /** 0..1 along the split axis of that pane. */
  factor: number;
  /** Ctrl held: `area_split_snap_calc_location`. */
  snap: boolean;
  /** Cleared when the pane can't take a split — too small, or nothing to move
   *  into the new half. Blender's `area_split_allowed` + our unique-id limit. */
  allowed: boolean;
}

/** Blender snaps to twelfths of the area, and to any other edge that lines up.
 *  Ours has no free vertices, so the second half is the other panes' sashes
 *  along the same axis — the same intent, expressed in a split tree.
 *
 *  Works in the same gapless space as `factor` itself (see `aimAt`). */
function snapFactor(factor: number, innerSpan: number, innerOrigin: number, others: number[]): number {
  const span = innerSpan || 1;
  const cursor = innerOrigin + factor * span;

  let best = factor;
  let bestDist = Infinity;
  for (let i = 0; i <= 12; i++) {
    const d = Math.abs(cursor - (innerOrigin + (span * i) / 12));
    if (d < bestDist) { bestDist = d; best = i / 12; }
  }
  for (const at of others) {
    const d = Math.abs(cursor - at);
    // Only inside this pane; the ends would mean "no split".
    if (d < bestDist && at > innerOrigin && at < innerOrigin + span) { bestDist = d; best = (at - innerOrigin) / span; }
  }
  return best;
}

/**
 * Blender's `screen_draw_split_preview`: two outlined ghosts, one either side
 * of the pending line — white at 10% fill, 40% outline. At either extreme (it
 * uses `factor < 0.0001 || factor > 0.9999`) it stops proposing a cut and
 * highlights the whole area instead, which is also what we show when the pane
 * can't be split at all.
 */
function SplitPreview({ aim, root, scale }: { aim: SplitAim; root: DOMRect; scale: number }) {
  if (!aim.rect) return null;
  const inner = "rgba(255,255,255,0.10)";
  const outline = "1px solid rgba(255,255,255,0.4)";
  const { left, top, width: w, height: h } = localRect(aim.rect, root, scale);

  const ghost = (s: CSSProperties, key: string) => (
    <div
      key={key}
      data-dock-splitghost={key}
      style={{ position: "absolute", background: inner, border: outline, borderRadius: RADIUS, boxSizing: "border-box", pointerEvents: "none", zIndex: 60, ...s }}
    />
  );

  if (!aim.allowed || aim.factor < 0.0001 || aim.factor > 0.9999) {
    return ghost({ left, top, width: w, height: h }, "whole");
  }
  // The halves divide the pane minus the splitter between them, exactly as
  // the committed `sizes` will (see `aimAt`).
  const usable = (aim.dir === "row" ? w : h) - GAP;
  const cut = Math.max(0, usable * aim.factor);
  const restSize = Math.max(0, usable - cut);
  return aim.dir === "row"
    ? (
      <>
        {ghost({ left, top, width: cut, height: h }, "first")}
        {ghost({ left: left + cut + GAP, top, width: restSize, height: h }, "second")}
      </>
    )
    : (
      <>
        {ghost({ left, top, width: w, height: cut }, "first")}
        {ghost({ left, top: top + cut + GAP, width: w, height: restSize }, "second")}
      </>
    );
}

// -------------------------------------------------------------- the component

export interface DockProps {
  layout: DockNode;
  onLayout: (next: DockNode) => void;
  /** Display name per panel id (instance ids included). */
  title: (id: string) => string;
  /** Material Symbols glyph name per panel id. */
  icon: (id: string) => string;
  /** Panel body. Every tab in a leaf stays mounted; inactive ones are hidden,
   *  so switching tabs never reloads the canvas iframe. */
  render: (id: string) => ReactNode;
  /**
   * The active panel's own controls, laid inline in the pane header — the
   * Blender arrangement: one header row per pane, not a tab strip above a
   * title bar. Panels with no controls return null.
   */
  renderHeader?: (id: string) => ReactNode;
  /** Panels offered by the pane's type dropdown, in menu order. */
  panelMenu?: string[];
  /**
   * A fresh instance id for a panel that may appear more than once, or null.
   * Lets Area Options ▸ Split work on a pane holding a single canvas.
   */
  newInstance?: (id: string) => string | null;
}

export function Dock({ layout, onLayout, title, icon, render, renderHeader, panelMenu, newInstance }: DockProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const leaves = useRef(new Map<string, HTMLElement>());
  const [sash, setSash] = useState<SashMenu | null>(null);
  const [aim, setAim] = useState<SplitAim | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const registerLeaf = useCallback((key: string, el: HTMLElement | null) => {
    if (el) leaves.current.set(key, el);
    else leaves.current.delete(key);
  }, []);

  const leafUnder = useCallback((x: number, y: number): { key: string; rect: DOMRect } | null => {
    for (const [key, el] of leaves.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { key, rect };
    }
    return null;
  }, []);

  /** The pane adjoining a point on the outer border. Measured rather than
   *  derived from the tree: the tree knows nothing about which leaf ended up
   *  against which edge. */
  const leafNearest = useCallback((x: number, y: number, side: "top" | "right" | "bottom" | "left"): Path | null => {
    let best: { key: string; d: number } | null = null;
    for (const [key, el] of leaves.current) {
      const r = el.getBoundingClientRect();
      // Distance along the edge's own axis, then perpendicular to it, so a
      // click near a corner picks the pane that actually touches that side.
      const along = side === "top" || side === "bottom"
        ? Math.max(r.left - x, x - r.right, 0)
        : Math.max(r.top - y, y - r.bottom, 0);
      const across = side === "top" ? r.top - y
        : side === "bottom" ? y - r.bottom
        : side === "left" ? r.left - x
        : x - r.right;
      const d = along * 1000 + Math.abs(across);
      if (!best || d < best.d) best = { key, d };
    }
    return best ? pathOfKey(best.key) : null;
  }, []);

  // --- split preview (Blender's modal) --------------------------------------

  /** Re-aim at whatever pane the cursor is over now, and work out the factor. */
  const aimAt = useCallback((dir: "row" | "col", x: number, y: number, snap: boolean): SplitAim => {
    const hit = leafUnder(x, y);
    if (!hit) return { dir, path: null, rect: null, factor: 0.5, snap, allowed: false };
    const path = pathOfKey(hit.key);
    const node = nodeAt(layout, path);

    // `area_split_allowed`: the pane must be at least double the minimum on
    // the split axis. Plus our own limit — something has to move into the
    // new half, so a lone un-duplicable panel can't split.
    const span = dir === "row" ? hit.rect.width : hit.rect.height;
    const dup = node?.kind === "leaf" ? (newInstance?.(node.active) ?? null) : null;
    const allowed = span >= 2 * MIN_PANE && canSplit(layout, path, !!dup);

    /* `factor` is the stored size fraction, and the sizes divide the pane
     * MINUS the splitter that will sit between the halves — a `flexBasis`
     * child shrinks to make room for it. Measuring the cursor as a plain
     * fraction of the whole pane therefore committed a split a couple of
     * pixels off the line the phantom drew. Work in the gapless span, with
     * the cursor as the seam's centre, and the two agree exactly. */
    const origin = dir === "row" ? hit.rect.left : hit.rect.top;
    const inner = Math.max(1, span - GAP);
    const innerOrigin = origin + GAP / 2;
    let factor = ((dir === "row" ? x : y) - innerOrigin) / inner;

    if (snap) {
      const seams = [...(rootRef.current?.querySelectorAll<HTMLElement>(`[data-dock-splitter="${dir === "row" ? "vertical" : "horizontal"}"]`) ?? [])]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return dir === "row" ? r.left + r.width / 2 : r.top + r.height / 2;
        });
      factor = snapFactor(factor, inner, innerOrigin, seams);
    }

    // Neither half may go under the minimum — Blender clamps the same way,
    // to its `bigger`/`smaller` limits. Only meaningful when a split is on.
    const minF = MIN_PANE / inner;
    factor = allowed
      ? Math.min(1 - minF, Math.max(minF, factor))
      : Math.min(1, Math.max(0, factor));
    return { dir, path, rect: hit.rect, factor, snap, allowed };
  }, [layout, leafUnder, newInstance]);

  /** The modal's live state. A ref, not effect-local: `newInstance` and
   *  `onLayout` are inline props, so the effect below is re-created on any
   *  parent render — effect-local state would silently reset the axis you
   *  flipped and the cursor position you aimed with. */
  const aimCtl = useRef({ dir: "row" as "row" | "col", x: 0, y: 0, snap: false, ok: false });

  const beginSplit = useCallback((dir: "row" | "col", x: number, y: number) => {
    aimCtl.current = { dir, x, y, snap: false, ok: true };
    setAim(aimAt(dir, x, y, false));
  }, [aimAt]);

  useEffect(() => {
    modalRunning = !!aim;
    return () => { modalRunning = false; };
  }, [aim]);

  useEffect(() => {
    if (!aim) return;
    const ctl = aimCtl.current;

    const repaint = () => { if (ctl.ok) setAim(aimAt(ctl.dir, ctl.x, ctl.y, ctl.snap)); };
    const flip = () => { ctl.dir = ctl.dir === "row" ? "col" : "row"; repaint(); };
    const move = (e: PointerEvent) => {
      ctl.x = e.clientX; ctl.y = e.clientY; ctl.snap = e.ctrlKey; ctl.ok = true;
      repaint();
    };
    // Commit on release, not press: the click that chose the menu item is
    // still travelling, and a press-to-commit would swallow it.
    const up = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const shot = ctl.ok ? aimAt(ctl.dir, ctl.x, ctl.y, ctl.snap) : null;
      setAim(null);
      if (shot?.path && shot.allowed && shot.factor > 0.0001 && shot.factor < 0.9999) {
        const node = nodeAt(layout, shot.path);
        const dup = node?.kind === "leaf" ? (newInstance?.(node.active) ?? null) : null;
        onLayout(splitLeafAt(layout, shot.path, shot.dir, dup, shot.factor));
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setAim(null); return; }
      // Blender: Tab (or middle mouse) flips the axis mid-modal.
      if (e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); flip(); return; }
      if (e.key === "Control") { ctl.snap = true; repaint(); }
    };
    const keyUp = (e: KeyboardEvent) => { if (e.key === "Control") { ctl.snap = false; repaint(); } };
    const aux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      flip();
    };
    const ctx = (e: MouseEvent) => { e.preventDefault(); setAim(null); };

    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("auxclick", aux, true);
    window.addEventListener("contextmenu", ctx, true);
    window.addEventListener("blur", () => setAim(null), { once: true });
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("auxclick", aux, true);
      window.removeEventListener("contextmenu", ctx, true);
    };
    // Re-armed only when a preview starts, not on every factor change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!aim, aimAt, layout, onLayout, newInstance]);

  // --- tab drag ------------------------------------------------------------

  /** `onTap` fires when the pointer went down and up without ever clearing
   *  the drag threshold — that is a click, and the header uses it to open the
   *  pane's type dropdown. */
  const startDrag = useCallback((id: string, ev: React.PointerEvent, onTap?: () => void) => {
    if (ev.button !== 0) return;
    const origin = { x: ev.clientX, y: ev.clientY };
    let armed = false;

    const under = (x: number, y: number): { key: string; el: HTMLElement; rect: DOMRect } | null => {
      for (const [key, el] of leaves.current) {
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { key, el, rect };
      }
      return null;
    };

    const hit = (x: number, y: number): DragState["over"] => {
      // 1. Hard against the dock's border: a band spanning the whole dock.
      //    Kept narrow so it barely eats into the top row's headers, and the
      //    overlay shows the full-span result the moment you arrive.
      const rootRect = rootRef.current?.getBoundingClientRect();
  const scale = zoomOf(rootRef.current);
      if (rootRect) {
        if (x - rootRect.left < EDGE) return { path: [], zone: "left", rect: rootRect };
        if (rootRect.right - x < EDGE) return { path: [], zone: "right", rect: rootRect };
        if (y - rootRect.top < EDGE) return { path: [], zone: "top", rect: rootRect };
        if (rootRect.bottom - y < EDGE) return { path: [], zone: "bottom", rect: rootRect };
      }

      const leafHit = under(x, y);
      if (!leafHit) return null;
      const path = pathOfKey(leafHit.key);
      const bar = leafHit.el.querySelector<HTMLElement>("[data-dock-tabbar]");
      const headerRect = bar?.getBoundingClientRect();

      // 2. A pane's header: add a tab, at the position the caret shows. The
      //    icons render in model order, so the icon index IS the tab index.
      if (bar && headerRect && y <= headerRect.bottom) {
        const icons = [...bar.querySelectorAll<HTMLElement>("[data-dock-tab]")];
        let index = icons.length;
        for (let i = 0; i < icons.length; i++) {
          const r = icons[i].getBoundingClientRect();
          if (x < r.left + r.width / 2) {
            index = i;
            break;
          }
        }
        const anchor = index < icons.length ? icons[index].getBoundingClientRect().left - 3 : (icons.at(-1)?.getBoundingClientRect().right ?? headerRect.left) + 2;
        return {
          path,
          zone: "center",
          rect: leafHit.rect,
          index,
          line: { left: anchor, top: headerRect.top + 3, height: headerRect.height - 6 },
        };
      }

      // 3. Otherwise, the pane's own five zones.
      return { path, zone: zoneOf(leafHit.rect, x, y), rect: leafHit.rect };
    };

    const move = (e: PointerEvent) => {
      if (!armed && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_SLOP) return;
      armed = true;
      setDrag({ id, x: e.clientX, y: e.clientY, over: hit(e.clientX, e.clientY) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!armed) {
        onTap?.();
        return;
      }
      const d = dragRef.current;
      setDrag(null);
      if (d?.over) onLayout(dockTab(layout, d.id, d.over.path, d.over.zone, d.over.index));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [layout, onLayout]);

  // A drag that outlives its pointer (alt-tab, devtools) would leave the
  // ghost stuck; Escape and blur both cancel.
  useEffect(() => {
    if (!drag) return;
    const cancel = () => setDrag(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setDrag(null); };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key); };
  }, [drag]);

  const rootRect = rootRef.current?.getBoundingClientRect();
  const scale = zoomOf(rootRef.current);

  return (
    <div
      ref={rootRef}
      data-dock-root
      style={{ flex: 1, position: "relative", display: "flex", minWidth: 0, minHeight: 0, padding: GUTTER, background: C.void }}
    >
      <DockBranch
        node={layout}
        path={[]}
        layout={layout}
        onLayout={onLayout}
        title={title}
        icon={icon}
        render={render}
        renderHeader={renderHeader}
        panelMenu={panelMenu}
        registerLeaf={registerLeaf}
        onTabDown={startDrag}
        onSashMenu={setSash}
        dragging={drag?.id ?? null}
      />

      <EdgeBorders
        onMenu={(e, side) => {
          const leaf = leafNearest(e.clientX, e.clientY, side);
          if (leaf) setSash({ kind: "edge", x: e.clientX, y: e.clientY, leaf });
        }}
      />

      {sash && (
        <AreaOptions
          menu={sash}
          layout={layout}
          title={title}
          onClose={() => setSash(null)}
          onLayout={onLayout}
          onBeginSplit={beginSplit}
          scale={scale}
        />
      )}

      {/* Same iframe problem as the tab drag: without a shield the phantom
          freezes the moment the cursor crosses the canvas. The split cursor
          lives here too, so it holds across every pane. */}
      {aim && (
        <div
          data-dock-splitaim={aim.allowed ? aim.dir : "blocked"}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 55,
            cursor: !aim.allowed ? "not-allowed" : aim.dir === "row" ? "col-resize" : "row-resize",
          }}
        />
      )}
      {aim && rootRect && <SplitPreview aim={aim} root={rootRect} scale={scale} />}

      {/* A pointer over an iframe delivers its events to THAT document, not
          ours — so dragging across the canvas silently froze the drop preview
          at whatever it read just before the cursor crossed the frame edge.
          This shield sits above the panes for the duration of the drag so the
          moves keep arriving. It must stay below the previews, which are
          pointer-transparent anyway. */}
      {drag && (
        <div style={{ position: "absolute", inset: 0, zIndex: 55, cursor: "grabbing" }} />
      )}

      {drag && rootRect && <DropOverlay over={drag.over} root={rootRect} scale={scale} />}
      {drag && (
        <div
          style={{
            position: "fixed",
            // Fixed, but still inside the zoomed subtree, so the pointer's
            // viewport coordinates need the same conversion. The nudge is
            // written in local pixels and stays as it is.
            left: drag.x / scale + 12,
            top: drag.y / scale + 10,
            padding: "3px 9px",
            background: C.menu,
            border: `1px solid ${C.borderHover}`,
            borderRadius: 4,
            color: C.text,
            fontSize: 11,
            pointerEvents: "none",
            zIndex: 200,
            boxShadow: "0 8px 20px rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Sym name={icon(drag.id)} size={13} />
          {title(drag.id)}
        </div>
      )}
    </div>
  );
}

interface BranchProps {
  node: DockNode;
  path: Path;
  layout: DockNode;
  onLayout: (n: DockNode) => void;
  title: (id: string) => string;
  icon: (id: string) => string;
  render: (id: string) => ReactNode;
  renderHeader?: (id: string) => ReactNode;
  panelMenu?: string[];
  registerLeaf: (key: string, el: HTMLElement | null) => void;
  onTabDown: (id: string, ev: React.PointerEvent, onTap?: () => void) => void;
  onSashMenu: (m: SashMenu) => void;
  dragging: string | null;
}

/**
 * An open Area Options menu. A sash between two panes offers the lot; the
 * dock's outer border has only one neighbour, so Join and Swap have no
 * meaning there and it offers Split alone.
 */
type SashMenu =
  | {
      kind: "pair";
      x: number;
      y: number;
      /** The split node holding the pair. */
      path: Path;
      /** The sash sits between children i and i+1. */
      i: number;
      dir: "row" | "col";
    }
  | { kind: "edge"; x: number; y: number; /** The one adjoining pane. */ leaf: Path };

function DockBranch(props: BranchProps) {
  const { node, path } = props;
  return node.kind === "leaf" ? <DockLeafView {...props} node={node} /> : <DockSplitView {...props} node={node} key={path.join(".")} />;
}

function DockSplitView({ node, path, ...rest }: BranchProps & { node: DockSplit }) {
  const ref = useRef<HTMLDivElement>(null);
  const row = node.dir === "row";

  const startResize = (i: number, ev: React.PointerEvent) => {
    ev.preventDefault();
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const total = row ? box.width : box.height;
    if (total <= 0) return;
    const start = row ? ev.clientX : ev.clientY;
    const a0 = node.sizes[i];
    const b0 = node.sizes[i + 1];
    const min = MIN_PANE / total;

    const move = (e: PointerEvent) => {
      const d = ((row ? e.clientX : e.clientY) - start) / total;
      const a = Math.min(Math.max(a0 + d, min), a0 + b0 - min);
      if (!Number.isFinite(a)) return;
      const sizes = node.sizes.map((s, si) => (si === i ? a : si === i + 1 ? a0 + b0 - a : s));
      rest.onLayout(replaceAt(rest.layout, path, { ...node, sizes }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={ref} style={{ flex: 1, display: "flex", flexDirection: row ? "row" : "column", minWidth: 0, minHeight: 0 }}>
      {node.children.flatMap((child, i) => {
        const pane = (
          <div key={i} style={{ display: "flex", flexBasis: `${node.sizes[i] * 100}%`, flexGrow: 0, flexShrink: 1, minWidth: 0, minHeight: 0 }}>
            <DockBranch {...rest} node={child} path={[...path, i]} />
          </div>
        );
        return i < node.children.length - 1
          ? [
              pane,
              <Splitter
                key={`s${i}`}
                row={row}
                onDown={(e) => startResize(i, e)}
                onMenu={(e) => rest.onSashMenu({ kind: "pair", x: e.clientX, y: e.clientY, path, i, dir: node.dir })}
              />,
            ]
          : [pane];
      })}
    </div>
  );
}

/**
 * The seam between two panes. Not a drawn line: the panes are rounded cards
 * with a real gap between them, so the barrier IS the gap, the way VS Code's
 * newer window chrome does it. A hairline squeezed between two square panes
 * read as a smudge and Sam called it — cards and space are legible, a 1px
 * divider between flush surfaces is not.
 *
 * The only mark is a three-dot grip at the middle of the seam, so a draggable
 * gap doesn't look like dead space.
 */
function Splitter({
  row,
  onDown,
  onMenu,
}: {
  row: boolean;
  onDown: (e: React.PointerEvent) => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const [hot, setHot] = useState(false);
  return (
    <div
      // The sash's own orientation, not the parent split's direction: a
      // row-split is divided by a VERTICAL seam.
      data-dock-splitter={row ? "vertical" : "horizontal"}
      style={{
        flex: `0 0 ${GAP}px`,
        position: "relative",
        background: "transparent",
        zIndex: 6,
      }}
    >
      {/* The grab area overhangs the gap on both sides, so the seam can look
          as narrow as it should without being fiddly to grab. */}
      <div
        onPointerDown={onDown}
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => setHot(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMenu(e);
        }}
        style={{
          position: "absolute",
          ...(row ? { top: 0, bottom: 0, left: -GRAB, right: -GRAB } : { left: 0, right: 0, top: -GRAB, bottom: -GRAB }),
          // `ew-`/`ns-resize` (plain double arrows), not `col-`/`row-resize`
          // (Sam, 2026-08-25): those draw a split bar, which is the wrong
          // promise on a sash you drag to resize. The split MODAL keeps the
          // split-shaped cursor, where it means what it draws.
          cursor: row ? "ew-resize" : "ns-resize",
        }}
      />
      {/* Centred by transform, not by flex: the seam is only GAP px across, and
          under the app's CSS zoom the track and the grip round independently,
          so flex centring visibly drifted off the seam at some zooms (Sam,
          2026-08-25). A 50% offset plus a -50% translate stays put because
          both are fractions of the same box. */}
      <div
        data-dock-grip
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: row ? "column" : "row",
          gap: 2,
          pointerEvents: "none",
          opacity: hot ? 1 : 0.5,
          transition: "opacity 120ms ease-out",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 2,
              height: 2,
              borderRadius: 1,
              background: hot ? C.blueLight : C.faint,
              transition: "background 120ms ease-out",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Blender's Area Options, on right-click of a sash. Join and Swap act on the
 * pair either side of it; Split arms a phantom you then place by hand, so it
 * isn't tied to this seam at all.
 */
function AreaOptions({
  menu,
  layout,
  title,
  onClose,
  onLayout,
  onBeginSplit,
  scale,
}: {
  menu: SashMenu;
  layout: DockNode;
  title: (id: string) => string;
  scale: number;
  onClose: () => void;
  onLayout: (n: DockNode) => void;
  onBeginSplit: (dir: "row" | "col", x: number, y: number) => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", onClose);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const nameOf = (n: DockNode | null | undefined) =>
    n?.kind === "leaf" ? title(n.active) : "group";

  const pair = menu.kind === "pair" ? nodeAt(layout, menu.path) : null;
  if (menu.kind === "pair" && pair?.kind !== "split") return null;
  const names =
    menu.kind === "pair" && pair?.kind === "split"
      ? [menu.i, menu.i + 1].map((k) => nameOf(pair.children[k]))
      : [nameOf(menu.kind === "edge" ? nodeAt(layout, menu.leaf) : null)];

  /* Order and meaning read from Blender's `screen_area_options_invoke`: the
   * label is the direction the SURVIVOR grows, not which pane you keep. "Join
   * Right" keeps the left pane and expands it rightwards. Blender lists
   * Right-then-Left for a vertical seam and Up-then-Down for a horizontal one
   * (its Y axis points up, ours down — hence the asymmetric `keep`). */
  const joins: { word: string; icon: string; keep: "first" | "second" }[] =
    menu.kind !== "pair"
      ? []
      : menu.dir === "row"
      ? [
          { word: "Right", icon: "arrow_forward", keep: "first" },
          { word: "Left", icon: "arrow_back", keep: "second" },
        ]
      : [
          { word: "Up", icon: "arrow_upward", keep: "second" },
          { word: "Down", icon: "arrow_downward", keep: "first" },
        ];

  const act = (next: DockNode) => {
    onClose();
    onLayout(next);
  };

  /* Split arms a phantom rather than cutting on the spot — Blender's
   * `area_split_invoke` goes modal and `screen_draw_split_preview` follows the
   * cursor. So there is no target to name and nothing to grey out here: the
   * modal re-picks the pane on every move, and refuses with a whole-area
   * ghost over panes that can't take a cut. */
  const arm = (dir: "row" | "col") => (e: React.MouseEvent) => {
    onClose();
    onBeginSplit(dir, e.clientX, e.clientY);
  };

  const items: { label: string; icon: string; run: (e: React.MouseEvent) => void; sep?: boolean }[] = [
    { label: "Vertical Split", icon: "splitscreen_vertical_add", run: arm("row") },
    { label: "Horizontal Split", icon: "splitscreen_add", run: arm("col") },
    // Blender guards its Join and Swap entries with `if (sa1 && sa2)` for the
    // same reason: one neighbour, nothing to join or swap it with.
    ...(menu.kind === "pair"
      ? [
          { label: "", icon: "", sep: true, run: () => {} },
          ...joins.map((j) => ({
            label: `Join ${j.word}`,
            icon: j.icon,
            run: () => act(joinAt(layout, menu.path, menu.i, j.keep)),
          })),
          { label: "", icon: "", sep: true, run: () => {} },
          { label: "Swap Areas", icon: "swap_horiz", run: () => act(swapAt(layout, menu.path, menu.i)) },
        ]
      : []),
  ];

  const left = Math.max(4, Math.min(menu.x / scale, window.innerWidth / scale - 210));
  const top = Math.max(4, Math.min(menu.y / scale, window.innerHeight / scale - 200));
  return (
    <div
      data-dock-areamenu
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left, top, minWidth: 196, background: C.menu, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 14px 30px rgba(0,0,0,0.55)", padding: "4px 0", zIndex: 200 }}
    >
      <div style={{ padding: "3px 10px 5px", fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.09em", whiteSpace: "nowrap" }}>
        Area Options · {names.join(" | ")}
      </div>
      {items.map((it, k) =>
        it.sep ? (
          <div key={k} style={{ height: 1, background: C.border, margin: "4px 0" }} />
        ) : (
          <button
            key={k}
            className="hv-menu"
            title={it.label.endsWith("Split") ? "Move to place the split, click to confirm. Tab flips it, Ctrl snaps, Esc cancels." : undefined}
            onClick={it.run}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 24, padding: "0 10px", background: "none", border: "none", color: C.body, cursor: "pointer", textAlign: "left" }}
          >
            <Sym name={it.icon} size={14} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

/**
 * The dock's outer border, made clickable. It carries no sash — there is
 * nothing beyond it to resize against — so it does not drag; right-click gets
 * the adjoining pane's Split options.
 *
 * Without this the border ring is the one piece of dock chrome you can see
 * and not use, and a dock reduced to a single pane can never be split again.
 *
 * The strips cover the gutter plus a couple of pixels of the pane's own
 * rounded edge, to make a 4px ring a comfortable target. They sit above the
 * panes (so a right-click over the canvas iframe reaches us at all — an
 * iframe would otherwise swallow it) but below the drag shield.
 */
function EdgeBorders({ onMenu }: { onMenu: (e: React.MouseEvent, side: "top" | "right" | "bottom" | "left") => void }) {
  const reach = GUTTER + 2;
  const sides: { side: "top" | "right" | "bottom" | "left"; style: CSSProperties }[] = [
    { side: "top", style: { top: 0, left: 0, right: 0, height: reach } },
    { side: "bottom", style: { bottom: 0, left: 0, right: 0, height: reach } },
    { side: "left", style: { left: 0, top: 0, bottom: 0, width: reach } },
    { side: "right", style: { right: 0, top: 0, bottom: 0, width: reach } },
  ];
  return (
    <>
      {sides.map(({ side, style }) => (
        <div
          key={side}
          data-dock-edge={side}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMenu(e, side);
          }}
          // It cannot be dragged, so it must not promise a resize. Every other
          // edge in the dock changes the cursor; a border that did nothing at
          // all read as dead (Sam, 2026-08-25).
          style={{ position: "absolute", zIndex: 20, cursor: "context-menu", ...style }}
        />
      ))}
    </>
  );
}

/** Square icon button — the header's whole vocabulary. */
function iconBtn(active: boolean, faded: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    gap: 1,
    height: 20,
    padding: "0 3px",
    background: active ? C.ctlHover : "transparent",
    border: "none",
    borderRadius: 4,
    color: active ? "#fff" : C.muted,
    cursor: "grab",
    opacity: faded ? 0.4 : 1,
    userSelect: "none",
  };
}

/**
 * One pane. Blender's arrangement: a single header row whose leftmost control
 * is a small icon dropdown naming the panel, with that panel's own buttons
 * inline to its right. Other panels docked here sit beside it as bare icons —
 * no wide text tabs, and no separate title bar underneath.
 */
function DockLeafView({ node, path, title, icon, render, renderHeader, panelMenu, registerLeaf, onTabDown, dragging, layout, onLayout }: BranchProps & { node: DockLeaf }) {
  const key = path.join(".");
  const ref = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    registerLeaf(key, ref.current);
    return () => registerLeaf(key, null);
  }, [key, registerLeaf]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    // Capture phase: the menu's own buttons stopPropagation, everything else
    // (including a click in another pane) dismisses.
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const header = renderHeader?.(node.active);

  return (
    <div
      ref={ref}
      data-dock-leaf={key}
      // A rounded card with a hairline outline, floating on the dock's void.
      // The outline is what keeps the canvas pane — whose body is the same
      // near-black as the gap — from dissolving into the background.
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS,
        overflow: "hidden",
      }}
    >
      <div
        data-dock-tabbar
        style={{ flex: "0 0 auto", minHeight: 26, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, padding: "3px 6px", background: C.sunken, borderBottom: `1px solid ${C.border}`, minWidth: 0 }}
      >
        {/* Tabs in MODEL order, so a drop's insertion line means what it looks
            like it means. The active one is the type dropdown, wherever it
            happens to sit; the rest are bare icons. */}
        {node.tabs.map((id) =>
          id === node.active ? (
        <div key={id} style={{ flex: "0 0 auto", position: "relative" }}>
          <button
            className="hv-ctl"
            data-dock-tab={node.active}
            data-dock-type
            title={`${title(node.active)} — click to switch, drag to move`}
            onPointerDown={(e) => onTabDown(node.active, e, () => setMenuOpen((v) => !v))}
            onClick={(e) => e.stopPropagation()}
            style={iconBtn(true, dragging === node.active)}
          >
            <Sym name={icon(node.active)} size={15} />
            <span style={{ fontSize: 7, color: C.faint, lineHeight: 1 }}>▼</span>
          </button>
          {menuOpen && panelMenu && (
            <div
              data-dock-typemenu
              onClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", top: 23, left: 0, minWidth: 170, background: C.menu, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 14px 30px rgba(0,0,0,0.55)", padding: "4px 0", zIndex: 50 }}
            >
              {panelMenu.map((id) => {
                const here = node.tabs.includes(id);
                return (
                  <button
                    key={id}
                    className="hv-menu"
                    onClick={() => {
                      setMenuOpen(false);
                      // Already in this pane? Just show it. Otherwise pull it
                      // here from wherever it lives.
                      onLayout(here ? focusPanel(layout, id) : dockTab(layout, id, path, "center"));
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 24, padding: "0 10px", background: "none", border: "none", color: here ? "#fff" : C.body, cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ flex: "0 0 12px", color: C.blueLight, fontSize: 11 }}>{id === node.active ? "•" : ""}</span>
                    <Sym name={icon(id)} size={14} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{title(id)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
          ) : (
            <button
              key={id}
              className="hv-ctl"
              data-dock-tab={id}
              title={title(id)}
              onPointerDown={(e) => onTabDown(id, e, () => onLayout(focusPanel(layout, id)))}
              onClick={(e) => e.stopPropagation()}
              style={iconBtn(false, dragging === id)}
            >
              <Sym name={icon(id)} size={15} />
            </button>
          ),
        )}

        {header && <div style={{ flex: "0 0 auto", width: 1, height: 15, background: C.border, margin: "0 1px" }} />}

        {/* The active panel's own controls, inline — the point of the exercise.
            The panel owns the spacing inside this box, so a toolbar that wants
            something flushed right (the canvas's Mode switch) still gets it. */}
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {header}
        </div>

      </div>
      {node.tabs.map((id) => (
        <div
          key={id}
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: id === node.active ? "flex" : "none",
            flexDirection: "column",
          }}
        >
          {render(id)}
        </div>
      ))}
    </div>
  );
}
