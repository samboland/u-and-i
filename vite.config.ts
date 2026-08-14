import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { uaiApi, uaiTagger } from "./server/api.ts";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(repoRoot, "web"),
  publicDir: false,
  plugins: [uaiTagger(repoRoot), react(), tailwindcss(), uaiApi(repoRoot)],
  resolve: {
    alias: {
      "next/link": path.join(repoRoot, "fixtures", "stubs", "next-link.tsx"),
      "@": path.join(repoRoot, "fixtures", "demo-project", "src"),
    },
  },
  server: {
    port: 4400,
    fs: { allow: [repoRoot] },
  },
});
