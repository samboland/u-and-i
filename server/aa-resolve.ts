/**
 * Importer-aware resolver for the target app: when a module inside the
 * target Next.js checkout imports something, remap its Next-specific and
 * server-only imports to the canvas shims and its "@/…" alias to its own
 * src tree. Modules outside the target (u-and-i's own code) are untouched.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export function uaiResolver(repoRoot: string, targetRoot: string | null): Plugin {
  const shims = path.join(repoRoot, "web", "src", "harness", "next-shims");
  const shim = (f: string) => path.join(shims, f);
  const targetFs = targetRoot?.replaceAll("\\", "/") ?? null;
  // Vite hands importers outside its root in several spellings: absolute,
  // /@fs/-prefixed, or relative. Match on the checkout's directory name so
  // all of them count.
  const marker = targetRoot ? `/${path.basename(targetRoot)}/` : null;

  const exact: Record<string, string> = {
    "next/link": shim("link.tsx"),
    "next/navigation": shim("navigation.ts"),
    "next/image": shim("image.tsx"),
    "next/headers": shim("headers.ts"),
    "next/font/local": shim("font-local.ts"),
    "next-auth/react": shim("next-auth-react.tsx"),
    "next-auth": shim("empty.ts"),
    "server-only": shim("empty.ts"),
  };

  /** Absolute-path extension inference (rollup resolve won't do it). */
  const withExt = (base: string): string | null => {
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts", ".css", ".json"]) {
      const candidate = base + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  };

  return {
    name: "uai-resolver",
    enforce: "pre",
    resolveId(source, importer) {
      if (!targetFs || !marker || !importer) return null;
      const imp = importer.split("?")[0].replaceAll("\\", "/");
      if (!imp.startsWith(targetFs) && !imp.includes(marker)) return null;

      if (exact[source]) return exact[source];
      if (source === "@/auth" || source.startsWith("@/auth/")) return shim("server-stub.ts");
      if (source === "@/db" || source.startsWith("@/db/")) return shim("server-stub.ts");
      if (source.startsWith("@/")) return withExt(path.join(targetRoot!, "src", source.slice(2)));
      return null;
    },
  };
}
