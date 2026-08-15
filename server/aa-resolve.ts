/**
 * Importer-aware resolver. Vite's resolve.alias is global and runs before
 * every plugin, so "@/…" and "next/link" cannot live there — the demo
 * fixture and the adventure-alerts checkout both use those specifiers and
 * need different answers. This plugin routes by who is importing:
 *
 *   importer inside adventure-alerts  → AA's own src, canvas shims for
 *     next/* + next-auth + server-only, throwing stubs for @/auth + @/db
 *   any other importer                → the demo fixture's src and its
 *     original next/link stub (legacy behavior, unchanged)
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export function uaiResolver(repoRoot: string, aaRoot: string | null): Plugin {
  const shims = path.join(repoRoot, "web", "src", "harness", "next-shims");
  const shim = (f: string) => path.join(shims, f);
  const fixtureSrc = path.join(repoRoot, "fixtures", "demo-project", "src");
  const fixtureLink = path.join(repoRoot, "fixtures", "stubs", "next-link.tsx");
  const aaMarker = aaRoot ? `/${path.basename(aaRoot)}/` : null;

  const aaExact: Record<string, string> = {
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
      const imp = importer ? importer.split("?")[0].replaceAll("\\", "/") : "";
      const fromAA = !!aaMarker && (imp.includes(aaMarker) || imp.startsWith(aaRoot!.replaceAll("\\", "/")));

      if (fromAA) {
        if (aaExact[source]) return aaExact[source];
        if (source === "@/auth" || source.startsWith("@/auth/")) return shim("server-stub.ts");
        if (source === "@/db" || source.startsWith("@/db/")) return shim("server-stub.ts");
        if (source.startsWith("@/")) return withExt(path.join(aaRoot!, "src", source.slice(2)));
        return null;
      }

      // Legacy demo-fixture mappings (previously global resolve.alias).
      if (source === "next/link") return fixtureLink;
      if (source.startsWith("@/")) return withExt(path.join(fixtureSrc, source.slice(2)));
      return null;
    },
  };
}
