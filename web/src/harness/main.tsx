/**
 * Harness: renders the user's real component (served through the uai-tagger
 * transform, so every JSX element carries a data-uai id) and relays
 * hover/click selection to the editor.
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
import type { EditorToHarness, HarnessToEditor } from "../shared/protocol";

const modules = import.meta.glob(
  "../../../fixtures/demo-project/src/components/**/*.tsx",
);
const pageModules = import.meta.glob(
  "../../../fixtures/demo-project/src/pages-gen/*.tsx",
);

/** Map a glob key (../../../fixtures/...) to a repo-root-relative path. */
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

/** One bad render (e.g. props mid-switch) must not kill the whole stage. */
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
  // Component + props + file are one atom, set only after the module import
  // resolves — the stage can never pair a component with another file's props.
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
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  async function load(file: string, props: Record<string, unknown>) {
    const seq = ++loadSeq.current;
    const loader = byRel[file];
    if (!loader) {
      setError(`unknown component file: ${file}`);
      return;
    }
    try {
      const mod = (await loader()) as Record<string, unknown>;
      if (seq !== loadSeq.current) return; // superseded by a newer request
      const exportName = mocks[file]?.exportName ?? "default";
      const comp = mod[exportName];
      // forwardRef/memo components are objects, not functions.
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
      // Newly generated page module: the glob updates via HMR; reload to pick
      // it up on first creation.
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
        setSelectedBlockId(msg.id);
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

  // After a source edit lands, Vite HMR-updates the fixture module; re-import
  // so the stage picks up the fresh component implementation.
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

  // Selection highlight: DOM classes on every instance of the selected node.
  useEffect(() => {
    document
      .querySelectorAll(".uai-selected")
      .forEach((el) => el.classList.remove("uai-selected"));
    if (selectedId) {
      document
        .querySelectorAll(`[data-uai="${CSS.escape(selectedId)}"]`)
        .forEach((el) => el.classList.add("uai-selected"));
    }
    if (selectedBlockId) {
      document
        .querySelectorAll(`[data-uai-block="${CSS.escape(selectedBlockId)}"]`)
        .forEach((el) => el.classList.add("uai-selected"));
    }
    document.body.classList.toggle("uai-page-mode", stage?.mode === "page");
    // Direct manipulation needs draggable targets; refresh after every render
    // (HMR replaces the DOM under us).
    if (stage?.mode === "page") {
      document
        .querySelectorAll<HTMLElement>(
          '[data-uai-kind="block"], [data-uai-kind="section"]',
        )
        .forEach((el) => {
          if (!el.classList.contains("uai-editing")) el.draggable = true;
        });
    }
  });

  // Margin overlay for the selected block (devtools-style margin box).
  useEffect(() => {
    if (stage?.mode !== "page") return;
    const overlay = document.createElement("div");
    overlay.className = "uai-margin-overlay";
    document.body.appendChild(overlay);
    const update = () => {
      const el = selectedBlockId
        ? document.querySelector<HTMLElement>(
            `[data-uai-block="${CSS.escape(selectedBlockId)}"]`,
          )
        : null;
      if (!el) {
        overlay.style.display = "none";
        return;
      }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const m = {
        t: parseFloat(cs.marginTop) || 0,
        r: parseFloat(cs.marginRight) || 0,
        b: parseFloat(cs.marginBottom) || 0,
        l: parseFloat(cs.marginLeft) || 0,
      };
      Object.assign(overlay.style, {
        display: "block",
        left: `${r.left - m.l + window.scrollX}px`,
        top: `${r.top - m.t + window.scrollY}px`,
        width: `${r.width + m.l + m.r}px`,
        height: `${r.height + m.t + m.b}px`,
      });
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      overlay.remove();
    };
  }, [stage, selectedBlockId]);

  // Page-mode drag & drop + inline text editing.
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

    const onDragStart = (e: DragEvent) => {
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

    // Toolbox items dragged in from the editor (parent frame). During
    // dragover only the mime TYPE is readable, so the kind is encoded there.
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
        columnTarget = {
          sectionId: section.getAttribute("data-uai-block")!,
          index,
        };
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
      // Reset to horizontal-line geometry for block/section indicators.
      indicator.style.height = "3px";

      if (kind === "block") {
        const col = (e.target as Element).closest?.(
          '[data-uai-kind="column"]',
        ) as HTMLElement | null;
        if (!col) {
          // Dropping onto a section with no columns yet: highlight the whole
          // section; the editor creates a column to hold the block.
          const section = (e.target as Element).closest?.(
            '[data-uai-kind="section"]',
          ) as HTMLElement | null;
          if (
            external &&
            section &&
            !section.querySelector('[data-uai-kind="column"]')
          ) {
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
              : blocks[index].getBoundingClientRect().top - 4;
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
          main.querySelectorAll<HTMLElement>(
            ':scope > [data-uai-kind="section"]',
          ),
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
        if (external === "block" && (dropTarget && "columnId" in dropTarget)) {
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
      const el = (e.target as Element).closest?.(
        '[data-uai-kind="block"]',
      ) as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName.toLowerCase();
      if (!["h1", "h2", "h3", "p", "button"].includes(tag)) return;
      e.preventDefault();
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
          post({
            type: "edit-text",
            blockId: el.getAttribute("data-uai-block")!,
            text,
          });
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
    };

    // For toolbox drags the source element lives in the parent frame, so
    // dragend never fires here — clear the indicator when the drag leaves.
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

  // Hover + click → editor.
  useEffect(() => {
    const selector = () =>
      stageRef.current?.mode === "page" ? "[data-uai-block]" : "[data-uai]";
    const over = (e: Event) => {
      const el = (e.target as Element).closest?.(selector());
      document
        .querySelectorAll(".uai-hover")
        .forEach((n) => n.classList.remove("uai-hover"));
      if (el) el.classList.add("uai-hover");
    };
    const click = (e: MouseEvent) => {
      if ((e.target as Element).closest?.(".uai-editing")) return;
      const el = (e.target as Element).closest?.(selector());
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      if (stageRef.current?.mode === "page") {
        const id = el.getAttribute("data-uai-block")!;
        setSelectedBlockId(id);
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

  if (error) return <pre className="uai-error">{error}</pre>;
  if (!stage) return null;
  return (
    <Boundary resetKey={stage.file + JSON.stringify(stage.props)}>
      <stage.Component {...stage.props} />
    </Boundary>
  );
}

createRoot(document.getElementById("root")!).render(<Stage />);
