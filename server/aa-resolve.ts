/**
 * Importer-aware resolver: when a module inside the adventure-alerts
 * checkout imports something, remap its Next-specific and server-only
 * imports to the canvas shims and its "@/…" alias to its own src tree.
 * Modules outside AA are untouched, so the fixture's own "@" alias and
 * next/link stub keep working exactly as before.
 */
import path from "node:path";
import type { Plugin } from "vite";

export function aaResolver(repoRoot: string, aaRoot: string): Plugin {
  const shims = path.join(repoRoot, "web", "src", "harness", "next-shims");
  const shim = (f: string) => path.join(shims, f);
  const aaFs = aaRoot.replaceAll("\\", "/");

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

  return {
    name: "uai-aa-resolver",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer) return null;
      const imp = importer.split("?")[0].replaceAll("\\", "/");
      if (!imp.startsWith(aaFs)) return null;

      if (exact[source]) return exact[source];
      if (source === "@/auth" || source.startsWith("@/auth/")) return shim("server-stub.ts");
      if (source === "@/db" || source.startsWith("@/db/")) return shim("server-stub.ts");
      if (source.startsWith("@/")) {
        const target = path.join(aaRoot, "src", source.slice(2));
        const resolved = await this.resolve(target, importer, { skipSelf: true });
        return resolved?.id ?? null;
      }
      return null;
    },
  };
}
