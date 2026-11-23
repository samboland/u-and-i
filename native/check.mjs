import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { repoRoot, targetRoot } from "../scripts/checks/_shared.mjs";

const target = path.join(repoRoot, "native", "target");
fs.mkdirSync(target, { recursive: true });
const fixture = fs.mkdtempSync(path.join(target, "test-project-"));
function write(file, value) {
  const destination = path.join(fixture, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}
write("package.json", '{"name":"native-test","private":true}');
write("tsconfig.json", '{"compilerOptions":{"jsx":"preserve"}}');
write("src/app/page.tsx", "export default function Home(){return <main>Home</main>}\n");
write("src/components/ui/card.tsx", "export function Card() {\n  return (\n    <div>\n      <span>Original</span>\n    </div>\n  );\n}\n");
write("src/app/globals.css", ":root { --background: #f5eadd; --source-community: #ff1414; }\n");
fs.symlinkSync(path.join(targetRoot(), "node_modules"), path.join(fixture, "node_modules"), "junction");

const cssPath = path.join(repoRoot, "web/src/harness/target-canvas.css");
const previousCss = fs.existsSync(cssPath) ? fs.readFileSync(cssPath) : null;
const env = { ...process.env, UAI_TARGET: fixture, UAI_NATIVE_FIXTURE: fixture,
  UAI_LIVE_PORT: "0", UAI_NATIVE_SETTINGS: path.join(fixture, "settings.json") };
const daemon = spawn(process.execPath, ["electron/server.mjs"], {
  cwd: repoRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "inherit"],
});
const daemonExit = once(daemon, "exit");
try {
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Project daemon timed out")), 30000);
    daemon.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/UAI_PORT (\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    daemonExit.then(() => { clearTimeout(timer); reject(new Error("Project daemon exited")); }, reject);
  });
  const test = spawn("cargo", ["test", "--manifest-path", "native/Cargo.toml", "--locked", "--", "--ignored"], {
    cwd: repoRoot, windowsHide: true, env: { ...env, UAI_EDITOR_ORIGIN: `http://localhost:${port}` }, stdio: "inherit",
  });
  process.exitCode = (await once(test, "exit"))[0] ?? 1;
} finally {
  daemon.kill();
  await daemonExit;
  const current = fs.existsSync(cssPath) && fs.readFileSync(cssPath, "utf8");
  if (current && current.includes(fixture.replaceAll("\\", "/"))) {
    if (previousCss) fs.writeFileSync(cssPath, previousCss);
    else fs.unlinkSync(cssPath);
  }
}
