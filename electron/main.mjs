/**
 * Electron shell: runs the u-and-i daemon (Vite + AST engine) inside the main
 * process and opens the editor in a native window. The entire web codebase is
 * unchanged — this is the VS Code recipe: Node kernel + Chromium shell.
 */
import { app, BrowserWindow, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** @type {import("vite").ViteDevServer | undefined} */
let viteServer;

// Every failure-shaped event, timestamped — for chasing environment-specific
// launch problems (e.g. the mystery error sound on some starts).
const t0 = Date.now();
const diag = (name, detail) =>
  console.warn(`[diag +${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}${detail ? ` ${detail}` : ""}`);
app.on("child-process-gone", (_e, d) => diag("child-process-gone", JSON.stringify(d)));
app.on("render-process-gone", (_e, _wc, d) => diag("render-process-gone", JSON.stringify(d)));
process.on("uncaughtException", (err) => diag("uncaughtException", String(err?.stack ?? err)));
process.on("unhandledRejection", (err) => diag("unhandledRejection", String(err)));

async function start() {
  // Bisect mode for the launch error-sound hunt: UAI_BARE=1 skips vite
  // entirely and opens a static window, so a ding here means Chromium's own
  // process startup; silence means the Node/vite side.
  if (process.env.UAI_BARE) {
    Menu.setApplicationMenu(null);
    const win = new BrowserWindow({ width: 600, height: 300, title: "u-and-i bare", backgroundColor: "#16181d" });
    await win.loadURL(
      "data:text/html,<body style='background:%2316181d;color:%23e8eaee;font-family:sans-serif'><h2>bare mode — no vite</h2></body>",
    );
    return;
  }
  const { createServer } = await import("vite");
  viteServer = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
  });
  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : 4400;

  // The editor draws its own menu bar — the native one would duplicate it.
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: "u-and-i",
    backgroundColor: "#16181d",
    autoHideMenuBar: true,
  });
  win.on("page-title-updated", (e) => e.preventDefault());
  // Keep the accelerators the native menu used to provide.
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") win.webContents.toggleDevTools();
    else if (input.control && input.shift && input.key.toLowerCase() === "r") {
      win.webContents.reloadIgnoringCache();
    }
  });
  // Self-heal: if the renderer fails to load (vite restarting underneath us,
  // a mid-reload hiccup), retry instead of sitting on a blank window.
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    console.warn(`load failed (${code} ${desc}) — retrying in 1s`);
    setTimeout(() => {
      if (!win.isDestroyed()) void win.loadURL(`http://localhost:${port}/`);
    }, 1000);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.warn(`renderer gone (${details.reason}) — reloading`);
    if (!win.isDestroyed()) void win.loadURL(`http://localhost:${port}/`);
  });
  await win.loadURL(`http://localhost:${port}/`);
}

app.whenReady().then(start);

app.on("window-all-closed", () => app.quit());

app.on("will-quit", (e) => {
  if (viteServer) {
    e.preventDefault();
    const server = viteServer;
    viteServer = undefined;
    void server.close().finally(() => app.quit());
  }
});
