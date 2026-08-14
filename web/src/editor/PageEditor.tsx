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
export interface Section {
  id: string;
  background: "none" | "card" | "well";
  padding: string;
  gap: string;
  columns: Column[];
}
export interface Column {
  id: string;
  flex: string;
  gap: string;
  blocks: Block[];
}
export type Block =
  | { id: string; type: "heading"; level: 1 | 2 | 3; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "button"; label: string }
  | { id: string; type: "image"; src: string; alt: string; width: string }
  | { id: string; type: "spacer"; height: string }
  | {
      id: string;
      type: "component";
      file: string;
      exportName: string;
      props: Record<string, unknown>;
    };

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

export function defaultDoc(name: string): PageDoc {
  return {
    name,
    title: name,
    sections: [
      {
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
              { id: uid(), type: "heading", level: 1, text: "New page" },
              { id: uid(), type: "text", text: "Start arranging blocks." },
            ],
          },
        ],
      },
    ],
  };
}

function defaultBlock(type: Block["type"]): Block {
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
          <Field
            label="padding"
            value={s.padding}
            onCommit={(v) => onChange(mutate(doc, (d) => (d.sections[si].padding = v)))}
          />
          <Field
            label="column gap"
            value={s.gap}
            onCommit={(v) => onChange(mutate(doc, (d) => (d.sections[si].gap = v)))}
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
