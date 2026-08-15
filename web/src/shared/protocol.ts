/** postMessage protocol between editor (parent) and harness (iframe). */

export type EditorToHarness =
  | { type: "render"; file: string; props: Record<string, unknown> }
  | { type: "select"; id: string | null }
  | { type: "set-interact"; on: boolean }
  | { type: "set-device"; width: number }
  | { type: "set-zoom"; zoom: number }
  | { type: "set-theme"; dark: boolean }
  | { type: "set-session"; session: unknown }
  | { type: "token-preview"; name: string; value: string }
  | { type: "token-clear" };

export type HarnessToEditor =
  | { type: "ready" }
  | { type: "selected"; id: string; chain?: string[] }
  | { type: "open-component"; id: string }
  | { type: "context-menu"; id: string | null; x: number; y: number }
  | {
      type: "file-drop";
      /** data-uai id of the open-file element the drop landed on. */
      targetId: string;
      position: "before" | "after";
      /** Present when an existing element was dragged (move). */
      moveId?: string;
      /** Present when a palette item was dropped (insert). */
      insert?: { jsx: string; imports?: { source: string; named?: string[]; default?: string }[] };
    }
  | { type: "zoom-wheel"; dir: 1 | -1 }
  | { type: "toggle-interact" }
  | { type: "escape" }
  | { type: "key"; key: string; ctrl: boolean; shift: boolean; alt: boolean }
  | { type: "stage-metrics"; x: number; y: number }
  | { type: "render-error"; message: string };
