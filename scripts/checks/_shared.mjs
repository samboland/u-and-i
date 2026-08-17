/**
 * Shared bits for the check scripts. u-and-i has no test framework and no
 * Playwright dependency of its own: we borrow the target app's copy, and we
 * resolve the target the same way the server does, so nothing here is tied
 * to one machine.
 *
 * Every check assumes a u-and-i dev server on 4400 (`npx vite`). Checks that
 * exercise live mode also need the TARGET's own `npm run dev`.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export function targetRoot() {
  let target = process.env.UAI_TARGET;
  if (!target) {
    target = JSON.parse(fs.readFileSync(path.join(repoRoot, "uai.config.json"), "utf8")).target;
  }
  const root = path.resolve(repoRoot, target);
  if (!fs.existsSync(path.join(root, "package.json"))) {
    throw new Error(`target app not found at ${root}`);
  }
  return root;
}

/** Playwright, borrowed from the target app (u-and-i doesn't depend on it). */
export function playwright() {
  return createRequire(path.join(targetRoot(), "package.json"))("playwright");
}

export const readTarget = (rel) => fs.readFileSync(path.join(targetRoot(), rel.replaceAll("/", path.sep)), "utf8");

/** Per-FILE cleanliness — the target repo always has unrelated WIP in it. */
export const isDirty = (rel) =>
  execFileSync("git", ["status", "--porcelain", "--", rel], { cwd: targetRoot(), encoding: "utf8" }).trim();

export function reporter() {
  const fails = [];
  return {
    check(ok, what) {
      console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
      if (!ok) fails.push(what);
    },
    done() {
      console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nall checks passed");
      process.exit(fails.length ? 1 : 0);
    },
  };
}

/**
 * Click an element inside the live frame by dispatching at its content
 * coordinates. Playwright's own click math is blind to the CSS `zoom` that
 * scales the live iframe, so its screen-coordinate clicks land off-target;
 * a click dispatched inside the child rides the same capture handler real
 * input does. `text` narrows the match; only visible elements count.
 * Returns whether something was hit.
 */
export function clickInFrame(frame, selector, text) {
  return frame.evaluate(
    ([sel, txt]) => {
      const el = [...document.querySelectorAll(sel)].find((e) => {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        return !txt || (e.textContent ?? "").includes(txt);
      });
      if (!el) return false;
      const r = el.getBoundingClientRect();
      document.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
      return true;
    },
    [selector, text ?? null],
  );
}

/** Where the live mirror is listening, straight from the running server. */
export async function liveOrigin() {
  const r = await fetch("http://localhost:4400/api/project").then((x) => x.json());
  return r.live?.origin ?? null;
}
