/**
 * Vite plugins:
 *  - uaiTagger: injects data-uai ids into component files served to the
 *    harness (transform only — never touches disk). Covers the demo fixture
 *    and, when present, the adventure-alerts checkout.
 *  - uaiApi: the daemon API. Reads/parses/writes the real files on disk.
 *    Every endpoint is project-scoped (?project=demo|aa, default demo);
 *    write endpoints refuse non-writable projects — that is the hard line
 *    that keeps adventure-alerts read-only this iteration.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { analyzeFile, applyEdit, buildModel, tagTransform, type Edit } from "./ast.ts";
import { parseTokens, writeToken } from "./tokens.ts";
import { extractProps } from "./props.ts";
import { listPages, loadPage, savePage, type PageDoc } from "./pages.ts";
import { aaRootPath, getProject, getProjects, type UaiProject } from "./projects.ts";
import { scanRoutes } from "./routes.ts";

function toRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function listFiles(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
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
  // [components dir, id prefix] — the prefix makes harness selection ids
  // line up with the editor's project-prefixed file keys.
  const roots: { dir: string; base: string; prefix: string }[] = [
    {
      dir: path.join(repoRoot, "fixtures", "demo-project", "src", "components"),
      base: repoRoot,
      prefix: "",
    },
  ];
  const aaRoot = aaRootPath(repoRoot);
  if (aaRoot) {
    roots.push({
      dir: path.join(aaRoot, "src", "components"),
      base: aaRoot,
      prefix: "aa:",
    });
  }
  const normalized = roots.map((r) => ({ ...r, dirFs: r.dir.replaceAll("\\", "/") }));
  return {
    name: "uai-tagger",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.endsWith(".tsx")) return null;
      const root = normalized.find((r) => file.startsWith(r.dirFs));
      if (!root) return null;
      const rel = root.prefix + toRel(root.base, file);
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

export function uaiApi(repoRoot: string): Plugin {
  /** Resolve a request-supplied relative path inside the project sandbox.
   * Demo keeps its legacy repo-relative keys ("fixtures/demo-project/...");
   * other projects use project-relative keys ("src/components/..."). */
  const abs = (project: UaiProject, rel: string) => {
    const base = project.kind === "fixture" ? repoRoot : project.root;
    const full = path.resolve(base, rel);
    if (!full.startsWith(path.resolve(project.root))) {
      throw new Error("path escapes project root");
    }
    return full;
  };

  const assertWritable = (project: UaiProject) => {
    if (!project.writable) {
      throw new Error(`project "${project.id}" is read-only`);
    }
  };

  /** Resolve an import specifier to a request-key-compatible relative path,
   * or null when it points outside the project / at a package. */
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
        const relBase = project.kind === "fixture" ? repoRoot : project.root;
        const rel = toRel(relBase, candidate);
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
    configureServer(server: ViteDevServer) {
      // adventure-alerts components reference public/ assets by absolute URL
      // ("/brand/logo.svg"); serve that dir so the canvas isn't full of
      // broken images. Real editor paths never exist in public/, so this
      // can't shadow them.
      const aaRoot = aaRootPath(repoRoot);
      if (aaRoot) {
        const publicDir = path.resolve(aaRoot, "public");
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
          const project = getProject(repoRoot, url.searchParams.get("project"));

          if (url.pathname === "/api/projects" && req.method === "GET") {
            return json(200, { projects: Object.values(getProjects(repoRoot)) });
          }

          if (url.pathname === "/api/routes" && req.method === "GET") {
            return json(200, { tree: scanRoutes(project) });
          }

          if (url.pathname === "/api/components" && req.method === "GET") {
            const dir = path.join(project.root, project.srcDir, "components");
            const relBase = project.kind === "fixture" ? repoRoot : project.root;
            const files = listFiles(dir, /\.tsx$/)
              .filter((f) => !/\.test\.tsx$/.test(f))
              .map((f) => toRel(relBase, f));
            const meta: Record<string, { serverOnly: boolean }> = {};
            if (project.kind === "next") {
              for (const rel of files) {
                try {
                  meta[rel] = { serverOnly: isServerOnly(fs.readFileSync(abs(project, rel), "utf8")) };
                } catch {
                  meta[rel] = { serverOnly: true };
                }
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
              model: buildModel(code, rel, { resolveImport: importResolver(project, rel) }),
              props: extractProps(project.kind === "next" ? project.root : repoRoot, full, {
                tsconfig: project.kind === "next",
              }),
              // Async components (server pages) can't run in a browser canvas;
              // they get assisted (no-live-preview) editing instead.
              renderable: !isServerOnly(code) && !analysis.defaultAsync,
            });
          }

          if (url.pathname === "/api/edit" && req.method === "POST") {
            assertWritable(project);
            const { file, edit, expectTag } = (await readBody(req)) as {
              file: string;
              edit: Edit;
              expectTag?: string;
            };
            const full = abs(project, file);
            const before = fs.readFileSync(full, "utf8");
            if (expectTag) {
              // Cheap staleness check: the editor's model must still match disk.
              const model = buildModel(before, file);
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
              model: buildModel(result.code, file, { resolveImport: importResolver(project, file) }),
              focusId: result.focusIndex != null ? `${file}::${result.focusIndex}` : null,
              before,
              after: result.code,
            });
          }

          if (url.pathname === "/api/restore" && req.method === "POST") {
            // Byte-verbatim write for undo/redo: `before`/`after` from edit
            // responses restore exactly, no AST round-trip.
            assertWritable(project);
            const { file, text } = (await readBody(req)) as { file: string; text: string };
            fs.writeFileSync(abs(project, file), text, "utf8");
            return json(200, { ok: true });
          }

          if (url.pathname === "/api/tokens" && req.method === "GET") {
            const dir =
              project.kind === "fixture" ? project.root : path.join(project.root, project.srcDir);
            const relBase = project.kind === "fixture" ? repoRoot : project.root;
            const files = listFiles(dir, /\.css$/).map((f) => toRel(relBase, f));
            const tokens = files.map((rel) => ({
              file: rel,
              decls: parseTokens(fs.readFileSync(abs(project, rel), "utf8")),
            }));
            return json(200, { tokens });
          }

          if (url.pathname === "/api/material" && req.method === "POST") {
            assertWritable(project);
            if (project.kind !== "fixture") throw new Error("materials are a fixture-project feature");
            // Workshop output: maintain a marked block at the end of theme.css
            // holding --material-* tokens. Lines for the same material name are
            // replaced; other materials are preserved.
            const { name, lines } = (await readBody(req)) as {
              name: string;
              lines: string[];
            };
            if (!/^[\w-]+$/.test(name)) throw new Error("bad material name");
            const themePath = abs(project, "fixtures/demo-project/src/theme.css");
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

          if (url.pathname === "/api/token" && req.method === "POST") {
            assertWritable(project);
            if (project.kind !== "fixture") throw new Error("token writes are fixture-only for now");
            const { file, decl, value } = await readBody(req);
            const full = abs(project, file);
            const css = fs.readFileSync(full, "utf8");
            const next = writeToken(css, decl, value);
            fs.writeFileSync(full, next, "utf8");
            return json(200, { ok: true });
          }

          // Page documents are a fixture-project concept until the write-side
          // of the Next pivot lands (colocated page.uai.json per route).
          if (url.pathname === "/api/pages" && req.method === "GET") {
            if (project.kind !== "fixture") throw new Error("pages live per-route in Next projects");
            return json(200, { pages: listPages(project.root) });
          }

          if (url.pathname === "/api/page" && req.method === "GET") {
            if (project.kind !== "fixture") throw new Error("pages live per-route in Next projects");
            const name = url.searchParams.get("name")!;
            if (!/^[\w-]+$/.test(name)) throw new Error("bad page name");
            const doc = loadPage(project.root, name);
            // Refresh the generated module so it always matches the current
            // codegen version, not the one that last saved it.
            savePage(project.root, doc);
            return json(200, { doc });
          }

          if (url.pathname === "/api/page" && req.method === "POST") {
            assertWritable(project);
            if (project.kind !== "fixture") throw new Error("pages live per-route in Next projects");
            const { doc } = (await readBody(req)) as { doc: PageDoc };
            savePage(project.root, doc);
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
