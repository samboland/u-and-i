/**
 * The u-and-i daemon (Vite + AST engine), run as a Node child process via
 * ELECTRON_RUN_AS_NODE. Kept out of the Electron main process on purpose:
 * Node sets SEM_FAILCRITICALERRORS so the harmless failed-DLL probes inside
 * vite's import chain stay silent, while a GUI process lets Windows play the
 * system error sound for them. It also keeps a server crash from taking the
 * window down.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { createServer } = await import("vite");
const server = await createServer({
  configFile: path.join(repoRoot, "vite.config.ts"),
});
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === "object" && address ? address.port : 4400;
// The parent waits for this exact marker to learn the port.
console.log(`UAI_PORT ${port}`);

const shutdown = () => void server.close().finally(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// If the Electron parent dies without killing us, follow it down.
process.on("disconnect", shutdown);
