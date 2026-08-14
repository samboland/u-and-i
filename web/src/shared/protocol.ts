/** postMessage protocol between editor (parent) and harness (iframe). */

export type EditorToHarness =
  | { type: "render"; file: string; props: Record<string, unknown> }
  | { type: "render-page"; name: string }
  | { type: "select"; id: string | null }
  | { type: "select-block"; id: string | null }
  | { type: "token-preview"; name: string; value: string }
  | { type: "token-clear" };

export type HarnessToEditor =
  | { type: "ready" }
  | { type: "selected"; id: string }
  | { type: "selected-block"; id: string }
  | { type: "render-error"; message: string };
