/**
 * Live proxy: mirrors the target app's own dev server (`next dev`) on a port
 * u-and-i controls, so the canvas can show the REAL running app — real data,
 * real layout chrome, server components included.
 *
 * Three jobs, and nothing else. It is a mirror, not a renderer:
 *  - forward every request/response verbatim, websockets included (HMR),
 *  - drop the headers that stop a page being framed (`X-Frame-Options`, and
 *    the per-request CSP the target sets in src/proxy.ts — its nonce +
 *    strict-dynamic policy would also block the probe script below),
 *  - inject one <script> into HTML responses: the probe that maps a clicked
 *    element back to source.
 *
 * The target app is never modified. It doesn't know we exist.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Plugin } from "vite";

/** Headers that would stop us framing or instrumenting the page. */
const STRIP = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  // We ask upstream for identity encoding so HTML can be edited; never echo a
  // content-encoding that no longer describes the body.
  "content-encoding",
  "content-length",
  // Hop-by-hop framing: Node re-frames the response itself, and forwarding
  // chunked alongside our recomputed content-length is invalid HTTP that
  // strict clients reject.
  "transfer-encoding",
]);

const PROBE_PATH = "/__uai/probe.js";
const PROBE_TAG = `<script src="${PROBE_PATH}"></script>`;

export interface LiveProxyOptions {
  /** The target app's own dev server. */
  upstream: string;
  /** Port this mirror listens on. */
  port: number;
}

export function liveProxyOptions(repoRoot: string): LiveProxyOptions {
  let upstream = process.env.UAI_DEV_URL ?? "";
  let port = Number(process.env.UAI_LIVE_PORT ?? 0);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, "uai.config.json"), "utf8"));
    upstream = upstream || (cfg.devUrl as string | undefined) || "";
    port = port || Number(cfg.livePort ?? 0);
  } catch {
    /* config is optional */
  }
  return { upstream: upstream || "http://localhost:3000", port: port || 4410 };
}

/** The port the mirror actually bound (it walks up if one is taken), so the
 * API can tell the editor where the live canvas lives. */
let livePort: number | null = null;
export const getLivePort = (): number | null => livePort;
const setLivePort = (p: number) => {
  livePort = p;
};

/** The "your app isn't running" page — shown in the canvas instead of a
 * browser connection error, because the fix is a command, not a bug.
 * It gets the probe like any other page — without it the iframe swallows
 * ctrl+wheel and middle-drag, so zoom and pan die the moment the cursor
 * crosses this card. `__uaiStatic` tells the probe there is nothing to
 * select here (no overlay, text stays copyable), only gestures to relay. */
function offlinePage(upstream: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>app not running</title><script>window.__uaiStatic=true</script>${PROBE_TAG}</head>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#16181d;color:#c8cdd6;font:14px/1.6 system-ui">
  <div style="max-width:34rem;padding:1.5rem;border:1px solid #2b2f39;border-radius:10px">
    <p style="margin:0 0 .6rem;font-weight:600;color:#e6e9ef">The app isn't running.</p>
    <p style="margin:0 0 .6rem">u-and-i mirrors your own dev server at <code>${upstream}</code>. Start it in the target folder:</p>
    <pre style="margin:0 0 .6rem;padding:.6rem .8rem;background:#101216;border-radius:6px;color:#9ecbff">npm run dev</pre>
    <p style="margin:0;color:#7d8494;font-size:12px">${detail}</p>
  </div>
</body></html>`;
}

export function uaiLiveProxy(repoRoot: string): Plugin {
  const { upstream, port } = liveProxyOptions(repoRoot);
  const target = new URL(upstream);
  const probeFile = path.join(repoRoot, "web", "src", "harness", "live-probe.js");

  /** Upstream request options for an incoming request. */
  const forwardOptions = (req: http.IncomingMessage): http.RequestOptions => {
    const headers: Record<string, string | string[]> = { ...req.headers } as never;
    headers.host = target.host;
    // Identity so HTML arrives editable; upstream must not gzip under us.
    headers["accept-encoding"] = "identity";
    delete headers["if-none-match"]; // 304s would skip probe injection
    delete headers["if-modified-since"];
    return {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    };
  };

  const server = http.createServer((req, res) => {
    if (req.url?.split("?")[0] === PROBE_PATH) {
      let body = "";
      try {
        body = fs.readFileSync(probeFile, "utf8");
      } catch (err) {
        body = `console.error("u-and-i probe missing: ${String(err)}")`;
      }
      res.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }

    const upReq = http.request(forwardOptions(req), (upRes) => {
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (!STRIP.has(k.toLowerCase()) && v !== undefined) headers[k] = v;
      }
      const type = String(upRes.headers["content-type"] ?? "");
      // Only HTML is buffered — that's where the probe tag goes. Everything
      // else (RSC payloads, assets, streams) is piped through untouched.
      if (!type.includes("text/html")) {
        res.writeHead(upRes.statusCode ?? 200, headers);
        upRes.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      upRes.on("data", (c: Buffer) => chunks.push(c));
      upRes.on("end", () => {
        let html = Buffer.concat(chunks).toString("utf8");
        if (!html.includes(PROBE_TAG)) {
          html = html.includes("</head>")
            ? html.replace("</head>", `${PROBE_TAG}</head>`)
            : PROBE_TAG + html;
        }
        const body = Buffer.from(html, "utf8");
        headers["content-length"] = String(body.byteLength);
        res.writeHead(upRes.statusCode ?? 200, headers);
        res.end(body);
      });
    });
    upReq.on("error", (err) => {
      const body = offlinePage(upstream, String(err));
      res.writeHead(503, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body) });
      res.end(body);
    });
    req.pipe(upReq);
  });

  // Websockets: the target's HMR channel. Without this every edit needs a
  // manual reload, which would make the canvas feel dead.
  server.on("upgrade", (req, socket: net.Socket, head) => {
    const upReq = http.request(forwardOptions(req));
    upReq.end();
    upReq.on("upgrade", (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 101 ${upRes.statusMessage ?? "Switching Protocols"}`];
      for (const [k, v] of Object.entries(upRes.headers)) {
        for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) lines.push(`${k}: ${one}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upHead?.length) socket.unshift(upHead);
      if (head?.length) upSocket.unshift(head);
      upSocket.pipe(socket).pipe(upSocket);
    });
    upReq.on("error", () => socket.destroy());
    socket.on("error", () => upReq.destroy());
  });

  return {
    name: "uai-live-proxy",
    configureServer(vite) {
      // Other dev servers squat on nearby ports; walk up rather than die.
      let attempt = 0;
      const listen = () => server.listen(port + attempt);
      server.on("listening", () => {
        const chosen = (server.address() as net.AddressInfo).port;
        setLivePort(chosen);
        vite.config.logger.info(`  ➜  live app:  http://localhost:${chosen}/  (mirrors ${upstream})`);
      });
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempt < 9) {
          attempt += 1;
          listen();
          return;
        }
        vite.config.logger.warn(`uai live proxy failed on :${port + attempt} — ${String(err)}`);
      });
      listen();
      vite.httpServer?.on("close", () => server.close());
    },
  };
}
