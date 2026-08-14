import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mocks } from "../../../fixtures/mocks";
import type { EditorToHarness, HarnessToEditor } from "../shared/protocol";
import {
  PageInspector,
  PageTree,
  defaultDoc,
  findKind,
  moveBlockTo,
  moveSectionTo,
  setBlockText,
  type PageDoc,
  type PageSel,
} from "./PageEditor";

// ---------------------------------------------------------------------------
// Types mirrored from the server model
// ---------------------------------------------------------------------------

interface StyleProp {
  name: string;
  value: string | null;
  dynamic: boolean;
}
interface ClassChunk {
  chunk: number;
  value: string;
  conditional: boolean;
}
interface TextChild {
  slot: number;
  value: string;
}
interface JsxNode {
  id: string;
  index: number;
  tag: string;
  styleProps: StyleProp[] | null;
  styleDynamic: boolean;
  classChunks: ClassChunk[];
  textChildren: TextChild[];
  children: JsxNode[];
}
interface PropSpec {
  name: string;
  typeText: string;
  optional: boolean;
  control:
    | { kind: "string" }
    | { kind: "number" }
    | { kind: "boolean" }
    | { kind: "select"; options: string[] }
    | { kind: "json" };
}
interface TokenDecl {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  line: number;
}
interface TokenFile {
  file: string;
  decls: TokenDecl[];
}

type Edit =
  | { op: "set-style-prop"; index: number; name: string; value: string | null }
  | { op: "set-class-chunk"; index: number; chunk: number; value: string }
  | { op: "set-text"; index: number; slot: number; value: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

function findNode(roots: JsxNode[], id: string): JsxNode | null {
  for (const root of roots) {
    if (root.id === id) return root;
    const hit = findNode(root.children, id);
    if (hit) return hit;
  }
  return null;
}

function shortName(file: string): string {
  return file.split("/").pop()!.replace(/\.tsx$/, "");
}

const LAYOUT_FIELDS: { name: string; options?: string[] }[] = [
  { name: "display", options: ["flex", "inline-flex", "block", "inline-block", "grid", "none"] },
  { name: "flexDirection", options: ["row", "column", "row-reverse", "column-reverse"] },
  { name: "alignItems", options: ["flex-start", "center", "flex-end", "stretch", "baseline"] },
  { name: "justifyContent", options: ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"] },
  { name: "gap" },
  { name: "padding" },
  { name: "margin" },
  { name: "width" },
  { name: "height" },
  { name: "flex" },
];

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

/** Text input that commits on Enter/blur rather than every keystroke. */
function CommitInput({
  value,
  placeholder,
  onCommit,
  onLiveChange,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  onLiveChange?: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        onLiveChange?.(e.target.value);
      }}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

function Tree({
  nodes,
  depth,
  selectedId,
  onSelect,
}: {
  nodes: JsxNode[];
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.id}>
          <button
            className={`tree-item${node.id === selectedId ? " selected" : ""}`}
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => onSelect(node.id)}
          >
            <span className="tag">&lt;{node.tag}&gt;</span>
            {node.textChildren[0] ? ` ${node.textChildren[0].value.slice(0, 18)}` : ""}
          </button>
          <Tree
            nodes={node.children}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [files, setFiles] = useState<string[]>([]);
  // File + props live in one atom so a component switch can never render the
  // new component with the old component's props.
  const [view, setView] = useState<{
    file: string;
    props: Record<string, unknown>;
  } | null>(null);
  const [model, setModel] = useState<JsxNode[]>([]);
  const [propSpecs, setPropSpecs] = useState<PropSpec[]>([]);
  const [pages, setPages] = useState<string[]>([]);
  const [pageDoc, setPageDoc] = useState<PageDoc | null>(null);
  const [pageSel, setPageSel] = useState<PageSel>(null);
  const pageDocRef = useRef<PageDoc | null>(null);
  pageDocRef.current = pageDoc;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"style" | "props" | "tokens">("style");
  const [tokens, setTokens] = useState<TokenFile[]>([]);
  const [tokenFilter, setTokenFilter] = useState("--ui-card");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const harnessReady = useRef(false);

  const send = useCallback((msg: EditorToHarness) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const loadComponent = useCallback(
    async (file: string, props?: Record<string, unknown>) => {
      const data = await api<{ model: JsxNode[]; props: PropSpec[] }>(
        `/api/component?file=${encodeURIComponent(file)}`,
      );
      setModel(data.model);
      setPropSpecs(data.props);
      setPageDoc(null);
      setPageSel(null);
      setView({ file, props: props ?? mocks[file]?.props ?? {} });
    },
    [],
  );

  const openPage = useCallback(
    async (name: string) => {
      const data = await api<{ doc: PageDoc }>(
        `/api/page?name=${encodeURIComponent(name)}`,
      );
      setView(null);
      setSelectedId(null);
      setPageSel(null);
      setPageDoc(data.doc);
      if (harnessReady.current) send({ type: "render-page", name });
    },
    [send],
  );

  async function saveDoc(doc: PageDoc) {
    setPageDoc(doc);
    await api("/api/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc }),
    });
    setLastSaved(new Date().toLocaleTimeString());
  }

  async function newPage() {
    const name = window.prompt("Page name (letters, dashes):");
    if (!name || !/^[\w-]+$/.test(name)) return;
    await saveDoc(defaultDoc(name));
    setPages((prev) => (prev.includes(name) ? prev : [...prev, name]));
    await openPage(name);
  }

  // Boot: component list.
  useEffect(() => {
    void api<{ files: string[] }>("/api/components").then((d) => {
      setFiles(d.files);
      if (d.files.length) void loadComponent(d.files[0]);
    });
    void api<{ pages: string[] }>("/api/pages").then((d) => setPages(d.pages));
  }, [loadComponent]);

  // Harness messages.
  useEffect(() => {
    const onMessage = (e: MessageEvent<HarnessToEditor>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ready") {
        harnessReady.current = true;
        if (pageDocRef.current) {
          send({ type: "render-page", name: pageDocRef.current.name });
        } else if (view) {
          send({ type: "render", file: view.file, props: view.props });
          send({ type: "select", id: selectedId });
        }
      } else if (msg.type === "selected") {
        setSelectedId(msg.id);
      } else if (msg.type === "selected-block") {
        if (pageDocRef.current) setPageSel(findKind(pageDocRef.current, msg.id));
      } else if (msg.type === "move-block") {
        if (pageDocRef.current) {
          void saveDoc(
            moveBlockTo(pageDocRef.current, msg.blockId, msg.targetColumnId, msg.index),
          );
        }
      } else if (msg.type === "move-section") {
        if (pageDocRef.current) {
          void saveDoc(moveSectionTo(pageDocRef.current, msg.sectionId, msg.index));
        }
      } else if (msg.type === "edit-text") {
        if (pageDocRef.current) {
          void saveDoc(setBlockText(pageDocRef.current, msg.blockId, msg.text));
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [view, selectedId, send]);

  // Re-render harness whenever the view (file or props) changes.
  useEffect(() => {
    if (view && harnessReady.current) {
      send({ type: "render", file: view.file, props: view.props });
    }
  }, [view, send]);

  // Mirror selection into harness.
  useEffect(() => {
    send({ type: "select", id: selectedId });
  }, [selectedId, send]);
  useEffect(() => {
    send({ type: "select-block", id: pageSel?.id ?? null });
  }, [pageSel, send]);

  const selected = selectedId ? findNode(model, selectedId) : null;

  async function pushEdit(edit: Edit) {
    if (!view) return;
    const data = await api<{ model: JsxNode[] }>("/api/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: view.file, edit }),
    });
    setModel(data.model);
    setLastSaved(new Date().toLocaleTimeString());
  }

  function setStyleProp(name: string, value: string) {
    if (!selected) return;
    void pushEdit({
      op: "set-style-prop",
      index: selected.index,
      name,
      value: value.trim() === "" ? null : value.trim(),
    });
  }

  async function loadTokens() {
    const d = await api<{ tokens: TokenFile[] }>("/api/tokens");
    setTokens(d.tokens);
  }

  async function saveToken(file: string, decl: TokenDecl, value: string) {
    await api("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file,
        decl: { valueStart: decl.valueStart, valueEnd: decl.valueEnd, oldValue: decl.value },
        value,
      }),
    });
    send({ type: "token-clear" });
    setLastSaved(new Date().toLocaleTimeString());
    await loadTokens();
  }

  const styleByName = useMemo(() => {
    const map = new Map<string, StyleProp>();
    selected?.styleProps?.forEach((p) => map.set(p.name, p));
    return map;
  }, [selected]);

  return (
    <div className="app">
      {/* ------------------------------------------------ left: pages + components + tree */}
      <div className="panel">
        <h2>Pages</h2>
        <section>
          {pages.map((p) => (
            <button
              key={p}
              className={`comp-item${p === pageDoc?.name ? " active" : ""}`}
              onClick={() => void openPage(p)}
            >
              {p}
            </button>
          ))}
          <button className="comp-item dim" onClick={() => void newPage()}>
            + new page
          </button>
        </section>
        <h2>Components</h2>
        <section>
          {files.map((f) => (
            <button
              key={f}
              className={`comp-item${f === view?.file ? " active" : ""}`}
              onClick={() => {
                setSelectedId(null);
                void loadComponent(f);
              }}
            >
              {shortName(f)}
            </button>
          ))}
        </section>
        <h2>Layers</h2>
        <section>
          {pageDoc ? (
            <PageTree doc={pageDoc} sel={pageSel} onSelect={setPageSel} />
          ) : (
            <Tree nodes={model} depth={0} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </section>
        {lastSaved && <div className="save-note">saved to source at {lastSaved}</div>}
      </div>

      {/* ------------------------------------------------ center: canvas */}
      <div className="canvas">
        <iframe ref={iframeRef} src="/harness.html" title="canvas" />
      </div>

      {/* ------------------------------------------------ right: inspector */}
      <div className="panel">
        <div className="tabs">
          {(["style", "props", "tokens"] as const).map((t) => (
            <button
              key={t}
              className={t === tab ? "active" : ""}
              onClick={() => {
                setTab(t);
                if (t === "tokens" && tokens.length === 0) void loadTokens();
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "style" && pageDoc && (
          <PageInspector
            doc={pageDoc}
            sel={pageSel}
            componentFiles={files}
            componentExports={Object.fromEntries(
              Object.entries(mocks).map(([f, m]) => [f, m.exportName]),
            )}
            onChange={(doc) => void saveDoc(doc)}
            onSelect={setPageSel}
          />
        )}

        {tab === "style" && !pageDoc && !selected && (
          <div className="hint">Click an element on the canvas (or in Layers) to inspect it.</div>
        )}

        {tab === "style" && !pageDoc && selected && (
          <>
            <h2>
              Layout — &lt;{selected.tag}&gt;
            </h2>
            <section>
              {LAYOUT_FIELDS.map(({ name, options }) => {
                const prop = styleByName.get(name);
                const value = prop?.value ?? "";
                return (
                  <div className="row" key={name}>
                    <label>{name}</label>
                    {options ? (
                      <select
                        value={value}
                        onChange={(e) => setStyleProp(name, e.target.value)}
                      >
                        <option value="">—</option>
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <CommitInput value={value} onCommit={(v) => setStyleProp(name, v)} />
                    )}
                  </div>
                );
              })}
            </section>

            <h2>Inline styles</h2>
            <section>
              {(selected.styleProps ?? [])
                .filter((p) => !LAYOUT_FIELDS.some((f) => f.name === p.name))
                .map((p) => (
                  <div className="row" key={p.name}>
                    <label>{p.name}</label>
                    {p.dynamic ? (
                      <span className="dim">dynamic</span>
                    ) : (
                      <CommitInput
                        value={p.value ?? ""}
                        onCommit={(v) => setStyleProp(p.name, v)}
                      />
                    )}
                  </div>
                ))}
              <div className="row">
                <label>add prop</label>
                <CommitInput
                  value=""
                  placeholder="name: value"
                  onCommit={(v) => {
                    const idx = v.indexOf(":");
                    if (idx > 0) {
                      setStyleProp(v.slice(0, idx).trim(), v.slice(idx + 1).trim());
                    }
                  }}
                />
              </div>
              {selected.styleDynamic && (
                <div className="hint">style attribute is a dynamic expression — not editable yet</div>
              )}
            </section>

            {selected.classChunks.length > 0 && (
              <>
                <h2>Classes</h2>
                <section>
                  {selected.classChunks.map((c) => (
                    <div className="row" key={c.chunk}>
                      {c.conditional && <span className="badge">cond</span>}
                      <CommitInput
                        value={c.value}
                        onCommit={(v) =>
                          void pushEdit({
                            op: "set-class-chunk",
                            index: selected.index,
                            chunk: c.chunk,
                            value: v,
                          })
                        }
                      />
                    </div>
                  ))}
                </section>
              </>
            )}

            {selected.textChildren.length > 0 && (
              <>
                <h2>Text</h2>
                <section>
                  {selected.textChildren.map((t) => (
                    <div className="row" key={t.slot}>
                      <CommitInput
                        value={t.value}
                        onCommit={(v) =>
                          void pushEdit({
                            op: "set-text",
                            index: selected.index,
                            slot: t.slot,
                            value: v,
                          })
                        }
                      />
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        )}

        {tab === "props" && (
          <>
            <h2>Props{view ? ` — ${shortName(view.file)}` : ""}</h2>
            <section>
              {propSpecs.map((spec) => {
                const value = view?.props[spec.name];
                const set = (v: unknown) =>
                  setView((prev) =>
                    prev
                      ? { ...prev, props: { ...prev.props, [spec.name]: v } }
                      : prev,
                  );
                return (
                  <div className="row" key={spec.name}>
                    <label title={spec.typeText}>{spec.name}</label>
                    {spec.control.kind === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => set(e.target.checked)}
                      />
                    ) : spec.control.kind === "select" ? (
                      <select
                        value={String(value ?? "")}
                        onChange={(e) => set(e.target.value || undefined)}
                      >
                        <option value="">—</option>
                        {spec.control.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : spec.control.kind === "json" ? (
                      <textarea
                        rows={4}
                        defaultValue={JSON.stringify(value ?? null, null, 1)}
                        onBlur={(e) => {
                          try {
                            set(JSON.parse(e.target.value));
                          } catch {
                            /* keep previous value on bad JSON */
                          }
                        }}
                      />
                    ) : (
                      <CommitInput
                        value={String(value ?? "")}
                        onCommit={(v) =>
                          set(spec.control.kind === "number" ? Number(v) : v)
                        }
                      />
                    )}
                  </div>
                );
              })}
              {propSpecs.length === 0 && <div className="hint">No props interface found.</div>}
            </section>
          </>
        )}

        {tab === "tokens" && (
          <>
            <h2>Design tokens</h2>
            <div className="row">
              <input
                type="text"
                value={tokenFilter}
                placeholder="filter, e.g. --ui-card"
                onChange={(e) => setTokenFilter(e.target.value)}
              />
            </div>
            {tokens.map(({ file, decls }) => {
              const filtered = decls.filter((d) => d.name.includes(tokenFilter));
              if (!filtered.length) return null;
              return (
                <section key={file}>
                  <div className="token-file">{file.split("/").slice(-2).join("/")}</div>
                  {filtered.slice(0, 150).map((d) => {
                    const isHex = /^#[0-9a-fA-F]{3,8}$/.test(d.value);
                    return (
                      <div className="row" key={`${d.name}:${d.valueStart}`}>
                        <label title={`line ${d.line}`}>{d.name}</label>
                        {isHex && (
                          <input
                            type="color"
                            value={d.value.length === 4 ? d.value.replace(/([0-9a-f])/gi, "$1$1").slice(0, 7).replace("##", "#") : d.value.slice(0, 7)}
                            onChange={(e) => {
                              send({ type: "token-preview", name: d.name, value: e.target.value });
                            }}
                            onBlur={(e) => void saveToken(file, d, e.target.value)}
                          />
                        )}
                        <CommitInput
                          value={d.value}
                          onLiveChange={(v) =>
                            send({ type: "token-preview", name: d.name, value: v })
                          }
                          onCommit={(v) => void saveToken(file, d, v)}
                        />
                      </div>
                    );
                  })}
                  {filtered.length > 150 && (
                    <div className="hint">{filtered.length - 150} more — narrow the filter</div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
