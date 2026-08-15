/**
 * `npm run app` — boot the daemon (Vite) and open the editor in a chromeless
 * app-mode browser window, so u-and-i launches like a program instead of a
 * localhost tab.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("No Chrome/Edge found for app mode.");
  process.exit(1);
}

const vite = spawn("npx", ["vite"], {
  cwd: repoRoot,
  shell: true,
  stdio: ["ignore", "pipe", "inherit"],
});

let opened = false;
vite.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  // Vite colorizes the port with ANSI escapes — strip them before matching.
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  const m = plain.match(/http:\/\/localhost:(\d+)\//);
  if (m && !opened) {
    opened = true;
    const url = `http://localhost:${m[1]}/`;
    // Dedicated profile dir keeps the app window from merging with regular
    // browser sessions and gives it its own taskbar identity.
    const profile = path.join(repoRoot, "node_modules", ".uai-app-profile");
    spawn(
      browser,
      [`--app=${url}`, `--user-data-dir=${profile}`, "--window-size=1500,950"],
      { detached: true, stdio: "ignore" },
    ).unref();
    console.log(`\n  u-and-i app window opened (${path.basename(browser)})\n`);
  }
});

vite.on("exit", (code) => process.exit(code ?? 0));
