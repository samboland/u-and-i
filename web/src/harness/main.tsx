/**
 * Harness: renders a real component from the target Next.js app on the
 * canvas stage and layers the editor's affordances over it — hover/selection
 * outlines, drag-and-drop that becomes AST edits, device/zoom framing, the
 * void apron for panning. The rendered code is always the target's actual
 * source (served through the next/* shims); affordances decorate, never
 * re-draw.
 */
import {
  Component as ReactComponent,
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./harness.css";
import "./target-canvas.css";
import { SessionProvider } from "./next-shims/next-auth-react";
import type { EditorToHarness, HarnessToEditor } from "../shared/protocol";

const APP_PREFIX = "app:";

function post(msg: HarnessToEditor) {
  window.parent.postMessage(msg, "*");
}

// ---------------------------------------------------------------------------
// Boot: learn the target root, then module loading is plain dynamic import
// through vite's /@fs/ bridge — no compile-time globs, any folder works.
// ---------------------------------------------------------------------------

const targetRoot: string | null = await fetch("/api/project")
  .then((r) => r.json())
  .then((d) => (d.project?.root as string | undefined)?.replaceAll("\\", "/") ?? null)
  .catch(() => null);

function loadModule(file: string): Promise<Record<string, unknown>> {
  if (!targetRoot || !file.startsWith(APP_PREFIX)) {
    return Promise.reject(new Error(`unknown component file: ${file}`));
  }
  const rel = file.slice(APP_PREFIX.length);
  return import(/* @vite-ignore */ `/@fs/${targetRoot}/${rel}`) as Promise<Record<string, unknown>>;
}

// Target-specific canvas chrome (providers, svg defs). Generic fallback is
// just the fake session provider.
const appChrome =
  targetRoot?.endsWith("/adventure-alerts")
    ? await import("./aa/chrome").catch(() => null)
    : null;
function Providers({ children }: { children: ReactNode }) {
  if (appChrome) return <appChrome.AAProviders>{children}</appChrome.AAProviders>;
  return <SessionProvider>{children}</SessionProvider>;
}

/** One bad render must not kill the whole stage. */
class Boundary extends ReactComponent<
  { resetKey: string; children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: String(err) };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) return <pre className="uai-error">{this.state.error}</pre>;
    return this.props.children;
  }
}

function Stage() {
  const [stage, setStage] = useState<{
    file: string;
    props: Record<string, unknown>;
    Component: ComponentType<Record<string, unknown>>;
  } | null>(null);
  const stageRef = useRef<typeof stage>(null);
  stageRef.current = stage;

  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [frame, setFrame] = useState({ width: 1100, zoom: 0.62 });
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const zoomAnchor = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const loadSeq = useRef(0);
  const interact = useRef(false);

  // Standalone preview: /harness.html?file=<app:key> renders the component
  // plainly and interactive — no editor protocol, no stage framing. Sample
  // props come from the editor's localStorage (same origin).
  const previewFile = useRef(new URLSearchParams(location.search).get("file")).current;
  useEffect(() => {
    if (!previewFile) return;
    interact.current = true;
    document.title = `${previewFile.split("/").pop()} — preview`;
    document.documentElement.classList.add("uai-preview");
    document.body.classList.add("uai-preview");
    let props: Record<string, unknown> = {};
    try {
      const saved = localStorage.getItem(`uai:samples:app:${previewFile.slice(APP_PREFIX.length)}`);
      if (saved) props = JSON.parse(saved) as Record<string, unknown>;
    } catch {
      /* defaults */
    }
    void load(previewFile, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(file: string, props: Record<string, unknown>) {
    const seq = ++loadSeq.current;
    try {
      const mod = await loadModule(file);
      if (seq !== loadSeq.current) return;
      const isComp = (v: unknown) => typeof v === "function" || (typeof v === "object" && v !== null);
      let comp = mod.default;
      if (!isComp(comp)) {
        const named = Object.entries(mod).filter(([k, v]) => isComp(v) && /^[A-Z]/.test(k));
        comp = named[0]?.[1];
      }
      if (comp == null || !isComp(comp)) {
        setError(`no component export found in ${file}`);
        return;
      }
      setError(null);
      setStage({ file, props, Component: comp as ComponentType<Record<string, unknown>> });
    } catch (err) {
      if (seq === loadSeq.current) setError(String(err));
    }
  }

  // ------------------------------------------------------------------ messages

  useEffect(() => {
    const tokenOverrides = new Set<string>();
    const onMessage = (e: MessageEvent<EditorToHarness>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "render") {
        void load(msg.file, msg.props);
      } else if (msg.type === "select") {
        setSelectedId(msg.id);
      } else if (msg.type === "set-session") {
        void import("./next-shims/next-auth-react").then((m) =>
          m.setCanvasSession(msg.session as never),
        );
      } else if (msg.type === "set-interact") {
        interact.current = msg.on;
        document.body.classList.toggle("uai-interact", msg.on);
      } else if (msg.type === "set-device") {
        setFrame((f) => ({ ...f, width: msg.width }));
      } else if (msg.type === "set-zoom") {
        setFrame((f) => ({ ...f, zoom: msg.zoom }));
      } else if (msg.type === "set-theme") {
        document.documentElement.classList.toggle("dark", msg.dark);
      } else if (msg.type === "token-preview") {
        tokenOverrides.add(msg.name);
        document.documentElement.style.setProperty(msg.name, msg.value);
      } else if (msg.type === "token-clear") {
        for (const name of tokenOverrides) {
          document.documentElement.style.removeProperty(name);
        }
        tokenOverrides.clear();
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ stage navigation

  // Cursor-anchored zoom: when the zoom the editor sent back lands, shift
  // scroll so the content point under the cursor stays under the cursor.
  useEffect(() => {
    const anchor = zoomAnchor.current;
    if (!anchor || !stage || previewFile || frame.zoom === anchor.zoom) return;
    zoomAnchor.current = null;
    const el = document.querySelector<HTMLElement>("[data-uai-stage]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const originX = rect.left + window.scrollX;
    const originY = rect.top + window.scrollY;
    const cx = (window.scrollX + anchor.x - originX) / anchor.zoom;
    const cy = (window.scrollY + anchor.y - originY) / anchor.zoom;
    window.scrollTo({
      left: originX + cx * frame.zoom - anchor.x,
      top: originY + cy * frame.zoom - anchor.y,
    });
  }, [frame.zoom, stage, previewFile]);

  // Center the stage inside the void apron on load / file or device change
  // (not on zoom — zooming must not yank the pan position).
  const centeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!stage || previewFile) return;
    const key = `${stage.file}:${frame.width}`;
    if (centeredFor.current === key) return;
    centeredFor.current = key;
    const raf = requestAnimationFrame(() => {
      const stageW = frame.width * frame.zoom;
      window.scrollTo({
        left: window.innerWidth * 0.85 - Math.max(0, (window.innerWidth - stageW) / 2),
        top: window.innerHeight * 0.85 - 22,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [stage, frame, previewFile]);

  // Report where the stage origin sits in the viewport so the chrome's
  // rulers can track pan and zoom. rAF-coalesced.
  useEffect(() => {
    if (!stage || previewFile) return;
    let raf = 0;
    const report = () => {
      raf = 0;
      const el = document.querySelector<HTMLElement>("[data-uai-stage]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      post({ type: "stage-metrics", x: r.left, y: r.top });
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(report);
    };
    queue();
    window.addEventListener("scroll", queue, true);
    window.addEventListener("resize", queue);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", queue, true);
      window.removeEventListener("resize", queue);
    };
  }, [stage, frame, previewFile]);

  // Middle-mouse drag pans the canvas (suppresses the browser's autoscroll).
  useEffect(() => {
    if (previewFile) return;
    let pan: { x: number; y: number } | null = null;
    const down = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY };
      document.documentElement.style.cursor = "grabbing";
    };
    const move = (e: MouseEvent) => {
      if (!pan) return;
      window.scrollBy(pan.x - e.clientX, pan.y - e.clientY);
      pan = { x: e.clientX, y: e.clientY };
    };
    const up = (e: MouseEvent) => {
      if (e.button !== 1) return;
      pan = null;
      document.documentElement.style.cursor = "";
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [previewFile]);

  // Ctrl+scroll zooms the canvas — forwarded to the editor, which owns zoom.
  useEffect(() => {
    if (previewFile) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomAnchor.current = { x: e.clientX, y: e.clientY, zoom: frameRef.current.zoom };
      post({ type: "zoom-wheel", dir: e.deltaY < 0 ? 1 : -1 });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [previewFile]);

  // Re-import on HMR so the stage picks up fresh implementations.
  useEffect(() => {
    if (!import.meta.hot) return;
    const handler = () => {
      if (stage) void load(stage.file, stage.props);
    };
    import.meta.hot.on("vite:afterUpdate", handler);
    return () => import.meta.hot?.off("vite:afterUpdate", handler);
  }, [stage]);

  // ------------------------------------------------------------------ decoration

  // Selection highlight + draggability for the open file's own elements.
  // Runs every render — HMR replaces the DOM under us.
  useEffect(() => {
    document
      .querySelectorAll(".uai-selected")
      .forEach((el) => el.classList.remove("uai-selected"));
    if (selectedId) {
      document
        .querySelectorAll(`[data-uai="${CSS.escape(selectedId)}"]`)
        .forEach((el) => el.classList.add("uai-selected"));
    }
    const file = stageRef.current?.file;
    if (file && !previewFile) {
      document.querySelectorAll<HTMLElement>("[data-uai]").forEach((el) => {
        const id = el.getAttribute("data-uai")!;
        el.draggable = id.startsWith(`${file}::`) && !interact.current;
      });
    }
  });

  // ------------------------------------------------------------------ hover / click / keys

  useEffect(() => {
    const over = (e: Event) => {
      if (interact.current) return;
      const el = (e.target as Element).closest?.("[data-uai]");
      document
        .querySelectorAll(".uai-hover")
        .forEach((n) => n.classList.remove("uai-hover"));
      if (el) el.classList.add("uai-hover");
    };
    const chainOf = (el: Element): string[] => {
      const chain: string[] = [];
      let cur: Element | null = el;
      while (cur) {
        const v = cur.getAttribute?.("data-uai");
        if (v) chain.push(v);
        cur = cur.parentElement;
      }
      return chain;
    };
    const click = (e: MouseEvent) => {
      if (interact.current) return;
      const el = (e.target as Element).closest?.("[data-uai]");
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const id = el.getAttribute("data-uai")!;
      setSelectedId(id);
      post({ type: "selected", id, chain: chainOf(el) });
    };
    const ctx = (e: MouseEvent) => {
      if (interact.current) return;
      e.preventDefault();
      const el = (e.target as Element).closest?.("[data-uai]");
      post({ type: "context-menu", id: el?.getAttribute("data-uai") ?? null, x: e.clientX, y: e.clientY });
    };
    // The editor's shortcuts must keep working while the canvas has focus:
    // Tab and Escape always forward; in Edit mode every shortcut chord
    // forwards too. View mode leaves the keyboard to the app itself.
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "Tab") {
        e.preventDefault();
        post({ type: "toggle-interact" });
        return;
      }
      if (e.key === "Escape") {
        post({ type: "escape" });
        return;
      }
      if (interact.current) return;
      if (!(e.ctrlKey || e.metaKey || e.altKey || e.key === "Delete" || e.key === "F2")) return;
      e.preventDefault();
      post({ type: "key", key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
    };
    // Double-click descends into the element's source file.
    const dbl = (e: MouseEvent) => {
      if (interact.current) return;
      const el = (e.target as Element).closest?.("[data-uai]");
      if (!el) return;
      e.preventDefault();
      post({ type: "open-component", id: el.getAttribute("data-uai")! });
    };
    if (previewFile) return; // preview is plain interaction, no affordances
    document.addEventListener("mouseover", over);
    document.addEventListener("click", click, true);
    document.addEventListener("contextmenu", ctx);
    document.addEventListener("keydown", key);
    document.addEventListener("dblclick", dbl);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("click", click, true);
      document.removeEventListener("contextmenu", ctx);
      document.removeEventListener("keydown", key);
      document.removeEventListener("dblclick", dbl);
    };
  }, [previewFile]);

  // ------------------------------------------------------------------ drag & drop → AST edits

  useEffect(() => {
    if (previewFile) return;
    const MIME_JSX = "application/x-uai-jsx";
    const indicator = document.createElement("div");
    indicator.className = "uai-drop-indicator";
    document.body.appendChild(indicator);
    let moveId: string | null = null;
    let target: { id: string; position: "before" | "after" } | null = null;

    /** Nearest ancestor element that belongs to the open file. */
    const ownTarget = (from: Element | null): HTMLElement | null => {
      const file = stageRef.current?.file;
      if (!file) return null;
      let el = from?.closest?.("[data-uai]") as HTMLElement | null;
      while (el) {
        if (el.getAttribute("data-uai")!.startsWith(`${file}::`)) return el;
        el = el.parentElement?.closest?.("[data-uai]") as HTMLElement | null;
      }
      return null;
    };

    const onDragStart = (e: DragEvent) => {
      if (interact.current) return;
      const el = ownTarget(e.target as Element);
      if (!el) return;
      moveId = el.getAttribute("data-uai")!;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", moveId);
    };

    const onDragOver = (e: DragEvent) => {
      const external = e.dataTransfer ? Array.from(e.dataTransfer.types).includes(MIME_JSX) : false;
      if (!moveId && !external) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = moveId ? "move" : "copy";
      const el = ownTarget(e.target as Element);
      if (!el || el.getAttribute("data-uai") === moveId) {
        indicator.style.display = "none";
        target = null;
        return;
      }
      const r = el.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      target = { id: el.getAttribute("data-uai")!, position: before ? "before" : "after" };
      Object.assign(indicator.style, {
        display: "block",
        left: `${r.left + window.scrollX}px`,
        width: `${r.width}px`,
        top: `${(before ? r.top - 3 : r.bottom + 1) + window.scrollY}px`,
      });
    };

    const onDrop = (e: DragEvent) => {
      const payload = e.dataTransfer?.getData(MIME_JSX);
      if (!target) return;
      e.preventDefault();
      if (payload) {
        post({ type: "file-drop", targetId: target.id, position: target.position, insert: JSON.parse(payload) });
      } else if (moveId) {
        post({ type: "file-drop", targetId: target.id, position: target.position, moveId });
      }
      onDragEnd();
    };

    const onDragEnd = () => {
      moveId = null;
      target = null;
      indicator.style.display = "none";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!(e.relatedTarget instanceof Node)) indicator.style.display = "none";
    };

    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("dragleave", onDragLeave);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("dragleave", onDragLeave);
      indicator.remove();
    };
  }, [previewFile]);

  // ------------------------------------------------------------------ render

  if (error) return <pre className="uai-error">{error}</pre>;
  if (!stage) return null;

  const component = (
    <Providers>
      <Boundary resetKey={stage.file + JSON.stringify(stage.props)}>
        <stage.Component {...stage.props} />
      </Boundary>
    </Providers>
  );

  if (previewFile) return component;

  // The void apron around the stage lets you pan past the content edges in
  // every direction; a centering scroll on load puts it in view.
  return (
    <div style={{ padding: "85vh 85vw", width: "max-content" }}>
      <div style={{ width: frame.width * frame.zoom }}>
        <div data-uai-stage style={{ width: frame.width, transform: `scale(${frame.zoom})`, transformOrigin: "top left" }}>
          <div className="uai-page-surface">{component}</div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Stage />);
