/**
 * Live click → source position. The probe hands us a *compiled* stack-frame
 * position (React 19's `fiber._debugStack` owner stack); this module runs it
 * back through Turbopack's source maps to a real file + line + column inside
 * the target app.
 *
 * Two shapes of compiled URL, verified against a running `next dev`:
 *  - Client chunks: `http(s)://…/_next/static/chunks/src_*.js` — the map is
 *    served next to the chunk (`<chunk>.map`), fetched from the target's own
 *    dev server (the URL's origin is our mirror; only the path matters).
 *  - Server components: `about://React/Server/<percent-encoded absolute
 *    path>?N` — a Windows-backslashed path into the target's
 *    `.next/dev/server/chunks/ssr/`, with a `?N` cache-buster. The map is on
 *    disk next to the chunk.
 *
 * Both are indexed maps (`sections`) whose sources are percent-encoded
 * `file:///` URLs; source-map-js handles the sections, `fileURLToPath` the
 * decoding. Resolution is server-side on purpose: Node reads `.next/dev/**`
 * off disk and fetches maps without CORS in the way.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer } from "source-map-js";

const SERVER_PREFIX = "about://React/Server/";

/** Consumers are cheap to cache and chunks are content-named; mtime guards
 * the on-disk ones against Turbopack rewriting a name in place. */
const cache = new Map<string, { consumer: SourceMapConsumer; mtimeMs: number | null }>();

function consumerFor(key: string, load: () => string, mtimeMs: number | null): SourceMapConsumer {
  const hit = cache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return hit.consumer;
  const consumer = new SourceMapConsumer(JSON.parse(load()));
  if (cache.size > 64) cache.clear();
  cache.set(key, { consumer, mtimeMs });
  return consumer;
}

export interface SourcePosition {
  /** Target-relative file, forward slashes. */
  file: string;
  /** 1-based. */
  line: number;
  /** 0-based (babel convention). */
  column: number;
}

/**
 * @param root      target app root (absolute)
 * @param upstream  the target's own dev server, e.g. http://localhost:3000
 * @param url       compiled URL from the stack frame
 * @param line      1-based, from the stack frame
 * @param column    1-based, from the stack frame (V8 convention)
 */
export async function resolveLivePosition(
  root: string,
  upstream: string,
  url: string,
  line: number,
  column: number,
): Promise<SourcePosition | null> {
  let consumer: SourceMapConsumer;
  if (url.startsWith(SERVER_PREFIX)) {
    let encoded = url.slice(SERVER_PREFIX.length);
    const q = encoded.lastIndexOf("?");
    if (q >= 0) encoded = encoded.slice(0, q);
    const chunk = path.resolve(decodeURIComponent(encoded));
    // Only ever read maps out of the target's own build output.
    if (!chunk.startsWith(path.resolve(root, ".next") + path.sep)) return null;
    const mapFile = chunk + ".map";
    if (!fs.existsSync(mapFile)) return null;
    const mtimeMs = fs.statSync(mapFile).mtimeMs;
    consumer = consumerFor(mapFile, () => fs.readFileSync(mapFile, "utf8"), mtimeMs);
  } else {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return null;
    }
    if (!pathname.startsWith("/_next/")) return null;
    const mapUrl = `${upstream}${pathname}.map`;
    const cached = cache.get(mapUrl);
    if (cached) {
      consumer = cached.consumer;
    } else {
      const res = await fetch(mapUrl);
      if (!res.ok) return null;
      const text = await res.text();
      consumer = consumerFor(mapUrl, () => text, null);
    }
  }

  // Stack columns are 1-based, source-map generated columns 0-based. The
  // frame is a call site so it should sit on a mapping; LEAST_UPPER_BOUND is
  // the fallback for a position just before one.
  let pos = consumer.originalPositionFor({ line, column: Math.max(0, column - 1) });
  if (pos.source == null) {
    pos = consumer.originalPositionFor({
      line,
      column: Math.max(0, column - 1),
      bias: SourceMapConsumer.LEAST_UPPER_BOUND,
    });
  }
  if (pos.source == null || pos.line == null) return null;
  if (!pos.source.startsWith("file://")) return null;

  let abs: string;
  try {
    abs = fileURLToPath(pos.source);
  } catch {
    return null;
  }
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep).includes("node_modules")) {
    return null;
  }
  return { file: rel.split(path.sep).join("/"), line: pos.line, column: pos.column ?? 0 };
}
