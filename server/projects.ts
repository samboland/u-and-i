/**
 * Target resolution: u-and-i serves exactly one Next.js app at a time — the
 * folder named by UAI_TARGET or uai.config.json's "target" (relative paths
 * resolve against the u-and-i repo root). There is no bundled demo and no
 * save format: the target's real code is the document, and git in the
 * target repo is the safety net.
 */
import fs from "node:fs";
import path from "node:path";

export interface UaiProject {
  id: "app";
  label: string;
  /** Absolute root the path sandbox resolves against. */
  root: string;
  srcDir: string;
}

export function targetRootPath(repoRoot: string): string | null {
  let target = process.env.UAI_TARGET;
  if (!target) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, "uai.config.json"), "utf8"));
      target = cfg.target;
    } catch {
      /* no config */
    }
  }
  if (!target) return null;
  const root = path.resolve(repoRoot, target);
  return fs.existsSync(path.join(root, "package.json")) ? root : null;
}

export function getProject(repoRoot: string): UaiProject {
  const root = targetRootPath(repoRoot);
  if (!root) {
    throw new Error(
      "no target app — set UAI_TARGET or uai.config.json { target } to a Next.js app folder",
    );
  }
  const srcDir = fs.existsSync(path.join(root, "src", "app")) ? "src" : ".";
  return { id: "app", label: path.basename(root), root, srcDir };
}
