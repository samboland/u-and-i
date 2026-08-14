/**
 * Core AST round-trip engine.
 *
 * One parser, one traversal order, three consumers:
 *  - tagTransform: injects `data-uai` ids into the code served to the harness
 *  - buildModel: extracts the editable JSX tree sent to the editor
 *  - applyEdit: writes a minimal change back to the original source
 *
 * Node identity is the preorder index of the JSXElement within the file. All
 * three consumers parse the same on-disk source, so indices always agree.
 * Edits never add or remove elements, so indices are stable across edits.
 */
import * as recast from "recast";
import * as babelTs from "recast/parsers/babel-ts";

const b = recast.types.builders;
const n = recast.types.namedTypes;

export function parse(code: string) {
  return recast.parse(code, { parser: babelTs });
}

export function print(
  ast: unknown,
  lineTerminator = "\n",
  quote: "single" | "double" = "double",
): string {
  // recast defaults lineTerminator to os.EOL, which silently rewrites every
  // line of an LF file as CRLF on Windows — always pass it explicitly.
  return recast.print(ast as recast.types.ASTNode, {
    lineTerminator,
    quote,
    trailingComma: true,
  }).code;
}

/** Match the file's dominant string-quote style so edits blend in. */
function detectQuote(code: string): "single" | "double" {
  const singles = (code.match(/'/g) ?? []).length;
  const doubles = (code.match(/"/g) ?? []).length;
  return singles > doubles ? "single" : "double";
}

/** Visit every JSXElement in preorder, calling fn with its index. */
function visitElements(
  ast: unknown,
  fn: (path: InstanceType<typeof recast.types.NodePath>, index: number) => void,
) {
  let i = 0;
  recast.types.visit(ast as recast.types.ASTNode, {
    visitJSXElement(path) {
      fn(path as never, i++);
      this.traverse(path);
    },
  });
}

// ---------------------------------------------------------------------------
// Tagging (harness transform)
// ---------------------------------------------------------------------------

export function tagTransform(code: string, relFile: string): string {
  const ast = parse(code);
  visitElements(ast, (path, index) => {
    const opening = (
      path.node as unknown as { openingElement: { attributes?: unknown[] } }
    ).openingElement as { attributes: unknown[] };
    opening.attributes = opening.attributes ?? [];
    opening.attributes.push(
      b.jsxAttribute(
        b.jsxIdentifier("data-uai"),
        b.stringLiteral(`${relFile}::${index}`),
      ),
    );
  });
  return print(ast);
}

// ---------------------------------------------------------------------------
// Model extraction
// ---------------------------------------------------------------------------

export interface StylePropModel {
  name: string;
  /** Serialized literal value, or null when the value is a dynamic expression. */
  value: string | null;
  dynamic: boolean;
}

export interface ClassChunkModel {
  /** Index into the string literals under the className attribute value. */
  chunk: number;
  value: string;
  /** True when the literal sits inside a conditional / call, not a bare string. */
  conditional: boolean;
}

export interface TextChildModel {
  /** Index into the element's children array. */
  slot: number;
  value: string;
}

export interface JsxNodeModel {
  id: string;
  index: number;
  tag: string;
  styleProps: StylePropModel[] | null; // null = no style attribute
  styleDynamic: boolean; // style attr exists but isn't a plain object literal
  classChunks: ClassChunkModel[];
  textChildren: TextChildModel[];
  children: JsxNodeModel[];
}

function tagName(node: { openingElement: { name: unknown } }): string {
  const name = node.openingElement.name as Record<string, unknown>;
  if (n.JSXIdentifier.check(name)) return name.name as unknown as string;
  return recast.print(name as unknown as recast.types.ASTNode).code;
}

function getAttr(node: Record<string, unknown>, attrName: string) {
  const opening = (node as { openingElement: { attributes?: unknown[] } })
    .openingElement;
  for (const attr of opening.attributes ?? []) {
    if (
      n.JSXAttribute.check(attr) &&
      n.JSXIdentifier.check(attr.name) &&
      attr.name.name === attrName
    ) {
      return attr;
    }
  }
  return null;
}

function literalToString(value: unknown): string | null {
  if (n.StringLiteral.check(value)) return value.value;
  if (n.NumericLiteral.check(value)) return String(value.value);
  if (
    n.UnaryExpression.check(value) &&
    value.operator === "-" &&
    n.NumericLiteral.check(value.argument)
  ) {
    return `-${value.argument.value}`;
  }
  return null;
}

/** Collect string literals under the className attribute value, in source order. */
function collectClassLiterals(attr: {
  value?: unknown;
}): { node: { value: string }; conditional: boolean }[] {
  const out: { node: { value: string }; conditional: boolean }[] = [];
  const value = attr.value;
  if (!value) return out;
  if (n.StringLiteral.check(value)) {
    out.push({ node: value as { value: string }, conditional: false });
    return out;
  }
  if (n.JSXExpressionContainer.check(value)) {
    recast.types.visit(value as recast.types.ASTNode, {
      visitStringLiteral(path) {
        // A literal is "conditional" when it's not a direct argument of the
        // top-level call expression (i.e. it lives inside &&, ?:, etc.).
        let conditional = false;
        let p = path.parent;
        while (p) {
          if (
            n.LogicalExpression.check(p.node) ||
            n.ConditionalExpression.check(p.node) ||
            n.BinaryExpression.check(p.node)
          ) {
            conditional = true;
            break;
          }
          p = p.parent;
        }
        out.push({ node: path.node as { value: string }, conditional });
        this.traverse(path);
      },
    });
  }
  return out;
}

function styleModel(node: Record<string, unknown>): {
  styleProps: StylePropModel[] | null;
  styleDynamic: boolean;
} {
  const attr = getAttr(node, "style");
  if (!attr) return { styleProps: null, styleDynamic: false };
  const value = attr.value;
  if (
    !n.JSXExpressionContainer.check(value) ||
    !n.ObjectExpression.check(value.expression)
  ) {
    return { styleProps: null, styleDynamic: true };
  }
  const props: StylePropModel[] = [];
  for (const prop of value.expression.properties) {
    if (!n.ObjectProperty.check(prop)) continue;
    let name: string | null = null;
    if (n.Identifier.check(prop.key)) name = prop.key.name;
    else if (n.StringLiteral.check(prop.key)) name = prop.key.value;
    if (name == null) continue;
    const lit = literalToString(prop.value);
    props.push({ name, value: lit, dynamic: lit == null });
  }
  return { styleProps: props, styleDynamic: false };
}

export function buildModel(code: string, relFile: string): JsxNodeModel[] {
  const ast = parse(code);
  const roots: JsxNodeModel[] = [];
  const stack: { node: unknown; model: JsxNodeModel }[] = [];

  let index = 0;
  recast.types.visit(ast as recast.types.ASTNode, {
    visitJSXElement(path) {
      const node = path.node as unknown as Record<string, unknown>;
      const classAttr = getAttr(node, "className");
      const classChunks: ClassChunkModel[] = classAttr
        ? collectClassLiterals(classAttr).map((c, i) => ({
            chunk: i,
            value: c.node.value,
            conditional: c.conditional,
          }))
        : [];

      const textChildren: TextChildModel[] = [];
      const children = (node.children ?? []) as unknown[];
      children.forEach((child, slot) => {
        if (n.JSXText.check(child)) {
          const trimmed = (child.value as string).trim();
          if (trimmed) textChildren.push({ slot, value: trimmed });
        }
      });

      const model: JsxNodeModel = {
        id: `${relFile}::${index}`,
        index,
        tag: tagName(node as never),
        ...styleModel(node),
        classChunks,
        textChildren,
        children: [],
      };
      index++;

      // Pop stack until top is an ancestor of this path.
      while (stack.length) {
        const top = stack[stack.length - 1];
        let p: InstanceType<typeof recast.types.NodePath> | null = path.parent;
        let isAncestor = false;
        while (p) {
          if (p.node === top.node) {
            isAncestor = true;
            break;
          }
          p = p.parent;
        }
        if (isAncestor) break;
        stack.pop();
      }

      if (stack.length) stack[stack.length - 1].model.children.push(model);
      else roots.push(model);
      stack.push({ node: path.node, model });

      this.traverse(path);
    },
  });

  return roots;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export type Edit =
  | { op: "set-style-prop"; index: number; name: string; value: string | null }
  | { op: "set-class-chunk"; index: number; chunk: number; value: string }
  | { op: "set-text"; index: number; slot: number; value: string };

function cssValueToNode(value: string) {
  if (/^-?\d+(\.\d+)?$/.test(value)) return b.numericLiteral(Number(value));
  return b.stringLiteral(value);
}

export function applyEdit(code: string, edit: Edit): string {
  const eol = code.includes("\r\n") ? "\r\n" : "\n";
  const q = detectQuote(code);
  const ast = parse(code);
  let target: Record<string, unknown> | null = null;
  visitElements(ast, (path, index) => {
    if (index === edit.index) target = path.node as unknown as Record<string, unknown>;
  });
  if (!target) throw new Error(`No JSX element at index ${edit.index}`);
  const el = target as Record<string, unknown>;

  if (edit.op === "set-style-prop") {
    let attr = getAttr(el, "style");
    if (!attr) {
      if (edit.value == null) return print(ast, eol, q);
      attr = b.jsxAttribute(
        b.jsxIdentifier("style"),
        b.jsxExpressionContainer(b.objectExpression([])),
      );
      (el as { openingElement: { attributes: unknown[] } }).openingElement.attributes.push(attr);
    }
    const value = attr.value;
    if (
      !n.JSXExpressionContainer.check(value) ||
      !n.ObjectExpression.check(value.expression)
    ) {
      throw new Error("style attribute is not a plain object literal");
    }
    const obj = value.expression;
    const existing = obj.properties.findIndex(
      (p) =>
        n.ObjectProperty.check(p) &&
        ((n.Identifier.check(p.key) && p.key.name === edit.name) ||
          (n.StringLiteral.check(p.key) && p.key.value === edit.name)),
    );
    if (edit.value == null) {
      if (existing >= 0) obj.properties.splice(existing, 1);
    } else if (existing >= 0) {
      (obj.properties[existing] as { value: unknown }).value = cssValueToNode(edit.value);
    } else {
      const key = /^[A-Za-z_$][\w$]*$/.test(edit.name)
        ? b.identifier(edit.name)
        : b.stringLiteral(edit.name);
      obj.properties.push(b.objectProperty(key, cssValueToNode(edit.value)));
    }
    return print(ast, eol, q);
  }

  if (edit.op === "set-class-chunk") {
    const attr = getAttr(el, "className");
    if (!attr) throw new Error("no className attribute");
    const literals = collectClassLiterals(attr);
    const lit = literals[edit.chunk];
    if (!lit) throw new Error(`no class chunk ${edit.chunk}`);
    lit.node.value = edit.value;
    return print(ast, eol, q);
  }

  if (edit.op === "set-text") {
    const children = (el.children ?? []) as unknown[];
    const child = children[edit.slot];
    if (!n.JSXText.check(child)) throw new Error(`child ${edit.slot} is not text`);
    (child as { value: string }).value = edit.value;
    return print(ast, eol, q);
  }

  throw new Error("unknown edit op");
}
