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

function insertInto(root: DockNode, path: Path, zone: DropZone, id: string): DockNode {
  const target = nodeAt(root, path);
  if (!target) return root;
  if (zone === "center") {
    if (target.kind !== "leaf") return root;
    return replaceAt(root, path, { kind: "leaf", tabs: [...target.tabs, id], active: id });
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
export function dockTab(root: DockNode, id: string, path: Path, zone: DropZone): DockNode {
  const SENTINEL = "__uai_moving__";
  const marked = renameTab(root, id, SENTINEL);
  const inserted = insertInto(marked, path, zone, id);
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

interface DragState {
  id: string;
  x: number;
  y: number;
  /** null until the pointer clears the slop threshold. */
  over: { path: Path; zone: DropZone; rect: DOMRect } | null;
}

/** A leaf's key is its path joined by dots — "" for a lone root leaf. */
function pathOfKey(key: string): Path {
  return key === "" ? [] : key.split(".").map(Number);
}

function zoneOf(rect: DOMRect, x: number, y: number, tabBarBottom: number): DropZone {
  if (y <= tabBarBottom) return "center";
  const bandX = Math.min(rect.width * 0.3, 90);
  const bandY = Math.min(rect.height * 0.3, 90);
  const dl = x - rect.left;
  const dr = rect.right - x;
  const dt = y - rect.top;
  const db = rect.bottom - y;
  const min = Math.min(dl < bandX ? dl : Infinity, dr < bandX ? dr : Infinity, dt < bandY ? dt : Infinity, db < bandY ? db : Infinity);
  if (min === Infinity) return "center";
  if (min === dl) return "left";
  if (min === dr) return "right";
  if (min === dt) return "top";
  return "bottom";
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
  /** Panel body. Every tab in a leaf stays mounted; inactive ones are hidden,
   *  so switching tabs never reloads the canvas iframe. */
  render: (id: string) => ReactNode;
  /** Panels the user may close from the tab strip. Default: all. */
  closable?: (id: string) => boolean;
}

export function Dock({ layout, onLayout, title, render, closable }: DockProps) {
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

  const startDrag = useCallback((id: string, ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    const origin = { x: ev.clientX, y: ev.clientY };
    let armed = false;

    const hit = (x: number, y: number): DragState["over"] => {
      // Outer edges of the whole dock win over any leaf: that is how you get
      // a panel back out to a full-height column.
      const rootRect = rootRef.current?.getBoundingClientRect();
      if (rootRect) {
        const edge = 18;
        if (x - rootRect.left < edge) return { path: [], zone: "left", rect: rootRect };
        if (rootRect.right - x < edge) return { path: [], zone: "right", rect: rootRect };
        if (y - rootRect.top < edge) return { path: [], zone: "top", rect: rootRect };
        if (rootRect.bottom - y < edge) return { path: [], zone: "bottom", rect: rootRect };
      }
      for (const [key, el] of leaves.current) {
        const rect = el.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        const bar = el.querySelector<HTMLElement>("[data-dock-tabbar]");
        const barBottom = bar ? bar.getBoundingClientRect().bottom : rect.top;
        return { path: pathOfKey(key), zone: zoneOf(rect, x, y, barBottom), rect };
      }
      return null;
    };

    const move = (e: PointerEvent) => {
      if (!armed && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_SLOP) return;
      armed = true;
      setDrag({ id, x: e.clientX, y: e.clientY, over: hit(e.clientX, e.clientY) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current;
      setDrag(null);
      if (d?.over) onLayout(dockTab(layout, d.id, d.over.path, d.over.zone));
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
    <div ref={rootRef} style={{ flex: 1, position: "relative", display: "flex", minWidth: 0, minHeight: 0 }}>
      <DockBranch
        node={layout}
        path={[]}
        layout={layout}
        onLayout={onLayout}
        title={title}
        render={render}
        closable={closable}
        registerLeaf={registerLeaf}
        onTabDown={startDrag}
        dragging={drag?.id ?? null}
      />

      {drag?.over && rootRect && (
        <div
          style={{
            position: "absolute",
            ...previewBox(drag.over.rect, rootRect, drag.over.zone),
            background: "rgba(50,142,193,0.18)",
            border: `1px solid ${C.blue}`,
            borderRadius: 3,
            pointerEvents: "none",
            zIndex: 60,
          }}
        />
      )}
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
          }}
        >
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
  render: (id: string) => ReactNode;
  closable?: (id: string) => boolean;
  registerLeaf: (key: string, el: HTMLElement | null) => void;
  onTabDown: (id: string, ev: React.PointerEvent) => void;
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

function Splitter({ row, onDown }: { row: boolean; onDown: (e: React.PointerEvent) => void }) {
  const [hot, setHot] = useState(false);
  return (
    <div
      onPointerDown={onDown}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      style={{
        flex: "0 0 4px",
        background: hot ? C.blue : C.border,
        cursor: row ? "col-resize" : "row-resize",
        transition: "background 90ms",
      }}
    />
  );
}

function DockLeafView({ node, path, title, render, closable, registerLeaf, onTabDown, dragging, layout, onLayout }: BranchProps & { node: DockLeaf }) {
  const key = path.join(".");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerLeaf(key, ref.current);
    return () => registerLeaf(key, null);
  }, [key, registerLeaf]);

  return (
    <div
      ref={ref}
      data-dock-leaf={key}
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: C.panel, borderRight: `1px solid ${C.border}`, overflow: "hidden" }}
    >
      <div
        data-dock-tabbar
        style={{ flex: "0 0 24px", display: "flex", alignItems: "stretch", background: C.sunken, borderBottom: `1px solid ${C.border}`, overflowX: "auto", overflowY: "hidden" }}
      >
        {node.tabs.map((id) => {
          const active = id === node.active;
          return (
            <div
              key={id}
              data-dock-tab={id}
              onPointerDown={(e) => { onLayout(focusPanel(layout, id)); onTabDown(id, e); }}
              title={title(id)}
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 8px",
                background: active ? C.panel : "transparent",
                borderRight: `1px solid ${C.border}`,
                color: active ? "#fff" : C.muted,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                cursor: "grab",
                opacity: dragging === id ? 0.4 : 1,
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              {title(id)}
              {(closable?.(id) ?? true) && (
                <span
                  className="hv-close"
                  onPointerDown={(e) => { e.stopPropagation(); }}
                  onClick={(e) => { e.stopPropagation(); onLayout(closePanel(layout, id)); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 13, height: 13, borderRadius: 3, color: C.faint, fontFamily: MONO, fontSize: 10, cursor: "pointer" }}
                >
                  ×
                </span>
              )}
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
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
