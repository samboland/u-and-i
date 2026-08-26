/**
 * Next.js app-router tree for the Outliner's Project mode. Editor-side mirror
 * of server/routes.ts RouteNode — read-only this iteration: selecting a route
 * shows its facts in Properties and a placeholder on the canvas.
 */
import { useState } from "react";
import { C } from "./chrome";
import { OutlinerRow } from "./OutlinerRow";

export interface RouteNode {
  segment: string;
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
  layoutChain: string[];
  ownership: "coded" | "owned" | null;
  children: RouteNode[];
}

/** Stable identity for expansion/selection (urlPath collides across groups). */
export function routeId(node: RouteNode): string {
  return node.files.page ?? node.files.route ?? `${node.urlPath}#${node.segment}`;
}

function isApiOnly(node: RouteNode): boolean {
  return !!node.files.route && !node.files.page;
}

function Rows({
  node,
  depth,
  expanded,
  toggle,
  selectedId,
  onSelect,
}: {
  node: RouteNode;
  depth: number;
  expanded: Set<string>;
  toggle: (node: RouteNode, recursive: boolean) => void;
  selectedId: string | null;
  onSelect: (node: RouteNode) => void;
}) {
  const id = routeId(node);
  const open = expanded.has(id);
  const hasChildren = node.children.length > 0;
  const label =
    node.segment === "" ? "app" : node.isDynamic ? node.segment : node.segment;
  const badges: string[] = [];
  if (isApiOnly(node)) badges.push("API");
  if (node.files.layout) badges.push("layout");
  if (node.ownership === "owned") badges.push("owned");
  return (
    <>
      <OutlinerRow
        pad={10 + depth * 13}
        glyph={node.isGroup ? "folder_open" : node.isDynamic ? "data_array" : node.files.page ? "description" : isApiOnly(node) ? "api" : "folder"}
        glyphColor={node.files.page ? C.blueLight : node.isGroup ? C.faint : C.muted}
        label={label}
        dim={node.isGroup || (!node.files.page && !isApiOnly(node))}
        selected={selectedId === id}
        mark={node.ownership === "owned" ? C.orange : C.blue}
        caret={hasChildren ? (open ? "open" : "closed") : undefined}
        guideXs={Array.from({ length: depth }, (_, j) => 16 + j * 13)}
        right={badges.join(" · ") || undefined}
        onToggle={(recursive) => toggle(node, recursive)}
        onClick={() => {
          if (node.files.page || isApiOnly(node)) onSelect(node);
          else if (hasChildren) toggle(node, false);
        }}
      />
      {open &&
        node.children.map((c) => (
          <Rows
            key={routeId(c)}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

export function RouteTree({
  tree,
  selectedId,
  onSelect,
}: {
  tree: RouteNode;
  selectedId: string | null;
  onSelect: (node: RouteNode) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([routeId(tree)]));
  /** Shift-click (recursive) opens or closes the whole subtree, Blender's
   *  triangle behavior. */
  const toggle = (node: RouteNode, recursive: boolean) =>
    setExpanded((s) => {
      const next = new Set(s);
      const opening = !next.has(routeId(node));
      const ids: string[] = [];
      const collect = (n: RouteNode) => {
        ids.push(routeId(n));
        if (recursive) n.children.forEach(collect);
      };
      collect(node);
      for (const i of ids) {
        if (opening) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  return (
    <Rows
      node={tree}
      depth={0}
      expanded={expanded}
      toggle={toggle}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
}
