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
const EDGE = 12;
const GUTTER = 6;

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
function DropOverlay({ over, root }: { over: DragState["over"]; root: DOMRect }) {
  const [eased, setEased] = useState(false);
  const visible = !!over;
  const lastBox = useRef<CSSProperties>({ left: 0, top: 0, width: 0, height: 0 });
  if (over) lastBox.current = previewBox(over.rect, root, over.zone);

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
          left: (over?.line?.left ?? 0) - root.left,
          top: (over?.line?.top ?? 0) - root.top,
          width: 2,
          height: over?.line?.height ?? 0,
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

/** Preview rectangle (relative to the dock root) for a pending drop. */
function previewBox(rect: DOMRect, root: DOMRect, zone: DropZone): CSSProperties {
  const left = rect.left - root.left;
  const top = rect.top - root.top;
  const w = rect.width;
  const h = rect.height;
  if (zone === "center") return { left, top, width: w, height: h };
  if (zone === "left") return { left, top, width: w * NEW_PANE, height: h };
  if (zone === "right") return { left: left + w * (1 - NEW_PANE), top, width: w * NEW_PANE, height: h };
  if (zone === "top") return { left, top, width: w, height: h * NEW_PANE };
  return { left, top: top + h * (1 - NEW_PANE), width: w, height: h * NEW_PANE };
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
  /** Panels the user may close from the header. Default: all. */
  closable?: (id: string) => boolean;
}

export function Dock({ layout, onLayout, title, icon, render, renderHeader, panelMenu, closable }: DockProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const leaves = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const registerLeaf = useCallback((key: string, el: HTMLElement | null) => {
    if (el) leaves.current.set(key, el);
    else leaves.current.delete(key);
  }, []);

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
        closable={closable}
        registerLeaf={registerLeaf}
        onTabDown={startDrag}
        dragging={drag?.id ?? null}
      />

      {/* A pointer over an iframe delivers its events to THAT document, not
          ours — so dragging across the canvas silently froze the drop preview
          at whatever it read just before the cursor crossed the frame edge.
          This shield sits above the panes for the duration of the drag so the
          moves keep arriving. It must stay below the previews, which are
          pointer-transparent anyway. */}
      {drag && (
        <div style={{ position: "absolute", inset: 0, zIndex: 55, cursor: "grabbing" }} />
      )}

      {drag && rootRect && <DropOverlay over={drag.over} root={rootRect} />}
      {drag && (
        <div
          style={{
            position: "fixed",
            left: drag.x + 12,
            top: drag.y + 10,
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
  closable?: (id: string) => boolean;
  registerLeaf: (key: string, el: HTMLElement | null) => void;
  onTabDown: (id: string, ev: React.PointerEvent, onTap?: () => void) => void;
  dragging: string | null;
}

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
          ? [pane, <Splitter key={`s${i}`} row={row} onDown={(e) => startResize(i, e)} />]
          : [pane];
      })}
    </div>
  );
}

/**
 * The seam between two panes. Painted as a single dark hairline — panes are
 * lighter than the gap, so the line reads as space between raised surfaces.
 * The grab area is much wider than the line: a 1px target would be miserable
 * to hit, and a 6px slab of near-panel grey (what this used to be, on top of
 * each pane's own border) just looked like a smudge.
 */
function Splitter({ row, onDown }: { row: boolean; onDown: (e: React.PointerEvent) => void }) {
  const [hot, setHot] = useState(false);
  return (
    <div
      data-dock-splitter={row ? "col" : "row"}
      onPointerDown={onDown}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      style={{
        flex: "0 0 7px",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        flexDirection: row ? "row" : "column",
        background: "transparent",
        cursor: row ? "col-resize" : "row-resize",
        zIndex: 6,
      }}
    >
      <div
        style={{
          flex: `0 0 ${hot ? 3 : 1}px`,
          background: hot ? C.blue : C.void,
          borderRadius: 2,
          transition: "flex-basis 90ms, background 90ms",
        }}
      />
    </div>
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
function DockLeafView({ node, path, title, icon, render, renderHeader, panelMenu, closable, registerLeaf, onTabDown, dragging, layout, onLayout }: BranchProps & { node: DockLeaf }) {
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
      // No border of its own: the seam between panes is the Splitter, and
      // doubling them made one mushy band instead of a clean line.
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: C.panel, overflow: "hidden" }}
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

        {(closable?.(node.active) ?? true) && (
          <button
            className="hv-close"
            title={`Close ${title(node.active)}`}
            onClick={(e) => { e.stopPropagation(); onLayout(closePanel(layout, node.active)); }}
            style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, background: "none", border: "none", borderRadius: 3, color: C.faint, fontFamily: MONO, fontSize: 11, cursor: "pointer" }}
          >
            ×
          </button>
        )}
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
