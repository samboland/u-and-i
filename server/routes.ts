/**
 * Next.js app-router interpreter: walk <root>/<srcDir>/app and build the
 * route tree the editor's Outliner shows. Read-only — u-and-i's write-side
 * (colocated page.uai.json + "@uai-generated"-marked page.tsx) is a later
 * iteration, but ownership detection for that convention lives here already.
 */
import fs from "node:fs";
import path from "node:path";
import type { UaiProject } from "./projects.ts";

export interface RouteNode {
  /** Directory name verbatim: "(main)", "[alertId]", "alerts", "" at app root. */
  segment: string;
  /** URL with route groups stripped: "/beacon/[alertId]"; app root is "/". */
  urlPath: string;
  isGroup: boolean;
  isDynamic: boolean;
  files: {
    page?: string;
    layout?: string;
    loading?: string;
    error?: string;
    notFound?: string;
    route?: string;
  };
  /** layout.tsx files that wrap this node's page, root-first. */
  layoutChain: string[];
  /** "owned" = u-and-i manages this page; "coded" = hand-written; null = no page. */
  ownership: "coded" | "owned" | null;
  children: RouteNode[];
}

const FILE_KEYS: [keyof RouteNode["files"], RegExp][] = [
  ["page", /^page\.(tsx|jsx)$/],
  ["layout", /^layout\.(tsx|jsx)$/],
  ["loading", /^loading\.(tsx|jsx)$/],
  ["error", /^error\.(tsx|jsx)$/],
  ["notFound", /^not-found\.(tsx|jsx)$/],
  ["route", /^route\.(ts|tsx)$/],
];

const UAI_MARKER = "@uai-generated";

function toRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function detectOwnership(dir: string, pageFile: string): "coded" | "owned" {
  if (fs.existsSync(path.join(dir, "page.uai.json"))) return "owned";
  try {
    const fd = fs.openSync(pageFile, "r");
    const buf = Buffer.alloc(160);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (buf.toString("utf8", 0, n).includes(UAI_MARKER)) return "owned";
  } catch {
    /* unreadable → treat as coded */
  }
  return "coded";
}

function walk(
  projectRoot: string,
  dir: string,
  segment: string,
  parentUrl: string,
  parentLayouts: string[],
): RouteNode {
  const isGroup = /^\(.+\)$/.test(segment);
  const urlPath =
    segment === "" || isGroup
      ? parentUrl
      : parentUrl === "/"
        ? `/${segment}`
        : `${parentUrl}/${segment}`;

  const files: RouteNode["files"] = {};
  const childDirs: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith("_") && entry.name !== "node_modules") childDirs.push(entry.name);
      continue;
    }
    for (const [key, re] of FILE_KEYS) {
      if (re.test(entry.name)) files[key] = toRel(projectRoot, path.join(dir, entry.name));
    }
  }

  const layoutChain = files.layout ? [...parentLayouts, files.layout] : parentLayouts;
  const children = childDirs
    .map((name) => walk(projectRoot, path.join(dir, name), name, urlPath, layoutChain))
    .sort((a, b) => {
      if (a.isDynamic !== b.isDynamic) return a.isDynamic ? 1 : -1;
      return a.segment.localeCompare(b.segment);
    });

  return {
    segment,
    urlPath: urlPath === "" ? "/" : urlPath,
    isGroup,
    isDynamic: /\[.+\]/.test(segment),
    files,
    layoutChain,
    ownership: files.page
      ? detectOwnership(dir, path.join(projectRoot, files.page))
      : null,
    children,
  };
}

export function scanRoutes(project: UaiProject): RouteNode {
  const appDir = path.join(project.root, project.srcDir, "app");
  if (!fs.existsSync(appDir)) throw new Error(`no app directory at ${appDir}`);
  return walk(project.root, appDir, "", "/", []);
}
