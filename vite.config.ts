import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { uaiApi, uaiTagger } from "./server/api.ts";
import { aaResolver } from "./server/aa-resolve.ts";
import { aaRootPath } from "./server/projects.ts";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const aaRoot = aaRootPath(repoRoot);

export default defineConfig({
  root: path.join(repoRoot, "web"),
  publicDir: false,
  plugins: [
    ...(aaRoot ? [aaResolver(repoRoot, aaRoot)] : []),
    uaiTagger(repoRoot),
    react(),
    tailwindcss(),
    uaiApi(repoRoot),
  ],
  resolve: {
    // Two React copies (ours + adventure-alerts') would break hooks.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      "next/link": path.join(repoRoot, "fixtures", "stubs", "next-link.tsx"),
      "@": path.join(repoRoot, "fixtures", "demo-project", "src"),
      // u-and-i doesn't depend on react-query; the AA canvas providers use
      // adventure-alerts' own copy so components share one instance.
      ...(aaRoot && fs.existsSync(path.join(aaRoot, "node_modules", "@tanstack", "react-query"))
        ? { "@tanstack/react-query": path.join(aaRoot, "node_modules", "@tanstack", "react-query") }
        : {}),
    },
  },
  server: {
    port: 4400,
    fs: { allow: aaRoot ? [repoRoot, aaRoot] : [repoRoot] },
  },
});
