/**
 * Vite plugins:
 *  - uaiTagger: injects data-uai ids into fixture component files served to
 *    the harness (transform only — never touches disk).
 *  - uaiApi: the daemon API. Reads/parses/writes the real files on disk.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { applyEdit, buildModel, tagTransform, type Edit } from "./ast.ts";
import { parseTokens, writeToken } from "./tokens.ts";
import { extractProps } from "./props.ts";
import { listPages, loadPage, savePage, type PageDoc } from "./pages.ts";

const FIXTURE_ROOT = "fixtures/demo-project";

function toRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function listFiles(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, ext, out);
    else if (ext.test(entry.name)) out.push(full);
  }
  return out;
}

export function uaiTagger(repoRoot: string): Plugin {
  const fixtureComponents = path.join(repoRoot, FIXTURE_ROOT, "src", "components");
  return {
    name: "uai-tagger",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      const componentsDir = fixtureComponents.replaceAll("\\", "/");
      if (!file.startsWith(componentsDir) || !file.endsWith(".tsx")) return null;
      const rel = toRel(repoRoot, file.split("?")[0]);
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
  const abs = (rel: string) => {
    const full = path.resolve(repoRoot, rel);
    if (!full.startsWith(path.resolve(repoRoot, FIXTURE_ROOT))) {
      throw new Error("path escapes fixture root");
    }
    return full;
  };

  return {
    name: "uai-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };

        try {
          if (url.pathname === "/api/components" && req.method === "GET") {
            const dir = path.join(repoRoot, FIXTURE_ROOT, "src", "components");
            const files = listFiles(dir, /\.tsx$/)
              .filter((f) => !/\.test\.tsx$/.test(f))
              .map((f) => toRel(repoRoot, f));
            return json(200, { files });
          }

          if (url.pathname === "/api/component" && req.method === "GET") {
            const rel = url.searchParams.get("file")!;
            const full = abs(rel);
            const code = fs.readFileSync(full, "utf8");
            return json(200, {
              model: buildModel(code, rel),
              props: extractProps(repoRoot, full),
            });
          }

          if (url.pathname === "/api/edit" && req.method === "POST") {
            const { file, edit } = (await readBody(req)) as {
              file: string;
              edit: Edit;
            };
            const full = abs(file);
            const code = fs.readFileSync(full, "utf8");
            const next = applyEdit(code, edit);
            fs.writeFileSync(full, next, "utf8");
            return json(200, { ok: true, model: buildModel(next, file) });
          }

          if (url.pathname === "/api/tokens" && req.method === "GET") {
            const dir = path.join(repoRoot, FIXTURE_ROOT);
            const files = listFiles(dir, /\.css$/).map((f) => toRel(repoRoot, f));
            const tokens = files.map((rel) => ({
              file: rel,
              decls: parseTokens(fs.readFileSync(abs(rel), "utf8")),
            }));
            return json(200, { tokens });
          }

          if (url.pathname === "/api/material" && req.method === "POST") {
            // Workshop output: maintain a marked block at the end of theme.css
            // holding --material-* tokens. Lines for the same material name are
            // replaced; other materials are preserved.
            const { name, lines } = (await readBody(req)) as {
              name: string;
              lines: string[];
            };
            if (!/^[\w-]+$/.test(name)) throw new Error("bad material name");
            const themePath = abs("fixtures/demo-project/src/theme.css");
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
            const { file, decl, value } = await readBody(req);
            const full = abs(file);
            const css = fs.readFileSync(full, "utf8");
            const next = writeToken(css, decl, value);
            fs.writeFileSync(full, next, "utf8");
            return json(200, { ok: true });
          }

          const fixtureRoot = path.join(repoRoot, FIXTURE_ROOT);

          if (url.pathname === "/api/pages" && req.method === "GET") {
            return json(200, { pages: listPages(fixtureRoot) });
          }

          if (url.pathname === "/api/page" && req.method === "GET") {
            const name = url.searchParams.get("name")!;
            if (!/^[\w-]+$/.test(name)) throw new Error("bad page name");
            const doc = loadPage(fixtureRoot, name);
            // Refresh the generated module so it always matches the current
            // codegen version, not the one that last saved it.
            savePage(fixtureRoot, doc);
            return json(200, { doc });
          }

          if (url.pathname === "/api/page" && req.method === "POST") {
            const { doc } = (await readBody(req)) as { doc: PageDoc };
            savePage(fixtureRoot, doc);
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
