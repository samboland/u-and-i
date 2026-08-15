/**
 * Harness: renders the user's real generated page (or a component) and layers
 * the editor's canvas affordances over it — per-kind selection outlines and
 * badges, drop indicators, dev-note pins and callouts, empty-column wells,
 * device/zoom stage framing, canvas states. The page itself is always the
 * real code from pages-gen/ — affordances decorate, never re-draw.
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
import { mocks } from "../../../fixtures/mocks";
import type { CanvasState, EditorToHarness, HarnessToEditor } from "../shared/protocol";

const modules = import.meta.glob(
  "../../../fixtures/demo-project/src/components/**/*.tsx",
);
const pageModules = import.meta.glob(
  "../../../fixtures/demo-project/src/pages-gen/*.tsx",
);

function relKey(globKey: string): string {
  return globKey.replace(/^(\.\.\/)+/, "");
}

const byRel: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(modules)) byRel[relKey(key)] = loader;

const pageByName: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(pageModules)) {
  const name = key.split("/").pop()!.replace(/\.tsx$/, "");
  pageByName[name] = loader;
}

function post(msg: HarnessToEditor) {
  window.parent.postMessage(msg, "*");
}

const KIND_BADGE_BG = { block: "#ff6b00", column: "#5fae6f", section: "#6fb8ea" } as const;
const KIND_BADGE_FG = { block: "#ffffff", column: "#0d1a12", section: "#0d1a22" } as const;

const STATE_MESSAGE: Record<Exclude<CanvasState, "Default">, string> = {
  Loading: "Loading…",
  Empty: "No data yet",
  Error: "Couldn't load",
};

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

interface SelMeta {
  id: string | null;
  kind: "section" | "column" | "block" | null;
  badge: string | null;
}

function Stage() {
  const [stage, setStage] = useState<{
    mode: "component" | "page";
    file: string;
    props: Record<string, unknown>;
    Component: ComponentType<Record<string, unknown>>;
  } | null>(null);
  const stageRef = useRef<typeof stage>(null);
  stageRef.current = stage;

  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selMeta, setSelMeta] = useState<SelMeta>({ id: null, kind: null, badge: null });
  const selMetaRef = useRef(selMeta);
  selMetaRef.current = selMeta;
  const [frame, setFrame] = useState({ width: 1100, zoom: 0.62 });
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const zoomAnchor = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasState>("Default");
  const [showNotes, setShowNotes] = useState(true);
  const [annotations, setAnnotations] = useState<{
    notes: { id: string; n: number; text: string }[];
    needsData: string[];
  }>({ notes: [], needsData: [] });
  const loadSeq = useRef(0);
  const interact = useRef(false);

  async function load(file: string, props: Record<string, unknown>) {
    const seq = ++loadSeq.current;
    const loader = byRel[file];
    if (!loader) {
      setError(`unknown component file: ${file}`);
      return;
    }
    try {
      const mod = (await loader()) as Record<string, unknown>;
      if (seq !== loadSeq.current) return;
      const exportName = mocks[file]?.exportName ?? "default";
      const comp = mod[exportName];
      if (comp == null || (typeof comp !== "function" && typeof comp !== "object")) {
        setError(`export ${exportName} not found in ${file}`);
        return;
      }
      setError(null);
      setStage({
        mode: "component",
        file,
        props,
        Component: comp as ComponentType<Record<string, unknown>>,
      });
    } catch (err) {
      if (seq === loadSeq.current) setError(String(err));
    }
  }

  async function loadPage(name: string) {
    const seq = ++loadSeq.current;
    const loader = pageByName[name];
    if (!loader) {
      location.reload();
      return;
    }
    try {
      const mod = (await loader()) as { default?: unknown };
      if (seq !== loadSeq.current) return;
      if (typeof mod.default !== "function") {
        setError(`page ${name} has no default export`);
        return;
      }
      setError(null);
      setStage({
        mode: "page",
        file: name,
        props: {},
        Component: mod.default as ComponentType<Record<string, unknown>>,
      });
    } catch (err) {
      if (seq === loadSeq.current) setError(String(err));
    }
  }

  // ------------------------------------------------------------------ inline edit

  function startEdit(el: HTMLElement) {
    el.draggable = false;
    el.contentEditable = "true";
    el.classList.add("uai-editing");
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const finish = (commit: boolean) => {
      const text = el.innerText.trim();
      el.contentEditable = "false";
      el.classList.remove("uai-editing");
      el.draggable = true;
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      if (commit) {
        post({ type: "edit-text", blockId: el.getAttribute("data-uai-block")!, text });
      }
    };
    const onKey = (ke: KeyboardEvent) => {
      if (ke.key === "Enter") {
        ke.preventDefault();
        el.blur();
      } else if (ke.key === "Escape") {
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  // ------------------------------------------------------------------ messages

  useEffect(() => {
    const tokenOverrides = new Set<string>();
    const onMessage = (e: MessageEvent<EditorToHarness>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "render") {
        void load(msg.file, msg.props);
      } else if (msg.type === "render-page") {
        void loadPage(msg.name);
      } else if (msg.type === "select") {
        setSelectedId(msg.id);
      } else if (msg.type === "select-block") {
        setSelMeta({ id: msg.id, kind: msg.kind ?? "block", badge: msg.badge ?? null });
      } else if (msg.type === "set-interact") {
        interact.current = msg.on;
        document.body.classList.toggle("uai-interact", msg.on);
      } else if (msg.type === "set-device") {
        setFrame((f) => ({ ...f, width: msg.width }));
      } else if (msg.type === "set-zoom") {
        setFrame((f) => ({ ...f, zoom: msg.zoom }));
      } else if (msg.type === "set-canvas-state") {
        setCanvasState(msg.state);
      } else if (msg.type === "set-show-notes") {
        setShowNotes(msg.on);
      } else if (msg.type === "set-theme") {
        document.documentElement.classList.toggle("dark", msg.dark);
      } else if (msg.type === "set-annotations") {
        setAnnotations({ notes: msg.notes, needsData: msg.needsData });
      } else if (msg.type === "begin-edit") {
        const el = document.querySelector<HTMLElement>(
          `[data-uai-block="${CSS.escape(msg.id)}"]`,
        );
        if (el && ["H1", "H2", "H3", "P", "BUTTON"].includes(el.tagName)) startEdit(el);
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

  // Cursor-anchored zoom: when the zoom the editor sent back lands, shift
  // scroll so the content point under the cursor stays under the cursor.
  useEffect(() => {
    const anchor = zoomAnchor.current;
    if (!anchor || stage?.mode !== "page" || frame.zoom === anchor.zoom) return;
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
  }, [frame.zoom, stage]);

  // Center the page inside the void apron on load / page or device change
  // (not on zoom — zooming must not yank the pan position).
  const centeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (stage?.mode !== "page") {
      centeredFor.current = null;
      return;
    }
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
  }, [stage, frame]);

  // Middle-mouse drag pans the canvas (suppresses the browser's autoscroll).
  useEffect(() => {
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
  }, []);

  // Ctrl+scroll zooms the canvas — forwarded to the editor, which owns zoom.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || stageRef.current?.mode !== "page") return;
      e.preventDefault();
      zoomAnchor.current = { x: e.clientX, y: e.clientY, zoom: frameRef.current.zoom };
      post({ type: "zoom-wheel", dir: e.deltaY < 0 ? 1 : -1 });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // Re-import on HMR so the stage picks up fresh implementations.
  useEffect(() => {
    if (!import.meta.hot) return;
    const handler = () => {
      if (!stage) return;
      if (stage.mode === "page") void loadPage(stage.file);
      else void load(stage.file, stage.props);
    };
    import.meta.hot.on("vite:afterUpdate", handler);
    return () => import.meta.hot?.off("vite:afterUpdate", handler);
  }, [stage]);

  // ------------------------------------------------------------------ decoration

  // Component-mode selection highlight (legacy inspector flow).
  useEffect(() => {
    document
      .querySelectorAll(".uai-selected")
      .forEach((el) => el.classList.remove("uai-selected"));
    if (stage?.mode === "component" && selectedId) {
      document
        .querySelectorAll(`[data-uai="${CSS.escape(selectedId)}"]`)
        .forEach((el) => el.classList.add("uai-selected"));
    }
    document.body.classList.toggle("uai-page-mode", stage?.mode === "page");
    if (stage?.mode === "page") {
      document
        .querySelectorAll<HTMLElement>('[data-uai-kind="block"], [data-uai-kind="section"]')
        .forEach((el) => {
          if (!el.classList.contains("uai-editing")) el.draggable = true;
        });
    }
  });

  // Page-mode decoration: selection outline + badge, note pins + callout,
  // empty-column wells, state wells. Re-runs on every render (HMR replaces
  // the DOM under us) plus scroll/resize for the positioned overlays.
  useEffect(() => {
    if (stage?.mode !== "page") return;
    const overlays: HTMLElement[] = [];
    const injected: HTMLElement[] = [];
    const hidden: HTMLElement[] = [];
    const outlined: HTMLElement[] = [];

    const decorate = () => {
      overlays.forEach((o) => o.remove());
      overlays.length = 0;
      injected.forEach((o) => o.remove());
      injected.length = 0;
      hidden.forEach((el) => (el.style.visibility = ""));
      hidden.length = 0;
      outlined.forEach((el) =>
        el.classList.remove("uai-sel-block", "uai-sel-column", "uai-sel-section"),
      );
      outlined.length = 0;

      const byId = (id: string) =>
        document.querySelector<HTMLElement>(`[data-uai-block="${CSS.escape(id)}"]`);

      // Selection outline + badge
      const sm = selMetaRef.current;
      if (sm.id && sm.kind) {
        const el = byId(sm.id);
        if (el) {
          el.classList.add(`uai-sel-${sm.kind}`);
          outlined.push(el);
          if (sm.badge) {
            const r = el.getBoundingClientRect();
            const b = document.createElement("div");
            b.className = "uai-badge";
            b.textContent = sm.badge;
            b.style.background = KIND_BADGE_BG[sm.kind];
            b.style.color = KIND_BADGE_FG[sm.kind];
            b.style.fontWeight = sm.kind === "block" ? "400" : "600";
            b.style.left = `${r.left + window.scrollX - 3}px`;
            b.style.top = `${r.top + window.scrollY - (sm.kind === "column" ? 24 : sm.kind === "section" ? 20 : 19)}px`;
            document.body.appendChild(b);
            overlays.push(b);
          }
        }
      }

      // Note pins (+ callout under the selected element)
      if (showNotes) {
        for (const note of annotations.notes) {
          const el = byId(note.id);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const pin = document.createElement("span");
          pin.className = "uai-pin";
          pin.textContent = String(note.n);
          pin.style.left = `${r.right + window.scrollX - 5}px`;
          pin.style.top = `${r.top + window.scrollY + 2}px`;
          document.body.appendChild(pin);
          overlays.push(pin);
          if (sm.id === note.id) {
            const callout = document.createElement("div");
            callout.className = "uai-callout";
            callout.innerHTML = `<span class="uai-callout-n">${note.n}</span><div>${note.text.replace(/</g, "&lt;")}</div>`;
            el.insertAdjacentElement("afterend", callout);
            injected.push(callout);
          }
        }
      }

      // Empty-column wells
      document
        .querySelectorAll<HTMLElement>('[data-uai-kind="column"]')
        .forEach((col) => {
          if (!col.querySelector('[data-uai-kind="block"]')) {
            const well = document.createElement("div");
            well.className = "uai-empty-well";
            well.textContent = "empty column";
            col.appendChild(well);
            injected.push(well);
          }
        });

      // Canvas-state wells over data-bound blocks
      if (canvasState !== "Default") {
        for (const id of annotations.needsData) {
          const el = byId(id);
          if (!el) continue;
          el.style.visibility = "hidden";
          hidden.push(el);
          const well = document.createElement("div");
          well.className = "uai-state-well";
          well.textContent = STATE_MESSAGE[canvasState];
          const r = el.getBoundingClientRect();
          well.style.left = `${r.left + window.scrollX}px`;
          well.style.top = `${r.top + window.scrollY}px`;
          well.style.width = `${Math.max(180, r.width)}px`;
          well.style.height = `${Math.max(40, r.height)}px`;
          document.body.appendChild(well);
          overlays.push(well);
        }
      }
    };

    decorate();
    const raf = requestAnimationFrame(decorate);
    window.addEventListener("scroll", decorate, true);
    window.addEventListener("resize", decorate);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", decorate, true);
      window.removeEventListener("resize", decorate);
      overlays.forEach((o) => o.remove());
      injected.forEach((o) => o.remove());
      hidden.forEach((el) => (el.style.visibility = ""));
      outlined.forEach((el) =>
        el.classList.remove("uai-sel-block", "uai-sel-column", "uai-sel-section"),
      );
    };
  }, [stage, selMeta, annotations, canvasState, showNotes, frame]);

  // ------------------------------------------------------------------ hover + click selection

  useEffect(() => {
    const selector = () =>
      stageRef.current?.mode === "page" ? "[data-uai-block]" : "[data-uai]";
    const over = (e: Event) => {
      if (interact.current) return;
      const el = (e.target as Element).closest?.(selector());
      document
        .querySelectorAll(".uai-hover")
        .forEach((n) => n.classList.remove("uai-hover"));
      if (el) el.classList.add("uai-hover");
    };
    const click = (e: MouseEvent) => {
      if (interact.current) return;
      if ((e.target as Element).closest?.(".uai-editing")) return;
      const el = (e.target as Element).closest?.(selector());
      if (!el) {
        if (stageRef.current?.mode === "page") {
          setSelMeta({ id: null, kind: null, badge: null });
          post({ type: "selected-block", id: "" });
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (stageRef.current?.mode === "page") {
        const id = el.getAttribute("data-uai-block")!;
        post({ type: "selected-block", id });
      } else {
        const id = el.getAttribute("data-uai")!;
        setSelectedId(id);
        post({ type: "selected", id });
      }
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("click", click, true);
    };
  }, []);

  // ------------------------------------------------------------------ drag & drop + dblclick

  useEffect(() => {
    if (stage?.mode !== "page") return;
    const indicator = document.createElement("div");
    indicator.className = "uai-drop-indicator";
    document.body.appendChild(indicator);
    let dragging: { id: string; kind: "block" | "section" } | null = null;
    let dropTarget:
      | { columnId: string; index: number }
      | { sectionIndex: number }
      | null = null;

    const MIME_BLOCK = "application/x-uai-new-block";
    const MIME_SECTION = "application/x-uai-new-section";
    const MIME_COLUMN = "application/x-uai-new-column";
    const externalKind = (e: DragEvent): "block" | "section" | "column" | null => {
      const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
      if (types.includes(MIME_BLOCK)) return "block";
      if (types.includes(MIME_SECTION)) return "section";
      if (types.includes(MIME_COLUMN)) return "column";
      return null;
    };
    let columnTarget: { sectionId: string; index: number } | null = null;
    let sectionOnlyTarget: string | null = null;

    const onDragStart = (e: DragEvent) => {
      if (interact.current) return;
      const el = (e.target as Element).closest?.(
        '[data-uai-kind="block"], [data-uai-kind="section"]',
      ) as HTMLElement | null;
      if (!el || el.classList.contains("uai-editing")) return;
      dragging = {
        id: el.getAttribute("data-uai-block")!,
        kind: el.getAttribute("data-uai-kind") as "block" | "section",
      };
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", dragging.id);
    };

    const onDragOver = (e: DragEvent) => {
      const external = externalKind(e);
      const kind = dragging?.kind ?? external;
      if (!kind) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = dragging ? "move" : "copy";
      columnTarget = null;
      sectionOnlyTarget = null;

      if (kind === "column") {
        const section = (e.target as Element).closest?.(
          '[data-uai-kind="section"]',
        ) as HTMLElement | null;
        if (!section) {
          indicator.style.display = "none";
          return;
        }
        const cols = Array.from(
          section.querySelectorAll<HTMLElement>('[data-uai-kind="column"]'),
        );
        let index = cols.length;
        for (let i = 0; i < cols.length; i++) {
          const r = cols[i].getBoundingClientRect();
          if (e.clientX < r.left + r.width / 2) {
            index = i;
            break;
          }
        }
        columnTarget = { sectionId: section.getAttribute("data-uai-block")!, index };
        const sr = section.getBoundingClientRect();
        const x =
          cols.length === 0
            ? sr.left + 8
            : index === cols.length
              ? cols[cols.length - 1].getBoundingClientRect().right + 2
              : cols[index].getBoundingClientRect().left - 4;
        Object.assign(indicator.style, {
          display: "block",
          left: `${x + window.scrollX}px`,
          width: "3px",
          top: `${sr.top + window.scrollY}px`,
          height: `${sr.height}px`,
        });
        return;
      }
      indicator.style.height = "3px";

      if (kind === "block") {
        const col = (e.target as Element).closest?.(
          '[data-uai-kind="column"]',
        ) as HTMLElement | null;
        if (!col) {
          const section = (e.target as Element).closest?.(
            '[data-uai-kind="section"]',
          ) as HTMLElement | null;
          if (external && section && !section.querySelector('[data-uai-kind="column"]')) {
            sectionOnlyTarget = section.getAttribute("data-uai-block")!;
            const sr = section.getBoundingClientRect();
            Object.assign(indicator.style, {
              display: "block",
              left: `${sr.left + window.scrollX}px`,
              width: `${sr.width}px`,
              top: `${sr.top + sr.height / 2 + window.scrollY}px`,
            });
            return;
          }
          indicator.style.display = "none";
          dropTarget = null;
          return;
        }
        const blocks = Array.from(
          col.querySelectorAll<HTMLElement>(':scope > [data-uai-kind="block"]'),
        ).filter((b) => b.getAttribute("data-uai-block") !== dragging?.id);
        let index = blocks.length;
        for (let i = 0; i < blocks.length; i++) {
          const r = blocks[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) {
            index = i;
            break;
          }
        }
        dropTarget = { columnId: col.getAttribute("data-uai-block")!, index };
        const colRect = col.getBoundingClientRect();
        const y =
          blocks.length === 0
            ? colRect.top + 4
            : index === blocks.length
              ? blocks[blocks.length - 1].getBoundingClientRect().bottom + 2
              : blocks[index].getBoundingClientRect().top - 9;
        Object.assign(indicator.style, {
          display: "block",
          left: `${colRect.left + window.scrollX}px`,
          width: `${colRect.width}px`,
          top: `${y + window.scrollY}px`,
        });
      } else {
        const main = document.querySelector("main");
        if (!main) return;
        const sections = Array.from(
          main.querySelectorAll<HTMLElement>(':scope > [data-uai-kind="section"]'),
        ).filter((s) => s.getAttribute("data-uai-block") !== dragging?.id);
        let index = sections.length;
        for (let i = 0; i < sections.length; i++) {
          const r = sections[i].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) {
            index = i;
            break;
          }
        }
        dropTarget = { sectionIndex: index };
        const mainRect = main.getBoundingClientRect();
        const y =
          sections.length === 0
            ? mainRect.top
            : index === sections.length
              ? sections[sections.length - 1].getBoundingClientRect().bottom + 4
              : sections[index].getBoundingClientRect().top - 4;
        Object.assign(indicator.style, {
          display: "block",
          left: `${mainRect.left + window.scrollX}px`,
          width: `${mainRect.width}px`,
          top: `${y + window.scrollY}px`,
        });
      }
    };

    const onDrop = (e: DragEvent) => {
      const external = externalKind(e);
      if (external) {
        e.preventDefault();
        if (external === "block" && dropTarget && "columnId" in dropTarget) {
          post({
            type: "insert-block",
            item: JSON.parse(e.dataTransfer!.getData(MIME_BLOCK) || "{}"),
            targetColumnId: dropTarget.columnId,
            targetSectionId: null,
            index: dropTarget.index,
          });
        } else if (external === "block" && sectionOnlyTarget) {
          post({
            type: "insert-block",
            item: JSON.parse(e.dataTransfer!.getData(MIME_BLOCK) || "{}"),
            targetColumnId: null,
            targetSectionId: sectionOnlyTarget,
            index: 0,
          });
        } else if (external === "section" && dropTarget && "sectionIndex" in dropTarget) {
          post({ type: "insert-section", index: dropTarget.sectionIndex });
        } else if (external === "column" && columnTarget) {
          post({
            type: "insert-column",
            sectionId: columnTarget.sectionId,
            index: columnTarget.index,
          });
        }
        onDragEnd();
        return;
      }
      if (!dragging || !dropTarget) return;
      e.preventDefault();
      if (dragging.kind === "block" && "columnId" in dropTarget) {
        post({
          type: "move-block",
          blockId: dragging.id,
          targetColumnId: dropTarget.columnId,
          index: dropTarget.index,
        });
      } else if (dragging.kind === "section" && "sectionIndex" in dropTarget) {
        post({
          type: "move-section",
          sectionId: dragging.id,
          index: dropTarget.sectionIndex,
        });
      }
    };

    const onDragEnd = () => {
      dragging = null;
      dropTarget = null;
      columnTarget = null;
      sectionOnlyTarget = null;
      indicator.style.display = "none";
      indicator.style.height = "3px";
    };

    const onDblClick = (e: MouseEvent) => {
      if (interact.current) return;
      const el = (e.target as Element).closest?.(
        '[data-uai-kind="block"]',
      ) as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName.toLowerCase();
      if (!["h1", "h2", "h3", "p", "button"].includes(tag)) return;
      e.preventDefault();
      startEdit(el);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!(e.relatedTarget instanceof Node)) indicator.style.display = "none";
    };

    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dblclick", onDblClick);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dblclick", onDblClick);
      indicator.remove();
    };
  }, [stage?.mode]);

  // ------------------------------------------------------------------ render

  if (error) return <pre className="uai-error">{error}</pre>;
  if (!stage) return null;

  if (stage.mode === "page") {
    // The void apron around the page lets you pan past the content edges in
    // every direction; a centering scroll on load puts the page in view.
    return (
      <div style={{ padding: "85vh 85vw", width: "max-content" }}>
        <div style={{ width: frame.width * frame.zoom }}>
          <div data-uai-stage style={{ width: frame.width, transform: `scale(${frame.zoom})`, transformOrigin: "top left" }}>
            <div className="uai-page-surface">
              <Boundary resetKey={stage.file}>
                <stage.Component />
              </Boundary>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Boundary resetKey={stage.file + JSON.stringify(stage.props)}>
      <stage.Component {...stage.props} />
    </Boundary>
  );
}

createRoot(document.getElementById("root")!).render(<Stage />);
