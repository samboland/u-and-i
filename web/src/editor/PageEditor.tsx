/**
 * Page-builder panels: document tree (layers) + inspector for the selected
 * section/column/block. The document is builder-owned; every change flows up
 * through onChange and is saved + regenerated server-side.
 */
import { useState } from "react";

// Mirror of server/pages.ts types.
export interface PageDoc {
  name: string;
  title: string;
  sections: Section[];
}
export type Align = "start" | "center" | "end" | "stretch";
export interface Section {
  id: string;
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
interface BlockCommon {
  id: string;
  margin?: string;
  align?: Align;
}
export type Block =
  | (BlockCommon & {
      type: "heading";
      level: 1 | 2 | 3;
      text: string;
      textAlign?: "left" | "center" | "right";
    })
  | (BlockCommon & {
      type: "text";
      text: string;
      textAlign?: "left" | "center" | "right";
    })
  | (BlockCommon & { type: "button"; label: string })
  | (BlockCommon & { type: "image"; src: string; alt: string; width: string })
  | (BlockCommon & { type: "spacer"; height: string })
  | (BlockCommon & {
      type: "component";
      file: string;
      exportName: string;
      props: Record<string, unknown>;
    });

export type PageSel = { kind: "section" | "column" | "block"; id: string } | null;

export const uid = () => Math.random().toString(36).slice(2, 9);

export function findKind(doc: PageDoc, id: string): PageSel {
  for (const s of doc.sections) {
    if (s.id === id) return { kind: "section", id };
    for (const c of s.columns) {
      if (c.id === id) return { kind: "column", id };
      for (const blk of c.blocks) if (blk.id === id) return { kind: "block", id };
    }
  }
  return null;
}

export function defaultSection(): Section {
  return {
    id: uid(),
    background: "card",
    padding: "1.5rem",
    gap: "1.5rem",
    columns: [
      {
        id: uid(),
        flex: "1",
        gap: "0.75rem",
        blocks: [
          { id: uid(), type: "heading", level: 2, text: "New section" },
        ],
      },
    ],
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

export function defaultBlock(type: Block["type"]): Block {
  const id = uid();
  switch (type) {
    case "heading":
      return { id, type, level: 2, text: "Heading" };
    case "text":
      return { id, type, text: "Some text." };
    case "button":
      return { id, type, label: "Click me" };
    case "image":
      return { id, type, src: "", alt: "", width: "100%" };
    case "spacer":
      return { id, type, height: "2rem" };
    case "component":
      return { id, type, file: "", exportName: "", props: {} };
  }
}

/** structuredClone + caller mutation — pragmatic immutable-enough updates. */
function mutate(doc: PageDoc, fn: (d: PageDoc) => void): PageDoc {
  const next = structuredClone(doc);
  fn(next);
  return next;
}

function move<T>(arr: T[], i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// ---------------------------------------------------------------------------
// Semantic ops driven by canvas drag & drop / inline editing
// ---------------------------------------------------------------------------

export function moveBlockTo(
  doc: PageDoc,
  blockId: string,
  targetColumnId: string,
  index: number,
): PageDoc {
  return mutate(doc, (d) => {
    let blk: Block | undefined;
    for (const s of d.sections) {
      for (const c of s.columns) {
        const i = c.blocks.findIndex((b) => b.id === blockId);
        if (i >= 0) {
          blk = c.blocks[i];
          c.blocks.splice(i, 1);
        }
      }
    }
    if (!blk) return;
    for (const s of d.sections) {
      for (const c of s.columns) {
        if (c.id === targetColumnId) {
          c.blocks.splice(Math.min(index, c.blocks.length), 0, blk);
          return;
        }
      }
    }
  });
}

export function moveSectionTo(doc: PageDoc, sectionId: string, index: number): PageDoc {
  return mutate(doc, (d) => {
    const i = d.sections.findIndex((s) => s.id === sectionId);
    if (i < 0) return;
    const [s] = d.sections.splice(i, 1);
    d.sections.splice(Math.min(index, d.sections.length), 0, s);
  });
}

/** A toolbox item being dragged onto the canvas. */
export type NewItem =
  | { kind: "block"; blockType: Exclude<Block["type"], "component"> }
  | {
      kind: "component";
      file: string;
      exportName: string;
      props: Record<string, unknown>;
    };

export function makeBlock(item: NewItem): Block {
  if (item.kind === "component") {
    return {
      id: uid(),
      type: "component",
      file: item.file,
      exportName: item.exportName,
      props: item.props,
    };
  }
  return defaultBlock(item.blockType);
}

/** Insert a new block; when columnId is null, drop targets an empty section —
 * create a column there to hold the block. Returns the new block's id. */
export function insertBlockAt(
  doc: PageDoc,
  item: NewItem,
  columnId: string | null,
  sectionId: string | null,
  index: number,
): { doc: PageDoc; id: string } {
  const block = makeBlock(item);
  const next = mutate(doc, (d) => {
    for (const s of d.sections) {
      for (const c of s.columns) {
        if (c.id === columnId) {
          c.blocks.splice(Math.min(index, c.blocks.length), 0, block);
          return;
        }
      }
    }
    for (const s of d.sections) {
      if (s.id === sectionId) {
        s.columns.push({ id: uid(), flex: "1", gap: "0.75rem", blocks: [block] });
        return;
      }
    }
  });
  return { doc: next, id: block.id };
}

export function insertSectionAt(doc: PageDoc, index: number): { doc: PageDoc; id: string } {
  const section = defaultSection();
  const next = mutate(doc, (d) => {
    d.sections.splice(Math.min(index, d.sections.length), 0, section);
  });
  return { doc: next, id: section.id };
}

export function insertColumnAt(
  doc: PageDoc,
  sectionId: string,
  index: number,
): { doc: PageDoc; id: string } {
  const column: Column = { id: uid(), flex: "1", gap: "0.75rem", blocks: [] };
  const next = mutate(doc, (d) => {
    for (const s of d.sections) {
      if (s.id === sectionId) {
        s.columns.splice(Math.min(index, s.columns.length), 0, column);
      }
    }
  });
  return { doc: next, id: column.id };
}

export function setBlockText(doc: PageDoc, blockId: string, text: string): PageDoc {
  return mutate(doc, (d) => {
    for (const s of d.sections)
      for (const c of s.columns)
        for (const b of c.blocks) {
          if (b.id !== blockId) continue;
          if (b.type === "heading" || b.type === "text") b.text = text;
          else if (b.type === "button") b.label = text;
        }
  });
}

// ---------------------------------------------------------------------------
// Toolbox — drag items out of here onto the canvas
// ---------------------------------------------------------------------------

export const MIME_BLOCK = "application/x-uai-new-block";
export const MIME_SECTION = "application/x-uai-new-section";
export const MIME_COLUMN = "application/x-uai-new-column";

function ToolItem({
  label,
  icon,
  mime,
  payload,
}: {
  label: string;
  icon: string;
  mime: string;
  payload?: NewItem;
}) {
  return (
    <div
      className="tool-item"
      draggable
      title={`Drag onto the page`}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(mime, JSON.stringify(payload ?? {}));
      }}
    >
      <span className="tool-icon">{icon}</span>
      {label}
    </div>
  );
}

export function Toolbox({
  componentFiles,
  componentExports,
  componentProps,
}: {
  componentFiles: string[];
  componentExports: Record<string, string>;
  componentProps: Record<string, Record<string, unknown>>;
}) {
  const blocks: { type: Exclude<Block["type"], "component">; label: string; icon: string }[] = [
    { type: "heading", label: "Heading", icon: "H" },
    { type: "text", label: "Text", icon: "¶" },
    { type: "button", label: "Button", icon: "▭" },
    { type: "image", label: "Image", icon: "🖼" },
    { type: "spacer", label: "Spacer", icon: "↕" },
  ];
  return (
    <div className="toolbox">
      {blocks.map((b) => (
        <ToolItem
          key={b.type}
          label={b.label}
          icon={b.icon}
          mime={MIME_BLOCK}
          payload={{ kind: "block", blockType: b.type }}
        />
      ))}
      <ToolItem label="Section" icon="▤" mime={MIME_SECTION} />
      <ToolItem label="Column" icon="▯" mime={MIME_COLUMN} />
      {componentFiles.map((f) => (
        <ToolItem
          key={f}
          label={f.split("/").pop()!.replace(/\.tsx$/, "")}
          icon="⧉"
          mime={MIME_BLOCK}
          payload={{
            kind: "component",
            file: f,
            exportName: componentExports[f] ?? "default",
            props: componentProps[f] ?? {},
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function blockLabel(b: Block): string {
  switch (b.type) {
    case "heading":
      return `h${b.level} ${b.text.slice(0, 16)}`;
    case "text":
      return `text ${b.text.slice(0, 16)}`;
    case "button":
      return `button ${b.label}`;
    case "image":
      return "image";
    case "spacer":
      return "spacer";
    case "component":
      return b.exportName || "component";
  }
}

export function PageTree({
  doc,
  sel,
  onSelect,
}: {
  doc: PageDoc;
  sel: PageSel;
  onSelect: (sel: PageSel) => void;
}) {
  const item = (
    id: string,
    kind: "section" | "column" | "block",
    depth: number,
    label: string,
  ) => (
    <button
      key={id}
      className={`tree-item${sel?.id === id ? " selected" : ""}`}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={() => onSelect({ kind, id })}
    >
      <span className="tag">{label}</span>
    </button>
  );
  return (
    <>
      {doc.sections.map((s, si) => (
        <div key={s.id}>
          {item(s.id, "section", 0, `section ${si + 1} (${s.background})`)}
          {s.columns.map((c, ci) => (
            <div key={c.id}>
              {item(c.id, "column", 1, `column ${ci + 1}`)}
              {c.blocks.map((b) => (
                <div key={b.id}>{item(b.id, "block", 2, blockLabel(b))}</div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Reset draft when target value changes identity.
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  return (
    <div className="row">
      <label>{label}</label>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
      />
    </div>
  );
}

/** Parse a CSS margin/padding shorthand into [top, right, bottom, left]. */
function parseBox(value: string): [string, string, string, string] {
  const p = value.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return ["0", "0", "0", "0"];
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  return [p[0], p[1], p[2], p[3]];
}

function joinBox(t: string, r: string, b: string, l: string): string {
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

/** Devtools-style 4-sided spacing control committing a CSS shorthand. */
function BoxField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const sides = parseBox(value || "0");
  const [draft, setDraft] = useState(sides);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(parseBox(value || "0"));
  }
  const commit = (next: [string, string, string, string]) => {
    const v = joinBox(...(next.map((s) => s.trim() || "0") as [string, string, string, string]));
    if (v !== (value || "0")) onCommit(v);
  };
  const input = (i: 0 | 1 | 2 | 3, cls: string) => (
    <input
      className={`box-input ${cls}`}
      type="text"
      value={draft[i]}
      onChange={(e) => {
        const next = [...draft] as typeof draft;
        next[i] = e.target.value;
        setDraft(next);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
  return (
    <div className="row">
      <label>{label}</label>
      <div className="boxmodel">
        {input(0, "box-t")}
        <div className="boxmodel-mid">
          {input(3, "box-l")}
          <div className="boxmodel-core" />
          {input(1, "box-r")}
        </div>
        {input(2, "box-b")}
      </div>
    </div>
  );
}

const ALIGN_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "start", label: "start" },
  { value: "center", label: "center" },
  { value: "end", label: "end" },
  { value: "stretch", label: "stretch" },
];

function AlignSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: Align | undefined) => void;
}) {
  return (
    <div className="row">
      <label>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange((e.target.value || undefined) as Align | undefined)}
      >
        {ALIGN_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const BLOCK_TYPES: Block["type"][] = [
  "heading",
  "text",
  "button",
  "image",
  "spacer",
  "component",
];

export function PageInspector({
  doc,
  sel,
  componentFiles,
  componentExports,
  onChange,
  onSelect,
}: {
  doc: PageDoc;
  sel: PageSel;
  componentFiles: string[];
  /** rel file path → export name (from mocks). */
  componentExports: Record<string, string>;
  onChange: (doc: PageDoc) => void;
  onSelect: (sel: PageSel) => void;
}) {
  const [addType, setAddType] = useState<Block["type"]>("heading");

  const pageControls = (
    <>
      <h2>Page</h2>
      <section>
        <Field
          label="title"
          value={doc.title}
          onCommit={(v) => onChange(mutate(doc, (d) => (d.title = v)))}
        />
        <div className="row">
          <button
            className="mini"
            onClick={() =>
              onChange(
                mutate(doc, (d) =>
                  d.sections.push(defaultDoc("x").sections[0]),
                ),
              )
            }
          >
            + add section
          </button>
        </div>
      </section>
    </>
  );

  if (!sel) {
    return (
      <>
        {pageControls}
        <div className="hint">Click a section, column, or block on the canvas.</div>
      </>
    );
  }

  // Locate selection context.
  let section: Section | undefined;
  let column: Column | undefined;
  let block: Block | undefined;
  let si = -1,
    ci = -1,
    bi = -1;
  doc.sections.forEach((s, i) => {
    if (s.id === sel.id) {
      section = s;
      si = i;
    }
    s.columns.forEach((c, j) => {
      if (c.id === sel.id) {
        section = s;
        si = i;
        column = c;
        ci = j;
      }
      c.blocks.forEach((b, k) => {
        if (b.id === sel.id) {
          section = s;
          si = i;
          column = c;
          ci = j;
          block = b;
          bi = k;
        }
      });
    });
  });

  if (sel.kind === "section" && section) {
    const s = section;
    return (
      <>
        <h2>Section</h2>
        <section>
          <div className="row">
            <label>background</label>
            <select
              value={s.background}
              onChange={(e) =>
                onChange(
                  mutate(doc, (d) => {
                    d.sections[si].background = e.target
                      .value as Section["background"];
                  }),
                )
              }
            >
              <option value="none">none</option>
              <option value="card">card (ui-card)</option>
              <option value="well">well (recessed)</option>
            </select>
          </div>
          <BoxField
            label="padding"
            value={s.padding}
            onCommit={(v) => onChange(mutate(doc, (d) => (d.sections[si].padding = v)))}
          />
          <Field
            label="column gap"
            value={s.gap}
            onCommit={(v) => onChange(mutate(doc, (d) => (d.sections[si].gap = v)))}
          />
          <AlignSelect
            label="align columns"
            value={s.alignColumns ?? ""}
            onChange={(v) =>
              onChange(mutate(doc, (d) => (d.sections[si].alignColumns = v)))
            }
          />
          <div className="row">
            <button
              className="mini"
              onClick={() =>
                onChange(
                  mutate(doc, (d) =>
                    d.sections[si].columns.push({
                      id: uid(),
                      flex: "1",
                      gap: "0.75rem",
                      blocks: [],
                    }),
                  ),
                )
              }
            >
              + column
            </button>
            <button className="mini" onClick={() => onChange(mutate(doc, (d) => move(d.sections, si, -1)))}>↑</button>
            <button className="mini" onClick={() => onChange(mutate(doc, (d) => move(d.sections, si, 1)))}>↓</button>
            <button
              className="mini danger"
              onClick={() => {
                onSelect(null);
                onChange(mutate(doc, (d) => void d.sections.splice(si, 1)));
              }}
            >
              delete
            </button>
          </div>
        </section>
        {pageControls}
      </>
    );
  }

  if (sel.kind === "column" && section && column) {
    return (
      <>
        <h2>Column</h2>
        <section>
          <Field
            label="flex"
            value={column.flex}
            onCommit={(v) =>
              onChange(mutate(doc, (d) => (d.sections[si].columns[ci].flex = v)))
            }
          />
          <Field
            label="gap"
            value={column.gap}
            onCommit={(v) =>
              onChange(mutate(doc, (d) => (d.sections[si].columns[ci].gap = v)))
            }
          />
          <AlignSelect
            label="align blocks"
            value={column.alignBlocks ?? ""}
            onChange={(v) =>
              onChange(
                mutate(doc, (d) => (d.sections[si].columns[ci].alignBlocks = v)),
              )
            }
          />
          <div className="row">
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value as Block["type"])}
            >
              {BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              className="mini"
              onClick={() =>
                onChange(
                  mutate(doc, (d) =>
                    d.sections[si].columns[ci].blocks.push(defaultBlock(addType)),
                  ),
                )
              }
            >
              + block
            </button>
            <button
              className="mini danger"
              onClick={() => {
                onSelect(null);
                onChange(
                  mutate(doc, (d) => void d.sections[si].columns.splice(ci, 1)),
                );
              }}
            >
              delete
            </button>
          </div>
        </section>
      </>
    );
  }

  if (sel.kind === "block" && block) {
    const b = block;
    const setBlock = (fn: (b: Block) => void) =>
      onChange(
        mutate(doc, (d) => fn(d.sections[si].columns[ci].blocks[bi])),
      );
    return (
      <>
        <h2>Block — {b.type}</h2>
        <section>
          {b.type === "heading" && (
            <>
              <Field label="text" value={b.text} onCommit={(v) => setBlock((x) => ((x as typeof b).text = v))} />
              <div className="row">
                <label>level</label>
                <select
                  value={String(b.level)}
                  onChange={(e) =>
                    setBlock((x) => ((x as typeof b).level = Number(e.target.value) as 1 | 2 | 3))
                  }
                >
                  <option value="1">h1</option>
                  <option value="2">h2</option>
                  <option value="3">h3</option>
                </select>
              </div>
            </>
          )}
          {b.type === "text" && (
            <Field label="text" value={b.text} onCommit={(v) => setBlock((x) => ((x as typeof b).text = v))} />
          )}
          {b.type === "button" && (
            <Field label="label" value={b.label} onCommit={(v) => setBlock((x) => ((x as typeof b).label = v))} />
          )}
          {b.type === "image" && (
            <>
              <Field label="src" value={b.src} onCommit={(v) => setBlock((x) => ((x as typeof b).src = v))} />
              <Field label="alt" value={b.alt} onCommit={(v) => setBlock((x) => ((x as typeof b).alt = v))} />
              <Field label="width" value={b.width} onCommit={(v) => setBlock((x) => ((x as typeof b).width = v))} />
            </>
          )}
          {b.type === "spacer" && (
            <Field label="height" value={b.height} onCommit={(v) => setBlock((x) => ((x as typeof b).height = v))} />
          )}
          {b.type === "component" && (
            <>
              <div className="row">
                <label>component</label>
                <select
                  value={b.file}
                  onChange={(e) => {
                    const file = e.target.value;
                    setBlock((x) => {
                      const cb = x as typeof b;
                      cb.file = file;
                      cb.exportName = componentExports[file] ?? "default";
                    });
                  }}
                >
                  <option value="">— pick —</option>
                  {componentFiles.map((f) => (
                    <option key={f} value={f}>
                      {f.split("/").pop()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <label>props</label>
                <textarea
                  rows={6}
                  defaultValue={JSON.stringify(b.props, null, 1)}
                  onBlur={(e) => {
                    try {
                      const props = JSON.parse(e.target.value);
                      setBlock((x) => ((x as typeof b).props = props));
                    } catch {
                      /* ignore bad JSON */
                    }
                  }}
                />
              </div>
            </>
          )}
          {(b.type === "heading" || b.type === "text") && (
            <div className="row">
              <label>text align</label>
              <select
                value={b.textAlign ?? ""}
                onChange={(e) =>
                  setBlock(
                    (x) =>
                      ((x as typeof b).textAlign = (e.target.value ||
                        undefined) as "left" | "center" | "right" | undefined),
                  )
                }
              >
                <option value="">—</option>
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </div>
          )}
          <AlignSelect
            label="align self"
            value={b.align ?? ""}
            onChange={(v) => setBlock((x) => (x.align = v))}
          />
          <BoxField
            label="margin"
            value={b.margin ?? "0"}
            onCommit={(v) => setBlock((x) => (x.margin = v))}
          />
          <div className="row">
            <button className="mini" onClick={() => onChange(mutate(doc, (d) => move(d.sections[si].columns[ci].blocks, bi, -1)))}>↑</button>
            <button className="mini" onClick={() => onChange(mutate(doc, (d) => move(d.sections[si].columns[ci].blocks, bi, 1)))}>↓</button>
            <button
              className="mini danger"
              onClick={() => {
                onSelect(null);
                onChange(
                  mutate(doc, (d) =>
                    void d.sections[si].columns[ci].blocks.splice(bi, 1),
                  ),
                );
              }}
            >
              delete
            </button>
          </div>
        </section>
      </>
    );
  }

  return <div className="hint">Selection not found — it may have been deleted.</div>;
}
