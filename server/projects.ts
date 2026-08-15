/**
 * Project registry: the targets u-and-i can read and edit.
 * "demo" is the bundled fixture sandbox. "aa" is the real adventure-alerts
 * Next.js repo — writable, but only through the AST edit/restore endpoints
 * (u-and-i has no save format: it edits the real code, and git in the
 * target repo is the safety net). It is omitted entirely when the sibling
 * checkout doesn't exist so the editor degrades gracefully.
 */
import fs from "node:fs";
import path from "node:path";

export interface UaiProject {
  id: string;
  label: string;
  /** Absolute root the path sandbox resolves against. */
  root: string;
  kind: "fixture" | "next";
  srcDir: string;
  writable: boolean;
}

export function getProjects(repoRoot: string): Record<string, UaiProject> {
  const projects: Record<string, UaiProject> = {
    demo: {
      id: "demo",
      label: "Demo project",
      root: path.join(repoRoot, "fixtures", "demo-project"),
      kind: "fixture",
      srcDir: "src",
      writable: true,
    },
  };
  const aaRoot = aaRootPath(repoRoot);
  if (aaRoot) {
    projects.aa = {
      id: "aa",
      label: "Adventure Alerts",
      root: aaRoot,
      kind: "next",
      srcDir: "src",
      writable: true,
    };
  }
  return projects;
}

/** The adventure-alerts checkout, or null when absent. */
export function aaRootPath(repoRoot: string): string | null {
  const root = process.env.UAI_AA_ROOT ?? path.resolve(repoRoot, "..", "adventure-alerts");
  return fs.existsSync(path.join(root, "package.json")) ? root : null;
}

export function getProject(repoRoot: string, id: string | null): UaiProject {
  const projects = getProjects(repoRoot);
  const project = projects[id ?? "demo"];
  if (!project) throw new Error(`unknown project "${id}"`);
  return project;
}
