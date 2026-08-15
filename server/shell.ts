/**
 * Follow-the-shell analysis: most Next pages are thin server shells whose
 * real UI lives in a view component (page.tsx → home-view.tsx). Find that
 * view so the editor can jump straight to the editable file. Also detects
 * Markdown-content pages (legal), which are not JSX-editable at all.
 */
import * as recast from "recast";
import { importMap, parse } from "./ast.ts";

const n = recast.types.namedTypes;

export interface ShellInfo {
  /** The page's primary view component file (resolved), when identifiable. */
  viewFile: string | null;
  viewTag: string | null;
  /** Human note when the page's content isn't JSX (e.g. legal Markdown). */
  contentNote: string | null;
}

export function analyzeShell(
  code: string,
  resolveImport: (spec: string) => string | null,
): ShellInfo {
  const ast = parse(code);
  const imports = importMap(ast);

  let contentNote: string | null = null;
  for (const spec of new Set(imports.values())) {
    if (/content\/legal|\/content\//.test(spec)) {
      contentNote = "This page renders versioned Markdown content — its copy isn't JSX-editable.";
    }
  }

  // Find the default-exported function (direct or by identifier).
  const body = (ast as { program: { body: unknown[] } }).program.body;
  const fns = new Map<string, unknown>();
  for (const stmt of body) {
    if (n.FunctionDeclaration.check(stmt) && stmt.id) fns.set((stmt.id as { name: string }).name, stmt);
  }
  let pageFn: unknown = null;
  for (const stmt of body) {
    if (!n.ExportDefaultDeclaration.check(stmt)) continue;
    const decl = stmt.declaration as unknown as Record<string, unknown>;
    if (n.FunctionDeclaration.check(decl) || n.ArrowFunctionExpression.check(decl)) pageFn = decl;
    else if (n.Identifier.check(decl)) pageFn = fns.get((decl as { name: string }).name) ?? null;
  }
  if (!pageFn) return { viewFile: null, viewTag: null, contentNote };

  // The first returned JSX root; if it's an html wrapper with exactly one
  // capitalized element child, descend one level.
  let root: Record<string, unknown> | null = null;
  recast.types.visit(pageFn as recast.types.ASTNode, {
    visitReturnStatement(path) {
      if (root) return false;
      recast.types.visit(path.node as recast.types.ASTNode, {
        visitJSXElement(inner) {
          if (!root) root = inner.node as unknown as Record<string, unknown>;
          return false;
        },
      });
      return false;
    },
  });
  if (!root) return { viewFile: null, viewTag: null, contentNote };

  const tagOf = (el: Record<string, unknown>): string => {
    const nm = (el.openingElement as { name: unknown }).name as Record<string, unknown>;
    return n.JSXIdentifier.check(nm) ? ((nm as { name: string }).name as string) : "";
  };
  let candidate: Record<string, unknown> | null = /^[A-Z]/.test(tagOf(root)) ? root : null;
  if (!candidate) {
    const kids = ((root as { children?: unknown[] }).children ?? []).filter((c) => n.JSXElement.check(c));
    const capKids = kids.filter((c) => /^[A-Z]/.test(tagOf(c as unknown as Record<string, unknown>)));
    if (capKids.length === 1) candidate = capKids[0] as unknown as Record<string, unknown>;
  }
  if (!candidate) return { viewFile: null, viewTag: null, contentNote };

  const tag = tagOf(candidate);
  const spec = imports.get(tag);
  const viewFile = spec ? resolveImport(spec) : null;
  return { viewFile, viewTag: viewFile ? tag : null, contentNote };
}
