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

/** Map a glob key (../../../fixtures/...) to a repo-root-relative path. */
function relKey(globKey: string): string {
  return globKey.replace(/^(\.\.\/)+/, "");
}

const byRel: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(modules)) byRel[relKey(key)] = loader;

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
    file: string;
    props: Record<string, unknown>;
    Component: ComponentType<Record<string, unknown>>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      if (typeof comp !== "function") {
        setError(`export ${exportName} not found in ${file}`);
        return;
      }
      setError(null);
      setStage({
        file,
        props,
        Component: comp as ComponentType<Record<string, unknown>>,
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
      } else if (msg.type === "select") {
        setSelectedId(msg.id);
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
      if (stage) void load(stage.file, stage.props);
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
  });

  // Hover + click → editor.
  useEffect(() => {
    const over = (e: Event) => {
      const el = (e.target as Element).closest?.("[data-uai]");
      document
        .querySelectorAll(".uai-hover")
        .forEach((n) => n.classList.remove("uai-hover"));
      if (el) el.classList.add("uai-hover");
    };
    const click = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-uai]");
      if (el) {
        e.preventDefault();
        e.stopPropagation();
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
