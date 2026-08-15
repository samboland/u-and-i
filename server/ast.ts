/**
 * Core AST round-trip engine.
 *
 * One parser, one traversal order, three consumers:
 *  - tagTransform: injects `data-uai` ids into the code served to the harness
 *  - buildModel: extracts the editable JSX tree sent to the editor
 *  - applyEdit: writes a minimal change back to the original source
 *
 * Node identity is the preorder index of the JSXElement within the file.
 * IDs ARE EPHEMERAL: structural edits (insert/delete/move) shift every
 * subsequent index, so an id is only valid between two edits. The contract:
 * applyEdit addresses pre-edit indices, returns the focus node's post-edit
 * index, and the editor rebuilds its model from the response — it never
 * trusts an id across an edit.
 *
 * Edits are guarded for fidelity: after printing, the changed line span must
 * stay inside the edited element's original source range (plus the import
 * section for import-adding ops). If recast disturbs anything else — a
 * comment, a sibling — the edit is rejected instead of written.
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

type NodePathT = InstanceType<typeof recast.types.NodePath>;

/** Visit every JSXElement in preorder, calling fn with its index. */
function visitElements(ast: unknown, fn: (path: NodePathT, index: number) => void) {
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

export interface PropModel {
  name: string;
  kind: "string" | "number" | "boolean" | "expression" | "spread";
  /** Literal value, or printed expression text for expression/spread kinds. */
  valueText: string;
}

export interface JsxNodeModel {
  id: string;
  index: number;
  tag: string;
  parentId: string | null;
  /** Index in the parent element's children array; -1 when not directly there
   * (e.g. the element lives inside an expression, a prop, or a return). */
  slot: number;
  selfClosing: boolean;
  /** All attributes except style / className. */
  props: PropModel[];
  styleProps: StylePropModel[] | null; // null = no style attribute
  styleDynamic: boolean; // style attr exists but isn't a plain object literal
  classChunks: ClassChunkModel[];
  /** className exists but its value is neither absent, a string literal, nor
   * something with editable literal chunks. */
  textChildren: TextChildModel[];
  /** Resolved source file for capitalized component tags, when the import
   * could be resolved inside the project. */
  componentSource: string | null;
  /** Produced by an expression (map callback, ternary, &&) — edits apply to
   * every repetition/branch instance. */
  dynamic: boolean;
  /** Compact label of the nearest enclosing expression, e.g. "items.map(…)". */
  dynamicLabel: string | null;
  can: { structural: boolean; text: boolean; style: boolean; classes: boolean };
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

function propsModel(node: Record<string, unknown>): PropModel[] {
  const opening = (node as { openingElement: { attributes?: unknown[] } }).openingElement;
  const out: PropModel[] = [];
  for (const attr of opening.attributes ?? []) {
    if (n.JSXSpreadAttribute.check(attr)) {
      out.push({
        name: "…spread",
        kind: "spread",
        valueText: recast.print(attr.argument as recast.types.ASTNode).code,
      });
      continue;
    }
    if (!n.JSXAttribute.check(attr) || !n.JSXIdentifier.check(attr.name)) continue;
    const name = attr.name.name as string;
    if (name === "style" || name === "className" || name === "data-uai") continue;
    const value = attr.value;
    if (value == null) {
      out.push({ name, kind: "boolean", valueText: "true" });
    } else if (n.StringLiteral.check(value)) {
      out.push({ name, kind: "string", valueText: value.value });
    } else if (n.JSXExpressionContainer.check(value)) {
      const expr = value.expression;
      if (n.NumericLiteral.check(expr)) {
        out.push({ name, kind: "number", valueText: String(expr.value) });
      } else if (n.BooleanLiteral.check(expr)) {
        out.push({ name, kind: "boolean", valueText: String(expr.value) });
      } else if (n.StringLiteral.check(expr)) {
        out.push({ name, kind: "string", valueText: expr.value });
      } else {
        out.push({
          name,
          kind: "expression",
          valueText: recast.print(expr as recast.types.ASTNode).code,
        });
      }
    }
  }
  return out;
}

/** Local component name → import specifier, from the file's import declarations. */
export function importMap(ast: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const body = (ast as { program: { body: unknown[] } }).program.body;
  for (const stmt of body) {
    if (!n.ImportDeclaration.check(stmt)) continue;
    const source = (stmt.source as { value: string }).value;
    for (const spec of stmt.specifiers ?? []) {
      const local = (spec as { local?: { name?: string } }).local?.name;
      if (local) map.set(local, source);
    }
  }
  return map;
}

/** Nearest enclosing expression container between the element and its parent
 * element — the signal that this element is produced dynamically. */
function dynamicContext(path: NodePathT): { dynamic: boolean; label: string | null } {
  let p: NodePathT | null = path.parent;
  while (p) {
    if (n.JSXElement.check(p.node)) break;
    if (n.JSXExpressionContainer.check(p.node)) {
      const expr = (p.node as { expression: unknown }).expression;
      let label = recast.print(expr as recast.types.ASTNode).code.replace(/\s+/g, " ");
      if (label.length > 34) label = `${label.slice(0, 31)}…`;
      return { dynamic: true, label };
    }
    p = p.parent;
  }
  return { dynamic: false, label: null };
}

export interface BuildModelOptions {
  /** Resolve an import specifier ("@/x", "./y") to a project-relative file. */
  resolveImport?: (specifier: string) => string | null;
}

export function buildModel(
  code: string,
  relFile: string,
  opts?: BuildModelOptions,
): JsxNodeModel[] {
  const ast = parse(code);
  const imports = importMap(ast);
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

      // Structural position: directly inside a parent element's children array?
      const parentNode = path.parent?.node as Record<string, unknown> | undefined;
      let slot = -1;
      if (parentNode && n.JSXElement.check(parentNode)) {
        slot = ((parentNode.children ?? []) as unknown[]).indexOf(path.node);
      }

      const tag = tagName(node as never);
      const source = /^[A-Z]/.test(tag) ? (imports.get(tag) ?? null) : null;
      const styles = styleModel(node);
      const dyn = dynamicContext(path as NodePathT);

      const model: JsxNodeModel = {
        id: `${relFile}::${index}`,
        index,
        tag,
        parentId: null, // linked below when attached to a parent
        slot,
        selfClosing: !!(node.openingElement as { selfClosing?: boolean }).selfClosing,
        props: propsModel(node),
        ...styles,
        classChunks,
        textChildren,
        componentSource: source ? (opts?.resolveImport?.(source) ?? null) : null,
        dynamic: dyn.dynamic,
        dynamicLabel: dyn.label,
        can: {
          structural: slot >= 0,
          text: textChildren.length > 0,
          style: !styles.styleDynamic,
          classes: !classAttr || classChunks.length > 0,
        },
        children: [],
      };
      index++;

      // Pop stack until top is an ancestor of this path.
      while (stack.length) {
        const top = stack[stack.length - 1];
        let p: NodePathT | null = path.parent;
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

      if (stack.length) {
        const parent = stack[stack.length - 1].model;
        model.parentId = parent.id;
        parent.children.push(model);
      } else {
        roots.push(model);
      }
      stack.push({ node: path.node, model });

      this.traverse(path);
    },
  });

  return roots;
}

// ---------------------------------------------------------------------------
// File-level analysis
// ---------------------------------------------------------------------------

/** Facts the editor needs about a file beyond its JSX tree. */
export function analyzeFile(code: string): { defaultAsync: boolean; hasDefault: boolean } {
  const ast = parse(code);
  const body = (ast as { program: { body: unknown[] } }).program.body;
  let defaultAsync = false;
  let hasDefault = false;
  const asyncFns = new Set<string>();
  for (const stmt of body) {
    if (n.FunctionDeclaration.check(stmt) && stmt.async && stmt.id) {
      asyncFns.add((stmt.id as { name: string }).name);
    }
    if (n.VariableDeclaration.check(stmt)) {
      for (const decl of stmt.declarations) {
        if (
          n.VariableDeclarator.check(decl) &&
          n.Identifier.check(decl.id) &&
          decl.init &&
          (n.ArrowFunctionExpression.check(decl.init) || n.FunctionExpression.check(decl.init)) &&
          (decl.init as { async?: boolean }).async
        ) {
          asyncFns.add((decl.id as { name: string }).name);
        }
      }
    }
  }
  for (const stmt of body) {
    if (!n.ExportDefaultDeclaration.check(stmt)) continue;
    hasDefault = true;
    const decl = stmt.declaration as unknown as Record<string, unknown>;
    if (
      (n.FunctionDeclaration.check(decl) || n.ArrowFunctionExpression.check(decl)) &&
      (decl as { async?: boolean }).async
    ) {
      defaultAsync = true;
    } else if (n.Identifier.check(decl) && asyncFns.has((decl as { name: string }).name)) {
      defaultAsync = true;
    }
  }
  return { defaultAsync, hasDefault };
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export type Edit =
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

export interface EditResult {
  code: string;
  /** Post-edit preorder index of the focus node (edited / inserted node, or
   * the parent after a delete), or null when nothing sensible remains. */
  focusIndex: number | null;
}

function cssValueToNode(value: string) {
  if (/^-?\d+(\.\d+)?$/.test(value)) return b.numericLiteral(Number(value));
  return b.stringLiteral(value);
}

/** Parse a JSX snippet into a JSXElement node. */
function parseSnippet(jsx: string): unknown {
  const wrapped = parse(`const __uai = <>${jsx}</>;`);
  let element: unknown = null;
  recast.types.visit(wrapped as recast.types.ASTNode, {
    visitJSXElement(path) {
      element = path.node;
      return false; // first element only
    },
  });
  if (!element) throw new Error("snippet contains no JSX element");
  return element;
}

/** Add imports, merging into existing declarations. Mutates the ast. */
function ensureImports(
  ast: unknown,
  imports: { source: string; named?: string[]; default?: string }[],
): boolean {
  const body = (ast as { program: { body: unknown[] } }).program.body;
  let changed = false;
  for (const imp of imports) {
    let decl = body.find(
      (s) => n.ImportDeclaration.check(s) && (s.source as { value: string }).value === imp.source,
    ) as { specifiers: unknown[] } | undefined;
    const wantNamed = imp.named ?? [];
    if (decl) {
      const have = new Set(
        decl.specifiers
          .filter((s) => n.ImportSpecifier.check(s))
          .map((s) => (s as { imported: { name: string } }).imported.name),
      );
      for (const name of wantNamed) {
        if (!have.has(name)) {
          decl.specifiers.push(b.importSpecifier(b.identifier(name)));
          changed = true;
        }
      }
    } else {
      const specifiers: unknown[] = [];
      if (imp.default) specifiers.push(b.importDefaultSpecifier(b.identifier(imp.default)));
      for (const name of wantNamed) specifiers.push(b.importSpecifier(b.identifier(name)));
      const newDecl = b.importDeclaration(specifiers as never, b.stringLiteral(imp.source));
      let lastImport = -1;
      body.forEach((s, i) => {
        if (n.ImportDeclaration.check(s)) lastImport = i;
      });
      body.splice(lastImport + 1, 0, newDecl);
      changed = true;
    }
  }
  return changed;
}

/** Splice a node (plus any adjacent pure-whitespace JSXText before it) out of
 * its parent's children; returns the removed element. */
function detachChild(parentChildren: unknown[], node: unknown): void {
  const i = parentChildren.indexOf(node);
  if (i < 0) throw new Error("node is not a direct child of its parent");
  let start = i;
  if (start > 0 && n.JSXText.check(parentChildren[start - 1]) && !(parentChildren[start - 1] as { value: string }).value.trim()) {
    start -= 1;
  }
  parentChildren.splice(start, i - start + 1);
}

/** Fidelity guard: the changed line span between old and new text must fall
 * inside [allowedStart, allowedEnd] (1-based, inclusive, old-file lines). */
function assertLocalChange(
  oldCode: string,
  newCode: string,
  allowedStart: number,
  allowedEnd: number,
  what: string,
): void {
  if (oldCode === newCode) return;
  const a = oldCode.split("\n");
  const c = newCode.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < c.length && a[prefix] === c[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < c.length - prefix &&
    a[a.length - 1 - suffix] === c[c.length - 1 - suffix]
  ) {
    suffix++;
  }
  const firstChanged = prefix + 1;
  const lastChanged = Math.max(a.length - suffix, firstChanged);
  if (firstChanged < allowedStart || lastChanged > allowedEnd) {
    throw new Error(
      `fidelity: ${what} disturbed lines ${firstChanged}-${lastChanged} outside the edited range ${allowedStart}-${allowedEnd}; edit rejected`,
    );
  }
}

function loc(node: unknown): { start: number; end: number } | null {
  const l = (node as { loc?: { start: { line: number }; end: { line: number } } }).loc;
  return l ? { start: l.start.line, end: l.end.line } : null;
}

export function applyEdit(code: string, edit: Edit): EditResult {
  const eol = code.includes("\r\n") ? "\r\n" : "\n";
  const q = detectQuote(code);
  const ast = parse(code);

  // Locate every element we may need by pre-edit index.
  const byIndex = new Map<number, { node: Record<string, unknown>; path: NodePathT }>();
  visitElements(ast, (path, index) => {
    byIndex.set(index, { node: path.node as unknown as Record<string, unknown>, path });
  });
  const locate = (index: number) => {
    const hit = byIndex.get(index);
    if (!hit) throw new Error(`No JSX element at index ${index}`);
    return hit;
  };

  /** After mutation: find the focus node's new preorder index. */
  const finish = (focusNode: unknown, allowed: { start: number; end: number } | null, what: string): EditResult => {
    const next = print(ast, eol, q);
    if (allowed) {
      assertLocalChange(code, next, Math.max(1, allowed.start - 1), allowed.end + 1, what);
    }
    let focusIndex: number | null = null;
    if (focusNode) {
      visitElements(ast, (path, index) => {
        if (path.node === focusNode) focusIndex = index;
      });
    }
    return { code: next, focusIndex };
  };

  if (edit.op === "set-style-prop") {
    const { node: el } = locate(edit.index);
    const range = loc(el);
    let attr = getAttr(el, "style");
    if (!attr) {
      if (edit.value == null) return { code, focusIndex: edit.index };
      attr = b.jsxAttribute(
        b.jsxIdentifier("style"),
        b.jsxExpressionContainer(b.objectExpression([])),
      );
      (el as { openingElement: { attributes: unknown[] } }).openingElement.attributes.push(attr);
    }
    const value = attr.value;
    if (!n.JSXExpressionContainer.check(value) || !n.ObjectExpression.check(value.expression)) {
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
    return finish(locate(edit.index).node, range, "style edit");
  }

  if (edit.op === "set-class-chunk") {
    const { node: el } = locate(edit.index);
    const attr = getAttr(el, "className");
    if (!attr) throw new Error("no className attribute");
    const literals = collectClassLiterals(attr);
    const lit = literals[edit.chunk];
    if (!lit) throw new Error(`no class chunk ${edit.chunk}`);
    lit.node.value = edit.value;
    return finish(el, loc(el), "class edit");
  }

  if (edit.op === "set-text") {
    const { node: el } = locate(edit.index);
    const children = (el.children ?? []) as unknown[];
    const child = children[edit.slot];
    if (!n.JSXText.check(child)) throw new Error(`child ${edit.slot} is not text`);
    (child as { value: string }).value = edit.value;
    return finish(el, loc(el), "text edit");
  }

  if (edit.op === "set-prop") {
    const { node: el } = locate(edit.index);
    const opening = (el as { openingElement: { attributes: unknown[] } }).openingElement;
    opening.attributes = opening.attributes ?? [];
    const existingIdx = opening.attributes.findIndex(
      (a) =>
        n.JSXAttribute.check(a) && n.JSXIdentifier.check(a.name) && a.name.name === edit.name,
    );
    if (edit.value.kind === "remove") {
      if (existingIdx >= 0) opening.attributes.splice(existingIdx, 1);
    } else {
      let valueNode: unknown;
      if (edit.value.kind === "string") valueNode = b.stringLiteral(edit.value.text ?? "");
      else if (edit.value.kind === "boolean-true") valueNode = null;
      else {
        const text = edit.value.text ?? "";
        const parsed = parse(`(${text});`) as { program: { body: unknown[] } };
        const stmt = parsed.program.body[0];
        if (!n.ExpressionStatement.check(stmt)) throw new Error("prop value is not an expression");
        valueNode = b.jsxExpressionContainer(stmt.expression as never);
      }
      const attr = b.jsxAttribute(b.jsxIdentifier(edit.name), valueNode as never);
      if (existingIdx >= 0) opening.attributes[existingIdx] = attr;
      else opening.attributes.push(attr);
    }
    return finish(el, loc(el), "prop edit");
  }

  if (edit.op === "set-class-string") {
    const { node: el } = locate(edit.index);
    const attr = getAttr(el, "className");
    if (attr && attr.value && !n.StringLiteral.check(attr.value) && !edit.force) {
      throw new Error("className is an expression — pass force to replace it");
    }
    if (attr) {
      (attr as { value: unknown }).value = b.stringLiteral(edit.value);
    } else {
      (el as { openingElement: { attributes: unknown[] } }).openingElement.attributes.push(
        b.jsxAttribute(b.jsxIdentifier("className"), b.stringLiteral(edit.value)),
      );
    }
    return finish(el, loc(el), "class edit");
  }

  if (edit.op === "insert-element") {
    const { node: parent } = locate(edit.parentIndex);
    const range = loc(parent);
    const element = parseSnippet(edit.jsx);
    const children = ((parent.children ?? []) as unknown[]);
    const pos = Math.max(0, Math.min(edit.childPos, children.length));
    children.splice(pos, 0, b.jsxText("\n"), element);
    parent.children = children;
    // Element edit first (guarded), then imports (guarded separately) — two
    // localized changes never share one diff span.
    const step1 = finish(element, range, "insert");
    if (edit.imports?.length) {
      const ast2 = parse(step1.code);
      if (ensureImports(ast2, edit.imports)) {
        const step2 = print(ast2, eol, q);
        const body = (ast2 as { program: { body: unknown[] } }).program.body;
        let lastImportLine = 1;
        for (const s of body) {
          if (n.ImportDeclaration.check(s)) {
            const l = loc(s);
            if (l) lastImportLine = Math.max(lastImportLine, l.end);
          }
        }
        assertLocalChange(step1.code, step2, 1, lastImportLine + 2, "import insert");
        return { code: step2, focusIndex: step1.focusIndex };
      }
    }
    return step1;
  }

  if (edit.op === "delete-element") {
    const { node: el, path } = locate(edit.index);
    const parentNode = path.parent?.node as Record<string, unknown> | undefined;
    if (!parentNode || !n.JSXElement.check(parentNode)) {
      throw new Error("only elements directly inside a parent element can be deleted");
    }
    const range = loc(parentNode);
    detachChild((parentNode.children ?? []) as unknown[], el);
    return finish(parentNode, range, "delete");
  }

  if (edit.op === "duplicate-element") {
    const { node: el, path } = locate(edit.index);
    const parentNode = path.parent?.node as Record<string, unknown> | undefined;
    if (!parentNode || !n.JSXElement.check(parentNode)) {
      throw new Error("only elements directly inside a parent element can be duplicated");
    }
    const range = loc(parentNode);
    const copy = parseSnippet(print(el, eol, q));
    const children = (parentNode.children ?? []) as unknown[];
    const i = children.indexOf(el);
    children.splice(i + 1, 0, b.jsxText("\n"), copy);
    return finish(copy, range, "duplicate");
  }

  if (edit.op === "move-element") {
    const { node: el, path } = locate(edit.index);
    const { node: newParent, path: newParentPath } = locate(edit.newParentIndex);
    const oldParentNode = path.parent?.node as Record<string, unknown> | undefined;
    if (!oldParentNode || !n.JSXElement.check(oldParentNode)) {
      throw new Error("only elements directly inside a parent element can be moved");
    }
    // The destination must not live inside the moved node.
    let p: NodePathT | null = newParentPath;
    while (p) {
      if ((p.node as unknown) === (el as unknown)) throw new Error("cannot move an element into itself");
      p = p.parent;
    }
    const oldRange = loc(oldParentNode);
    const newRange = loc(newParent);
    const oldChildren = (oldParentNode.children ?? []) as unknown[];
    const wasBefore =
      oldParentNode === newParent ? oldChildren.indexOf(el) : -1;
    detachChild(oldChildren, el);
    const destChildren = ((newParent.children ?? []) as unknown[]);
    let pos = Math.max(0, Math.min(edit.childPos, destChildren.length));
    if (wasBefore >= 0 && wasBefore < pos) pos = Math.max(0, pos - 2); // account for removed node + its whitespace
    destChildren.splice(pos, 0, b.jsxText("\n"), el);
    newParent.children = destChildren;
    const allowed =
      oldRange && newRange
        ? { start: Math.min(oldRange.start, newRange.start), end: Math.max(oldRange.end, newRange.end) }
        : null;
    return finish(el, allowed, "move");
  }

  throw new Error("unknown edit op");
}
