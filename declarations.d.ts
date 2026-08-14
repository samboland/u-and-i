declare module "recast/parsers/babel-ts" {
  import type { Options } from "recast";
  export function parse(source: string, options?: unknown): unknown;
}
