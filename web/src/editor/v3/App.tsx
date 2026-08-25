/**
 * u-and-i editor shell — code is truth, no save format.
 *
 * The editor serves exactly one target Next.js app (uai.config.json /
 * UAI_TARGET). Opening a route or component opens its REAL source file:
 * the Outliner shows the file's JSX tree, the canvas renders the actual
 * module through the next/* shims, and every mutation is an AST edit
 * written straight into the file — undo restores exact prior bytes.
 *
 * Regions: TopBar (menus + workspace tabs) · DocumentRow · a docked body ·
 * StatusBar. The body is a `Dock` (see dock.tsx): panels — Insert, Canvas,
 * Outliner, Properties, Style, Workshop — live in a split/tab tree the user
 * rearranges by dragging tabs. Each workspace keeps its own tree, and the
 * trees ride along in the per-project session. All file mutations flow
 * through one editFile funnel — that funnel IS the undo feature.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { EditorToHarness, HarnessToEditor } from "../../shared/protocol";
import {
  C,
  DEVICES,
  MONO,
  ROLES,
  ZOOMS,
  ctlBtn,
  inputStyle,
  primaryBtn,
  sectionHeader,
  segBtn,
  trough,
  vdiv,
  type DeviceName,
} from "./chrome";
import { Field, Row, Seg, Sym } from "./controls";
import {
  Dock,
  addPanel,
  basePanel,
  closePanel,
  dockModalActive,
  isDockNode,
  leaf,
  nextInstanceId,
  panelsIn,
  split,
  type DockNode,
} from "./dock";
import { FileNodeCard, FileOutliner } from "./FileMode";
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
import { findModelNode, type FileEdit, type JsxNodeModel } from "./model";

const MIME_JSX = "application/x-uai-jsx";
const APP_PREFIX = "app:";

const WORKSPACES = [
  { label: "Layout", hint: "edit the real running app" },
  { label: "Style", hint: "edit theme tokens with a live preview" },
  { label: "Workshop", hint: "build materials for the design system" },
  { label: "Component", hint: "render one component alone with sample props" },
] as const;
type Workspace = (typeof WORKSPACES)[number]["label"];

// --------------------------------------------------------------- dock panels

/**
 * Panel titles. Instance ids ("canvas#2") share their base panel's title —
 * see `basePanel`. Only the canvas may appear more than once; the extras are
 * additional live views of the running app, each with its own path.
 */
const PANEL_TITLE: Record<string, string> = {
  insert: "Insert",
  canvas: "Canvas",
  outliner: "Outliner",
  properties: "Properties",
  style: "Style",
  workshop: "Workshop",
};

/** Material Symbols glyph per panel — the pane header is icon-only. */
const PANEL_ICON: Record<string, string> = {
  insert: "widgets",
  canvas: "desktop_windows",
  outliner: "account_tree",
  properties: "tune",
  style: "palette",
  workshop: "handyman",
};

/**
 * Layout and Component share one tree. They hold the same panels and differ
 * only in what the canvas draws — and sharing keeps the canvas leaf in the
 * same place across the switch, so the harness iframe (with its mounted
 * module and sample props) survives it, exactly as it did before docking.
 */
type LayoutGroup = "edit" | "Style" | "Workshop";
const LAYOUT_GROUPS: LayoutGroup[] = ["edit", "Style", "Workshop"];
function groupOf(ws: Workspace): LayoutGroup {
  return ws === "Style" || ws === "Workshop" ? ws : "edit";
}

/** The panel a group is built around; it can't be closed away. */
const GROUP_MAIN: Record<LayoutGroup, string> = {
  edit: "canvas",
  Style: "style",
  Workshop: "workshop",
};

/** Which panels a group offers in View ▸ Panels, in menu order. */
function groupPanels(g: LayoutGroup): string[] {
  return g === "edit" ? ["insert", "canvas", "outliner", "properties"] : [GROUP_MAIN[g], "outliner", "properties"];
}

/** The pre-dock three-column arrangement, as a starting tree. */
function defaultLayout(g: LayoutGroup): DockNode {
  const side = split("col", [leaf(["outliner"]), leaf(["properties"])], [0.44, 0.56]);
  return g === "edit"
    ? split("row", [leaf(["insert"]), leaf(["canvas"]), side], [0.15, 0.66, 0.19])
    : split("row", [leaf([GROUP_MAIN[g]]), side], [0.81, 0.19]);
}

function defaultLayouts(): Record<LayoutGroup, DockNode> {
  return { edit: defaultLayout("edit"), Style: defaultLayout("Style"), Workshop: defaultLayout("Workshop") };
}

const PRIMITIVES: { label: string; icon: string; jsx: string }[] = [
  { label: "Container", icon: "▤", jsx: '<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}></div>' },
  { label: "Heading", icon: "H", jsx: "<h2>Heading</h2>" },
  { label: "Paragraph", icon: "¶", jsx: "<p>New paragraph</p>" },
  { label: "Button", icon: "▭", jsx: '<button type="button">Button</button>' },
  { label: "Link", icon: "↗", jsx: '<a href="#">Link</a>' },
  { label: "Image", icon: "▨", jsx: '<img src="" alt="" style={{ width: "160px", height: "90px", background: "var(--muted, #ddd)" }} />' },
];

interface PropSpec {
  name: string;
  typeText: string;
  optional?: boolean;
  control: { kind: string; options?: string[] };
}

interface FileState {
  file: string;
  canvasKey: string;
  model: JsxNodeModel[];
  renderable: boolean;
  specs: PropSpec[];
  values: Record<string, unknown>;
}

interface ShellInfo {
  viewFile: string | null;
  viewTag: string | null;
  contentNote: string | null;
}

type HistoryEntry = {
  file: string;
  before: string;
  after: string;
  focusBefore: string | null;
  focusAfter: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

/** Which canvas is on screen: one component we render ourselves, or the
 * target's own running app mirrored through the live proxy. Not free state —
 * it follows the workspace (Component renders alone; everything else is the
 * live app), so an editor reload can never strand the user off the live
 * view. */
type CanvasMode = "component" | "live";

/** Frame heights for the live canvas (the component canvas scrolls its own
 * stage, so it only ever needed widths). These are VIEWPORTS, not screens:
 * Desktop is a 1440x900 display minus ~110px of tab strip, address bar and
 * taskbar — what the page actually gets. */
const DEVICE_HEIGHT: Record<DeviceName, number> = { Desktop: 790, Tablet: 1112, Phone: 844 };

/** The one text slot an element can be edited in place through, or null when
 * its content is richer than a single JSXText child. */
function inlineTextSlot(node: JsxNodeModel | null): number | null {
  if (!node || node.textChildren.length !== 1 || node.children.length > 0) return null;
  return node.textChildren[0].slot;
}

function parentIndexOf(node: JsxNodeModel): number {
  const m = node.parentId?.match(/::(\d+)$/);
  return m ? Number(m[1]) : node.index;
}

// ---------------------------------------------------------------------------
// Persistent preferences (localStorage — editor state, never source truth)
// ---------------------------------------------------------------------------

interface Prefs {
  appZoom: number;
  rulersOn: boolean;
  rulerUnit: "px" | "rem";
  /** Restore the last open file (per target) on launch. */
  reopenLast: boolean;
}
const DEFAULT_PREFS: Prefs = { appZoom: 1, rulersOn: true, rulerUnit: "px", reopenLast: true };

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem("uai:prefs") ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface ProjectSession {
  openFile?: string;
  device?: DeviceName;
  zoom?: number;
  workspace?: Workspace;
  livePath?: string;
  /** Dock tree per layout group. Anything malformed falls back to the default. */
  layouts?: Partial<Record<LayoutGroup, DockNode>>;
  /** Path per extra live canvas pane, keyed by panel instance id. */
  extraLivePaths?: Record<string, string>;
}

/** Merge persisted trees over the defaults, dropping any that don't parse. */
function layoutsFromSession(saved: ProjectSession["layouts"]): Record<LayoutGroup, DockNode> {
  const out = defaultLayouts();
  for (const g of LAYOUT_GROUPS) {
    const t = saved?.[g];
    // A tree that lost its group's main panel would strand the user with no
    // canvas and no way back except Reset layout — take the default.
    if (isDockNode(t) && panelsIn(t).includes(GROUP_MAIN[g])) out[g] = t;
  }
  return out;
}
function loadProjectSession(root: string): ProjectSession {
  try {
    return JSON.parse(localStorage.getItem(`uai:proj:${root}`) ?? "{}") as ProjectSession;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const harnessReady = useRef(false);

  const [targetLabel, setTargetLabel] = useState<string>("…");
  const [routeTree, setRouteTree] = useState<RouteNode | null>(null);
  const [routeSel, setRouteSel] = useState<RouteNode | null>(null);
  const [routeShell, setRouteShell] = useState<ShellInfo | null>(null);
  const [components, setComponents] = useState<{
    files: string[];
    meta: Record<string, { serverOnly: boolean; exportName?: string }>;
  } | null>(null);

  const [fileState, setFileState] = useState<FileState | null>(null);
  const fileStateRef = useRef(fileState);
  fileStateRef.current = fileState;
  const [fileFocusId, setFileFocusId] = useState<string | null>(null);
  const fileFocusRef = useRef(fileFocusId);
  fileFocusRef.current = fileFocusId;
  const [fileCollapsed, setFileCollapsed] = useState<Set<string>>(new Set());
  const [touchedFiles, setTouchedFiles] = useState<Set<string>>(new Set());
  const editFileRef = useRef<(edit: FileEdit, expectTag: string) => void | Promise<void>>(() => {});
  const openFileRef = useRef<(file: string) => Promise<void>>(async () => {});

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [workspace, setWorkspace] = useState<Workspace>("Layout");
  const [outlinerMode, setOutlinerMode] = useState<"File" | "Routes">("Routes");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [reopenLast, setReopenLast] = useState(() => loadPrefs().reopenLast);
  const [rulersOn, setRulersOn] = useState(() => loadPrefs().rulersOn);
  const [device, setDevice] = useState<DeviceName>("Desktop");
  const [zoom, setZoom] = useState<number>(DEVICES.Desktop.zoom);
  const [targetRoot, setTargetRoot] = useState<string | null>(null);
  const [themeDark, setThemeDark] = useState(false);
  const [role, setRole] = useState("Traveler");
  const [search, setSearch] = useState("");
  const [interact, setInteract] = useState(false);
  const interactRef = useRef(interact);
  interactRef.current = interact;
  // Live canvas: the target's own running dev server, mirrored by
  // server/live-proxy.ts. `livePath` is the route the primary canvas shows;
  // where the app actually ended up (it redirects, e.g. /account → /signin)
  // is per-frame, so each LiveCanvas tracks its own.
  const [live, setLive] = useState<{ origin: string; upstream: string } | null>(null);
  const canvasMode: CanvasMode = workspace === "Component" ? "component" : "live";
  const canvasModeRef = useRef(canvasMode);
  canvasModeRef.current = canvasMode;
  const [livePath, setLivePath] = useState("/");
  // Every mounted live frame, primary and extras alike: commands the probe
  // understands (set-interact) go to all of them.
  const liveFrames = useRef(new Set<HTMLIFrameElement>());
  const registerLiveFrame = useCallback((el: HTMLIFrameElement | null, on: boolean) => {
    if (!el) return;
    if (on) liveFrames.current.add(el);
    else liveFrames.current.delete(el);
  }, []);
  const postLive = useCallback((msg: unknown) => {
    for (const f of liveFrames.current) f.contentWindow?.postMessage(msg, "*");
  }, []);
  const [extraLivePaths, setExtraLivePaths] = useState<Record<string, string>>({});
  const setExtraLivePath = useCallback((id: string, p: string) => {
    setExtraLivePaths((m) => ({ ...m, [id]: p }));
  }, []);

  // Docking: one tree per layout group, rearranged by dragging tabs.
  const [layouts, setLayouts] = useState<Record<LayoutGroup, DockNode>>(defaultLayouts);
  const group = groupOf(workspace);
  const layout = layouts[group];
  const setLayout = useCallback(
    (next: DockNode) => setLayouts((all) => ({ ...all, [group]: next })),
    [group],
  );
  const [styleEdits, setStyleEdits] = useState(0);
  const [wsMat, setWsMat] = useState<WorkshopState>(WS_INITIAL);
  const [appZoom, setAppZoom] = useState(() => loadPrefs().appZoom);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const handleChordRef = useRef<(c: { key: string; mod: boolean; shift: boolean; alt: boolean }) => boolean>(() => false);
  const hRuler = useRef<HTMLCanvasElement>(null);
  const vRuler = useRef<HTMLCanvasElement>(null);
  const stageXY = useRef({ x: 0, y: 0 });
  const drawRulersRef = useRef<() => void>(() => {});
  const [rulerUnit, setRulerUnit] = useState<"px" | "rem">(() => loadPrefs().rulerUnit);

  const send = useCallback((msg: EditorToHarness) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const styleTokens = useStyleTokens(send, () => {
    setStyleEdits((e) => e + 1);
    setSavedAt(new Date().toLocaleTimeString());
  });

  // ------------------------------------------------------------------ boot

  useEffect(() => {
    void api<{ project: { label: string; root: string }; live: { origin: string; upstream: string } | null }>("/api/project")
      .then((d) => {
        setTargetLabel(d.project.label);
        setTargetRoot(d.project.root);
        setLive(d.live);
        // Restore this project's last session.
        const session = loadProjectSession(d.project.root);
        if (session.device && session.device in DEVICES) setDevice(session.device);
        if (session.zoom && ZOOMS.includes(session.zoom)) setZoom(session.zoom);
        if (session.workspace && WORKSPACES.some((w) => w.label === session.workspace)) {
          setWorkspace(session.workspace);
        }
        if (session.livePath?.startsWith("/")) setLivePath(session.livePath);
        setLayouts(layoutsFromSession(session.layouts));
        if (session.extraLivePaths) setExtraLivePaths(session.extraLivePaths);
        if (loadPrefs().reopenLast && session.openFile) {
          void openFileRef.current(session.openFile).catch(() => {});
        }
      })
      .catch(() => setTargetLabel("no target app"));
    void api<{ tree: RouteNode }>("/api/routes").then((r) => setRouteTree(r.tree)).catch(() => {});
    void api<{ files: string[]; meta: Record<string, { serverOnly: boolean; exportName?: string }> }>(
      "/api/components",
    ).then(setComponents).catch(() => {});
  }, []);

  // Persist global prefs + the per-project session as they change.
  useEffect(() => {
    try {
      const prefs: Prefs = { appZoom, rulersOn, rulerUnit, reopenLast };
      localStorage.setItem("uai:prefs", JSON.stringify(prefs));
    } catch {
      /* storage unavailable — prefs just don't persist */
    }
  }, [appZoom, rulersOn, rulerUnit, reopenLast]);

  useEffect(() => {
    if (!targetRoot) return;
    try {
      // Keep the last-known open file even while nothing is open (e.g. the
      // brief window during boot restore) — closing isn't a concept here.
      const existing = loadProjectSession(targetRoot);
      const session: ProjectSession = {
        openFile: fileState?.file ?? existing.openFile,
        device,
        zoom,
        workspace,
        livePath,
        layouts,
        extraLivePaths,
      };
      localStorage.setItem(`uai:proj:${targetRoot}`, JSON.stringify(session));
    } catch {
      /* ditto */
    }
  }, [targetRoot, fileState?.file, device, zoom, workspace, livePath, layouts, extraLivePaths]);

  // Shell analysis for the selected route.
  useEffect(() => {
    setRouteShell(null);
    const page = routeSel?.files.page;
    if (!page) return;
    void api<ShellInfo>(`/api/page-shell?file=${encodeURIComponent(page)}`)
      .then(setRouteShell)
      .catch(() => {});
  }, [routeSel]);

  // ------------------------------------------------------------------ file mode (code is truth)

  const openFile = useCallback(async (file: string) => {
    setRouteSel(null);
    setFileFocusId(null);
    setFileCollapsed(new Set());
    setOutlinerMode("File");
    const d = await api<{ model: JsxNodeModel[]; props: PropSpec[]; renderable: boolean }>(
      `/api/component?file=${encodeURIComponent(file)}`,
    );
    let values: Record<string, unknown> = {};
    try {
      const saved = localStorage.getItem(`uai:samples:app:${file}`);
      if (saved) values = JSON.parse(saved) as Record<string, unknown>;
    } catch {
      /* corrupt entry — fall through to defaults */
    }
    if (Object.keys(values).length === 0) {
      for (const s of d.props) {
        if (s.optional) continue;
        if (s.control.kind === "string") values[s.name] = s.name;
        else if (s.control.kind === "number") values[s.name] = 0;
        else if (s.control.kind === "boolean") values[s.name] = false;
        else if (s.control.kind === "select") values[s.name] = s.control.options?.[0];
      }
    }
    const canvasKey = APP_PREFIX + file;
    setFileState({ file, canvasKey, model: d.model, renderable: d.renderable, specs: d.props, values });
    if (d.renderable) send({ type: "render", file: canvasKey, props: values });
  }, [send]);
  openFileRef.current = openFile;

  const setSampleProp = useCallback((name: string, value: unknown) => {
    setFileState((s) => {
      if (!s) return s;
      const values = { ...s.values };
      if (value === undefined || value === "") delete values[name];
      else values[name] = value;
      try {
        localStorage.setItem(`uai:samples:app:${s.file}`, JSON.stringify(values));
      } catch {
        /* storage full — samples are disposable */
      }
      if (s.renderable) send({ type: "render", file: s.canvasKey, props: values });
      return { ...s, values };
    });
  }, [send]);

  /** THE file-edit funnel: one path for every AST mutation. Writes the real
   * file, replaces the (ephemeral-id) model, re-anchors selection, records
   * undo, and tracks touched files. */
  const editFile = useCallback(
    async (edit: FileEdit, expectTag: string) => {
      const fs = fileStateRef.current;
      if (!fs) return;
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: fs.file, edit, expectTag }),
      });
      const body = (await res.json()) as {
        model?: JsxNodeModel[];
        focusId?: string | null;
        before?: string;
        after?: string;
        error?: string;
      };
      if (res.status === 409) {
        const d = await api<{ model: JsxNodeModel[] }>(
          `/api/component?file=${encodeURIComponent(fs.file)}`,
        );
        setFileState((s) => (s ? { ...s, model: d.model } : s));
        setFileFocusId(null);
        return;
      }
      if (!res.ok || !body.model) {
        console.warn(`edit rejected: ${body.error}`);
        setSavedAt(`✗ ${String(body.error).slice(0, 60)}`);
        return;
      }
      const focusBefore = fileFocusRef.current;
      setFileState((s) => (s ? { ...s, model: body.model! } : s));
      setFileFocusId(body.focusId ?? null);
      setHistory((h) => [
        ...h.slice(-59),
        {
          file: fs.file,
          before: body.before!,
          after: body.after!,
          focusBefore,
          focusAfter: body.focusId ?? null,
        },
      ]);
      setFuture([]);
      setTouchedFiles((t) => new Set(t).add(fs.file));
      setSavedAt(new Date().toLocaleTimeString());
      if (body.focusId) send({ type: "select", id: body.focusId });
    },
    [send],
  );
  editFileRef.current = editFile;

  /** Insert a JSX snippet into the open file: inside the focused container,
   * after the focused leaf, or appended to the root element. */
  const insertIntoFile = useCallback(
    (jsx: string, imports?: { source: string; named?: string[]; default?: string }[]) => {
      const fs = fileStateRef.current;
      if (!fs || !fs.model.length) return;
      const focus = findModelNode(fs.model, fileFocusRef.current);
      let parentIndex: number;
      let childPos: number;
      if (focus && /^[a-z]/.test(focus.tag) && !focus.selfClosing) {
        parentIndex = focus.index;
        childPos = 9999; // server clamps to children.length
      } else if (focus && focus.can.structural && focus.parentId) {
        parentIndex = parentIndexOf(focus);
        childPos = focus.slot + 2;
      } else {
        parentIndex = fs.model[0].index;
        childPos = 9999;
      }
      const expectTag = findModelNode(fs.model, `${fs.canvasKey}::${parentIndex}`)?.tag ?? "";
      void editFileRef.current({ op: "insert-element", parentIndex, childPos, jsx, imports }, expectTag);
    },
    [],
  );

  /** Elements whose entire content is a single text child can be edited in
   * place on the canvas — anything richer (siblings, expressions, nested
   * elements) keeps to the Properties card, where slots are explicit. */
  const beginTextEdit = useCallback(
    (id?: string | null) => {
      // In-place editing lives in the component canvas; in live mode that
      // iframe is hidden, so F2 would open an invisible caret. The
      // Properties Content field is the live-mode path for text.
      if (canvasModeRef.current === "live") return;
      const fs = fileStateRef.current;
      const target = id ?? fileFocusRef.current;
      if (!fs || !target || !target.startsWith(`${fs.canvasKey}::`)) return;
      if (inlineTextSlot(findModelNode(fs.model, target)) == null) return;
      setFileFocusId(target);
      send({ type: "select", id: target });
      send({ type: "edit-text", id: target });
    },
    [send],
  );

  /** Undo a file edit: write the exact prior bytes back, then re-sync. */
  const restoreFile = useCallback(
    async (entry: HistoryEntry, direction: "undo" | "redo") => {
      const text = direction === "undo" ? entry.before : entry.after;
      await api("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: entry.file, text }),
      });
      setSavedAt(new Date().toLocaleTimeString());
      const fsNow = fileStateRef.current;
      if (fsNow && fsNow.file === entry.file) {
        const d = await api<{ model: JsxNodeModel[] }>(
          `/api/component?file=${encodeURIComponent(entry.file)}`,
        );
        setFileState((s) => (s ? { ...s, model: d.model } : s));
        setFileFocusId(direction === "undo" ? entry.focusBefore : entry.focusAfter);
      }
    },
    [],
  );

  const undoAction = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [...f, prev]);
      void restoreFile(prev, "undo");
      return h.slice(0, -1);
    });
  }, [restoreFile]);

  const redoAction = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[f.length - 1];
      setHistory((h) => [...h.slice(-59), next]);
      void restoreFile(next, "redo");
      return f.slice(0, -1);
    });
  }, [restoreFile]);

  // ------------------------------------------------------------------ canvas sync

  useEffect(() => send({ type: "set-device", width: DEVICES[device].width }), [device, send]);
  useEffect(() => send({ type: "set-zoom", zoom }), [zoom, send]);
  useEffect(() => send({ type: "set-theme", dark: themeDark }), [themeDark, send]);
  useEffect(() => send({ type: "set-interact", on: interact }), [interact, send]);
  // The live probe honours the same toggle (select is its default).
  useEffect(() => {
    postLive({ uaiCmd: "set-interact", on: interact });
  }, [interact, postLive]);
  useEffect(() => {
    send({
      type: "set-session",
      session: {
        user: { name: `Canvas ${role}`, email: `${role.toLowerCase()}@example.com`, image: null, role: role.toLowerCase() },
        expires: "2099-01-01T00:00:00.000Z",
      },
    });
  }, [role, send]);

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

  // ------------------------------------------------------------------ harness messages

  // A live-canvas click: the probe sends a compiled stack-frame position,
  // the daemon runs it back through source maps to a file + node id. The
  // canvas stays live; the outliner and Properties card carry the selection.
  const resolveLiveClick = useCallback(async (msg: { url: string; line: number; column: number }) => {
    try {
      const r = await api<{ ok: boolean; file?: string; id?: string | null }>("/api/live-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: msg.url, line: msg.line, column: msg.column }),
      });
      if (!r.ok || !r.file) return;
      if (fileStateRef.current?.file !== r.file) await openFileRef.current(r.file);
      if (r.id) setFileFocusId(r.id);
    } catch {
      /* unresolvable click — leave the selection as-is */
    }
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent<HarnessToEditor>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      // The live probe speaks its own dialect from a different origin.
      if ((msg as { uai?: boolean }).uai) {
        const live = msg as unknown as { type: string; url?: string | null; line?: number; column?: number };
        if (live.type === "live-ready" && live.url) {
          // A fresh page load resets that frame's probe; re-send the toggle
          // state. Which frame it was is LiveCanvas's business (it matches on
          // event.source) — cheap enough to tell them all.
          postLive({ uaiCmd: "set-interact", on: interactRef.current });
        } else if (live.type === "live-click" && live.url) {
          void resolveLiveClick(live as { url: string; line: number; column: number });
        } else if (live.type === "toggle-interact") {
          // Tab pressed while the live frame holds focus.
          setInteract((v) => !v);
        } else if (live.type === "escape") {
          setCtxMenu(null);
          setPrefsOpen(false);
        }
        // live-zoom is LiveCanvas's own affair — it needs the cursor anchor.
        return;
      }
      if (msg.type === "ready") {
        harnessReady.current = true;
        const fsNow = fileStateRef.current;
        if (fsNow?.renderable) send({ type: "render", file: fsNow.canvasKey, props: fsNow.values });
        send({ type: "set-device", width: DEVICES[device].width });
        send({ type: "set-zoom", zoom });
      } else if (msg.type === "selected") {
        // Canvas click → resolve via the ancestor chain to the nearest
        // element belonging to the open file.
        const fsNow = fileStateRef.current;
        if (fsNow) {
          const prefix = `${fsNow.canvasKey}::`;
          const own = msg.id?.startsWith(prefix)
            ? msg.id
            : (msg.chain ?? []).find((c) => c.startsWith(prefix));
          if (own) {
            setFileFocusId(own);
            send({ type: "select", id: own });
          }
        }
      } else if (msg.type === "open-component") {
        // Double-click descend: into the clicked element's own source file,
        // or the focused tag's import within this file.
        const m = msg.id.match(/^app:(.+?)::\d+$/);
        if (m) {
          const file = m[1];
          const fsNow = fileStateRef.current;
          if (fsNow && fsNow.file === file) {
            const node = findModelNode(fsNow.model, msg.id);
            if (node?.componentSource) void openFileRef.current(node.componentSource);
          } else {
            void openFileRef.current(file);
          }
        }
      } else if (msg.type === "context-menu") {
        const fsNow = fileStateRef.current;
        if (fsNow && msg.id) {
          const prefix = `${fsNow.canvasKey}::`;
          if (msg.id.startsWith(prefix)) setFileFocusId(msg.id);
        }
        const r = iframeRef.current?.getBoundingClientRect();
        if (r) setCtxMenu({ x: r.left / appZoom + msg.x, y: r.top / appZoom + msg.y });
      } else if (msg.type === "file-drop") {
        const fsNow = fileStateRef.current;
        if (!fsNow) return;
        const target = findModelNode(fsNow.model, msg.targetId);
        if (!target || !target.can.structural) return;
        const parentIndex = parentIndexOf(target);
        const childPos = msg.position === "before" ? target.slot : target.slot + 2;
        const parentTag = findModelNode(fsNow.model, target.parentId)?.tag ?? "";
        if (msg.moveId) {
          const moved = findModelNode(fsNow.model, msg.moveId);
          if (moved) {
            void editFileRef.current(
              { op: "move-element", index: moved.index, newParentIndex: parentIndex, childPos },
              moved.tag,
            );
          }
        } else if (msg.insert) {
          void editFileRef.current(
            { op: "insert-element", parentIndex, childPos, jsx: msg.insert.jsx, imports: msg.insert.imports },
            parentTag,
          );
        }
      } else if (msg.type === "request-text-edit") {
        beginTextEdit(msg.id);
      } else if (msg.type === "set-text") {
        const fsNow = fileStateRef.current;
        const node = fsNow ? findModelNode(fsNow.model, msg.id) : null;
        const slot = inlineTextSlot(node);
        if (node && slot != null) {
          void editFileRef.current(
            { op: "set-text", index: node.index, slot, value: msg.value },
            node.tag,
          );
        }
      } else if (msg.type === "zoom-wheel") {
        zoomBy(msg.dir);
      } else if (msg.type === "toggle-interact") {
        setInteract((v) => !v);
      } else if (msg.type === "escape") {
        setCtxMenu(null);
      } else if (msg.type === "key") {
        handleChordRef.current({ key: msg.key, mod: msg.ctrl, shift: msg.shift, alt: msg.alt });
      } else if (msg.type === "stage-metrics") {
        stageXY.current = { x: msg.x, y: msg.y };
        drawRulersRef.current();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send, device, zoom, appZoom, zoomBy, beginTextEdit, resolveLiveClick]);

  // ------------------------------------------------------------------ keyboard

  const handleChord = useCallback(
    (c: { key: string; mod: boolean; shift: boolean; alt: boolean }): boolean => {
      const k = c.key.toLowerCase();
      const fsNow = fileStateRef.current;
      const fileNode =
        fsNow && fileFocusRef.current ? findModelNode(fsNow.model, fileFocusRef.current) : null;
      if (fileNode) {
        const parentIdx = parentIndexOf(fileNode);
        if (c.key === "F2" && inlineTextSlot(fileNode) != null) {
          beginTextEdit(fileNode.id);
          return true;
        }
        if (c.key === "Delete" && fileNode.can.structural) {
          void editFile({ op: "delete-element", index: fileNode.index }, fileNode.tag);
          return true;
        }
        if (c.mod && k === "d" && fileNode.can.structural) {
          void editFile({ op: "duplicate-element", index: fileNode.index }, fileNode.tag);
          return true;
        }
        if (c.alt && c.key === "ArrowUp" && fileNode.can.structural) {
          void editFile(
            { op: "move-element", index: fileNode.index, newParentIndex: parentIdx, childPos: Math.max(0, fileNode.slot - 2) },
            fileNode.tag,
          );
          return true;
        }
        if (c.alt && c.key === "ArrowDown" && fileNode.can.structural) {
          void editFile(
            { op: "move-element", index: fileNode.index, newParentIndex: parentIdx, childPos: fileNode.slot + 2 },
            fileNode.tag,
          );
          return true;
        }
      }
      // A running dock modal (the split phantom) owns the keyboard, the way a
      // modal operator does in Blender — otherwise Tab below would eat the
      // axis flip before the modal's own listener ran.
      if (dockModalActive()) return false;
      if (c.mod && !c.shift && k === "z") undoAction();
      else if (c.mod && c.shift && k === "z") redoAction();
      else if (c.key === "Tab" && (workspace === "Layout" || workspace === "Component")) {
        setInteract((v) => !v);
      }
      else if (c.key === "Escape") { setCtxMenu(null); setPrefsOpen(false); }
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
      else return false;
      return true;
    },
    [undoAction, redoAction, zoomBy, device, workspace, editFile, beginTextEdit],
  );
  handleChordRef.current = handleChord;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (handleChord({ key: e.key, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey })) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture phase: chords like Tab must be ours before any focused
    // control gets a chance to treat them as focus navigation.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handleChord]);

  // Ctrl+scroll over the chrome's canvas region zooms the page.
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

  const drawRulers = useCallback(() => {
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

  // ------------------------------------------------------------------ derived

  const fileNode = fileState ? findModelNode(fileState.model, fileFocusId) : null;
  const crumb = (() => {
    if (!fileState) return targetLabel;
    const base = fileState.file;
    return fileNode ? `${base} › ${fileNode.tag}` : base;
  })();
  const selTitle = routeSel
    ? routeSel.urlPath
    : fileNode
      ? `<${fileNode.tag}>`
      : fileState
        ? fileState.file.split("/").pop()!
        : "Nothing open";

  // ------------------------------------------------------------------ menus

  type MenuItem =
    | { sep: true }
    | { sep?: false; label: string; accel?: string; check?: string; icon?: string; disabled?: boolean; action?: () => void };
  const dot = (on: boolean) => (on ? "•" : "");
  const tick = (on: boolean) => (on ? "✓" : "");
  const menus: { label: string; width: number; items: MenuItem[] }[] = [
    {
      label: "File",
      width: 244,
      items: [
        { label: `Target: ${targetLabel}`, disabled: true },
        { label: "Change target (uai.config.json)", disabled: true },
        { sep: true },
        { label: "Exit", accel: "Alt+F4", action: () => window.close() },
      ],
    },
    {
      label: "Edit",
      width: 216,
      items: [
        { label: "Preferences…", icon: "settings", action: () => setPrefsOpen(true) },
        { sep: true },
        { label: "Undo", accel: "Ctrl+Z", disabled: !history.length, action: undoAction },
        { label: "Redo", accel: "Ctrl+Shift+Z", disabled: !future.length, action: redoAction },
        { sep: true },
        { label: "Edit text", accel: "F2", disabled: inlineTextSlot(fileNode) == null, action: () => beginTextEdit(fileNode?.id) },
        { sep: true },
        { label: "Duplicate", accel: "Ctrl+D", disabled: !fileNode?.can.structural, action: () => fileNode && void editFile({ op: "duplicate-element", index: fileNode.index }, fileNode.tag) },
        { label: "Delete", accel: "Del", disabled: !fileNode?.can.structural, action: () => fileNode && void editFile({ op: "delete-element", index: fileNode.index }, fileNode.tag) },
        { sep: true },
        { label: "Move up", accel: "Alt+Up", disabled: !fileNode?.can.structural, action: () => fileNode && void editFile({ op: "move-element", index: fileNode.index, newParentIndex: parentIndexOf(fileNode), childPos: Math.max(0, fileNode.slot - 2) }, fileNode.tag) },
        { label: "Move down", accel: "Alt+Down", disabled: !fileNode?.can.structural, action: () => fileNode && void editFile({ op: "move-element", index: fileNode.index, newParentIndex: parentIndexOf(fileNode), childPos: fileNode.slot + 2 }, fileNode.tag) },
      ],
    },
    {
      label: "Insert",
      width: 200,
      items: PRIMITIVES.map((p) => ({
        label: p.label,
        disabled: !fileState,
        action: () => insertIntoFile(p.jsx),
      })),
    },
    {
      label: "View",
      width: 244,
      items: [
        ...WORKSPACES.map((w) => ({
          label: `${w.label} workspace`,
          check: dot(workspace === w.label),
          action: () => setWorkspace(w.label),
        })),
        { sep: true },
        ...groupPanels(group).map((id) => {
          const open = panelsIn(layout).includes(id);
          return {
            label: `Panel: ${PANEL_TITLE[id]}`,
            check: tick(open),
            disabled: id === GROUP_MAIN[group],
            action: () => setLayout(open ? closePanel(layout, id) : addPanel(layout, id, GROUP_MAIN[group])),
          };
        }),
        ...(group === "edit"
          ? [{ label: "New canvas pane", action: () => setLayout(addPanel(layout, nextInstanceId(layout, "canvas"), "canvas")) }]
          : []),
        { label: "Reset layout", action: () => setLayout(defaultLayout(group)) },
        { sep: true },
        { label: "Outliner: file", check: dot(outlinerMode === "File"), action: () => setOutlinerMode("File") },
        { label: "Outliner: routes", check: dot(outlinerMode === "Routes"), action: () => setOutlinerMode("Routes") },
        { sep: true },
        { label: "Rulers", check: tick(rulersOn), action: () => setRulersOn((v) => !v) },
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
        { label: "Context…", accel: "P", action: () => setPreviewOpen(true) },
        { sep: true },
        { label: "Reload canvas", action: () => iframeRef.current?.contentWindow?.location.reload() },
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

  // ------------------------------------------------------------ dock panels

  /**
   * A panel's own controls, laid inline in the pane header next to its type
   * icon. Keeping them here rather than in a title bar of their own is what
   * buys back the vertical room the old three-column headers ate.
   */
  const renderPanelHeader = (id: string) => {
    switch (basePanel(id)) {
      case "insert":
        return (
          <input
            className="fc"
            type="text"
            aria-label="Search components"
            placeholder={fileState ? "Search components" : "open a file first"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 90px", minWidth: 70, height: 20, fontSize: 11 }}
          />
        );

      case "outliner":
        return <Seg items={(["File", "Routes"] as const).map((m) => ({ label: m, active: outlinerMode === m, onClick: () => setOutlinerMode(m) }))} />;

      case "properties":
        return (
          <>
            <span style={{ flex: "0 0 auto", width: 7, height: 7, background: fileNode ? C.orange : routeSel ? C.blueLight : C.muted, borderRadius: 2 }} />
            <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, color: "#fff", fontWeight: 600 }} title={selTitle}>
              {selTitle}
            </span>
          </>
        );

      case "canvas":
        // Secondary panes are plain live views; their path bar is their header.
        if (id !== "canvas") return null;
        return (
          <>
            <Seg items={(Object.keys(DEVICES) as DeviceName[]).map((d) => ({ label: d, active: device === d, onClick: () => setDeviceAnd(d) }))} />
            <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 10.5, color: C.faint }}>{DEVICES[device].width}px</span>
            <div style={{ flex: "0 0 auto", position: "relative", whiteSpace: "nowrap" }}>
              <button
                className="hv-ctl-border"
                style={{ display: "flex", alignItems: "center", gap: 6, height: 20, padding: "0 7px", background: previewOpen ? C.ctl : "transparent", border: `1px solid ${previewOpen ? C.borderHover : C.border}`, borderRadius: 5, color: C.body, cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setPreviewOpen((v) => !v); }}
                title="Canvas context (P)"
              >
                <span style={{ fontFamily: MONO, fontSize: 10.5 }}>{role} · {themeDark ? "Abyss" : "Parchment"}</span>
                <span style={{ fontSize: 7, color: C.faint }}>▼</span>
              </button>
              {previewOpen && (
                <div style={{ position: "absolute", top: 24, left: 0, minWidth: 230, background: C.menu, border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: "0 14px 30px rgba(0,0,0,0.55)", padding: "4px 0", zIndex: 30 }} onClick={(e) => e.stopPropagation()}>
                  {[
                    { title: "Session role", items: ROLES.map((r) => ({ label: r, on: role === r, act: () => setRole(r) })) },
                    { title: "Theme", items: [
                      { label: "Parchment", on: !themeDark, act: () => setThemeDark(false) },
                      { label: "Abyss", on: themeDark, act: () => setThemeDark(true) },
                    ]},
                  ].map((g, gi) => (
                    <div key={g.title}>
                      {gi > 0 && <div style={{ height: 1, background: C.border, margin: "4px 0" }} />}
                      <div style={{ padding: "3px 10px 2px", fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.09em" }}>{g.title}</div>
                      {g.items.map((it) => (
                        <button key={it.label} className="hv-menu" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 24, padding: "0 10px", background: "none", border: "none", color: C.body, cursor: "pointer", textAlign: "left" }} onClick={it.act}>
                          <span style={{ flex: "0 0 12px", color: C.blueLight, fontSize: 11 }}>{it.on ? "•" : ""}</span>
                          <span style={{ flex: 1 }}>{it.label}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: "1 1 0", minWidth: 4 }} />
            <div title="Tab toggles between editing and using the app">
              <Seg items={[
                { label: "Edit", active: !interact, onClick: () => setInteract(false) },
                { label: "View", active: interact, onClick: () => setInteract(true) },
              ]} />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  /**
   * One panel's body. Sizing, the header row and the borders belong to the
   * dock; a panel just fills the column it is handed.
   */
  const renderPanel = (id: string) => {
    switch (basePanel(id)) {
      // ------------------------------------------------------------ Insert
      case "insert":
        return (
          <>
            {/* No title row and no search row: both live in the pane header. */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 10 }}>
              <div style={{ borderTop: `1px solid ${C.softDiv}` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "8px 10px 5px", whiteSpace: "nowrap" }}>
                  <span style={{ flex: "0 0 auto", fontSize: 11, color: C.body, fontWeight: 600 }}>Primitives</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10, color: C.faint }}>plain html</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 10px" }}>
                  {PRIMITIVES.map((p) => (
                    <button
                      key={p.label}
                      className="hv-ctl-border"
                      draggable={!!fileState}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setData(MIME_JSX, JSON.stringify({ jsx: p.jsx }));
                      }}
                      onClick={() => insertIntoFile(p.jsx)}
                      disabled={!fileState}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 7px", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 5, color: fileState ? C.body : C.faint, cursor: fileState ? "grab" : "default", textAlign: "left", overflow: "hidden", whiteSpace: "nowrap" }}
                    >
                      <span style={{ flex: "0 0 auto", color: C.blueLight, width: 13, textAlign: "center" }}>{p.icon}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                if (!components) {
                  return <div style={{ margin: 10, fontSize: 11, color: C.faint }}>Loading component list…</div>;
                }
                const q = search.trim().toLowerCase();
                const groups = new Map<string, string[]>();
                for (const f of components.files) {
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
                        const meta = components.meta[f];
                        const serverOnly = meta?.serverOnly;
                        const name = f.split("/").pop()!.replace(/\.tsx$/, "");
                        const active = fileState?.file === f;
                        const insertable = !!fileState && !serverOnly && !!meta?.exportName;
                        const importSpec = meta?.exportName
                          ? [{ source: `@/${f.replace(/^src\//, "").replace(/\.tsx$/, "")}`, named: [meta.exportName] }]
                          : undefined;
                        return (
                          <div key={f} style={{ display: "flex", gap: 3 }}>
                            <button
                              className={serverOnly ? undefined : "hv-ctl-border"}
                              disabled={serverOnly}
                              draggable={insertable}
                              onDragStart={(e) => {
                                if (!insertable) return;
                                e.dataTransfer.effectAllowed = "copy";
                                e.dataTransfer.setData(MIME_JSX, JSON.stringify({ jsx: `<${meta!.exportName} />`, imports: importSpec }));
                              }}
                              title={serverOnly ? "Server component — can't render in the canvas" : `Open ${f}`}
                              onClick={() => void openFile(f)}
                              style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, padding: "4px 7px", background: active ? C.ctlHover : C.ctl, border: `1px solid ${active ? C.blue : C.border}`, borderRadius: 5, color: serverOnly ? C.faint : C.body, cursor: serverOnly ? "default" : "pointer", textAlign: "left", overflow: "hidden", whiteSpace: "nowrap", opacity: serverOnly ? 0.6 : 1 }}
                            >
                              <span style={{ flex: "0 0 auto", color: serverOnly ? C.faint : C.blueLight, width: 13, textAlign: "center" }}>⧉</span>
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                              {serverOnly && <span style={{ flex: "0 0 auto", fontSize: 9, color: C.faint, textTransform: "uppercase", letterSpacing: "0.05em" }}>server</span>}
                            </button>
                            {insertable && (
                              <button
                                className="hv-ctl-border"
                                title={`Insert <${meta!.exportName} /> into ${fileState!.file.split("/").pop()}`}
                                onClick={() => insertIntoFile(`<${meta!.exportName} />`, importSpec)}
                                style={{ flex: "0 0 22px", display: "flex", alignItems: "center", justifyContent: "center", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 5, color: C.blueLight, cursor: "pointer" }}
                              >
                                +
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </>
        );

      // ------------------------------------------------------------ Canvas
      case "canvas":
        // Extra canvas panes are extra views of the live app: the component
        // harness is a single iframe (one mounted module, one set of sample
        // props), so it stays with the primary pane.
        if (id !== "canvas") {
          return (
            <LiveCanvas
              live={live}
              registerFrame={registerLiveFrame}
              path={extraLivePaths[id] ?? livePath}
              setPath={(p) => setExtraLivePath(id, p)}
              width={DEVICES[device].width}
              height={DEVICE_HEIGHT[device]}
              zoom={zoom}
              onZoom={zoomBy}
            />
          );
        }
        return (
          <div ref={canvasRegionRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: C.void }}>
            {/* Toolbar moved into the pane header (see renderPanelHeader). */}

            {/* Rulers measure the component stage; the live app frames itself. */}
            {rulersOn && canvasMode === "component" && (
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
              {rulersOn && canvasMode === "component" && (
                <canvas ref={vRuler} style={{ flex: "0 0 16px", width: 16, background: C.canvasBar, borderRight: `1px solid ${C.canvasEdge}` }} />
              )}
              {/* The component canvas stays mounted across a mode switch —
                  reloading the harness would drop the rendered component
                  and the sample props with it. */}
              <iframe
                ref={iframeRef}
                src="/harness.html"
                title="canvas"
                style={{ flex: 1, border: "none", background: C.void, display: canvasMode === "live" ? "none" : "block" }}
              />
              {canvasMode === "live" && (
                <LiveCanvas
                  live={live}
                  registerFrame={registerLiveFrame}
                  path={livePath}
                  setPath={setLivePath}
                  width={DEVICES[device].width}
                  height={DEVICE_HEIGHT[device]}
                  zoom={zoom}
                  onZoom={zoomBy}
                />
              )}
              {canvasMode === "component" && fileState && !fileState.renderable && !routeSel && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.void }}>
                  <div style={{ maxWidth: 420, padding: "18px 20px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 13, color: "#fff" }}>{fileState.file.split("/").pop()}</span>
                    <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>
                      Server component — no live preview here. Edits still apply to the real code
                      (see them in <span style={{ fontFamily: MONO, fontSize: 10.5 }}>next dev</span>); use the Outliner to pick elements.
                    </div>
                  </div>
                </div>
              )}
              {canvasMode === "component" && routeSel && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.void }}>
                  <div style={{ maxWidth: 420, padding: "18px 20px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 14, color: "#fff" }}>{routeSel.urlPath}</span>
                      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: C.muted }}>
                        {routeSel.files.page ? "page" : "API route"}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>
                      {routeSel.files.page
                        ? "Open the page's view or its code from the Properties panel."
                        : "Route handler — nothing to draw."}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      // ---------------------------------------------------------- Outliner
      case "outliner":
        return (
          <>
            {/* No title row: the File/Routes switch lives in the pane header. */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 8, paddingTop: 4 }}>
              {outlinerMode === "File" && fileState && (
                <>
                  <div style={{ padding: "4px 10px 3px", fontSize: 9.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.09em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fileState.file}>
                    {fileState.file.split("/").pop()}
                  </div>
                  <FileOutliner
                    model={fileState.model}
                    focusId={fileFocusId}
                    collapsed={fileCollapsed}
                    onToggle={(id) =>
                      setFileCollapsed((c) => {
                        const next = new Set(c);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onSelect={(m) => {
                      setFileFocusId(m.id);
                      send({ type: "select", id: m.id });
                    }}
                  />
                </>
              )}
              {outlinerMode === "File" && !fileState && (
                <div style={{ padding: "10px", fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
                  No file open. Pick a component from Insert or a route from the Routes tree.
                </div>
              )}
              {outlinerMode === "Routes" && routeTree && (
                <RouteTree
                  tree={routeTree}
                  selectedId={routeSel ? routeId(routeSel) : null}
                  onSelect={(n) => {
                    setRouteSel(n);
                    setFileFocusId(null);
                    // In the live canvas a route is a place to go, not just a
                    // set of files to read. Dynamic segments have no concrete
                    // URL, so they stay put.
                    if (canvasMode === "live" && n.files.page && !n.urlPath.includes("[")) {
                      setLivePath(n.urlPath);
                    }
                  }}
                />
              )}
              {outlinerMode === "Routes" && !routeTree && (
                <div style={{ padding: "10px", fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
                  No route tree — is the target folder a Next.js app?
                </div>
              )}
            </div>
          </>
        );

      // -------------------------------------------------------- Properties
      case "properties":
        return (
          <>
            {/* No title row: the selection name lives in the pane header. */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              {routeSel ? (
                <RouteCard route={routeSel} shell={routeShell} openFile={(f) => void openFile(f)} />
              ) : fileNode && fileState ? (
                <FileNodeCard
                  file={fileState.file}
                  node={fileNode}
                  onEdit={editFile}
                  onOpenSource={(src) => void openFile(src)}
                />
              ) : fileState ? (
                <SamplePropsCard state={fileState} setSampleProp={setSampleProp} />
              ) : (
                <div style={{ padding: "12px 10px", fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
                  Nothing open. The Routes tree shows the app's structure; Insert lists its components.
                </div>
              )}
            </div>
          </>
        );

      case "style":
        return <StyleBody tokens={styleTokens} dark={themeDark} />;
      case "workshop":
        return <WorkshopBody ws={wsMat} setWs={setWsMat} />;
      default:
        return null;
    }
  };

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
              data-menu={m.label}
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
                      <span style={{ flex: "0 0 12px", display: "flex", alignItems: "center", color: C.blueLight, fontSize: 11 }}>
                        {it.icon ? <Sym name={it.icon} size={13} /> : (it.check ?? "")}
                      </span>
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
        <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 8px", background: C.ctl, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text }}>
          <span style={{ color: C.muted, fontSize: 11 }}>app</span>
          {targetLabel}
        </span>
        <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, fontSize: 11, color: C.faint }}>
          {fileState ? fileState.file : "open a component or route to start editing"}
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
          style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 5, height: 24, padding: "0 10px", ...primaryBtn, opacity: fileState?.renderable ? 1 : 0.5, cursor: fileState?.renderable ? "pointer" : "not-allowed" }}
          disabled={!fileState?.renderable}
          title={
            !fileState
              ? "Nothing open — open a component (or a page's view) first"
              : fileState.renderable
                ? "Open this component in a new window — real size, fully interactive"
                : `${fileState.file.split("/").pop()} is a server component — it can't render on the canvas`
          }
          onClick={() => fileState?.renderable && window.open(`/harness.html?file=${encodeURIComponent(fileState.canvasKey)}`, "_blank")}
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
          <button className="hv-ctl" style={{ ...ctlBtn, color: styleEdits ? C.body : C.faint }} onClick={() => { send({ type: "token-clear" }); void styleTokens.refetch(); }}>Reset preview</button>
          <div style={{ flex: "1 1 0", minWidth: 8 }} />
          <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 11, color: C.faint }}>
            {styleEdits ? `${styleEdits} change${styleEdits === 1 ? "" : "s"} written to the app's css` : "in sync with the app's css"}
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
            {wsMat.matEdits ? `${wsMat.matEdits} unsaved change${wsMat.matEdits === 1 ? "" : "s"} · globals.css` : "in sync with globals.css"}
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------- Body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Dock
          layout={layout}
          onLayout={setLayout}
          title={(id) => PANEL_TITLE[basePanel(id)] ?? id}
          icon={(id) => PANEL_ICON[basePanel(id)] ?? "square"}
          panelMenu={groupPanels(group)}
          closable={(id) => id !== GROUP_MAIN[group]}
          newInstance={(id) => (basePanel(id) === "canvas" ? nextInstanceId(layout, "canvas") : null)}
          renderHeader={renderPanelHeader}
          render={renderPanel}
        />
      </div>

      {/* ---------------------------------------------------------- Context menu */}
      {ctxMenu && (() => {
        const items: MenuItem[] = [];
        if (fileNode) {
          if (fileNode.componentSource) {
            items.push({ label: `Open ${fileNode.tag} source`, action: () => void openFile(fileNode.componentSource!) });
          }
          if (inlineTextSlot(fileNode) != null) {
            items.push({ label: "Edit text", accel: "F2", action: () => beginTextEdit(fileNode.id) });
          }
          if (fileNode.can.structural) {
            items.push(
              { label: "Duplicate", accel: "Ctrl+D", action: () => void editFile({ op: "duplicate-element", index: fileNode.index }, fileNode.tag) },
              { label: "Delete", accel: "Del", action: () => void editFile({ op: "delete-element", index: fileNode.index }, fileNode.tag) },
              { sep: true },
              { label: "Move up", accel: "Alt+Up", action: () => void editFile({ op: "move-element", index: fileNode.index, newParentIndex: parentIndexOf(fileNode), childPos: Math.max(0, fileNode.slot - 2) }, fileNode.tag) },
              { label: "Move down", accel: "Alt+Down", action: () => void editFile({ op: "move-element", index: fileNode.index, newParentIndex: parentIndexOf(fileNode), childPos: fileNode.slot + 2 }, fileNode.tag) },
            );
          }
        }
        if (fileState) {
          if (items.length) items.push({ sep: true });
          items.push({ label: "Copy file path", action: () => void navigator.clipboard.writeText(fileState.file) });
        }
        if (!items.length) return null;
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

      {/* ---------------------------------------------------------- Preferences */}
      {prefsOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}
          onClick={() => setPrefsOpen(false)}
        >
          <div
            style={{ width: 420, maxWidth: "90vw", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#fff" }}>Preferences</span>
              <button className="hv-close" style={{ width: 26, height: 22, background: "none", border: "none", color: C.muted, cursor: "pointer", borderRadius: 4 }} onClick={() => setPrefsOpen(false)}>✕</button>
            </div>
            <div style={{ padding: "12px 14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ ...sectionHeader }}>Application</div>
              <Row label="Scale">
                <Seg grow items={[0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5].map((z) => ({
                  label: `${Math.round(z * 100)}%`,
                  active: Math.abs(appZoom - z) < 0.01,
                  onClick: () => setAppZoom(z),
                }))} />
              </Row>
              <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5, marginTop: -4 }}>
                Also Ctrl+Shift+± anywhere; Ctrl+Shift+0 resets. Remembered across sessions.
              </div>

              <div style={{ ...sectionHeader, marginTop: 4 }}>Canvas</div>
              <Row label="Rulers">
                <Seg grow items={[
                  { label: "Shown", active: rulersOn, onClick: () => setRulersOn(true) },
                  { label: "Hidden", active: !rulersOn, onClick: () => setRulersOn(false) },
                ]} />
              </Row>
              <Row label="Ruler units">
                <Seg grow items={(["px", "rem"] as const).map((u) => ({
                  label: u,
                  active: rulerUnit === u,
                  onClick: () => setRulerUnit(u),
                }))} />
              </Row>

              <div style={{ ...sectionHeader, marginTop: 4 }}>Session</div>
              <Row label="On launch">
                <Seg grow items={[
                  { label: "Reopen last file", active: reopenLast, onClick: () => setReopenLast(true) },
                  { label: "Start empty", active: !reopenLast, onClick: () => setReopenLast(false) },
                ]} />
              </Row>
              <Row label="Remembered">
                <button
                  className="hv-ctl"
                  style={ctlBtn}
                  onClick={() => {
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                      const k = localStorage.key(i);
                      if (k?.startsWith("uai:proj:") || k?.startsWith("uai:samples:")) localStorage.removeItem(k);
                    }
                  }}
                >
                  Clear sessions & sample props
                </button>
              </Row>

              <div style={{ marginTop: 6, padding: "8px 10px", background: C.sunken, border: `1px dashed ${C.border}`, borderRadius: 6, fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
                More settings will land here as the editor grows — keyboard remapping, default device, canvas theme, target switching.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- StatusBar */}
      <div style={{ flex: "0 0 26px", display: "flex", alignItems: "center", gap: 10, padding: "0 10px", background: C.panel, borderTop: `1px solid ${C.border}`, fontSize: 11, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
        <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, color: C.muted }}>{crumb}</span>
        <div style={{ flex: "1 1 0", minWidth: 8 }} />
        <span style={{ flex: "0 0 auto", color: C.green }}>{savedAt ? `saved to source at ${savedAt}` : "in sync with source"}</span>
        {touchedFiles.size > 0 && (
          <>
            <div style={{ ...vdiv, height: 14 }} />
            <span style={{ flex: "0 0 auto", color: C.amber, cursor: "help" }} title={[...touchedFiles].join("\n")}>
              {touchedFiles.size} file{touchedFiles.size === 1 ? "" : "s"} edited — review with git
            </span>
          </>
        )}
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
// Route card
// ---------------------------------------------------------------------------

/**
 * The live canvas: the target's own running app, mirrored by the live proxy.
 * We frame it (device width, zoom) and steer it (path), but we do not render
 * it — everything inside the frame is the real app, real data included.
 */
function LiveCanvas({
  live,
  registerFrame,
  path,
  setPath,
  width,
  height,
  zoom,
  onZoom,
}: {
  live: { origin: string; upstream: string } | null;
  /** Publish this pane's frame so App can broadcast probe commands to it. */
  registerFrame: (el: HTMLIFrameElement | null, on: boolean) => void;
  path: string;
  setPath: (p: string) => void;
  width: number;
  height: number;
  zoom: number;
  onZoom: (dir: 1 | -1) => void;
}) {
  // There can be several live panes; every probe message reaches all of them,
  // so each one filters on `event.source` being its own frame. Where the app
  // actually landed (it redirects, e.g. /account → /signin) is per-pane too.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const attach = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (frameRef.current) registerFrame(frameRef.current, false);
      frameRef.current = el;
      if (el) registerFrame(el, true);
    },
    [registerFrame],
  );
  // The frame floats freely on the apron: `pan` is its top-left corner in
  // apron px, unclamped — a real canvas lets the window sit with void on
  // every side, which scroll-based centering (clamped at 0) never could.
  // null = not yet placed; the layout effect centers it once the apron has
  // a size, and a device-width change re-centers.
  const apronRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    if (pan !== null) return;
    // `live` is a dep because the apron only exists once the mirror is known:
    // without it, the effect fires before the ref is attached and never again.
    const a = apronRef.current;
    if (!a) return;
    setPan({ x: Math.max(16, (a.clientWidth - width * zoom) / 2), y: 16 });
  }, [pan, width, zoom, live]);
  useEffect(() => setPan(null), [width]);

  // Middle-drag pans. While dragging, the iframe stops eating pointer
  // events so the drag survives crossing it; drags that START inside the
  // frame arrive from the probe as live-pan deltas instead.
  useEffect(() => {
    const el = apronRef.current;
    if (!el) return;
    let active = false;
    const down = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      active = true;
      setDragging(true);
    };
    const move = (e: MouseEvent) => {
      if (!active) return;
      setPan((p) => p && { x: p.x + e.movementX, y: p.y + e.movementY });
    };
    const up = (e: MouseEvent) => {
      if (e.button !== 1) return;
      active = false;
      setDragging(false);
    };
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // `live` gates the apron's existence — see the placement effect.
  }, [live]);

  // Ctrl+wheel zoom, anchored on the cursor. The wheel arrives two ways —
  // relayed by the probe from inside the iframe (content coordinates), or
  // directly over the apron — and both funnel into zoomAt, which remembers
  // where the anchored content point sat on screen. After the new zoom
  // renders, the layout effect shifts the pan so that point hasn't moved.
  const anchorRef = useRef<{ cx: number; cy: number; sx: number; sy: number } | null>(null);
  const zoomAt = useCallback(
    (dir: 1 | -1, cx: number, cy: number) => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (rect) anchorRef.current = { cx, cy, sx: rect.left + cx * zoom, sy: rect.top + cy * zoom };
      onZoom(dir);
    },
    [frameRef, zoom, onZoom],
  );
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { uai?: boolean; type?: string; url?: string | null; dir?: 1 | -1; x?: number; y?: number; dx?: number; dy?: number };
      if (!m?.uai) return;
      // Not ours: another live pane's probe.
      if (e.source !== frameRef.current?.contentWindow) return;
      if (m.type === "live-ready" && m.url) {
        setAt(m.url);
      } else if (m.type === "live-zoom" && m.dir) {
        zoomAt(m.dir, m.x ?? width / 2, m.y ?? height / 2);
      } else if (m.type === "live-pan") {
        // Deltas are SCREEN px (see the probe) — applied 1:1, no zoom scaling,
        // so the frame tracks the cursor exactly at any zoom.
        setPan((p) => p && { x: p.x + (m.dx ?? 0), y: p.y + (m.dy ?? 0) });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [zoomAt, width, height, zoom]);
  useEffect(() => {
    const el = apronRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!e.ctrlKey) {
        // The apron has no native scroll any more (pan is a transform), so
        // plain wheel pans: vertical, Shift for horizontal, trackpad both.
        setPan(
          (p) =>
            p && {
              x: p.x - e.deltaX - (e.shiftKey ? e.deltaY : 0),
              y: p.y - (e.shiftKey ? 0 : e.deltaY),
            },
        );
        return;
      }
      const rect = frameRef.current?.getBoundingClientRect();
      zoomAt(
        e.deltaY < 0 ? 1 : -1,
        rect ? (e.clientX - rect.left) / zoom : width / 2,
        rect ? (e.clientY - rect.top) / zoom : height / 2,
      );
    };
    // Attached manually: preventDefault needs a non-passive listener, which
    // React's onWheel doesn't guarantee.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // `live` gates the apron's existence — see the placement effect.
  }, [zoomAt, zoom, width, height, frameRef, live]);
  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    anchorRef.current = null;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    // rect reflects the new scale at the old pan; the difference from the
    // remembered screen position is exactly the pan correction. Pan is
    // unclamped, so anchoring works even at the edges.
    setPan((p) => p && { x: p.x - (rect.left + a.cx * zoom - a.sx), y: p.y - (rect.top + a.cy * zoom - a.sy) });
  }, [zoom, frameRef]);
  const [draft, setDraft] = useState(path);
  useEffect(() => setDraft(path), [path]);
  const [signingIn, setSigningIn] = useState(false);

  /** OAuth can't run inside the iframe (GitHub won't be framed), but a
   * TOP-LEVEL window in the same profile shares the `localhost` cookie jar
   * regardless of port — Electron's default window.open does too. Sign in
   * there, and when the window closes, reload the frame into the session. */
  const signIn = () => {
    if (!live) return;
    const popup = window.open(`${live.upstream}/signin`, "_blank");
    if (!popup) return;
    setSigningIn(true);
    const watch = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(watch);
      setSigningIn(false);
      if (frameRef.current) frameRef.current.src = `${live.origin}${path}`;
    }, 500);
  };

  if (!live) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", background: C.void }}>
        <div style={{ maxWidth: 420, padding: "18px 20px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>
          The live mirror isn't running. It starts with the u-and-i dev server; check the
          console for <span style={{ fontFamily: MONO, fontSize: 10.5 }}>live app</span>.
        </div>
      </div>
    );
  }
  // Compare paths, not prefixes: "/signin" starts with "/" too.
  let landedElsewhere = false;
  let landedAt = "";
  try {
    if (at) {
      landedAt = new URL(at).pathname;
      landedElsewhere = landedAt !== path;
    }
  } catch {
    /* not a URL we can read — treat as no redirect */
  }
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: C.void }}>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: C.canvasBar, borderBottom: `1px solid ${C.canvasEdge}` }}>
        <span style={{ flex: "0 0 auto", fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Path</span>
        <input
          className="fc"
          aria-label="Live app path"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setPath(draft.startsWith("/") ? draft : `/${draft}`);
            if (e.key === "Escape") setDraft(path);
          }}
          style={{ ...inputStyle, flex: 1, minWidth: 0, height: 22, fontFamily: MONO, fontSize: 11 }}
        />
        <button className="hv-ctl" style={ctlBtn} title="Reload the live page" onClick={() => { if (frameRef.current) frameRef.current.src = `${live.origin}${path}`; }}>
          Reload
        </button>
        <button className="hv-ctl" style={ctlBtn} title={`Open ${live.upstream}${path} in a browser`} onClick={() => window.open(`${live.upstream}${path}`, "_blank")}>
          Open
        </button>
      </div>
      {landedElsewhere && (
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", background: C.amberBg, borderBottom: `1px solid ${C.amberBorder}`, fontSize: 10.5, color: C.amber }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {signingIn
              ? "Waiting for the sign-in window — the canvas reloads when it closes."
              : <>The app sent us to <span style={{ fontFamily: MONO }}>{landedAt}</span> — usually a sign-in redirect. OAuth can't run in the canvas; use the button.</>}
          </span>
          <button className="hv-ctl" style={{ ...ctlBtn, flex: "0 0 auto" }} title={`Sign in at ${live.upstream}/signin in its own window; the session carries over`} onClick={signIn} disabled={signingIn}>
            Sign in…
          </button>
        </div>
      )}
      <div
        ref={apronRef}
        style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative", cursor: dragging ? "grabbing" : undefined }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: width * zoom,
            height: height * zoom,
            transform: pan ? `translate(${pan.x}px, ${pan.y}px)` : undefined,
            visibility: pan ? "visible" : "hidden",
          }}
        >
          <iframe
            ref={attach}
            src={`${live.origin}${path}`}
            title="live app"
            style={{
              width,
              height,
              border: "none",
              background: "#fff",
              // CSS zoom, not transform: scale() — a fractional transform
              // composites layers on non-integer boundaries and draws 1px
              // seam lines between elements that touch at 100%. zoom scales
              // at layout/paint with device-pixel snapping, so edges stay
              // flush at any factor.
              zoom,
              pointerEvents: dragging ? "none" : undefined,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function RouteCard({
  route,
  shell,
  openFile,
}: {
  route: RouteNode;
  shell: ShellInfo | null;
  openFile: (file: string) => void;
}) {
  const pad: CSSProperties = { padding: "9px 10px 12px", display: "flex", flexDirection: "column", gap: 6 };
  const fileRows = (Object.entries(route.files) as [string, string | undefined][]).filter(
    (e): e is [string, string] => !!e[1],
  );
  return (
    <div style={pad}>
      <Row label="URL">
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, color: C.text }}>{route.urlPath}</span>
      </Row>
      {route.isDynamic && (
        <Row label="Dynamic">
          <span style={{ flex: 1, fontFamily: MONO, color: C.body }}>{route.segment}</span>
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
      {route.layoutChain.length ? (
        route.layoutChain.map((l, i) => (
          <div key={l} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
            <span style={{ flex: "0 0 62px", color: C.faint }}>{i === 0 ? "root" : `level ${i}`}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 10.5, color: C.body }}>{l}</span>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 11, color: C.faint }}>none</div>
      )}
      {shell?.contentNote && (
        <div style={{ padding: "6px 8px", background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 6, fontSize: 10.5, color: C.amber, lineHeight: 1.5 }}>
          {shell.contentNote}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
        {shell?.viewFile && (
          <button className="hv-primary" style={primaryBtn} title={shell.viewFile} onClick={() => openFile(shell.viewFile!)}>
            Open {shell.viewTag} (the page's view)
          </button>
        )}
        {route.files.page && (
          <button className="hv-ctl" style={ctlBtn} onClick={() => openFile(route.files.page!)}>
            Edit page code
          </button>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5, marginTop: 4 }}>
        The route structure is interpreted from <span style={{ fontFamily: MONO }}>src/app</span>; opening a file edits the real code.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sample props card (render props for the open file's root — preview only)
// ---------------------------------------------------------------------------

function SamplePropsCard({
  state,
  setSampleProp,
}: {
  state: FileState;
  setSampleProp: (name: string, value: unknown) => void;
}) {
  const pad: CSSProperties = { padding: "9px 10px 12px", display: "flex", flexDirection: "column", gap: 6 };
  return (
    <div style={pad}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={state.file}>{state.file}</div>
      <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
        {state.renderable
          ? "Sample render props — preview only, never written to code. Click an element on the canvas or in the Outliner to edit its code."
          : "Server component — no live preview. Pick elements in the Outliner to edit their code."}
      </div>
      {state.specs.map((s) => {
        const raw = state.values[s.name];
        if (s.control.kind === "boolean") {
          return (
            <Row key={s.name} label={s.name}>
              <Seg grow items={[
                { label: "false", active: raw !== true, onClick: () => setSampleProp(s.name, false) },
                { label: "true", active: raw === true, onClick: () => setSampleProp(s.name, true) },
              ]} />
            </Row>
          );
        }
        if (s.control.kind === "select" && s.control.options) {
          return (
            <Row key={s.name} label={s.name}>
              <select className="fc" value={String(raw ?? "")} onChange={(e) => setSampleProp(s.name, e.target.value || undefined)} style={{ ...inputStyle, height: 22, padding: "0 5px", flex: 1, minWidth: 0 }}>
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
              if (v === "") return setSampleProp(s.name, undefined);
              if (s.control.kind === "number") return setSampleProp(s.name, Number(v) || 0);
              let val: unknown = v;
              if (s.control.kind === "json") { try { val = JSON.parse(v); } catch { /* keep string */ } }
              setSampleProp(s.name, val);
            }} style={{ flex: 1, minWidth: 0 }} />
          </div>
        );
      })}
      {state.specs.length === 0 && <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>No props interface found for this component.</div>}
    </div>
  );
}
