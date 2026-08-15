/**
 * Editor-side mirror of the page document model (server/pages.ts) plus the
 * mutation helpers the edit() funnel applies. Every mutation deep-copies via
 * structuredClone — the funnel in App.tsx owns history.
 */

export type Align = "start" | "center" | "end" | "stretch";

export interface PageDoc {
  name: string;
  title: string;
  sections: Section[];
}
export interface Section {
  id: string;
  label?: string;
  background: "none" | "card" | "well";
  padding: string;
  gap: string;
  alignColumns?: Align;
  columns: Column[];
}
export interface Column {
  id: string;
  flex: string;
  gap: string;
  alignBlocks?: Align;
  blocks: Block[];
}
export interface BlockCommon {
  id: string;
  margin?: string;
  align?: Align;
  note?: string | null;
  needsData?: boolean;
  binding?: string;
  styles?: Record<string, string>;
}
export type Block =
  | (BlockCommon & { type: "heading"; level: 1 | 2 | 3; text: string; textAlign?: "left" | "center" | "right" })
  | (BlockCommon & { type: "text"; text: string; textAlign?: "left" | "center" | "right" })
  | (BlockCommon & { type: "button"; label: string })
  | (BlockCommon & { type: "image"; src: string; alt: string; width: string })
  | (BlockCommon & { type: "spacer"; height: string })
  | (BlockCommon & { type: "repeater"; collection: string; phHeight?: string })
  | (BlockCommon & { type: "component"; file: string; exportName: string; props: Record<string, unknown> });

export type SelKind = "section" | "column" | "block";
export interface Sel {
  kind: SelKind | null;
  id: string | null;
}

export const uid = () => Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------------------
// Code-is-truth file model (mirror of server/ast.ts model v2). IDs are
// EPHEMERAL — valid only until the next edit; every edit response replaces
// the whole model.
// ---------------------------------------------------------------------------

export interface StylePropModel {
  name: string;
  value: string | null;
  dynamic: boolean;
}
export interface ClassChunkModel {
  chunk: number;
  value: string;
  conditional: boolean;
}
export interface TextChildModel {
  slot: number;
  value: string;
}
export interface PropModel {
  name: string;
  kind: "string" | "number" | "boolean" | "expression" | "spread";
  valueText: string;
}
export interface JsxNodeModel {
  id: string;
  index: number;
  tag: string;
  parentId: string | null;
  slot: number;
  selfClosing: boolean;
  props: PropModel[];
  styleProps: StylePropModel[] | null;
  styleDynamic: boolean;
  classChunks: ClassChunkModel[];
  textChildren: TextChildModel[];
  componentSource: string | null;
  dynamic: boolean;
  dynamicLabel: string | null;
  can: { structural: boolean; text: boolean; style: boolean; classes: boolean };
  children: JsxNodeModel[];
}

export type FileEdit =
  | { op: "set-style-prop"; index: number; name: string; value: string | null }
  | { op: "set-class-chunk"; index: number; chunk: number; value: string }
  | { op: "set-text"; index: number; slot: number; value: string }
  | {
      op: "insert-element";
      parentIndex: number;
      childPos: number;
      jsx: string;
      imports?: { source: string; named?: string[]; default?: string }[];
    }
  | { op: "delete-element"; index: number }
  | { op: "move-element"; index: number; newParentIndex: number; childPos: number }
  | { op: "duplicate-element"; index: number }
  | {
      op: "set-prop";
      index: number;
      name: string;
      value: { kind: "string" | "expr" | "boolean-true" | "remove"; text?: string };
    }
  | { op: "set-class-string"; index: number; value: string; force?: boolean };

export function flattenModel(nodes: JsxNodeModel[], out: JsxNodeModel[] = []): JsxNodeModel[] {
  for (const m of nodes) {
    out.push(m);
    flattenModel(m.children, out);
  }
  return out;
}

export function findModelNode(nodes: JsxNodeModel[], id: string | null): JsxNodeModel | null {
  if (!id) return null;
  return flattenModel(nodes).find((m) => m.id === id) ?? null;
}

/** Deep-copy a section/column/block with fresh ids throughout — for paste
 * and duplicate, where reusing ids would break selection and codegen. */
export function reId<T extends Section | Column | Block>(node: T): T {
  const copy = structuredClone(node);
  const walk = (n: { id: string; columns?: Column[]; blocks?: Block[] }) => {
    n.id = uid();
    n.columns?.forEach(walk);
    n.blocks?.forEach(walk);
  };
  walk(copy);
  return copy;
}

export const KIND_LABEL: Record<Block["type"], string> = {
  heading: "Heading",
  text: "Paragraph",
  button: "Button",
  component: "Component",
  repeater: "Repeater",
  image: "Image",
  spacer: "Spacer",
};
export const TAG_OF: Record<Block["type"], string> = {
  heading: "h2",
  text: "p",
  button: "button",
  component: "Component",
  repeater: "Repeater",
  image: "img",
  spacer: "div",
};
export const GLYPH_OF: Record<Block["type"], string> = {
  heading: "H",
  text: "¶",
  button: "▭",
  component: "⧉",
  repeater: "≡",
  image: "▨",
  spacer: "↕",
};

export function blockTag(b: Block): string {
  if (b.type === "heading") return `h${b.level}`;
  if (b.type === "component") return b.exportName || "Component";
  return TAG_OF[b.type];
}

export function blockTitle(b: Block): string {
  if (b.type === "heading" || b.type === "text") return b.text;
  if (b.type === "button") return b.label;
  if (b.type === "component") return b.exportName;
  if (b.type === "repeater") return `repeats · ${b.collection}`;
  return KIND_LABEL[b.type];
}

export function blockText(b: Block): string | null {
  if (b.type === "heading" || b.type === "text") return b.text;
  if (b.type === "button") return b.label;
  return null;
}

export function setBlockTextValue(b: Block, text: string): void {
  if (b.type === "heading" || b.type === "text") b.text = text;
  else if (b.type === "button") b.label = text;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface BlockHit {
  sec: Section;
  col: Column;
  idx: number;
  block: Block;
}

export function locate(doc: PageDoc, id: string | null): BlockHit | null {
  if (!id) return null;
  for (const sec of doc.sections) {
    for (const col of sec.columns) {
      const idx = col.blocks.findIndex((b) => b.id === id);
      if (idx > -1) return { sec, col, idx, block: col.blocks[idx] };
    }
  }
  return null;
}

export function findColumn(doc: PageDoc, id: string | null) {
  if (!id) return null;
  for (const sec of doc.sections) {
    const ci = sec.columns.findIndex((c) => c.id === id);
    if (ci > -1) return { sec, ci, col: sec.columns[ci] };
  }
  return null;
}

export function findSection(doc: PageDoc, id: string | null) {
  if (!id) return null;
  const si = doc.sections.findIndex((s) => s.id === id);
  return si > -1 ? { si, sec: doc.sections[si] } : null;
}

/** Ordered scan of all blocks — note numbering and data counts derive from it. */
export function allBlocks(doc: PageDoc): { block: Block; sec: Section; col: Column }[] {
  const out: { block: Block; sec: Section; col: Column }[] = [];
  for (const sec of doc.sections)
    for (const col of sec.columns)
      for (const block of col.blocks) out.push({ block, sec, col });
  return out;
}

export function noteEntries(doc: PageDoc) {
  return allBlocks(doc)
    .filter((e) => e.block.note)
    .map((e, i) => ({ ...e, n: i + 1 }));
}

// ---------------------------------------------------------------------------
// Margin shorthand helpers (Space above/below + box model share block.margin)
// ---------------------------------------------------------------------------

export function parseBox(value: string | undefined): [string, string, string, string] {
  const p = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return ["0", "0", "0", "0"];
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  return [p[0], p[1], p[2], p[3]];
}

export function joinBox(t: string, r: string, b: string, l: string): string {
  const n = [t, r, b, l].map((s) => s.trim() || "0");
  if (n[0] === n[1] && n[1] === n[2] && n[2] === n[3]) return n[0];
  if (n[0] === n[2] && n[1] === n[3]) return `${n[0]} ${n[1]}`;
  return n.join(" ");
}

// ---------------------------------------------------------------------------
// Block factories (Insert palette specs)
// ---------------------------------------------------------------------------

export type NewSpec =
  | { type: "heading" | "text" | "button" | "image" | "spacer" | "repeater" }
  | { type: "component"; file: string; exportName: string; props: Record<string, unknown>; needsData?: boolean; note?: string; binding?: string };

export function makeBlock(spec: NewSpec): Block {
  const id = uid();
  switch (spec.type) {
    case "heading":
      return { id, type: "heading", level: 2, text: "New heading" };
    case "text":
      return { id, type: "text", text: "New paragraph." };
    case "button":
      return { id, type: "button", label: "Button" };
    case "image":
      return { id, type: "image", src: "", alt: "", width: "100%" };
    case "spacer":
      return { id, type: "spacer", height: "2rem" };
    case "repeater":
      return {
        id,
        type: "repeater",
        collection: "alerts",
        phHeight: "104px",
        needsData: true,
        note: "Bind to a sample-data collection; the real source is a dev note.",
        binding: "Repeater ← sample data: alerts",
      };
    case "component":
      return {
        id,
        type: "component",
        file: spec.file,
        exportName: spec.exportName,
        props: spec.props,
        needsData: spec.needsData,
        note: spec.note ?? null,
        binding: spec.binding,
      };
  }
}

export function defaultSection(): Section {
  return {
    id: uid(),
    label: "New section",
    background: "card",
    padding: "1.5rem",
    gap: "1.5rem",
    columns: [{ id: uid(), flex: "1", gap: "0.75rem", blocks: [] }],
  };
}

export function defaultDoc(name: string): PageDoc {
  const section = defaultSection();
  section.columns[0].blocks = [
    { id: uid(), type: "heading", level: 1, text: "New page" },
    { id: uid(), type: "text", text: "Start arranging blocks." },
  ];
  return { name, title: name, sections: [section] };
}
