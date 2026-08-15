/** postMessage protocol between editor (parent) and harness (iframe). */

export type CanvasState = "Default" | "Loading" | "Empty" | "Error";

export type EditorToHarness =
  | { type: "render"; file: string; props: Record<string, unknown> }
  | { type: "render-page"; name: string }
  | { type: "select"; id: string | null }
  | {
      type: "select-block";
      id: string | null;
      kind?: "section" | "column" | "block";
      badge?: string;
    }
  | { type: "set-interact"; on: boolean }
  | { type: "set-device"; width: number }
  | { type: "set-zoom"; zoom: number }
  | { type: "set-canvas-state"; state: CanvasState }
  | { type: "set-show-notes"; on: boolean }
  | { type: "set-theme"; dark: boolean }
  | { type: "begin-edit"; id: string }
  | {
      type: "set-annotations";
      notes: { id: string; n: number; text: string }[];
      needsData: string[];
    }
  | { type: "token-preview"; name: string; value: string }
  | { type: "token-clear" };

export type HarnessToEditor =
  | { type: "ready" }
  | { type: "selected"; id: string }
  | { type: "selected-block"; id: string }
  | { type: "move-block"; blockId: string; targetColumnId: string; index: number }
  | { type: "move-section"; sectionId: string; index: number }
  | {
      type: "insert-block";
      item: unknown;
      targetColumnId: string | null;
      targetSectionId: string | null;
      index: number;
    }
  | { type: "insert-section"; index: number }
  | { type: "insert-column"; sectionId: string; index: number }
  | { type: "edit-text"; blockId: string; text: string }
  | { type: "render-error"; message: string };
