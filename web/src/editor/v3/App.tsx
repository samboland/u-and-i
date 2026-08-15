/**
 * u-and-i editor shell v3 — converted from design/editor-redesign.dc.html.
 *
 * Regions: TopBar (menus + workspace tabs) · DocumentRow · workspace toolbar ·
 * workspace main (Layout: Insert | Canvas; Style/Workshop pending) · the
 * constant right column (Outliner over Properties) · StatusBar.
 *
 * All document mutations flow through one edit(mutator) funnel — that funnel
 * IS the undo feature. The canvas renders the real generated page in the
 * harness iframe; this chrome only sends protocol messages.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { mocks } from "../../../../fixtures/mocks";
import type { CanvasState, EditorToHarness, HarnessToEditor } from "../../shared/protocol";
import {
  C,
  CANVAS_STATES,
  DEVICES,
  MONO,
  ROLES,
  SEL_COLOR,
  ZOOMS,
  amberBtn,
  ctlBtn,
  inputStyle,
  primaryBtn,
  rowLabel,
  sectionHeader,
  segBtn,
  trough,
  vdiv,
  type DeviceName,
} from "./chrome";
import { OutlinerRow } from "./OutlinerRow";
import { RouteTree, routeId, type RouteNode } from "./RouteTree";
import { StyleBody, useStyleTokens } from "./StyleWorkspace";
import {
  WS_INITIAL,
  MAT_PRESETS,
  WorkshopBody,
  materialLines,
  type WorkshopState,
} from "./Workshop";
import {
  GLYPH_OF,
  KIND_LABEL,
  allBlocks,
  blockTag,
  blockText,
  blockTitle,
  defaultDoc,
  defaultSection,
  findColumn,
  findSection,
  joinBox,
  locate,
  makeBlock,
  noteEntries,
  parseBox,
  reId,
  setBlockTextValue,
  uid,
  type Block,
  type Column,
  type NewSpec,
  type PageDoc,
  type Section,
  type Sel,
  type SelKind,
} from "./model";

const MIME_BLOCK = "application/x-uai-new-block";
const MIME_SECTION = "application/x-uai-new-section";
const MIME_COLUMN = "application/x-uai-new-column";

const WORKSPACES = [
  { label: "Layout", hint: "compose the page" },
  { label: "Style", hint: "edit theme tokens with a live preview" },
  { label: "Workshop", hint: "build components and their materials" },
] as const;
type Workspace = (typeof WORKSPACES)[number]["label"];

const PROP_TABS = [
  { label: "Content", glyph: "✎" },
  { label: "Placement", glyph: "⊞" },
  { label: "Style", glyph: "◐" },
  { label: "Props", glyph: "⚙" },
  { label: "Data", glyph: "◈" },
  { label: "Notes", glyph: "✱" },
  { label: "Source", glyph: "⎇" },
] as const;
type PropTab = (typeof PROP_TABS)[number]["label"];

/** "24" → "24px": bare numbers in length fields mean pixels, like every
 * design tool. Keeps calc()/var()/keywords untouched. */
function normalizeLen(v: string): string {
  const t = v.trim();
  return /^-?\d+(\.\d+)?$/.test(t) && t !== "0" ? `${t}px` : t;
}

const LENGTH_PROPS = new Set([
  "width", "maxWidth", "minWidth", "height", "maxHeight", "minHeight",
  "top", "right", "bottom", "left", "padding", "gap",
]);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

const UI_DIR = "fixtures/demo-project/src/components/ui";
const COMPONENT_FILES: Record<string, string> = {
  ConfidenceBar: "fixtures/demo-project/src/components/product-card/confidence-bar.tsx",
  ResultCard: "fixtures/demo-project/src/components/explore/result-card.tsx",
};
function fileForComponent(name: string): string {
  return COMPONENT_FILES[name] ?? `${UI_DIR}/${name}.tsx`;
}
function componentSpec(name: string): NewSpec {
  const file = fileForComponent(name);
  const mock = mocks[file];
  return {
    type: "component",
    file,
    exportName: mock?.exportName ?? name,
    props: mock?.props ?? {},
  };
}
const UI_KIT = Object.keys(mocks)
  .filter((k) => k.startsWith(UI_DIR) && !/icons|tooltip|index/.test(k))
  .map((k) => k.split("/").pop()!.replace(/\.tsx$/, ""))
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

interface PropSpec {
  name: string;
  typeText: string;
  optional?: boolean;
  control: { kind: string; options?: string[] };
}

// ---------------------------------------------------------------------------
// Tiny shared controls
// ---------------------------------------------------------------------------

function Field({
  value,
  placeholder,
  mono,
  style,
  onCommit,
  title,
}: {
  value: string;
  placeholder?: string;
  mono?: boolean;
  style?: CSSProperties;
  title?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  return (
    <input
      className="fc"
      type="text"
      value={draft}
      placeholder={placeholder}
      title={title}
      style={{ ...inputStyle, ...(mono ? { fontFamily: MONO, fontSize: 11 } : {}), ...style }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
        e.stopPropagation();
      }}
    />
  );
}

function Seg({
  items,
  grow,
}: {
  items: { label: string; active: boolean; onClick: () => void }[];
  grow?: boolean;
}) {
  return (
    <div style={{ ...trough, ...(grow ? { flex: "1 1 0", minWidth: 0 } : {}) }}>
      {items.map((it) => (
        <button
          key={it.label}
          style={segBtn(it.active, grow ? { flex: 1, minWidth: 0, padding: "0 4px" } : undefined)}
          onClick={it.onClick}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Material Symbols glyph (rounded set, self-hosted font). */
function Sym({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <span aria-hidden className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1 }}>
      {name}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ ...rowLabel, whiteSpace: "nowrap", lineHeight: 1.25 }}>{label}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const harnessReady = useRef(false);

  const [pages, setPages] = useState<string[]>([]);
  const [doc, setDoc] = useState<PageDoc | null>(null);
  const docRef = useRef<PageDoc | null>(null);
  docRef.current = doc;
  const [sel, setSel] = useState<Sel>({ kind: null, id: null });
  const selRef = useRef(sel);
  selRef.current = sel;

  const [history, setHistory] = useState<{ doc: PageDoc; sel: Sel }[]>([]);
  const [future, setFuture] = useState<{ doc: PageDoc; sel: Sel }[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [workspace, setWorkspace] = useState<Workspace>("Layout");
  const [propTab, setPropTab] = useState<PropTab>("Content");
  const [outlinerMode, setOutlinerMode] = useState<"Page" | "Project">("Page");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [rulersOn, setRulersOn] = useState(true);
  const [notesOn, setNotesOn] = useState(true);
  const [device, setDevice] = useState<DeviceName>("Desktop");
  const [zoom, setZoom] = useState<number>(DEVICES.Desktop.zoom);
  const [canvasState, setCanvasState] = useState<CanvasState>("Default");
  const [themeDark, setThemeDark] = useState(false);
  const [role, setRole] = useState("Traveler");
  const [search, setSearch] = useState("");
  const [interact, setInteract] = useState(false);
  const [propSpecs, setPropSpecs] = useState<Record<string, PropSpec[]>>({});
  const [styleEdits, setStyleEdits] = useState(0);
  const [wsMat, setWsMat] = useState<WorkshopState>(WS_INITIAL);
  const [appZoom, setAppZoom] = useState(1);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const clipboard = useRef<{ kind: SelKind; node: Section | Column | Block } | null>(null);
  // Filled in below once handleChord exists; the harness message handler
  // reads it so iframe-forwarded shortcuts never go through a stale closure.
  const handleChordRef = useRef<(c: { key: string; mod: boolean; shift: boolean; alt: boolean }) => boolean>(() => false);
  const hRuler = useRef<HTMLCanvasElement>(null);
  const vRuler = useRef<HTMLCanvasElement>(null);
  const stageXY = useRef({ x: 0, y: 0 });
  const drawRulersRef = useRef<() => void>(() => {});
  const [rulerUnit, setRulerUnit] = useState<"px" | "rem">("px");
  // Next-project (adventure-alerts) route tree — read-only this iteration.
  const [routeTree, setRouteTree] = useState<RouteNode | null>(null);
  const routesFetched = useRef(false);
  const [routeSel, setRouteSel] = useState<RouteNode | null>(null);
  // Which design system the canvas iframe runs; AA components preview in a
  // dedicated ?project=aa document so the two .ui-* systems never mix.
  const [canvasProject, setCanvasProject] = useState<"demo" | "aa">("demo");
  const [insertSource, setInsertSource] = useState<"Demo kit" | "Adventure Alerts">("Demo kit");
  const [aaComponents, setAaComponents] = useState<{
    files: string[];
    meta: Record<string, { serverOnly: boolean }>;
  } | null>(null);
  const [aaPreview, setAaPreview] = useState<{
    file: string;
    specs: PropSpec[];
    values: Record<string, unknown>;
  } | null>(null);
  const aaPreviewRef = useRef(aaPreview);
  aaPreviewRef.current = aaPreview;

  const send = useCallback((msg: EditorToHarness) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const styleTokens = useStyleTokens(send, () => {
    setStyleEdits((e) => e + 1);
    setSavedAt(new Date().toLocaleTimeString());
  });

  // ------------------------------------------------------------------ persistence

  const persist = useCallback(async (next: PageDoc) => {
    await api("/api/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: next }),
    });
    setSavedAt(new Date().toLocaleTimeString());
  }, []);

  /** The one mutation funnel — deep-copies, applies, records history, saves. */
  const edit = useCallback(
    (mutator: (d: PageDoc) => Partial<Sel> | void) => {
      const cur = docRef.current;
      if (!cur) return;
      const next = structuredClone(cur);
      const selPatch = mutator(next) ?? {};
      setHistory((h) => [...h.slice(-39), { doc: cur, sel: selRef.current }]);
      setFuture([]);
      setDoc(next);
      if (selPatch.kind !== undefined || selPatch.id !== undefined) {
        setSel({ kind: selPatch.kind ?? null, id: selPatch.id ?? null });
      }
      void persist(next);
    },
    [persist],
  );

  const undoAction = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      const cur = docRef.current;
      if (cur) setFuture((f) => [...f, { doc: cur, sel: selRef.current }]);
      setDoc(prev.doc);
      setSel(prev.sel);
      void persist(prev.doc);
      return h.slice(0, -1);
    });
  }, [persist]);

  const redoAction = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[f.length - 1];
      const cur = docRef.current;
      if (cur) setHistory((h) => [...h.slice(-39), { doc: cur, sel: selRef.current }]);
      setDoc(next.doc);
      setSel(next.sel);
      void persist(next.doc);
      return f.slice(0, -1);
    });
  }, [persist]);

  const openPage = useCallback(async (name: string) => {
    const data = await api<{ doc: PageDoc }>(`/api/page?name=${encodeURIComponent(name)}`);
    setDoc(data.doc);
    setSel({ kind: null, id: null });
    setRouteSel(null);
    setAaPreview(null);
    setCanvasProject("demo");
    setHistory([]);
    setFuture([]);
    if (harnessReady.current) {
      iframeRef.current?.contentWindow?.postMessage({ type: "render-page", name }, "*");
    }
  }, []);

  const newPage = useCallback(async () => {
    const name = window.prompt("Page name (letters, dashes):");
    if (!name || !/^[\w-]+$/.test(name)) return;
    const d = defaultDoc(name);
    await api("/api/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: d }),
    });
    setPages((p) => (p.includes(name) ? p : [...p, name]));
    await openPage(name);
  }, [openPage]);

  // Boot
  useEffect(() => {
    void api<{ pages: string[] }>("/api/pages").then(async (d) => {
      setPages(d.pages);
      const first = d.pages.includes("home") ? "home" : d.pages[0];
      if (first) await openPage(first);
    });
  }, [openPage]);

  // Load the Next-project route tree the first time Project mode opens.
  useEffect(() => {
    if (outlinerMode !== "Project" || routesFetched.current) return;
    routesFetched.current = true;
    void api<{ projects: { id: string }[] }>("/api/projects")
      .then((d) =>
        d.projects.some((p) => p.id === "aa")
          ? api<{ tree: RouteNode }>("/api/routes?project=aa").then((r) => setRouteTree(r.tree))
          : undefined,
      )
      .catch(() => {});
  }, [outlinerMode]);

  // ------------------------------------------------------------------ selection helpers

  const hit = doc ? locate(doc, sel.kind === "block" ? sel.id : null) : null;
  const colHit = doc && sel.kind === "column" ? findColumn(doc, sel.id) : null;
  const secHit = doc && sel.kind === "section" ? findSection(doc, sel.id) : null;
  const block = hit?.block ?? null;
  const selAccent = sel.kind ? SEL_COLOR[sel.kind] : SEL_COLOR.none;
  const selKindLabel = block
    ? KIND_LABEL[block.type]
    : sel.kind === "column"
      ? "Column"
      : sel.kind === "section"
        ? "Section"
        : "Nothing";
  const notes = doc ? noteEntries(doc) : [];
  const needsDataCount = doc ? allBlocks(doc).filter((e) => e.block.needsData).length : 0;

  const badgeFor = useCallback(
    (d: PageDoc, kind: SelKind, id: string): string => {
      if (kind === "section") {
        const f = findSection(d, id);
        return f ? `Section · ${f.sec.label ?? f.sec.id}` : "Section";
      }
      if (kind === "column") {
        const f = findColumn(d, id);
        if (!f) return "Column";
        const total = f.sec.columns.reduce((a, c) => a + (parseInt(c.flex) || 1), 0);
        return `Column ${f.ci + 1} · ${f.col.flex} of ${total}`;
      }
      const h = locate(d, id);
      return h ? `${KIND_LABEL[h.block.type]} · ${blockTag(h.block)}` : "Element";
    },
    [],
  );

  const select = useCallback((kind: SelKind | null, id: string | null) => {
    setSel({ kind, id });
    if (kind) setRouteSel(null);
  }, []);

  // ------------------------------------------------------------------ canvas sync

  useEffect(() => {
    if (!doc) return;
    send({
      type: "select-block",
      id: sel.id,
      kind: sel.kind ?? undefined,
      badge: sel.kind && sel.id ? badgeFor(doc, sel.kind, sel.id) : undefined,
    });
  }, [sel, doc, send, badgeFor]);

  useEffect(() => {
    if (!doc) return;
    send({
      type: "set-annotations",
      notes: notesOn ? notes.map((n) => ({ id: n.block.id, n: n.n, text: n.block.note! })) : [],
      needsData: allBlocks(doc)
        .filter((e) => e.block.needsData)
        .map((e) => e.block.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, notesOn]);

  useEffect(() => send({ type: "set-device", width: DEVICES[device].width }), [device, send]);
  useEffect(() => send({ type: "set-zoom", zoom }), [zoom, send]);
  useEffect(() => send({ type: "set-canvas-state", state: canvasState }), [canvasState, send]);
  useEffect(() => send({ type: "set-show-notes", on: notesOn }), [notesOn, send]);
  useEffect(() => send({ type: "set-theme", dark: themeDark }), [themeDark, send]);
  useEffect(() => send({ type: "set-interact", on: interact }), [interact, send]);

  // ------------------------------------------------------------------ harness messages

  useEffect(() => {
    const onMessage = (e: MessageEvent<HarnessToEditor>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      const d = docRef.current;
      if (msg.type === "ready") {
        harnessReady.current = true;
        const preview = aaPreviewRef.current;
        if (canvasProject === "aa" && preview) {
          send({ type: "render", file: preview.file, props: preview.values });
        } else if (d) {
          iframeRef.current?.contentWindow?.postMessage({ type: "render-page", name: d.name }, "*");
          send({ type: "set-device", width: DEVICES[device].width });
          send({ type: "set-zoom", zoom });
        }
      } else if (msg.type === "selected-block") {
        setCtxMenu(null);
        if (!d) return;
        if (locate(d, msg.id)) select("block", msg.id);
        else if (findColumn(d, msg.id)) select("column", msg.id);
        else if (findSection(d, msg.id)) select("section", msg.id);
      } else if (msg.type === "move-block") {
        edit((p) => {
          let moved: Block | undefined;
          for (const s of p.sections)
            for (const c of s.columns) {
              const i = c.blocks.findIndex((b) => b.id === msg.blockId);
              if (i > -1) moved = c.blocks.splice(i, 1)[0];
            }
          if (!moved) return;
          for (const s of p.sections)
            for (const c of s.columns)
              if (c.id === msg.targetColumnId) {
                c.blocks.splice(Math.min(msg.index, c.blocks.length), 0, moved);
                return { kind: "block", id: moved.id };
              }
        });
      } else if (msg.type === "move-section") {
        edit((p) => {
          const i = p.sections.findIndex((s) => s.id === msg.sectionId);
          if (i < 0) return;
          const [s] = p.sections.splice(i, 1);
          p.sections.splice(Math.min(msg.index, p.sections.length), 0, s);
          return { kind: "section", id: s.id };
        });
      } else if (msg.type === "insert-block") {
        const spec = msg.item as NewSpec;
        edit((p) => {
          const b = makeBlock(spec);
          for (const s of p.sections)
            for (const c of s.columns)
              if (c.id === msg.targetColumnId) {
                c.blocks.splice(Math.min(msg.index, c.blocks.length), 0, b);
                return { kind: "block", id: b.id };
              }
          for (const s of p.sections)
            if (s.id === msg.targetSectionId) {
              s.columns.push({ id: uid(), flex: "1", gap: "0.75rem", blocks: [b] });
              return { kind: "block", id: b.id };
            }
        });
      } else if (msg.type === "insert-section") {
        edit((p) => {
          const s = defaultSection();
          p.sections.splice(Math.min(msg.index, p.sections.length), 0, s);
          return { kind: "section", id: s.id };
        });
      } else if (msg.type === "insert-column") {
        edit((p) => {
          for (const s of p.sections)
            if (s.id === msg.sectionId) {
              const c = { id: uid(), flex: "1", gap: "0.75rem", blocks: [] };
              s.columns.splice(Math.min(msg.index, s.columns.length), 0, c);
              return { kind: "column", id: c.id };
            }
        });
      } else if (msg.type === "edit-text") {
        edit((p) => {
          const h = locate(p, msg.blockId);
          if (h) setBlockTextValue(h.block, msg.text);
        });
      } else if (msg.type === "zoom-wheel") {
        zoomBy(msg.dir);
      } else if (msg.type === "context-menu") {
        if (d && msg.id) {
          if (locate(d, msg.id)) select("block", msg.id);
          else if (findColumn(d, msg.id)) select("column", msg.id);
          else if (findSection(d, msg.id)) select("section", msg.id);
        } else {
          select(null, null);
        }
        // Iframe coords → chrome coords. The rect is in visual (app-zoomed)
        // pixels; the fixed-position menu lives in the zoomed coordinate space.
        const r = iframeRef.current?.getBoundingClientRect();
        if (r) setCtxMenu({ x: r.left / appZoom + msg.x, y: r.top / appZoom + msg.y });
      } else if (msg.type === "toggle-interact") {
        setInteract((v) => !v);
      } else if (msg.type === "escape") {
        setCtxMenu(null);
      } else if (msg.type === "key") {
        handleChordRef.current({ key: msg.key, mod: msg.ctrl, shift: msg.shift, alt: msg.alt });
      } else if (msg.type === "stage-metrics") {
        // Straight to canvas — panning reports every frame and must not
        // re-render the chrome.
        stageXY.current = { x: msg.x, y: msg.y };
        drawRulersRef.current();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [edit, select, send, device, zoom, appZoom, canvasProject]);

  // ------------------------------------------------------------------ AA component preview

  /** Open an adventure-alerts component in the AA canvas: fetch its prop
   * specs, derive safe defaults, remount the iframe in ?project=aa mode. */
  const openAaComponent = useCallback(async (file: string) => {
    setRouteSel(null);
    setSel({ kind: null, id: null });
    let specs: PropSpec[] = [];
    try {
      const d = await api<{ props: PropSpec[] }>(
        `/api/component?project=aa&file=${encodeURIComponent(file)}`,
      );
      specs = d.props;
    } catch {
      /* prop extraction is best-effort */
    }
    const values: Record<string, unknown> = {};
    for (const s of specs) {
      if (s.optional) continue;
      if (s.control.kind === "string") values[s.name] = s.name;
      else if (s.control.kind === "number") values[s.name] = 0;
      else if (s.control.kind === "boolean") values[s.name] = false;
      else if (s.control.kind === "select") values[s.name] = s.control.options?.[0];
    }
    const preview = { file: `aa:${file}`, specs, values };
    setAaPreview(preview);
    if (canvasProject !== "aa") {
      setCanvasProject("aa"); // remount → ready handler sends the render
    } else {
      send({ type: "render", file: preview.file, props: values });
    }
  }, [canvasProject, send]);

  const setAaProp = useCallback((name: string, value: unknown) => {
    setAaPreview((p) => {
      if (!p) return p;
      const values = { ...p.values };
      if (value === undefined || value === "") delete values[name];
      else values[name] = value;
      const next = { ...p, values };
      send({ type: "render", file: p.file, props: values });
      return next;
    });
  }, [send]);

  // ------------------------------------------------------------------ operations

  const patchBlock = useCallback(
    (fn: (b: Block) => void) => {
      const id = selRef.current.id;
      if (!id) return;
      edit((p) => {
        const h = locate(p, id);
        if (h) fn(h.block);
      });
    },
    [edit],
  );

  const insertBlock = useCallback(
    (spec: NewSpec) => {
      edit((p) => {
        const b = makeBlock(spec);
        const s = selRef.current;
        const h = s.kind === "block" ? locate(p, s.id) : null;
        if (h) {
          h.col.blocks.splice(h.idx + 1, 0, b);
          return { kind: "block", id: b.id };
        }
        const cf = s.kind === "column" ? findColumn(p, s.id) : null;
        const col =
          cf?.col ??
          p.sections[p.sections.length - 1]?.columns[0] ??
          (() => {
            const sc = defaultSection();
            sc.columns[0].blocks = [];
            p.sections.push(sc);
            return sc.columns[0];
          })();
        col.blocks.push(b);
        return { kind: "block", id: b.id };
      });
    },
    [edit],
  );

  const addSection = useCallback(() => {
    edit((p) => {
      const sc = defaultSection();
      sc.columns[0].blocks = [];
      p.sections.push(sc);
      return { kind: "section", id: sc.id };
    });
  }, [edit]);

  const addColumn = useCallback(() => {
    edit((p) => {
      const s = selRef.current;
      const target =
        (s.kind === "block" ? locate(p, s.id)?.sec : null) ??
        (s.kind === "column" ? findColumn(p, s.id)?.sec : null) ??
        (s.kind === "section" ? findSection(p, s.id)?.sec : null) ??
        p.sections[p.sections.length - 1];
      if (!target) return;
      const c = { id: uid(), flex: "1", gap: "0.75rem", blocks: [] };
      target.columns.push(c);
      return { kind: "column", id: c.id };
    });
  }, [edit]);

  const deleteSel = useCallback(() => {
    const s = selRef.current;
    if (!s.id) return;
    edit((p) => {
      if (s.kind === "block") {
        const h = locate(p, s.id);
        if (h) h.col.blocks.splice(h.idx, 1);
      } else if (s.kind === "column") {
        const f = findColumn(p, s.id);
        if (f && f.sec.columns.length > 1) f.sec.columns.splice(f.ci, 1);
      } else if (s.kind === "section") {
        const f = findSection(p, s.id);
        if (f) p.sections.splice(f.si, 1);
      }
      return { kind: null, id: null };
    });
  }, [edit]);

  const duplicateAction = useCallback(() => {
    const s = selRef.current;
    if (!s.kind || !s.id) return;
    edit((p) => {
      if (s.kind === "block") {
        const h = locate(p, s.id);
        if (!h) return;
        const copy = reId(h.block);
        h.col.blocks.splice(h.idx + 1, 0, copy);
        return { kind: "block", id: copy.id };
      }
      if (s.kind === "column") {
        const f = findColumn(p, s.id);
        if (!f) return;
        const copy = reId(f.col);
        f.sec.columns.splice(f.ci + 1, 0, copy);
        return { kind: "column", id: copy.id };
      }
      const f = findSection(p, s.id);
      if (!f) return;
      const copy = reId(f.sec);
      p.sections.splice(f.si + 1, 0, copy);
      return { kind: "section", id: copy.id };
    });
  }, [edit]);

  const copyAction = useCallback(() => {
    const s = selRef.current;
    const d = docRef.current;
    if (!d || !s.kind || !s.id) return;
    const node =
      s.kind === "block"
        ? locate(d, s.id)?.block
        : s.kind === "column"
          ? findColumn(d, s.id)?.col
          : findSection(d, s.id)?.sec;
    if (node) clipboard.current = { kind: s.kind, node: structuredClone(node) };
  }, []);

  const cutAction = useCallback(() => {
    copyAction();
    deleteSel();
  }, [copyAction, deleteSel]);

  const pasteAction = useCallback(() => {
    const clip = clipboard.current;
    if (!clip) return;
    edit((p) => {
      const s = selRef.current;
      if (clip.kind === "section") {
        const sec = reId(clip.node as Section);
        const anchor =
          (s.kind === "block" ? locate(p, s.id)?.sec : null) ??
          (s.kind === "column" ? findColumn(p, s.id)?.sec : null) ??
          (s.kind === "section" ? findSection(p, s.id)?.sec : null);
        const i = anchor ? p.sections.indexOf(anchor) + 1 : p.sections.length;
        p.sections.splice(i, 0, sec);
        return { kind: "section", id: sec.id };
      }
      if (clip.kind === "column") {
        const col = reId(clip.node as Column);
        const target =
          (s.kind === "block" ? locate(p, s.id)?.sec : null) ??
          (s.kind === "column" ? findColumn(p, s.id)?.sec : null) ??
          (s.kind === "section" ? findSection(p, s.id)?.sec : null) ??
          p.sections[p.sections.length - 1];
        if (!target) return;
        const after = s.kind === "column" ? findColumn(p, s.id)?.ci : undefined;
        target.columns.splice(after !== undefined ? after + 1 : target.columns.length, 0, col);
        return { kind: "column", id: col.id };
      }
      const b = reId(clip.node as Block);
      const h = s.kind === "block" ? locate(p, s.id) : null;
      if (h) {
        h.col.blocks.splice(h.idx + 1, 0, b);
        return { kind: "block", id: b.id };
      }
      const col =
        (s.kind === "column" ? findColumn(p, s.id)?.col : null) ??
        (s.kind === "section" ? findSection(p, s.id)?.sec.columns[0] : null) ??
        p.sections[p.sections.length - 1]?.columns[0];
      if (!col) return;
      col.blocks.push(b);
      return { kind: "block", id: b.id };
    });
  }, [edit]);

  const moveBy = useCallback(
    (delta: number) => {
      const s = selRef.current;
      if (!s.id) return;
      edit((p) => {
        const arrMove = <T,>(arr: T[], i: number) => {
          const j = i + delta;
          if (j < 0 || j >= arr.length) return;
          [arr[i], arr[j]] = [arr[j], arr[i]];
        };
        if (s.kind === "block") {
          const h = locate(p, s.id);
          if (h) arrMove(h.col.blocks, h.idx);
        } else if (s.kind === "column") {
          const f = findColumn(p, s.id);
          if (f) arrMove(f.sec.columns, f.ci);
        } else if (s.kind === "section") {
          const f = findSection(p, s.id);
          if (f) arrMove(p.sections, f.si);
        }
      });
    },
    [edit],
  );

  const toggleNote = useCallback(() => {
    patchBlock((b) => {
      b.note = b.note ? null : "Needs review before handoff.";
    });
  }, [patchBlock]);

  const zoomBy = useCallback((dir: number) => {
    setZoom((z) => {
      const i = ZOOMS.findIndex((v) => Math.abs(v - z) < 0.001);
      const ni = Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 3 : i) + dir));
      return ZOOMS[ni];
    });
  }, []);

  const setDeviceAnd = useCallback((d: DeviceName) => {
    setDevice(d);
    setZoom(DEVICES[d].zoom);
  }, []);

  // Fetch prop specs for the selected component block.
  useEffect(() => {
    if (block?.type === "component" && !propSpecs[block.file]) {
      void api<{ props: PropSpec[] }>(`/api/component?file=${encodeURIComponent(block.file)}`)
        .then((d) => setPropSpecs((m) => ({ ...m, [block.file]: d.props })))
        .catch(() => setPropSpecs((m) => ({ ...m, [block.file]: [] })));
    }
  }, [block, propSpecs]);

  // ------------------------------------------------------------------ keyboard

  /** One shortcut map for both key sources: the chrome's own keydown events
   * and chords forwarded from the focused canvas iframe. Returns handled. */
  const handleChord = useCallback(
    (c: { key: string; mod: boolean; shift: boolean; alt: boolean }): boolean => {
      const k = c.key.toLowerCase();
      if (c.mod && !c.shift && k === "z") undoAction();
      else if (c.mod && c.shift && k === "z") redoAction();
      else if (c.mod && k === "d") duplicateAction();
      else if (c.mod && k === "c") { if (!window.getSelection()?.toString()) copyAction(); }
      else if (c.mod && k === "x") cutAction();
      else if (c.mod && k === "v") pasteAction();
      else if (c.key === "Tab" && workspace === "Layout") setInteract((v) => !v);
      else if (c.key === "Escape") setCtxMenu(null);
      else if (c.key === "Delete") deleteSel();
      else if (c.alt && c.key === "ArrowUp") moveBy(-1);
      else if (c.alt && c.key === "ArrowDown") moveBy(1);
      else if (c.key === "F2" && selRef.current.kind === "block" && selRef.current.id) {
        send({ type: "begin-edit", id: selRef.current.id });
      }
      // Application (chrome) zoom: Ctrl+Shift+± — canvas zoom: plain Ctrl+±.
      else if (c.mod && c.shift && (c.key === "+" || c.key === "=")) {
        setAppZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10));
      } else if (c.mod && c.shift && (c.key === "_" || c.key === "-")) {
        setAppZoom((z) => Math.max(0.7, Math.round((z - 0.1) * 10) / 10));
      } else if (c.mod && c.shift && c.key === ")") setAppZoom(1);
      else if (c.mod && (c.key === "=" || c.key === "+")) zoomBy(1);
      else if (c.mod && c.key === "-") zoomBy(-1);
      else if (c.mod && c.key === "0") setZoom(DEVICES[device].zoom);
      else if (k === "p" && !c.mod && !c.alt) setPreviewOpen((v) => !v);
      else if (c.alt && ["1", "2", "3", "4"].includes(c.key)) {
        setCanvasState(CANVAS_STATES[Number(c.key) - 1]);
      } else return false;
      return true;
    },
    [undoAction, redoAction, duplicateAction, copyAction, cutAction, pasteAction, deleteSel, moveBy, zoomBy, device, send, workspace],
  );
  handleChordRef.current = handleChord;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (handleChord({ key: e.key, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey })) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleChord]);

  // Ctrl+scroll over the chrome's canvas region (rulers, void margins) zooms
  // the page; scrolls over the iframe itself arrive via the zoom-wheel message.
  useEffect(() => {
    const el = canvasRegionRef.current;
    if (!el || workspace !== "Layout") return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [workspace, zoomBy]);

  // ------------------------------------------------------------------ rulers

  /** Draw both rulers: ticks in page units (px or rem) anchored to the page
   * origin the harness reports, so they track pan and zoom exactly. */
  const drawRulers = useCallback(() => {
    // App zoom scales the canvas bitmap after rasterization — bake it into
    // the backing store (and align ticks to the device grid) so the rulers
    // stay crisp at any chrome zoom.
    const dpr = (window.devicePixelRatio || 1) * appZoom;
    const unitPx = rulerUnit === "rem" ? 16 : 1;
    const pxPerUnit = unitPx * zoom;
    let minorStep = rulerUnit === "rem" ? 1 : 10;
    while (minorStep * pxPerUnit < 5) minorStep *= 2;
    let majorStep = rulerUnit === "rem" ? 4 : 100;
    while (majorStep * pxPerUnit < 34) majorStep *= 2;
    for (const [cv, horiz] of [[hRuler.current, true], [vRuler.current, false]] as const) {
      if (!cv) continue;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) continue;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1 / dpr;
      ctx.font = "8px ui-monospace, monospace";
      const origin = horiz ? stageXY.current.x : stageXY.current.y;
      const length = horiz ? w : h;
      const start = Math.floor(-origin / (minorStep * pxPerUnit)) * minorStep;
      for (let u = start; origin + u * pxPerUnit <= length; u += minorStep) {
        const p = (Math.round((origin + u * pxPerUnit) * dpr) + 0.5) / dpr;
        if (p < 0) continue;
        const isMajor = u % majorStep === 0;
        ctx.strokeStyle = isMajor ? C.borderHover : C.border;
        ctx.beginPath();
        if (horiz) {
          ctx.moveTo(p, 16);
          ctx.lineTo(p, isMajor ? 2 : 11);
        } else {
          ctx.moveTo(16, p);
          ctx.lineTo(isMajor ? 2 : 11, p);
        }
        ctx.stroke();
        if (isMajor) {
          ctx.fillStyle = C.faint;
          if (horiz) ctx.fillText(String(u), p + 3, 8);
          else {
            ctx.save();
            ctx.translate(8, p - 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(u), 0, 0);
            ctx.restore();
          }
        }
      }
    }
  }, [zoom, rulerUnit, appZoom]);
  drawRulersRef.current = drawRulers;

  useEffect(() => {
    if (!rulersOn || workspace !== "Layout") return;
    const raf = requestAnimationFrame(drawRulers);
    window.addEventListener("resize", drawRulers);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", drawRulers);
    };
  }, [drawRulers, rulersOn, workspace, device, appZoom]);

  // ------------------------------------------------------------------ derived labels

  const canUp = !!sel.id;
  const canDown = !!sel.id;
  const deleteLabel =
    sel.kind === "column" ? "Delete column" : sel.kind === "section" ? "Delete section" : "Delete";
  const crumb = (() => {
    if (!doc) return "";
    if (hit)
      return `${doc.name}.json › ${hit.sec.label ?? hit.sec.id} › column ${hit.sec.columns.indexOf(hit.col) + 1} › ${blockTag(hit.block)}`;
    if (colHit) return `${doc.name}.json › ${colHit.sec.label ?? colHit.sec.id} › column ${colHit.ci + 1}`;
    if (secHit) return `${doc.name}.json › ${secHit.sec.label ?? secHit.sec.id}`;
    return `${doc.name}.json`;
  })();
  const selPath = (() => {
    if (!doc) return "";
    if (hit) return `${doc.name}.json › ${hit.sec.id} › ${hit.col.id} › ${blockTag(hit.block)}`;
    if (colHit) return `${doc.name}.json › ${colHit.sec.id} › ${colHit.col.id}`;
    if (secHit) return `${doc.name}.json › ${secHit.sec.id}`;
    return "";
  })();
  const selTitle = routeSel
    ? routeSel.urlPath
    : block ? blockTitle(block) : colHit ? `Column ${colHit.ci + 1}` : secHit ? (secHit.sec.label ?? secHit.sec.id) : "Nothing selected";

  // ------------------------------------------------------------------ menus

  type MenuItem =
    | { sep: true }
    | { sep?: false; label: string; accel?: string; check?: string; disabled?: boolean; action?: () => void };
  const dot = (on: boolean) => (on ? "•" : "");
  const tick = (on: boolean) => (on ? "✓" : "");
  const menus: { label: string; width: number; items: MenuItem[] }[] = [
    {
      label: "File",
      width: 224,
      items: [
        { label: "New page", accel: "Ctrl+N", action: () => void newPage() },
        { label: "Open page…", accel: "Ctrl+P", action: () => setOutlinerMode("Project") },
        { sep: true },
        { label: "Save to source", accel: "Ctrl+S", action: () => doc && void persist(doc) },
        { label: "Regenerate components", action: () => doc && void persist(doc) },
        { sep: true },
        { label: "Exit", accel: "Alt+F4", action: () => window.close() },
      ],
    },
    {
      label: "Edit",
      width: 216,
      items: [
        { label: "Undo", accel: "Ctrl+Z", disabled: !history.length, action: undoAction },
        { label: "Redo", accel: "Ctrl+Shift+Z", disabled: !future.length, action: redoAction },
        { sep: true },
        { label: "Cut", accel: "Ctrl+X", disabled: !sel.id, action: cutAction },
        { label: "Copy", accel: "Ctrl+C", disabled: !sel.id, action: copyAction },
        { label: "Paste", accel: "Ctrl+V", disabled: !clipboard.current, action: pasteAction },
        { sep: true },
        { label: "Duplicate", accel: "Ctrl+D", disabled: !sel.id, action: duplicateAction },
        { label: "Delete", accel: "Del", disabled: !sel.id, action: deleteSel },
        { sep: true },
        { label: "Move up", accel: "Alt+Up", disabled: !canUp, action: () => moveBy(-1) },
        { label: "Move down", accel: "Alt+Down", disabled: !canDown, action: () => moveBy(1) },
        { sep: true },
        {
          label: "Edit text in place",
          accel: "F2",
          disabled: !block || blockText(block) == null,
          action: () => sel.id && send({ type: "begin-edit", id: sel.id }),
        },
      ],
    },
    {
      label: "Insert",
      width: 200,
      items: [
        { label: "Heading", action: () => insertBlock({ type: "heading" }) },
        { label: "Paragraph", action: () => insertBlock({ type: "text" }) },
        { label: "Button", action: () => insertBlock({ type: "button" }) },
        { label: "Image", action: () => insertBlock({ type: "image" }) },
        { label: "Spacer", action: () => insertBlock({ type: "spacer" }) },
        { sep: true },
        { label: "Section", action: addSection },
        { label: "Column", action: addColumn },
      ],
    },
    {
      label: "View",
      width: 244,
      items: [
        { label: "Layout workspace", check: dot(workspace === "Layout"), action: () => setWorkspace("Layout") },
        { label: "Style workspace", check: dot(workspace === "Style"), action: () => setWorkspace("Style") },
        { label: "Workshop workspace", check: dot(workspace === "Workshop"), action: () => setWorkspace("Workshop") },
        { sep: true },
        { label: "Outliner: page tree", check: dot(outlinerMode === "Page"), action: () => setOutlinerMode("Page") },
        { label: "Outliner: project", check: dot(outlinerMode === "Project"), action: () => setOutlinerMode("Project") },
        { sep: true },
        { label: "Rulers", check: tick(rulersOn), action: () => setRulersOn((v) => !v) },
        { label: "Dev notes", check: tick(notesOn), action: () => setNotesOn((v) => !v) },
        { sep: true },
        { label: "Zoom in", accel: "Ctrl+=", action: () => zoomBy(1) },
        { label: "Zoom out", accel: "Ctrl+-", action: () => zoomBy(-1) },
        { label: "Reset zoom", accel: "Ctrl+0", action: () => setZoom(DEVICES[device].zoom) },
      ],
    },
    {
      label: "Canvas",
      width: 208,
      items: [
        ...(Object.keys(DEVICES) as DeviceName[]).map((d) => ({
          label: d,
          check: dot(device === d),
          action: () => setDeviceAnd(d),
        })),
        { sep: true },
        { label: "Preview context…", accel: "P", action: () => setPreviewOpen(true) },
        ...CANVAS_STATES.map((cs, i) => ({
          label: `${cs} state`,
          accel: `Alt+${i + 1}`,
          check: dot(canvasState === cs),
          action: () => setCanvasState(cs),
        })),
        { sep: true },
        { label: "Reload canvas", accel: "Ctrl+R", action: () => iframeRef.current?.contentWindow?.location.reload() },
      ],
    },
    {
      label: "Help",
      width: 220,
      items: [
        { label: "Documentation" },
        { label: "Keyboard shortcuts" },
        { sep: true },
        { label: "About u-and-i" },
      ],
    },
  ];

  // ------------------------------------------------------------------ insert groups

  const insertGroups = useMemo(() => {
    interface Item {
      label: string;
      icon: string;
      data?: boolean;
      spec?: NewSpec;
      structural?: "section" | "column";
    }
    const groups: { name: string; note: string; items: Item[] }[] = [
      { name: "Text", note: "headings and copy", items: [
        { label: "Heading", icon: "H", spec: { type: "heading" } },
        { label: "Paragraph", icon: "¶", spec: { type: "text" } },
      ]},
      { name: "Interaction", note: "buttons and links", items: [
        { label: "Button", icon: "▭", spec: { type: "button" } },
      ]},
      { name: "Media", note: "images and space", items: [
        { label: "Image", icon: "▨", spec: { type: "image" } },
        { label: "Spacer", icon: "↕", spec: { type: "spacer" } },
      ]},
      { name: "Structure", note: "page structure", items: [
        { label: "Section", icon: "▤", structural: "section" },
        { label: "Column", icon: "▯", structural: "column" },
      ]},
      { name: "Data", note: "bound to sample data", items: [
        { label: "Repeater", icon: "≡", data: true, spec: { type: "repeater" } },
      ]},
      { name: "Shell", note: "chrome components", items: ["SearchBar", "Navbar", "TabBar", "SubHeader"].map((n) => ({
        label: n, icon: "⧉", spec: componentSpec(n),
      }))},
      { name: "Interface kit", note: `${UI_KIT.length} components`, items: UI_KIT.map((n) => ({
        label: n, icon: "⧉", spec: componentSpec(n),
      }))},
      { name: "Residue", note: "secretless · not AA domain", items: [
        { label: "ConfidenceBar", icon: "⧉", spec: componentSpec("ConfidenceBar") },
        { label: "ResultCard", icon: "⧉", spec: componentSpec("ResultCard") },
      ]},
    ];
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length);
  }, [search]);

  // ------------------------------------------------------------------ render

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: `${100 / appZoom}vh`, zoom: appZoom, background: C.win, color: C.body, fontFamily: "system-ui, sans-serif", fontSize: 12, overflow: "hidden" }}
      onClick={() => { if (openMenu) setOpenMenu(null); if (previewOpen) setPreviewOpen(false); if (ctxMenu) setCtxMenu(null); }}
    >
      {/* ---------------------------------------------------------- TopBar */}
      <div style={{ flex: "0 0 auto", minHeight: 32, display: "flex", flexWrap: "wrap", alignItems: "stretch", background: C.sunken, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", position: "relative", zIndex: 40 }}>
        <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", padding: "0 10px 0 11px", fontFamily: MONO, fontSize: 12, color: C.blueLight, letterSpacing: "-0.04em" }}>u—i</span>
        {menus.map((m) => (
          <div key={m.label} style={{ flex: "0 0 auto", position: "relative" }}>
            <button
              className="hv-ctl"
              style={{ height: 32, padding: "0 9px", background: openMenu === m.label ? C.ctlHover : "transparent", border: "none", color: openMenu === m.label ? "#fff" : C.body, cursor: "default" }}
              onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === m.label ? null : m.label); }}
              onMouseEnter={() => { if (openMenu && openMenu !== m.label) setOpenMenu(m.label); }}
            >
              {m.label}
            </button>
            {openMenu === m.label && (
              <div style={{ position: "absolute", top: 32, left: 0, minWidth: m.width, background: C.menu, border: `1px solid ${C.border}`, borderRadius: "0 0 6px 6px", boxShadow: "0 14px 30px rgba(0,0,0,0.55)", padding: "4px 0", zIndex: 30 }}>
                {m.items.map((it, i) =>
                  it.sep ? (
                    <div key={i} style={{ height: 1, background: C.border, margin: "4px 0" }} />
                  ) : (
                    <button
                      key={i}
                      className={it.disabled ? undefined : "hv-menu"}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 24, padding: "0 10px", background: "none", border: "none", color: it.disabled ? C.faint : C.body, cursor: it.disabled ? "default" : "pointer", textAlign: "left" }}
                      onClick={(e) => { e.stopPropagation(); if (it.disabled) return; setOpenMenu(null); it.action?.(); }}
                    >
                      <span style={{ flex: "0 0 12px", color: C.blueLight, fontSize: 11 }}>{it.check ?? ""}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                      <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 10.5, color: C.faint }}>{it.accel ?? ""}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        <div style={{ ...vdiv, alignSelf: "center", margin: "0 8px" }} />
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-end", gap: 1 }}>
          {WORKSPACES.map((w) => (
            <button
              key={w.label}
              style={{ flex: "0 0 auto", height: 32, padding: "0 14px", background: workspace === w.label ? C.panel : "transparent", border: "none", borderRadius: workspace === w.label ? "6px 6px 0 0" : 0, color: workspace === w.label ? "#fff" : C.muted, cursor: "pointer" }}
              onClick={() => setWorkspace(w.label)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div style={{ flex: "1 1 0", minWidth: 8 }} />
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
          <button style={{ width: 24, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 5, color: history.length ? C.body : C.faint, cursor: "pointer" }} title="Undo (Ctrl+Z)" onClick={undoAction}><Sym name="undo" /></button>
          <button style={{ width: 24, height: 22, display: "flex", alignItems: "center", justifyContent: "center", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 5, color: future.length ? C.body : C.faint, cursor: "pointer" }} title="Redo (Ctrl+Shift+Z)" onClick={redoAction}><Sym name="redo" /></button>
        </div>
      </div>

      {/* ---------------------------------------------------------- DocumentRow */}
      <div style={{ flex: "0 0 34px", display: "flex", alignItems: "center", gap: 10, padding: "0 10px", background: C.panel, borderBottom: `1px solid ${C.border}`, minWidth: 0, whiteSpace: "nowrap" }}>
        <button className="hv-ctl" style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 8px", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, cursor: "pointer" }} onClick={() => setOutlinerMode("Project")}>
          <span style={{ color: C.muted, fontSize: 11 }}>page</span>
          {doc?.name ?? "…"}
          <span style={{ color: C.muted }}>▾</span>
        </button>
        <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, fontSize: 11, color: C.faint }}>
          adventure-alerts / pages / {doc?.name ?? "…"}.json
        </span>
        <div style={{ ...vdiv, height: 16 }} />
        <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, color: C.muted }}>
          {WORKSPACES.find((w) => w.label === workspace)?.hint}
        </span>
        <div style={{ flex: "1 1 0", minWidth: 8 }} />
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 8px", background: C.sunken, border: `1px solid ${C.border}`, borderRadius: 5, fontFamily: MONO, fontSize: 11, color: C.green }} title="Every edit is written straight to source">
          <span style={{ width: 6, height: 6, borderRadius: 99, background: C.green }} />
          {savedAt ? `saved ${savedAt}` : "in sync"}
        </div>
        <button
          className="hv-primary"
          style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 5, height: 24, padding: "0 10px", ...primaryBtn }}
          title="Open this page in a new window — real size, fully interactive"
          onClick={() => doc && window.open(`/harness.html?page=${encodeURIComponent(doc.name)}`, "_blank")}
        >
          <Sym name="open_in_new" size={13} />
          Preview
        </button>
      </div>

      {/* ------------------------------------------------ Workspace toolbar */}
      {workspace === "Style" && (
        <div style={{ flex: "0 0 auto", minHeight: 34, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "4px 10px", background: C.panel, borderBottom: `1px solid ${C.border}`, minWidth: 0 }}>
          <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
            <span style={{ width: 7, height: 7, background: C.blueLight, borderRadius: 2 }} />
            Theme
          </span>
          <div style={vdiv} />
          <span style={{ flex: "0 0 auto", fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Preview</span>
          <Seg items={[
            { label: "Parchment", active: !themeDark, onClick: () => setThemeDark(false) },
            { label: "Abyss", active: themeDark, onClick: () => setThemeDark(true) },
          ]} />
          <div style={vdiv} />
          <button className="hv-primary" style={primaryBtn} title="Token edits write to source when committed" onClick={() => setSavedAt(new Date().toLocaleTimeString())}>Write to theme.css</button>
          <button className="hv-ctl" style={{ ...ctlBtn, color: styleEdits ? C.body : C.faint }} onClick={() => { send({ type: "token-clear" }); void styleTokens.refetch(); }}>Reset tokens</button>
          <div style={{ flex: "1 1 0", minWidth: 8 }} />
          <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 11, color: C.faint }}>
            {styleEdits ? `${styleEdits} change${styleEdits === 1 ? "" : "s"} written · theme.css` : "in sync with theme.css"}
          </span>
        </div>
      )}
      {workspace === "Workshop" && (
        <div style={{ flex: "0 0 auto", minHeight: 34, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "4px 10px", background: C.panel, borderBottom: `1px solid ${C.border}`, minWidth: 0 }}>
          <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
            <span style={{ width: 7, height: 7, background: C.muted, borderRadius: 2 }} />
            Material
          </span>
          <Field mono value={wsMat.matName} style={{ flex: "0 0 168px", width: 168, height: 22 }} onCommit={(v) => setWsMat((w) => ({ ...w, matName: v.trim().replace(/[^\w-]/g, "-") || "material", written: false }))} />
          <div style={vdiv} />
          <Seg items={Object.keys(MAT_PRESETS).map((label) => ({
            label,
            active: wsMat.matPreset === label,
            onClick: () => setWsMat((w) => ({ ...w, mat: { ...MAT_PRESETS[label] }, matPreset: label, matEdits: w.matEdits + 1, written: false, matName: `surface-${label.toLowerCase()}` })),
          }))} />
          <div style={vdiv} />
          <button
            className="hv-primary"
            style={primaryBtn}
            onClick={() => {
              void api("/api/material", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: wsMat.matName, lines: materialLines(wsMat) }),
              }).then(() => {
                setWsMat((w) => ({ ...w, written: true, matEdits: 0 }));
                setSavedAt(new Date().toLocaleTimeString());
              });
            }}
          >
            Write tokens
          </button>
          <button className="hv-ctl" style={{ ...ctlBtn, color: wsMat.matEdits ? C.body : C.faint }} onClick={() => setWsMat(WS_INITIAL)}>Revert</button>
          <div style={{ flex: "1 1 0", minWidth: 8 }} />
          <button className="hv-ctl" style={{ ...ctlBtn, height: 22, padding: "0 8px", fontFamily: MONO, fontSize: 11, color: C.muted }} title="Reset graph zoom" onClick={() => setWsMat((w) => ({ ...w, graphZoom: 1 }))}>
            {Math.round(wsMat.graphZoom * 100)}%
          </button>
          <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 11, color: C.faint }}>
            {wsMat.matEdits ? `${wsMat.matEdits} unsaved change${wsMat.matEdits === 1 ? "" : "s"} · theme.css` : "in sync with theme.css"}
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------- Body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {workspace === "Layout" ? (
          <>
            {/* Insert panel */}
            <div style={{ flex: "0 1 236px", minWidth: 180, display: "flex", flexDirection: "column", background: C.panel, borderRight: `1px solid ${C.border}`, minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 6px", whiteSpace: "nowrap" }}>
                <h2 style={{ ...sectionHeader, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>Insert</h2>
                <span style={{ flex: "0 0 auto", fontSize: 10, color: C.faint }}>
                  {insertSource === "Demo kit" ? "drag or click" : "click to preview"}
                </span>
              </div>
              {routeTree && (
                <div style={{ padding: "0 10px 6px" }}>
                  <Seg grow items={(["Demo kit", "Adventure Alerts"] as const).map((s) => ({
                    label: s === "Demo kit" ? "Demo" : "Adventure Alerts",
                    active: insertSource === s,
                    onClick: () => {
                      setInsertSource(s);
                      if (s === "Demo kit" && canvasProject === "aa") {
                        setAaPreview(null);
                        setCanvasProject("demo");
                      }
                      if (s === "Adventure Alerts" && !aaComponents) {
                        void api<{ files: string[]; meta: Record<string, { serverOnly: boolean }> }>(
                          "/api/components?project=aa",
                        ).then(setAaComponents).catch(() => {});
                      }
                    },
                  }))} />
                </div>
              )}
              <div style={{ padding: "0 10px 8px" }}>
                <input className="fc" type="text" placeholder="Search blocks and components" value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
              </div>
              {insertSource === "Adventure Alerts" ? (
                <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 10 }}>
                  {(() => {
                    if (!aaComponents) {
                      return <div style={{ margin: 10, fontSize: 11, color: C.faint }}>Loading component list…</div>;
                    }
                    const q = search.trim().toLowerCase();
                    const groups = new Map<string, string[]>();
                    for (const f of aaComponents.files) {
                      const short = f.replace(/^src\/components\//, "");
                      if (q && !short.toLowerCase().includes(q)) continue;
                      const dir = short.includes("/") ? short.split("/")[0] : "root";
                      (groups.get(dir) ?? groups.set(dir, []).get(dir)!).push(f);
                    }
                    if (groups.size === 0) {
                      return <div style={{ margin: 10, padding: 10, border: `1px dashed ${C.border}`, borderRadius: 6, fontSize: 11, color: C.faint }}>Nothing matches that search.</div>;
                    }
                    return [...groups.entries()].map(([dir, files]) => (
                      <div key={dir} style={{ borderTop: `1px solid ${C.softDiv}` }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "8px 10px 5px", whiteSpace: "nowrap" }}>
                          <span style={{ flex: "0 0 auto", fontSize: 11, color: C.body, fontWeight: 600 }}>{dir}</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10, color: C.faint }}>{files.length}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 10px" }}>
                          {files.map((f) => {
                            const serverOnly = aaComponents.meta[f]?.serverOnly;
                            const name = f.split("/").pop()!.replace(/\.tsx$/, "");
                            const active = aaPreview?.file === `aa:${f}`;
                            return (
                              <button
                                key={f}
                                className={serverOnly ? undefined : "hv-ctl-border"}
                                disabled={serverOnly}
                                title={serverOnly ? "Server component — can't render in the canvas" : f}
                                onClick={() => void openAaComponent(f)}
                                style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 7px", background: active ? C.ctlHover : C.ctl, border: `1px solid ${active ? C.blue : C.border}`, borderRadius: 5, color: serverOnly ? C.faint : C.body, cursor: serverOnly ? "default" : "pointer", textAlign: "left", overflow: "hidden", whiteSpace: "nowrap", opacity: serverOnly ? 0.6 : 1 }}
                              >
                                <span style={{ flex: "0 0 auto", color: serverOnly ? C.faint : C.blueLight, width: 13, textAlign: "center" }}>⧉</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                                {serverOnly && <span style={{ flex: "0 0 auto", fontSize: 9, color: C.faint, textTransform: "uppercase", letterSpacing: "0.05em" }}>server</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
              <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 10 }}>
                {insertGroups.map((g) => (
                  <div key={g.name} style={{ borderTop: `1px solid ${C.softDiv}` }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "8px 10px 5px", whiteSpace: "nowrap" }}>
                      <span style={{ flex: "0 0 auto", fontSize: 11, color: C.body, fontWeight: 600 }}>{g.name}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10, color: C.faint }}>{g.note}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 10px" }}>
                      {g.items.map((i) => (
                        <button
                          key={i.label}
                          className="hv-ctl-border"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "copy";
                            if (i.structural === "section") e.dataTransfer.setData(MIME_SECTION, "{}");
                            else if (i.structural === "column") e.dataTransfer.setData(MIME_COLUMN, "{}");
                            else if (i.spec) e.dataTransfer.setData(MIME_BLOCK, JSON.stringify(i.spec));
                          }}
                          onClick={() => {
                            if (i.structural === "section") addSection();
                            else if (i.structural === "column") addColumn();
                            else if (i.spec) insertBlock(i.spec);
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 5, color: C.body, cursor: "grab", textAlign: "left", overflow: "hidden", whiteSpace: "nowrap" }}
                        >
                          <span style={{ flex: "0 0 auto", color: C.blueLight, width: 13, textAlign: "center" }}>{i.icon}</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{i.label}</span>
                          {i.data && <span style={{ flex: "0 0 auto", width: 5, height: 5, borderRadius: 99, background: C.amber }} title="expects data" />}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {insertGroups.length === 0 && (
                  <div style={{ margin: 10, padding: 10, border: `1px dashed ${C.border}`, borderRadius: 6, fontSize: 11, color: C.faint }}>Nothing matches that search.</div>
                )}
              </div>
              )}
            </div>

            {/* Canvas region */}
            <div ref={canvasRegionRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 240, background: C.void }}>
              <div style={{ flex: "0 0 auto", minHeight: 30, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "4px 10px", borderBottom: `1px solid ${C.canvasEdge}`, background: C.canvasBar, minWidth: 0, position: "relative", zIndex: 25 }}>
                <Seg items={(Object.keys(DEVICES) as DeviceName[]).map((d) => ({ label: d, active: device === d, onClick: () => setDeviceAnd(d) }))} />
                <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 11, color: C.faint }}>{DEVICES[device].width}px</span>
                <div style={{ ...vdiv, height: 16 }} />
                <div style={{ flex: "0 0 auto", position: "relative", whiteSpace: "nowrap" }}>
                  <button
                    className="hv-ctl-border"
                    style={{ display: "flex", alignItems: "center", gap: 7, height: 22, padding: "0 8px", background: previewOpen ? C.ctl : "transparent", border: `1px solid ${previewOpen ? C.borderHover : C.border}`, borderRadius: 5, color: C.body, cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); setPreviewOpen((v) => !v); }}
                    title="Preview context (P)"
                  >
                    <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Context</span>
                    <span style={{ fontFamily: MONO, fontSize: 11 }}>{role} · {canvasState} · {themeDark ? "Abyss" : "Parchment"}</span>
                    <span style={{ fontSize: 8, color: C.faint }}>▼</span>
                  </button>
                  {previewOpen && (
                    <div style={{ position: "absolute", top: 26, left: 0, minWidth: 230, background: C.menu, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 14px 30px rgba(0,0,0,0.55)", padding: "4px 0", zIndex: 30 }} onClick={(e) => e.stopPropagation()}>
                      {[
                        { title: "Role", items: ROLES.map((r) => ({ label: r, on: role === r, accel: "", act: () => setRole(r) })) },
                        { title: "State", items: CANVAS_STATES.map((cs, i) => ({ label: cs, on: canvasState === cs, accel: `Alt+${i + 1}`, act: () => setCanvasState(cs) })) },
                        { title: "Theme", items: [
                          { label: "Parchment", on: !themeDark, accel: "", act: () => setThemeDark(false) },
                          { label: "Abyss", on: themeDark, accel: "Z", act: () => setThemeDark(true) },
                        ]},
                      ].map((g, gi) => (
                        <div key={g.title}>
                          {gi > 0 && <div style={{ height: 1, background: C.border, margin: "4px 0" }} />}
                          <div style={{ padding: "3px 10px 2px", fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.09em" }}>{g.title}</div>
                          {g.items.map((it) => (
                            <button key={it.label} className="hv-menu" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 24, padding: "0 10px", background: "none", border: "none", color: C.body, cursor: "pointer", textAlign: "left" }} onClick={it.act}>
                              <span style={{ flex: "0 0 12px", color: C.blueLight, fontSize: 11 }}>{it.on ? "•" : ""}</span>
                              <span style={{ flex: 1 }}>{it.label}</span>
                              <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 10.5, color: C.faint }}>{it.accel}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ flex: "1 1 0", minWidth: 8 }} />
                <span style={{ flex: "0 0 auto", fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Mode</span>
                <div title="Tab toggles between editing and using the page">
                  <Seg items={[
                    { label: "Edit", active: !interact, onClick: () => setInteract(false) },
                    { label: "View", active: interact, onClick: () => setInteract(true) },
                  ]} />
                </div>
              </div>

              {rulersOn && (
                <div style={{ flex: "0 0 16px", display: "flex", background: C.canvasBar, borderBottom: `1px solid ${C.canvasEdge}`, overflow: "hidden" }}>
                  <button
                    title="Ruler units (px / rem)"
                    onClick={() => setRulerUnit((u) => (u === "px" ? "rem" : "px"))}
                    style={{ flex: "0 0 16px", padding: 0, background: "none", border: "none", borderRight: `1px solid ${C.canvasEdge}`, color: C.faint, fontSize: 7, fontFamily: MONO, cursor: "pointer", lineHeight: 1 }}
                  >
                    {rulerUnit}
                  </button>
                  <canvas ref={hRuler} style={{ flex: 1, minWidth: 0, height: 16 }} />
                </div>
              )}
              <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative" }}>
                {rulersOn && (
                  <canvas ref={vRuler} style={{ flex: "0 0 16px", width: 16, background: C.canvasBar, borderRight: `1px solid ${C.canvasEdge}` }} />
                )}
                <iframe
                  key={canvasProject}
                  ref={iframeRef}
                  src={canvasProject === "aa" ? "/harness.html?project=aa" : "/harness.html"}
                  title="canvas"
                  style={{ flex: 1, border: "none", background: C.void }}
                />
                {routeSel && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.void }}>
                    <div style={{ maxWidth: 420, padding: "18px 20px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontFamily: MONO, fontSize: 14, color: "#fff" }}>{routeSel.urlPath}</span>
                        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: routeSel.ownership === "owned" ? C.orange : C.muted }}>
                          {routeSel.files.page ? (routeSel.ownership ?? "coded") : "API route"}
                        </span>
                      </div>
                      {routeSel.files.page ? (
                        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>
                          Hand-coded page — <span style={{ fontFamily: MONO, fontSize: 10.5 }}>{routeSel.files.page}</span>.
                          Owned pages become editable on this canvas when u-and-i's Next write-side lands.
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>
                          Route handler — <span style={{ fontFamily: MONO, fontSize: 10.5 }}>{routeSel.files.route}</span>. Nothing to draw.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : workspace === "Style" ? (
          <StyleBody tokens={styleTokens} dark={themeDark} />
        ) : (
          <WorkshopBody ws={wsMat} setWs={setWsMat} />
        )}

        {/* ---------------------------------------------------- Right column */}
        <div style={{ flex: "0 1 302px", minWidth: 230, display: "flex", flexDirection: "column", background: C.panel, borderLeft: `1px solid ${C.border}`, minHeight: 0 }}>
          {/* Outliner */}
          <div style={{ flex: "0 0 38%", minHeight: 132, display: "flex", flexDirection: "column", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 6px", whiteSpace: "nowrap" }}>
              <h2 style={sectionHeader}>Outliner</h2>
              <div style={{ flex: "1 1 0", minWidth: 4 }} />
              <Seg items={(["Page", "Project"] as const).map((m) => ({ label: m, active: outlinerMode === m, onClick: () => setOutlinerMode(m) }))} />
            </div>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 8 }}>
              {outlinerMode === "Page" && doc && doc.sections.map((s, si) => (
                <div key={s.id}>
                  <OutlinerRow pad={10} glyph="▤" glyphColor={C.blueLight} label={s.label ?? `section ${si + 1}`} selected={sel.id === s.id} mark={SEL_COLOR.section}
                    caret={collapsed[s.id] ? "▸" : "▾"}
                    onToggle={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))}
                    onClick={() => select("section", s.id)}
                    onCtx={(e) => { e.preventDefault(); select("section", s.id); setCtxMenu({ x: e.clientX / appZoom, y: e.clientY / appZoom }); }} />
                  {!collapsed[s.id] && s.columns.map((c, ci) => (
                    <div key={c.id}>
                      <OutlinerRow pad={23} glyph="▯" glyphColor={C.green} label={c.blocks.length ? `column ${ci + 1}` : `column ${ci + 1} · empty`} selected={sel.id === c.id} mark={SEL_COLOR.column}
                        caret={collapsed[c.id] ? "▸" : "▾"}
                        onToggle={() => setCollapsed((x) => ({ ...x, [c.id]: !x[c.id] }))}
                        onClick={() => select("column", c.id)}
                        onCtx={(e) => { e.preventDefault(); select("column", c.id); setCtxMenu({ x: e.clientX / appZoom, y: e.clientY / appZoom }); }} />
                      {!collapsed[c.id] && c.blocks.map((b) => (
                        <OutlinerRow key={b.id} pad={36} glyph={GLYPH_OF[b.type]} glyphColor={C.muted} label={blockTitle(b)} selected={sel.id === b.id} mark={SEL_COLOR.block}
                          note={!!b.note} data={!!b.needsData}
                          onClick={() => select("block", b.id)}
                          onCtx={(e) => { e.preventDefault(); select("block", b.id); setCtxMenu({ x: e.clientX / appZoom, y: e.clientY / appZoom }); }} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              {outlinerMode === "Project" && (
                <>
                  <div style={{ padding: "6px 10px 3px", fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.09em" }}>Pages</div>
                  {pages.map((p) => (
                    <OutlinerRow key={p} pad={10} glyph="▤" glyphColor={C.blueLight} label={p} selected={doc?.name === p} mark={C.blue}
                      right={`/${p === "home" ? "" : p}`}
                      onClick={() => void openPage(p)} />
                  ))}
                  <div className="hv-row" style={{ padding: "4px 10px", color: C.faint, cursor: "pointer" }} onClick={() => void newPage()}>+ New page</div>
                  <div style={{ padding: "6px 10px 3px", fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.09em" }}>Project</div>
                  <OutlinerRow pad={10} glyph="⌸" glyphColor={C.muted} label="Layouts" right="none yet" onClick={() => {}} />
                  <OutlinerRow pad={10} glyph="⧉" glyphColor={C.muted} label="Components" right={`${UI_KIT.length + 2}`} onClick={() => {}} />
                  <OutlinerRow pad={10} glyph="◈" glyphColor={C.muted} label="Sample data" right="0 collections" onClick={() => {}} />
                  <OutlinerRow pad={10} glyph="▨" glyphColor={C.muted} label="Assets" right="none" onClick={() => {}} />
                  {routeTree && (
                    <>
                      <div style={{ padding: "8px 10px 3px", fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.09em" }}>
                        Adventure Alerts · routes
                      </div>
                      <RouteTree
                        tree={routeTree}
                        selectedId={routeSel ? routeId(routeSel) : null}
                        onSelect={(n) => {
                          setRouteSel(n);
                          setSel({ kind: null, id: null });
                        }}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Properties */}
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            <div style={{ flex: "0 0 30px", display: "flex", flexDirection: "column", background: C.win, borderRight: `1px solid ${C.border}`, paddingTop: 4, gap: 1 }}>
              {PROP_TABS.map((p) => (
                <button key={p.label} className="hv-ctl" title={p.label}
                  style={{ height: 28, background: propTab === p.label ? C.ctlHover : "transparent", border: "none", borderLeft: `2px solid ${propTab === p.label ? C.blue : "transparent"}`, color: propTab === p.label ? "#fff" : C.muted, fontSize: 13, cursor: "pointer", lineHeight: 1 }}
                  onClick={() => setPropTab(p.label)}>
                  {p.glyph}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ flex: "0 0 auto", padding: "8px 10px 7px", borderBottom: `1px solid ${C.softDiv}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                  <span style={{ flex: "0 0 auto", width: 7, height: 7, background: selAccent, borderRadius: 2 }} />
                  <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12, color: "#fff", fontWeight: 600 }}>{selTitle}</span>
                  <span style={{ flex: "0 0 auto", fontSize: 11, color: C.muted }}>{sel.kind ? selKindLabel : ""}</span>
                </div>
                <div style={{ marginTop: 3, display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
                  <span style={{ flex: "0 0 auto", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted, fontWeight: 700 }}>{propTab}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, fontSize: 10.5, color: C.faint }}>{selPath}</span>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                <Properties
                  tab={propTab}
                  routeSel={routeSel}
                  aaPreview={canvasProject === "aa" ? aaPreview : null}
                  setAaProp={setAaProp}
                  doc={doc}
                  sel={sel}
                  block={block}
                  colHit={colHit}
                  secHit={secHit}
                  notes={notes}
                  propSpecs={block?.type === "component" ? propSpecs[block.file] : undefined}
                  edit={edit}
                  patchBlock={patchBlock}
                  select={select}
                  toggleNote={toggleNote}
                  addColumn={addColumn}
                  moveBy={moveBy}
                  setCanvasState={setCanvasState}
                  canvasState={canvasState}
                  gotoStyle={() => setWorkspace("Style")}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- Context menu */}
      {ctxMenu && (() => {
        const items: MenuItem[] = [];
        if (block && blockText(block) != null)
          items.push(
            { label: "Edit text in place", accel: "F2", action: () => sel.id && send({ type: "begin-edit", id: sel.id }) },
            { sep: true },
          );
        if (sel.kind)
          items.push(
            { label: "Cut", accel: "Ctrl+X", action: cutAction },
            { label: "Copy", accel: "Ctrl+C", action: copyAction },
          );
        items.push({
          label: clipboard.current ? `Paste ${clipboard.current.kind}` : "Paste",
          accel: "Ctrl+V",
          disabled: !clipboard.current,
          action: pasteAction,
        });
        if (sel.kind)
          items.push(
            { label: "Duplicate", accel: "Ctrl+D", action: duplicateAction },
            { label: deleteLabel, accel: "Del", action: deleteSel },
            { sep: true },
            { label: sel.kind === "column" ? "Move left" : "Move up", accel: "Alt+Up", action: () => moveBy(-1) },
            { label: sel.kind === "column" ? "Move right" : "Move down", accel: "Alt+Down", action: () => moveBy(1) },
          );
        if (block)
          items.push(
            { sep: true },
            { label: block.note ? "Remove dev note" : "Add dev note", action: toggleNote },
            { label: "Needs data", check: tick(!!block.needsData), action: () => patchBlock((b) => { b.needsData = !b.needsData; }) },
          );
        if (secHit)
          items.push(
            { sep: true },
            { label: "Card surface", check: tick(secHit.sec.background !== "none"), action: () => edit((p) => { const f = findSection(p, secHit.sec.id); if (f) f.sec.background = f.sec.background === "none" ? "card" : "none"; }) },
            { label: "Add column", action: addColumn },
          );
        if (colHit) items.push({ sep: true }, { label: "Add column", action: addColumn });
        if (!sel.kind) items.push({ sep: true }, { label: "Add section", action: addSection });
        const left = Math.max(4, Math.min(ctxMenu.x, window.innerWidth / appZoom - 232));
        const top = Math.max(4, Math.min(ctxMenu.y, window.innerHeight / appZoom - items.length * 22 - 20));
        return (
          <div
            style={{ position: "fixed", left, top, minWidth: 218, background: C.menu, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 14px 30px rgba(0,0,0,0.55)", padding: "4px 0", zIndex: 60 }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {items.map((it, i) =>
              it.sep ? (
                <div key={i} style={{ height: 1, background: C.border, margin: "4px 0" }} />
              ) : (
                <button
                  key={i}
                  className={it.disabled ? undefined : "hv-menu"}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 24, padding: "0 10px", background: "none", border: "none", color: it.disabled ? C.faint : C.body, cursor: it.disabled ? "default" : "pointer", textAlign: "left" }}
                  onClick={() => { if (it.disabled) return; setCtxMenu(null); it.action?.(); }}
                >
                  <span style={{ flex: "0 0 12px", color: C.blueLight, fontSize: 11 }}>{it.check ?? ""}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                  <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 10.5, color: C.faint }}>{it.accel ?? ""}</span>
                </button>
              ),
            )}
          </div>
        );
      })()}

      {/* ---------------------------------------------------------- StatusBar */}
      <div style={{ flex: "0 0 26px", display: "flex", alignItems: "center", gap: 10, padding: "0 10px", background: C.panel, borderTop: `1px solid ${C.border}`, fontSize: 11, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
        <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, color: C.muted }}>{crumb}</span>
        <div style={{ flex: "1 1 0", minWidth: 8 }} />
        <span style={{ flex: "0 0 auto", color: C.green }}>{savedAt ? `saved to source at ${savedAt}` : "in sync with source"}</span>
        <div style={{ ...vdiv, height: 14 }} />
        <span style={{ flex: "0 0 auto", color: C.muted }}>
          {needsDataCount === 0 ? "all elements bound" : `${needsDataCount} element${needsDataCount === 1 ? "" : "s"} needs data`}
        </span>
        <div style={{ ...vdiv, height: 14 }} />
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 4 }}>
          <button style={{ width: 19, height: 18, background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.body, cursor: "pointer", lineHeight: 1 }} title="Zoom out" onClick={() => zoomBy(-1)}>−</button>
          <span style={{ fontFamily: MONO, color: C.body, width: 32, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <button style={{ width: 19, height: 18, background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.body, cursor: "pointer", lineHeight: 1 }} title="Zoom in" onClick={() => zoomBy(1)}>+</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties body (per-tab)
// ---------------------------------------------------------------------------

function Properties(props: {
  tab: PropTab;
  routeSel?: RouteNode | null;
  aaPreview?: { file: string; specs: PropSpec[]; values: Record<string, unknown> } | null;
  setAaProp?: (name: string, value: unknown) => void;
  doc: PageDoc | null;
  sel: Sel;
  block: Block | null;
  colHit: ReturnType<typeof findColumn>;
  secHit: ReturnType<typeof findSection>;
  notes: ReturnType<typeof noteEntries>;
  propSpecs?: PropSpec[];
  edit: (m: (d: PageDoc) => Partial<Sel> | void) => void;
  patchBlock: (fn: (b: Block) => void) => void;
  select: (kind: SelKind | null, id: string | null) => void;
  toggleNote: () => void;
  addColumn: () => void;
  moveBy: (d: number) => void;
  setCanvasState: (s: CanvasState) => void;
  canvasState: CanvasState;
  gotoStyle: () => void;
}) {
  const { tab, doc, sel, block, colHit, secHit, notes, edit, patchBlock, select } = props;
  const pad: CSSProperties = { padding: "9px 10px 12px", display: "flex", flexDirection: "column", gap: 6 };

  if (props.aaPreview && !props.routeSel) {
    const p = props.aaPreview;
    const rel = p.file.replace(/^aa:/, "");
    return (
      <div style={pad}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rel}>{rel}</div>
        <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
          Live preview of the real adventure-alerts component. Prop edits re-render the canvas; nothing is written.
        </div>
        {p.specs.map((s) => {
          const raw = p.values[s.name];
          if (s.control.kind === "boolean") {
            return (
              <Row key={s.name} label={s.name}>
                <Seg grow items={[
                  { label: "false", active: raw !== true, onClick: () => props.setAaProp?.(s.name, false) },
                  { label: "true", active: raw === true, onClick: () => props.setAaProp?.(s.name, true) },
                ]} />
              </Row>
            );
          }
          if (s.control.kind === "select" && s.control.options) {
            return (
              <Row key={s.name} label={s.name}>
                <select className="fc" value={String(raw ?? "")} onChange={(e) => props.setAaProp?.(s.name, e.target.value || undefined)} style={{ ...inputStyle, height: 22, padding: "0 5px", flex: 1, minWidth: 0 }}>
                  <option value="">—</option>
                  {s.control.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Row>
            );
          }
          const display = typeof raw === "string" ? raw : raw === undefined ? "" : JSON.stringify(raw);
          return (
            <div key={s.name} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ flex: "0 0 74px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: C.muted }} title={s.typeText}>{s.name}</span>
              <Field value={display} onCommit={(v) => {
                if (v === "") return props.setAaProp?.(s.name, undefined);
                if (s.control.kind === "number") return props.setAaProp?.(s.name, Number(v) || 0);
                let val: unknown = v;
                if (s.control.kind === "json") { try { val = JSON.parse(v); } catch { /* keep string */ } }
                props.setAaProp?.(s.name, val);
              }} style={{ flex: 1, minWidth: 0 }} />
            </div>
          );
        })}
        {p.specs.length === 0 && <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>No props interface found for this component.</div>}
      </div>
    );
  }

  if (props.routeSel) {
    const r = props.routeSel;
    const fileRows = (Object.entries(r.files) as [string, string | undefined][]).filter(
      (e): e is [string, string] => !!e[1],
    );
    return (
      <div style={pad}>
        <Row label="URL">
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, color: C.text }}>{r.urlPath}</span>
        </Row>
        <Row label="Ownership">
          <span style={{ flex: 1, color: r.ownership === "owned" ? C.orange : C.body }}>
            {r.files.page ? (r.ownership === "owned" ? "u-and-i owned" : "hand-coded") : "route handler"}
          </span>
        </Row>
        {r.isDynamic && (
          <Row label="Dynamic">
            <span style={{ flex: 1, fontFamily: MONO, color: C.body }}>{r.segment}</span>
          </Row>
        )}
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted, fontWeight: 700, marginTop: 4 }}>Files</div>
        {fileRows.map(([kind, file]) => (
          <div key={kind} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
            <span style={{ flex: "0 0 62px", color: C.muted }}>{kind}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 10.5, color: C.body }}>{file}</span>
          </div>
        ))}
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted, fontWeight: 700, marginTop: 4 }}>Layout chain</div>
        {r.layoutChain.length ? (
          r.layoutChain.map((l, i) => (
            <div key={l} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ flex: "0 0 62px", color: C.faint }}>{i === 0 ? "root" : `level ${i}`}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 10.5, color: C.body }}>{l}</span>
            </div>
          ))
        ) : (
          <div style={{ fontSize: 11, color: C.faint }}>none</div>
        )}
        <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5, marginTop: 4 }}>
          Read-only: adventure-alerts routes are interpreted from <span style={{ fontFamily: MONO }}>src/app</span>, never modified.
        </div>
      </div>
    );
  }

  if (!doc) return null;
  if (!sel.kind) {
    return <div style={{ padding: "12px 10px", fontSize: 11, color: C.faint, lineHeight: 1.5 }}>Nothing selected. Pick a row in the Outliner, or click something on the page.</div>;
  }

  const styleGet = (k: string) => block?.styles?.[k] ?? "";
  const styleSet = (k: string) => (v: string) =>
    patchBlock((b) => {
      b.styles = { ...(b.styles ?? {}) };
      const val = LENGTH_PROPS.has(k) ? normalizeLen(v) : v.trim();
      if (val === "") delete b.styles[k];
      else b.styles[k] = val;
    });

  if (tab === "Content") {
    const text = block ? blockText(block) : null;
    return (
      <div style={pad}>
        {block && text != null && (
          <>
            <Field value={text} onCommit={(v) => patchBlock((b) => setBlockTextValue(b, v))} />
            <Row label="Reads as">
              <span style={{ flex: 1, minWidth: 0, color: C.body }}>
                {block.type === "heading" ? (block.level === 1 ? "Page title" : block.level === 2 ? "Section title" : "Sub-heading") : block.type === "button" ? "Action label" : "Body copy"}
              </span>
            </Row>
            <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>Double-click the element on the page to edit in place.</div>
          </>
        )}
        {secHit && (
          <>
            <Field value={secHit.sec.label ?? ""} placeholder="Section name" onCommit={(v) => edit((p) => { const f = findSection(p, secHit.sec.id); if (f) f.sec.label = v; })} />
            <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>Section names are labels for you and for the Outliner. They don't render on the page.</div>
          </>
        )}
        {block && text == null && (
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>This element has no editable text. Its content comes from props or data.</div>
        )}
        {colHit && <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>Columns have no content of their own — select a block inside, or drag one in from Insert.</div>}
      </div>
    );
  }

  if (tab === "Placement") {
    return (
      <div style={pad}>
        {block && (
          <>
            <Row label="In column">
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.body }}>
                {(() => {
                  const h = locate(doc, block.id);
                  if (!h) return "";
                  const total = h.sec.columns.reduce((a, c) => a + (parseInt(c.flex) || 1), 0);
                  return `${h.col.id} · ${h.col.flex} of ${total} width`;
                })()}
              </span>
            </Row>
            {/* Margin / padding box model */}
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, background: C.sunken, padding: "7px 8px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Margin</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>any CSS length</span>
              </div>
              <BoxGrid
                margin={parseBox(block.margin)}
                padding={parseBox(styleGet("padding") || undefined)}
                onMargin={(sides) => patchBlock((b) => { b.margin = joinBox(...sides); })}
                onPadding={(sides) => styleSet("padding")(joinBox(...sides) === "0" ? "" : joinBox(...sides))}
              />
            </div>
            {[
              { label: "Width", a: ["width", "width"], b: ["maxWidth", "max-width"] },
              { label: "Height", a: ["height", "height"], b: ["maxHeight", "max-height"] },
              { label: "Min", a: ["minWidth", "min-width"], b: ["minHeight", "min-height"] },
            ].map((r) => (
              <Row key={r.label} label={r.label}>
                <Field mono value={styleGet(r.a[0])} placeholder={r.a[1]} title={r.a[1]} style={{ flex: 1, minWidth: 0, height: 22 }} onCommit={styleSet(r.a[0])} />
                <Field mono value={styleGet(r.b[0])} placeholder={r.b[1]} title={r.b[1]} style={{ flex: 1, minWidth: 0, height: 22 }} onCommit={styleSet(r.b[0])} />
              </Row>
            ))}
            {[
              { label: "Display", key: "display", options: ["", "block", "flex", "inline-flex", "grid", "none"] },
              { label: "Position", key: "position", options: ["", "static", "relative", "absolute", "sticky", "fixed"] },
              { label: "Align self", key: "alignSelf", options: ["", "flex-start", "center", "flex-end", "stretch"] },
              { label: "Overflow", key: "overflow", options: ["", "visible", "hidden", "auto"] },
            ].map((f) => (
              <Row key={f.key} label={f.label}>
                <select className="fc" value={styleGet(f.key)} onChange={(e) => styleSet(f.key)(e.target.value)} style={{ ...inputStyle, height: 22, padding: "0 5px", flex: 1, minWidth: 0 }}>
                  {f.options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </Row>
            ))}
            {["relative", "absolute", "sticky", "fixed"].includes(styleGet("position")) && (
              <Row label="Inset">
                <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                  {(["top", "right", "bottom", "left"] as const).map((k) => (
                    <Field key={k} mono value={styleGet(k)} placeholder={k} title={k} style={{ height: 22, padding: "0 5px", textAlign: "center", fontSize: 10 }} onCommit={styleSet(k)} />
                  ))}
                </div>
              </Row>
            )}
            <Row label="Z-index">
              <Field mono value={styleGet("zIndex")} placeholder="auto" style={{ flex: 1, minWidth: 0, height: 22 }} onCommit={styleSet("zIndex")} />
            </Row>
          </>
        )}
        {colHit && (
          <>
            <Row label="Width">
              <Seg grow items={["1", "2", "3", "4", "5"].map((w) => ({ label: w, active: colHit.col.flex === w, onClick: () => edit((p) => { const f = findColumn(p, colHit.col.id); if (f) f.col.flex = w; }) }))} />
            </Row>
            <Row label="Share">
              <span style={{ flex: 1, color: C.body }}>{colHit.col.flex} of {colHit.sec.columns.reduce((a, c) => a + (parseInt(c.flex) || 1), 0)}</span>
            </Row>
            <Row label="Contains">
              <span style={{ flex: 1, color: C.body }}>{colHit.col.blocks.length} block{colHit.col.blocks.length === 1 ? "" : "s"}</span>
            </Row>
          </>
        )}
        {secHit && (
          <Row label="Columns">
            <span style={{ flex: 1, color: C.body }}>{secHit.sec.columns.length}</span>
            <button className="hv-ctl" style={ctlBtn} onClick={props.addColumn}>Add</button>
          </Row>
        )}
        <Row label="Order">
          <div style={{ display: "flex", gap: 4 }}>
            <button className="hv-ctl" style={ctlBtn} onClick={() => props.moveBy(-1)}>{sel.kind === "column" ? "Move left" : "Move up"}</button>
            <button className="hv-ctl" style={ctlBtn} onClick={() => props.moveBy(1)}>{sel.kind === "column" ? "Move right" : "Move down"}</button>
          </div>
        </Row>
        {colHit && <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>Drag blocks from Insert straight into this column, or drag existing blocks between columns.</div>}
        {secHit && <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>A section is one flex row in {doc.name}.json. Click a column inside it to size that column.</div>}
      </div>
    );
  }

  if (tab === "Style") {
    return (
      <div style={pad}>
        {block?.type === "heading" && (
          <Row label="Level">
            <Seg grow items={[1, 2, 3].map((l) => ({ label: `H${l}`, active: block.level === l, onClick: () => patchBlock((b) => { if (b.type === "heading") b.level = l as 1 | 2 | 3; }) }))} />
          </Row>
        )}
        {(block?.type === "heading" || block?.type === "text") && (
          <Row label="Align">
            <Seg grow items={(["left", "center", "right"] as const).map((a) => ({
              label: a[0].toUpperCase() + a.slice(1),
              active: (block.textAlign ?? "left") === a,
              onClick: () => patchBlock((b) => { if (b.type === "heading" || b.type === "text") b.textAlign = a === "left" ? undefined : a; }),
            }))} />
          </Row>
        )}
        {secHit && (
          <Row label="Surface">
            <Seg grow items={[{ l: "Card", v: "card" }, { l: "Plain", v: "none" }].map((m) => ({
              label: m.l,
              active: secHit.sec.background === m.v || (m.v === "card" && secHit.sec.background === "well"),
              onClick: () => edit((p) => { const f = findSection(p, secHit.sec.id); if (f) f.sec.background = m.v as "card" | "none"; }),
            }))} />
          </Row>
        )}
        <Row label="Tokens">
          <button className="hv-ctl" style={ctlBtn} onClick={props.gotoStyle}>Open Style workspace</button>
        </Row>
        {block && (
          <div style={{ background: C.sunken, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 8px", fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: C.muted }}>
            {Object.entries(block.styles ?? {}).length
              ? Object.entries(block.styles!).map(([k, v]) => `${k}: ${v};`).join(" ")
              : "no CSS overrides on this element"}
          </div>
        )}
      </div>
    );
  }

  if (tab === "Props") {
    return (
      <div style={pad}>
        {block?.type === "component" ? (
          <>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.file}</div>
            {(props.propSpecs ?? []).map((p) => {
              const raw = block.props[p.name];
              const display = typeof raw === "string" ? raw : raw === undefined ? "" : JSON.stringify(raw);
              return (
                <div key={p.name} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ flex: "0 0 74px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: C.muted }} title={p.typeText}>{p.name}</span>
                  <Field value={display} onCommit={(v) => patchBlock((b) => {
                    if (b.type !== "component") return;
                    let val: unknown = v;
                    if (v === "") { const { [p.name]: _, ...rest } = b.props; b.props = rest; return; }
                    try { val = JSON.parse(v); } catch { /* keep string */ }
                    b.props = { ...b.props, [p.name]: val };
                  })} style={{ flex: 1, minWidth: 0 }} />
                </div>
              );
            })}
            {props.propSpecs?.length === 0 && <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>No props interface found for this component.</div>}
            <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>Controls are derived from the component's TypeScript props interface. Values are written into the page document, not the component.</div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>Props apply to component elements. Select a component on the page.</div>
        )}
      </div>
    );
  }

  if (tab === "Data") {
    return (
      <div style={pad}>
        {block && (
          <>
            <Row label="Value">
              <Seg grow items={[
                { label: "Static", active: !block.needsData, onClick: () => patchBlock((b) => { b.needsData = false; }) },
                { label: "From data", active: !!block.needsData, onClick: () => patchBlock((b) => { b.needsData = true; b.binding = b.binding ?? `${b.type === "component" ? b.exportName : KIND_LABEL[b.type]} ← (data source)`; }) },
              ]} />
            </Row>
            {block.needsData && (
              <div style={{ padding: "8px 9px", background: C.sunken, border: `1px solid ${C.border}`, borderRadius: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ flex: "0 0 auto", width: 5, height: 5, borderRadius: 99, background: C.amber }} />
                  <span style={{ color: C.body }}>Awaiting data</span>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{block.binding}</div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button className="hv-primary" style={{ ...primaryBtn, height: 22, padding: "0 8px" }} onClick={() => patchBlock((b) => { b.needsData = false; b.note = null; })}>Hook up…</button>
                  <button className="hv-ctl" style={{ ...ctlBtn, height: 22, padding: "0 8px" }} onClick={() => patchBlock((b) => { b.needsData = false; })}>Keep mock</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ ...rowLabel, lineHeight: 1.4 }}>Show in</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, minWidth: 0 }}>
                {CANVAS_STATES.map((cs) => (
                  <button key={cs} style={{ padding: "2px 7px", borderRadius: 999, background: props.canvasState === cs ? C.ctlHover : C.sunken, border: `1px solid ${props.canvasState === cs ? C.blue : C.border}`, color: props.canvasState === cs ? "#fff" : C.muted, cursor: "pointer" }} onClick={() => props.setCanvasState(cs)}>
                    {cs}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div style={{ paddingTop: 2, fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
          Sample-data collections aren't built yet — "From data" marks the element as awaiting a real source, which travels as a dev note into generated code.
        </div>
      </div>
    );
  }

  if (tab === "Notes") {
    return (
      <div style={pad}>
        {block && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Field value={block.note ?? ""} placeholder="No note on this element" onCommit={(v) => patchBlock((b) => { b.note = v || null; })} />
            <button className="hv-amber" style={{ ...amberBtn, alignSelf: "flex-start" }} onClick={props.toggleNote}>
              {block.note ? "Remove note" : "Add dev note"}
            </button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ flex: 1, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: C.muted, fontWeight: 700 }}>Open on this page</span>
            <span style={{ flex: "0 0 auto", fontSize: 10, color: C.faint }}>{notes.length}</span>
          </div>
          {notes.map((n) => (
            <div key={n.block.id} className="hv-card" style={{ padding: "7px 8px", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 6, display: "flex", gap: 7, alignItems: "flex-start", cursor: "pointer" }} onClick={() => select("block", n.block.id)}>
              <span style={{ flex: "0 0 auto", width: 16, height: 16, borderRadius: 99, background: C.amber, color: C.amberInk, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{n.n}</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.block.note}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{blockTag(n.block)} · {n.col.id}</span>
              </div>
            </div>
          ))}
          {notes.length === 0 && (
            <div style={{ padding: 9, border: `1px dashed ${C.border}`, borderRadius: 6, fontSize: 11, color: C.faint, lineHeight: 1.5 }}>No open notes on this page.</div>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
          Notes travel with the element in <span style={{ fontFamily: MONO }}>{doc.name}.json</span> and surface as TODO comments in generated source.
        </div>
      </div>
    );
  }

  // Source
  return (
    <div style={{ padding: "9px 10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis" }}>
        pages/{doc.name}.json → src/pages-gen/{doc.name}.tsx
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        <button className="hv-ctl" style={ctlBtn} onClick={() => void navigator.clipboard.writeText(`fixtures/demo-project/src/pages-gen/${doc.name}.tsx`)}>Copy path</button>
      </div>
      <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
        The editor writes JSON; the component is regenerated. Never edit <span style={{ fontFamily: MONO }}>pages-gen/</span> by hand.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Box model grid (margin ring around padding ring)
// ---------------------------------------------------------------------------

function BoxGrid({
  margin,
  padding,
  onMargin,
  onPadding,
}: {
  margin: [string, string, string, string];
  padding: [string, string, string, string];
  onMargin: (sides: [string, string, string, string]) => void;
  onPadding: (sides: [string, string, string, string]) => void;
}) {
  const cell = (
    sides: [string, string, string, string],
    i: 0 | 1 | 2 | 3,
    commit: (s: [string, string, string, string]) => void,
  ) => (
    <Field
      mono
      value={sides[i] === "0" ? "" : sides[i]}
      placeholder="0"
      style={{ width: 44, height: 20, background: C.panel, borderRadius: 4, textAlign: "center", fontSize: 10, padding: "0 2px" }}
      onCommit={(v) => {
        const next = [...sides] as [string, string, string, string];
        next[i] = normalizeLen(v) || "0";
        commit(next);
      }}
    />
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 44px", gap: 4, alignItems: "center", justifyItems: "center" }}>
      <span />
      {cell(margin, 0, onMargin)}
      <span />
      {cell(margin, 3, onMargin)}
      <div style={{ width: "100%", border: `1px dashed ${C.borderHover}`, borderRadius: 5, padding: "6px 5px", display: "grid", gridTemplateColumns: "44px 1fr 44px", gap: 4, alignItems: "center", justifyItems: "center" }}>
        <span />
        {cell(padding, 0, onPadding)}
        <span />
        {cell(padding, 3, onPadding)}
        <span style={{ fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>padding</span>
        {cell(padding, 1, onPadding)}
        <span />
        {cell(padding, 2, onPadding)}
        <span />
      </div>
      {cell(margin, 1, onMargin)}
      <span />
      {cell(margin, 2, onMargin)}
      <span />
    </div>
  );
}
