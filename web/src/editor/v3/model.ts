/**
 * Editor-side mirror of the server's file model (server/ast.ts model v2).
 * IDs are EPHEMERAL — valid only until the next edit; every edit response
 * replaces the whole model, and the editor re-anchors selection to the
 * returned focusId.
 */

export interface StylePropModel {
  name: string;
  value: string | null;
  dynamic: boolean;
}
export interface ClassChunkModel {
  chunk: number;
  value: string;
  conditional: boolean;
}
export interface TextChildModel {
  slot: number;
  value: string;
}
export interface PropModel {
  name: string;
  kind: "string" | "number" | "boolean" | "expression" | "spread";
  valueText: string;
}
export interface JsxNodeModel {
  id: string;
  index: number;
  tag: string;
  parentId: string | null;
  slot: number;
  selfClosing: boolean;
  props: PropModel[];
  styleProps: StylePropModel[] | null;
  styleDynamic: boolean;
  classChunks: ClassChunkModel[];
  textChildren: TextChildModel[];
  componentSource: string | null;
  dynamic: boolean;
  dynamicLabel: string | null;
  can: { structural: boolean; text: boolean; style: boolean; classes: boolean };
  children: JsxNodeModel[];
}

export type FileEdit =
  | { op: "set-style-prop"; index: number; name: string; value: string | null }
  | { op: "set-class-chunk"; index: number; chunk: number; value: string }
  | { op: "set-text"; index: number; slot: number; value: string }
  | {
      op: "insert-element";
      parentIndex: number;
      childPos: number;
      jsx: string;
      imports?: { source: string; named?: string[]; default?: string }[];
    }
  | { op: "delete-element"; index: number }
  | { op: "move-element"; index: number; newParentIndex: number; childPos: number }
  | { op: "duplicate-element"; index: number }
  | {
      op: "set-prop";
      index: number;
      name: string;
      value: { kind: "string" | "expr" | "boolean-true" | "remove"; text?: string };
    }
  | { op: "set-class-string"; index: number; value: string; force?: boolean };

export function flattenModel(nodes: JsxNodeModel[], out: JsxNodeModel[] = []): JsxNodeModel[] {
  for (const m of nodes) {
    out.push(m);
    flattenModel(m.children, out);
  }
  return out;
}

export function findModelNode(nodes: JsxNodeModel[], id: string | null): JsxNodeModel | null {
  if (!id) return null;
  return flattenModel(nodes).find((m) => m.id === id) ?? null;
}
