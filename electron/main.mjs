/**
 * Electron shell: spawns the u-and-i daemon (Vite + AST engine) as a Node
 * child process and opens the editor in a native window. The server runs
 * outside the GUI process (see electron/server.mjs for why — Windows plays
 * the system error sound for failed DLL probes in GUI processes), and a
 * server crash can't take the window down.
 */
import { app, BrowserWindow, Menu } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** @type {import("node:child_process").ChildProcess | undefined} */
let serverProc;

// Every failure-shaped event, timestamped — for chasing environment-specific
// launch problems.
const t0 = Date.now();
const diag = (name, detail) =>
  console.warn(`[diag +${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}${detail ? ` ${detail}` : ""}`);
app.on("child-process-gone", (_e, d) => diag("child-process-gone", JSON.stringify(d)));
app.on("render-process-gone", (_e, _wc, d) => diag("render-process-gone", JSON.stringify(d)));
process.on("uncaughtException", (err) => diag("uncaughtException", String(err?.stack ?? err)));
process.on("unhandledRejection", (err) => diag("unhandledRejection", String(err)));

/** Start server.mjs under Electron-as-Node; resolves with the port. */
function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [path.join(repoRoot, "electron", "server.mjs")], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let buf = "";
    let ready = false;
    serverProc.stdout.on("data", (chunk) => {
      const text = String(chunk);
      if (!ready) {
        buf += text;
        const m = buf.match(/^UAI_PORT (\d+)$/m);
        if (m) {
          ready = true;
          resolve(Number(m[1]));
        }
      }
      process.stdout.write(text);
    });
    serverProc.on("exit", (code) => {
      diag("server exited", `code ${code}`);
      serverProc = undefined;
      if (!ready) reject(new Error(`server exited before ready (code ${code})`));
    });
  });
}

async function start() {
  const port = await startServer();

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

app.on("will-quit", () => {
  serverProc?.kill();
});
