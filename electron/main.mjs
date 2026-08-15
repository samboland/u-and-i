/**
 * Electron shell: runs the u-and-i daemon (Vite + AST engine) inside the main
 * process and opens the editor in a native window. The entire web codebase is
 * unchanged — this is the VS Code recipe: Node kernel + Chromium shell.
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** @type {import("vite").ViteDevServer | undefined} */
let viteServer;

async function start() {
  const { createServer } = await import("vite");
  viteServer = await createServer({
    configFile: path.join(repoRoot, "vite.config.ts"),
  });
  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : 4400;

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: "u-and-i",
    backgroundColor: "#16181d",
    autoHideMenuBar: false,
  });
  win.on("page-title-updated", (e) => e.preventDefault());
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
