/**
 * CSS custom-property (design token) parsing and surgical write-back.
 *
 * Tokens are located by byte offset so a rename-free value edit touches only
 * the value text — comments, formatting, and duplicate declarations (e.g. the
 * same token in light and dark blocks) are all preserved.
 */

export interface TokenDecl {
  name: string;
  value: string;
  /** Offset of the value text within the file. */
  valueStart: number;
  valueEnd: number;
  line: number;
}

const DECL_RE = /(--[\w-]+)\s*:\s*([^;{}]+);/g;

export function parseTokens(css: string): TokenDecl[] {
  const out: TokenDecl[] = [];
  for (const m of css.matchAll(DECL_RE)) {
    const [, name, rawValue] = m;
    const value = rawValue.trim();
    const valueStart = m.index + m[0].indexOf(rawValue) + (rawValue.length - rawValue.trimStart().length);
    out.push({
      name,
      value,
      valueStart,
      valueEnd: valueStart + value.length,
      line: css.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** Replace one declaration's value, verifying the file hasn't shifted underneath us. */
export function writeToken(
  css: string,
  decl: { valueStart: number; valueEnd: number; oldValue: string },
  newValue: string,
): string {
  const current = css.slice(decl.valueStart, decl.valueEnd);
  if (current !== decl.oldValue) {
    throw new Error("stale token offsets — file changed since parse; re-fetch tokens");
  }
  return css.slice(0, decl.valueStart) + newValue + css.slice(decl.valueEnd);
}
