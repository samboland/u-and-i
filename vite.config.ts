import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { uaiApi, uaiTagger } from "./server/api.ts";
import { uaiResolver } from "./server/aa-resolve.ts";
import { targetRootPath } from "./server/projects.ts";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = targetRootPath(repoRoot);

export default defineConfig({
  root: path.join(repoRoot, "web"),
  publicDir: false,
  plugins: [
    uaiResolver(repoRoot, targetRoot),
    uaiTagger(repoRoot),
    react(),
    tailwindcss(),
    uaiApi(repoRoot),
  ],
  resolve: {
    // Two React copies (ours + the target's) would break hooks.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      // u-and-i doesn't depend on react-query; the canvas providers use the
      // target app's own copy so components share one instance.
      ...(targetRoot && fs.existsSync(path.join(targetRoot, "node_modules", "@tanstack", "react-query"))
        ? { "@tanstack/react-query": path.join(targetRoot, "node_modules", "@tanstack", "react-query") }
        : {}),
    },
  },
  server: {
    port: 4400,
    fs: { allow: targetRoot ? [repoRoot, targetRoot] : [repoRoot] },
  },
});
