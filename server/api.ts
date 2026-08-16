/**
 * Vite plugins:
 *  - uaiTagger: injects data-uai ids into the target app's component files
 *    served to the harness (transform only — never touches disk).
 *  - uaiApi: the daemon API. Reads/parses/writes the target app's real
 *    files on disk. There is no save format and no bundled demo: every
 *    write is an AST edit (or byte-verbatim restore) against the one
 *    configured Next.js app.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { analyzeFile, applyEdit, buildModel, nodeAtPosition, tagTransform, type Edit } from "./ast.ts";
import { resolveLivePosition } from "./live-resolve.ts";
import { parseTokens, writeToken } from "./tokens.ts";
import { extractProps } from "./props.ts";
import { getProject, targetRootPath, type UaiProject } from "./projects.ts";
import { scanRoutes } from "./routes.ts";
import { analyzeShell } from "./shell.ts";
import { getLivePort, liveProxyOptions } from "./live-proxy.ts";

/** data-uai ids and request keys share this prefix + project-relative path. */
export const APP_PREFIX = "app:";

function toRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function listFiles(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, ext, out);
    else if (ext.test(entry.name)) out.push(full);
  }
  return out;
}

/** Files that must never load in the canvas: server-only imports. */
function isServerOnly(code: string): boolean {
  return /import\s+["']server-only["']|from\s+["']next\/headers["']|from\s+["']@\/(db|auth)/.test(
    code,
  );
}

export function uaiTagger(repoRoot: string): Plugin {
  const root = targetRootPath(repoRoot);
  const componentsDir = root
    ? path.join(root, "src", "components").replaceAll("\\", "/")
    : null;
  const appDir = root ? path.join(root, "src", "app").replaceAll("\\", "/") : null;
  return {
    name: "uai-tagger",
    enforce: "pre",
    transform(code, id) {
      if (!root) return null;
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.endsWith(".tsx")) return null;
      if (!(componentsDir && file.startsWith(componentsDir)) && !(appDir && file.startsWith(appDir))) {
        return null;
      }
      const rel = APP_PREFIX + toRel(root, file);
      try {
        return { code: tagTransform(code, rel), map: null };
      } catch (err) {
        this.warn(`uai-tagger failed for ${rel}: ${err}`);
        return null;
      }
    },
  };
}

async function readBody(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** The canvas design-system CSS is target-dependent (Tailwind @source needs
 * literal paths), so it's generated at boot into a gitignored real file. */
function writeTargetCanvasCss(repoRoot: string): void {
  const out = path.join(repoRoot, "web", "src", "harness", "target-canvas.css");
  const root = targetRootPath(repoRoot);
  let content = "/* GENERATED at dev-server boot from uai.config.json — do not edit. */\n";
  if (root) {
    const fsRoot = root.replaceAll("\\", "/");
    const globals = ["src/app/globals.css", "app/globals.css", "src/styles/globals.css"]
      .map((p) => `${fsRoot}/${p}`)
      .find((p) => fs.existsSync(p));
    if (globals) content += `@import "${globals}";\n`;
    content += `@source "${fsRoot}/src/components";\n@source "${fsRoot}/src/app";\n`;
    if (path.basename(root) === "adventure-alerts") {
      // Stand-in for this app's next/font/local wiring.
      content += `@import "./aa/aa-fonts.css";\n`;
    }
  }
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== content) {
    fs.writeFileSync(out, content, "utf8");
  }
}

export function uaiApi(repoRoot: string): Plugin {
  /** Resolve a request-supplied project-relative path inside the target. */
  const abs = (project: UaiProject, rel: string) => {
    const full = path.resolve(project.root, rel);
    if (!full.startsWith(path.resolve(project.root))) {
      throw new Error("path escapes the target app");
    }
    return full;
  };

  /** Resolve an import specifier to a project-relative file, or null. */
  const importResolver = (project: UaiProject, fromRel: string) => (spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) {
      base = path.join(project.root, project.srcDir, spec.slice(2));
    } else if (spec.startsWith(".")) {
      base = path.resolve(path.dirname(abs(project, fromRel)), spec);
    } else {
      return null;
    }
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      const candidate = base + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const rel = toRel(project.root, candidate);
        return rel.startsWith("..") ? null : rel;
      }
    }
    return null;
  };

  const MIME: Record<string, string> = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
  };

  return {
    name: "uai-api",
    config() {
      writeTargetCanvasCss(repoRoot);
    },
    configureServer(server: ViteDevServer) {
      // The target app references public/ assets by absolute URL; serve that
      // dir so the canvas isn't full of broken images. Real editor paths
      // never exist in public/, so this can't shadow them.
      const root = targetRootPath(repoRoot);
      if (root) {
        const publicDir = path.resolve(root, "public");
        server.middlewares.use((req, res, next) => {
          const pathname = decodeURIComponent(
            new URL(req.url ?? "/", "http://localhost").pathname,
          );
          if (pathname.startsWith("/api/") || pathname === "/") return next();
          const file = path.resolve(publicDir, pathname.slice(1));
          if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return next();
          }
          res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
          fs.createReadStream(file).pipe(res);
        });
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };

        try {
          const project = getProject(repoRoot);

          if (url.pathname === "/api/project" && req.method === "GET") {
            // `live` is where the canvas can reach the target's own running
            // dev server through our mirror (see server/live-proxy.ts).
            const livePort = getLivePort();
            return json(200, {
              project,
              live: livePort
                ? { origin: `http://localhost:${livePort}`, upstream: liveProxyOptions(repoRoot).upstream }
                : null,
            });
          }

          if (url.pathname === "/api/routes" && req.method === "GET") {
            return json(200, { tree: scanRoutes(project) });
          }

          if (url.pathname === "/api/page-shell" && req.method === "GET") {
            const rel = url.searchParams.get("file")!;
            const code = fs.readFileSync(abs(project, rel), "utf8");
            const shell = analyzeShell(code, importResolver(project, rel));
            // Thin shells hide their nature one hop down (terms → policy-view
            // → markdown content); scan the resolved view too.
            if (shell.viewFile && !shell.contentNote) {
              try {
                const viewCode = fs.readFileSync(abs(project, shell.viewFile), "utf8");
                if (/content\/legal|renderMarkdown/.test(viewCode)) {
                  shell.contentNote =
                    "This page renders versioned Markdown content — its copy isn't JSX-editable.";
                }
              } catch {
                /* view unreadable — leave as-is */
              }
            }
            return json(200, shell);
          }

          if (url.pathname === "/api/components" && req.method === "GET") {
            const dir = path.join(project.root, project.srcDir, "components");
            const files = listFiles(dir, /\.tsx$/)
              .filter((f) => !/\.test\.tsx$/.test(f))
              .map((f) => toRel(project.root, f));
            const meta: Record<string, { serverOnly: boolean; exportName?: string }> = {};
            for (const rel of files) {
              try {
                const code = fs.readFileSync(abs(project, rel), "utf8");
                const exportName = code.match(
                  /export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+([A-Z]\w+)/,
                )?.[1];
                meta[rel] = { serverOnly: isServerOnly(code), exportName };
              } catch {
                meta[rel] = { serverOnly: true };
              }
            }
            return json(200, { files, meta });
          }

          if (url.pathname === "/api/component" && req.method === "GET") {
            const rel = url.searchParams.get("file")!;
            const full = abs(project, rel);
            const code = fs.readFileSync(full, "utf8");
            const analysis = analyzeFile(code);
            return json(200, {
              model: buildModel(code, APP_PREFIX + rel, { resolveImport: importResolver(project, rel) }),
              props: extractProps(project.root, full, { tsconfig: true }),
              // Async components (server pages) can't run in a browser canvas;
              // they get assisted (no-live-preview) editing instead.
              renderable: !isServerOnly(code) && !analysis.defaultAsync,
            });
          }

          if (url.pathname === "/api/live-resolve" && req.method === "POST") {
            // A live-canvas click: compiled stack-frame position → source
            // file → JSX node id. Misses are ok:false, not errors — clicks
            // on framework-owned DOM have nowhere to land.
            const { url: frameUrl, line, column } = (await readBody(req)) as {
              url: string;
              line: number;
              column: number;
            };
            const pos = await resolveLivePosition(
              project.root,
              liveProxyOptions(repoRoot).upstream,
              frameUrl,
              line,
              column,
            );
            if (!pos) return json(200, { ok: false });
            const code = fs.readFileSync(abs(project, pos.file), "utf8");
            const index = nodeAtPosition(code, pos.line, pos.column);
            return json(200, {
              ok: true,
              file: pos.file,
              line: pos.line,
              column: pos.column,
              id: index != null ? `${APP_PREFIX}${pos.file}::${index}` : null,
            });
          }

          if (url.pathname === "/api/edit" && req.method === "POST") {
            const { file, edit, expectTag } = (await readBody(req)) as {
              file: string;
              edit: Edit;
              expectTag?: string;
            };
            const full = abs(project, file);
            const before = fs.readFileSync(full, "utf8");
            const modelKey = APP_PREFIX + file;
            if (expectTag) {
              // Cheap staleness check: the editor's model must still match disk.
              const model = buildModel(before, modelKey);
              const idx =
                "index" in edit ? edit.index : "parentIndex" in edit ? edit.parentIndex : -1;
              const flat: { index: number; tag: string }[] = [];
              const walk = (nodes: typeof model) =>
                nodes.forEach((m) => {
                  flat.push({ index: m.index, tag: m.tag });
                  walk(m.children);
                });
              walk(model);
              const hit = flat.find((f) => f.index === idx);
              if (!hit || hit.tag !== expectTag) {
                return json(409, { error: "stale model — the file changed; refetch" });
              }
            }
            const result = applyEdit(before, edit);
            fs.writeFileSync(full, result.code, "utf8");
            return json(200, {
              ok: true,
              model: buildModel(result.code, modelKey, { resolveImport: importResolver(project, file) }),
              focusId: result.focusIndex != null ? `${modelKey}::${result.focusIndex}` : null,
              before,
              after: result.code,
            });
          }

          if (url.pathname === "/api/restore" && req.method === "POST") {
            // Byte-verbatim write for undo/redo: `before`/`after` from edit
            // responses restore exactly, no AST round-trip.
            const { file, text } = (await readBody(req)) as { file: string; text: string };
            fs.writeFileSync(abs(project, file), text, "utf8");
            return json(200, { ok: true });
          }

          if (url.pathname === "/api/tokens" && req.method === "GET") {
            const dir = path.join(project.root, project.srcDir);
            const files = listFiles(dir, /\.css$/).map((f) => toRel(project.root, f));
            const tokens = files.map((rel) => ({
              file: rel,
              decls: parseTokens(fs.readFileSync(abs(project, rel), "utf8")),
            }));
            return json(200, { tokens });
          }

          if (url.pathname === "/api/token" && req.method === "POST") {
            const { file, decl, value } = await readBody(req);
            const full = abs(project, file);
            const css = fs.readFileSync(full, "utf8");
            const next = writeToken(css, decl, value);
            fs.writeFileSync(full, next, "utf8");
            return json(200, { ok: true });
          }

          if (url.pathname === "/api/material" && req.method === "POST") {
            // Workshop output: maintain a marked block at the end of the
            // app's global stylesheet holding --material-* tokens. Lines for
            // the same material name are replaced; others are preserved.
            const { name, lines } = (await readBody(req)) as {
              name: string;
              lines: string[];
            };
            if (!/^[\w-]+$/.test(name)) throw new Error("bad material name");
            const globalsRel = ["src/app/globals.css", "app/globals.css", "src/styles/globals.css"]
              .find((p) => fs.existsSync(abs(project, p)));
            if (!globalsRel) throw new Error("no globals.css found in the target app");
            const themePath = abs(project, globalsRel);
            const css = fs.readFileSync(themePath, "utf8");
            const START = "/* @uai-materials — written by the u-and-i Workshop */";
            const END = "/* @uai-materials-end */";
            let existing: string[] = [];
            let base = css;
            const si = css.indexOf(START);
            if (si >= 0) {
              const ei = css.indexOf(END);
              const block = css.slice(si, ei);
              existing = block
                .split("\n")
                .filter((l) => l.trim().startsWith("--"))
                .filter((l) => !l.trim().startsWith(`--material-${name}-`));
              base = css.slice(0, si).trimEnd() + "\n" + css.slice(ei + END.length).trimStart();
            }
            const decls = [...existing, ...lines.map((l) => `  ${l.trim()}`)];
            const block = `${START}\n:root {\n${decls.join("\n")}\n}\n${END}\n`;
            fs.writeFileSync(themePath, base.trimEnd() + "\n\n" + block, "utf8");
            return json(200, { ok: true });
          }

          return json(404, { error: "unknown endpoint" });
        } catch (err) {
          return json(500, { error: String(err) });
        }
      });
    },
  };
}
