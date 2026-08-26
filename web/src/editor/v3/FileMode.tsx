/**
 * Code-is-truth file editing surface: the JSX outliner and the per-node
 * property card for a real source file. No save format — every commit here
 * becomes an AST edit against the file on disk, routed through App's
 * editFile funnel (which owns undo and selection re-anchoring).
 */
import { C, MONO, ctlBtn, inputStyle } from "./chrome";
import { Field, LENGTH_PROPS, Row, Seg, normalizeLen, sectionLabel } from "./controls";
import { OutlinerRow } from "./OutlinerRow";
import { type FileEdit, type JsxNodeModel } from "./model";

// ---------------------------------------------------------------------------
// Outliner
// ---------------------------------------------------------------------------

/** Material Symbols icon per JSX tag (rounded set, self-hosted font). */
function nodeGlyph(m: JsxNodeModel): { glyph: string; color: string } {
  if (/^[A-Z]/.test(m.tag)) return { glyph: "deployed_code", color: C.blueLight };
  if (/^h[1-6]$/.test(m.tag)) return { glyph: `format_h${m.tag[1]}`, color: C.muted };
  if (m.tag === "p" || m.tag === "span") return { glyph: "notes", color: C.muted };
  if (m.tag === "img" || m.tag === "svg") return { glyph: "image", color: C.muted };
  if (m.tag === "button") return { glyph: "smart_button", color: C.muted };
  if (m.tag === "a") return { glyph: "link", color: C.muted };
  if (m.tag === "ul" || m.tag === "ol" || m.tag === "li") return { glyph: "format_list_bulleted", color: C.muted };
  if (m.tag === "input" || m.tag === "textarea" || m.tag === "select") return { glyph: "input", color: C.muted };
  if (m.tag === "table") return { glyph: "table", color: C.muted };
  return { glyph: "crop_square", color: C.muted };
}

/** Blender's collapsed-parent icon row: the hidden subtree's icons, merged by
 *  kind with a count overlaid as text when more than one. Visual-only. */
function CollapsedIcons({ nodes }: { nodes: JsxNodeModel[] }) {
  const merged = new Map<string, { color: string; n: number }>();
  const walk = (list: JsxNodeModel[]) => {
    for (const c of list) {
      const g = nodeGlyph(c);
      const e = merged.get(g.glyph);
      if (e) e.n += 1;
      else merged.set(g.glyph, { color: g.color, n: 1 });
      walk(c.children);
    }
  };
  walk(nodes);
  const entries = [...merged.entries()].slice(0, 4);
  return (
    <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 4, opacity: 0.6 }}>
      {entries.map(([glyph, e]) => (
        <span key={glyph} style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
          <span aria-hidden className="material-symbols-rounded" style={{ fontSize: 12, lineHeight: 1, color: e.color }}>{glyph}</span>
          {e.n > 1 && <span style={{ fontFamily: MONO, fontSize: 9, color: C.faint }}>{e.n}</span>}
        </span>
      ))}
      {merged.size > 4 && <span style={{ fontFamily: MONO, fontSize: 9, color: C.faint }}>…</span>}
    </span>
  );
}

function OutlinerNodes({
  nodes,
  depth,
  focusId,
  collapsed,
  onToggle,
  onSelect,
}: {
  nodes: JsxNodeModel[];
  depth: number;
  focusId: string | null;
  collapsed: Set<string>;
  onToggle: (id: string, recursive: boolean) => void;
  onSelect: (m: JsxNodeModel) => void;
}) {
  return (
    <>
      {nodes.map((m) => {
        const { glyph, color } = nodeGlyph(m);
        const open = !collapsed.has(m.id);
        return (
          <div key={m.id}>
            <OutlinerRow
              pad={10 + depth * 12}
              glyph={glyph}
              glyphColor={color}
              label={m.tag}
              dim={m.dynamic}
              selected={focusId === m.id}
              mark={C.orange}
              caret={m.children.length ? (open ? "open" : "closed") : undefined}
              after={!open && m.children.length > 0 ? <CollapsedIcons nodes={m.children} /> : undefined}
              guideXs={Array.from({ length: depth }, (_, j) => 16 + j * 12)}
              right={m.dynamic ? (m.dynamicLabel ?? "dynamic") : undefined}
              onToggle={(recursive) => onToggle(m.id, recursive)}
              onClick={() => onSelect(m)}
            />
            {open && m.children.length > 0 && (
              <OutlinerNodes
                nodes={m.children}
                depth={depth + 1}
                focusId={focusId}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function FileOutliner(props: {
  model: JsxNodeModel[];
  focusId: string | null;
  collapsed: Set<string>;
  onToggle: (id: string, recursive: boolean) => void;
  onSelect: (m: JsxNodeModel) => void;
}) {
  return (
    <OutlinerNodes
      nodes={props.model}
      depth={0}
      focusId={props.focusId}
      collapsed={props.collapsed}
      onToggle={props.onToggle}
      onSelect={props.onSelect}
    />
  );
}

// ---------------------------------------------------------------------------
// Node property card
// ---------------------------------------------------------------------------

export function FileNodeCard({
  file,
  node,
  onEdit,
  onOpenSource,
}: {
  file: string;
  node: JsxNodeModel;
  onEdit: (edit: FileEdit, expectTag: string) => void;
  onOpenSource?: (file: string) => void;
}) {
  const idx = node.index;
  const tag = node.tag;
  return (
    <div style={{ padding: "9px 10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file}>
        {file}
      </div>
      {node.dynamic && (
        <div style={{ padding: "6px 8px", background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 6, fontSize: 10.5, color: C.amber, lineHeight: 1.5 }}>
          Rendered by <span style={{ fontFamily: MONO }}>{node.dynamicLabel}</span> — edits apply to every repetition.
        </div>
      )}
      {node.componentSource && onOpenSource && (
        <button className="hv-ctl" style={{ ...ctlBtn, alignSelf: "flex-start" }} onClick={() => onOpenSource(node.componentSource!)}>
          Open {tag} source
        </button>
      )}

      {/* ------------------------------------------------ Content */}
      {node.textChildren.length > 0 && (
        <>
          <div style={sectionLabel}>Content</div>
          {node.textChildren.map((t) => (
            <Field
              key={t.slot}
              value={t.value}
              onCommit={(v) => onEdit({ op: "set-text", index: idx, slot: t.slot, value: v }, tag)}
            />
          ))}
        </>
      )}

      {/* ------------------------------------------------ Style */}
      <div style={sectionLabel}>Style</div>
      {node.styleDynamic ? (
        <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
          The style attribute is a dynamic expression — edit it in code.
        </div>
      ) : (
        <>
          {(node.styleProps ?? []).map((p) => (
            <div key={p.name} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <span style={{ flex: "0 0 96px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, fontSize: 10.5, color: C.muted }} title={p.name}>
                {p.name}
              </span>
              {p.dynamic ? (
                <span style={{ flex: 1, fontSize: 10.5, color: C.faint }}>dynamic</span>
              ) : (
                <Field
                  mono
                  value={p.value ?? ""}
                  style={{ flex: 1, minWidth: 0, height: 22 }}
                  onCommit={(v) =>
                    onEdit(
                      {
                        op: "set-style-prop",
                        index: idx,
                        name: p.name,
                        value: v === "" ? null : LENGTH_PROPS.has(p.name) ? normalizeLen(v) : v,
                      },
                      tag,
                    )
                  }
                />
              )}
            </div>
          ))}
          <AddStyleProp onAdd={(name, value) => onEdit({ op: "set-style-prop", index: idx, name, value: LENGTH_PROPS.has(name) ? normalizeLen(value) : value }, tag)} />
        </>
      )}

      {/* ------------------------------------------------ Classes */}
      <div style={sectionLabel}>Classes</div>
      {node.classChunks.map((ch) => (
        <div key={ch.chunk} style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {ch.conditional && <span style={{ flex: "0 0 auto", fontSize: 9, color: C.amber }} title="Inside a conditional expression">?:</span>}
          <Field
            mono
            value={ch.value}
            style={{ flex: 1, minWidth: 0, height: 22 }}
            onCommit={(v) => onEdit({ op: "set-class-chunk", index: idx, chunk: ch.chunk, value: v }, tag)}
          />
        </div>
      ))}
      {node.classChunks.length === 0 && node.can.classes && (
        <Field
          mono
          value=""
          placeholder="add className"
          style={{ height: 22 }}
          onCommit={(v) => v && onEdit({ op: "set-class-string", index: idx, value: v }, tag)}
        />
      )}

      {/* ------------------------------------------------ Props */}
      {node.props.length > 0 && (
        <>
          <div style={sectionLabel}>Props</div>
          {node.props.map((p, i) => (
            <div key={`${p.name}-${i}`} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <span style={{ flex: "0 0 96px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, fontSize: 10.5, color: C.muted }} title={p.name}>
                {p.name}
              </span>
              {p.kind === "string" || p.kind === "number" ? (
                <Field
                  mono
                  value={p.valueText}
                  style={{ flex: 1, minWidth: 0, height: 22 }}
                  onCommit={(v) =>
                    onEdit(
                      {
                        op: "set-prop",
                        index: idx,
                        name: p.name,
                        value:
                          p.kind === "number" && /^-?\d+(\.\d+)?$/.test(v.trim())
                            ? { kind: "expr", text: v.trim() }
                            : { kind: "string", text: v },
                      },
                      tag,
                    )
                  }
                />
              ) : p.kind === "boolean" ? (
                <Seg
                  grow
                  items={["true", "false"].map((b) => ({
                    label: b,
                    active: p.valueText === b,
                    onClick: () => onEdit({ op: "set-prop", index: idx, name: p.name, value: { kind: "expr", text: b } }, tag),
                  }))}
                />
              ) : (
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 10, color: C.faint }} title={p.valueText}>
                  {"{"}{p.valueText}{"}"}
                </span>
              )}
            </div>
          ))}
        </>
      )}

      {/* ------------------------------------------------ Placement */}
      <div style={sectionLabel}>Placement</div>
      {node.can.structural ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button className="hv-ctl" style={ctlBtn} onClick={() => onEdit({ op: "move-element", index: idx, newParentIndex: parentIndexOf(node), childPos: Math.max(0, node.slot - 2) }, tag)}>
            Move up
          </button>
          <button className="hv-ctl" style={ctlBtn} onClick={() => onEdit({ op: "move-element", index: idx, newParentIndex: parentIndexOf(node), childPos: node.slot + 2 }, tag)}>
            Move down
          </button>
          <button className="hv-ctl" style={ctlBtn} onClick={() => onEdit({ op: "duplicate-element", index: idx }, tag)}>
            Duplicate
          </button>
          <button className="hv-danger" style={ctlBtn} onClick={() => onEdit({ op: "delete-element", index: idx }, tag)}>
            Delete
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
          This element isn't a direct child of another element — no structural moves here.
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5, marginTop: 2 }}>
        Every change is written straight into the file — review with git.
      </div>
    </div>
  );
}

/** The parent's preorder index, derivable from the id scheme. */
function parentIndexOf(node: JsxNodeModel): number {
  const m = node.parentId?.match(/::(\d+)$/);
  return m ? Number(m[1]) : node.index;
}

function AddStyleProp({ onAdd }: { onAdd: (name: string, value: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      <input
        className="fc"
        placeholder="property"
        style={{ ...inputStyle, flex: "0 0 96px", height: 22, fontFamily: MONO, fontSize: 10.5 }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return e.stopPropagation();
          const nameEl = e.target as HTMLInputElement;
          const valueEl = nameEl.nextElementSibling as HTMLInputElement;
          if (nameEl.value && valueEl?.value) {
            onAdd(nameEl.value.trim(), valueEl.value.trim());
            nameEl.value = "";
            valueEl.value = "";
          }
          e.stopPropagation();
        }}
      />
      <input
        className="fc"
        placeholder="value"
        style={{ ...inputStyle, flex: 1, minWidth: 0, height: 22, fontFamily: MONO, fontSize: 10.5 }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return e.stopPropagation();
          const valueEl = e.target as HTMLInputElement;
          const nameEl = valueEl.previousElementSibling as HTMLInputElement;
          if (nameEl?.value && valueEl.value) {
            onAdd(nameEl.value.trim(), valueEl.value.trim());
            nameEl.value = "";
            valueEl.value = "";
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}
