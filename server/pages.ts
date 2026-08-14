/**
 * Builder-owned page documents + deterministic React codegen.
 *
 * A page lives as JSON under <fixture>/pages/<name>.json. Saving regenerates
 * <fixture>/src/pages-gen/<name>.tsx — clean, readable JSX that the harness
 * imports and renders directly. What the canvas shows IS the generated code.
 *
 * Every section/column/block carries data-uai-block="<id>" plus
 * data-uai-kind, so the canvas can map DOM interactions (click, drag, inline
 * edit) back to document nodes without any parsing.
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

export interface PageDoc {
  name: string;
  title: string;
  sections: Section[];
}

export type Align = "start" | "center" | "end" | "stretch";

export interface Section {
  id: string;
  /** Visual treatment straight from the fixture design system. */
  background: "none" | "card" | "well";
  padding: string;
  gap: string;
  /** Vertical alignment of columns within the row. */
  alignColumns?: Align;
  columns: Column[];
}

export interface Column {
  id: string;
  /** flex-grow weight; "1" is an equal column. */
  flex: string;
  gap: string;
  /** Horizontal alignment of blocks in the column (default stretch). */
  alignBlocks?: Align;
  blocks: Block[];
}

interface BlockCommon {
  id: string;
  /** CSS margin shorthand, e.g. "0 0 1rem 0". */
  margin?: string;
  /** align-self override within the column. */
  align?: Align;
}

export type Block =
  | (BlockCommon & {
      type: "heading";
      level: 1 | 2 | 3;
      text: string;
      textAlign?: "left" | "center" | "right";
    })
  | (BlockCommon & {
      type: "text";
      text: string;
      textAlign?: "left" | "center" | "right";
    })
  | (BlockCommon & { type: "button"; label: string })
  | (BlockCommon & { type: "image"; src: string; alt: string; width: string })
  | (BlockCommon & { type: "spacer"; height: string })
  | (BlockCommon & {
      type: "component";
      file: string;
      exportName: string;
      props: Record<string, unknown>;
    });

// ---------------------------------------------------------------------------
// Codegen
// ---------------------------------------------------------------------------

const IND = "  ";

function jsxText(text: string): string {
  return /^[^{}<>&"']*$/.test(text) ? text : `{${JSON.stringify(text)}}`;
}

/** Render a style object literal from [property, value] pairs. */
function styleAttr(entries: [string, string | number][]): string {
  const parts = entries
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`);
  return parts.length ? ` style={{ ${parts.join(", ")} }}` : "";
}

/** JSON is valid JS — pretty-print prop objects as object literals. */
function propsLiteral(props: Record<string, unknown>, indent: string): string {
  const json = JSON.stringify(props, null, 2);
  return json.split("\n").join(`\n${indent}`);
}

function componentImportPath(file: string): string {
  const marker = "/src/";
  const i = file.indexOf(marker);
  return "../" + file.slice(i + marker.length).replace(/\.tsx?$/, "");
}

const SECTION_BG: Record<Section["background"], string> = {
  none: "",
  card: "ui-card",
  well: "ui-iconwell--recess",
};

function commonStyle(b: Block): [string, string][] {
  const out: [string, string][] = [];
  if (b.margin) out.push(["margin", b.margin]);
  if (b.align) out.push(["alignSelf", ALIGN_CSS[b.align]]);
  return out;
}

function genBlock(block: Block, d: string): string {
  const tag = `data-uai-block="${block.id}" data-uai-kind="block"`;
  const common = commonStyle(block);
  switch (block.type) {
    case "heading": {
      const h = `h${block.level}`;
      const style = styleAttr([
        ["margin", block.margin ?? "0"],
        ...(block.textAlign ? ([["textAlign", block.textAlign]] as [string, string][]) : []),
        ...common.filter(([k]) => k !== "margin"),
      ]);
      return `${d}<${h} ${tag}${style}>${jsxText(block.text)}</${h}>`;
    }
    case "text": {
      const style = styleAttr([
        ["margin", block.margin ?? "0"],
        ...(block.textAlign ? ([["textAlign", block.textAlign]] as [string, string][]) : []),
        ...common.filter(([k]) => k !== "margin"),
      ]);
      return `${d}<p ${tag}${style}>${jsxText(block.text)}</p>`;
    }
    case "button": {
      const style = styleAttr([
        ["padding", "0.5rem 1.25rem"],
        ["cursor", "pointer"],
        ["font", "inherit"],
        ["border", "none"],
        ...common,
      ]);
      return `${d}<button ${tag} type="button" className="ui-card"${style}>${jsxText(block.label)}</button>`;
    }
    case "image": {
      const style = styleAttr([
        ["width", block.width],
        ["maxWidth", "100%"],
        ...common,
      ]);
      return `${d}<img ${tag} src=${JSON.stringify(block.src)} alt=${JSON.stringify(block.alt)}${style} />`;
    }
    case "spacer": {
      const style = styleAttr([["height", block.height], ...common]);
      return `${d}<div ${tag}${style} />`;
    }
    case "component":
      throw new Error("component blocks are emitted inline by generatePage");
  }
}

const ALIGN_CSS: Record<Align, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

export function generatePage(doc: PageDoc): string {
  const imports = new Map<string, string>();
  for (const s of doc.sections)
    for (const c of s.columns)
      for (const blk of c.blocks)
        if (blk.type === "component")
          imports.set(blk.exportName, componentImportPath(blk.file));

  const lines: string[] = [];
  lines.push("// Generated by u-and-i — edit in the visual builder.");
  lines.push(`// Source document: pages/${doc.name}.json`);
  for (const [name, from] of imports)
    lines.push(`import { ${name} } from "${from}";`);
  if (imports.size) lines.push("");
  lines.push(`export default function Page() {`);
  lines.push(`${IND}return (`);
  lines.push(
    `${IND.repeat(2)}<main style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>`,
  );

  for (const s of doc.sections) {
    const cls = SECTION_BG[s.background];
    const clsAttr = cls ? ` className="${cls}"` : "";
    const d3 = IND.repeat(3);
    lines.push(
      `${d3}<section data-uai-block="${s.id}" data-uai-kind="section"${clsAttr}${styleAttr([["padding", s.padding]])}>`,
    );
    lines.push(
      `${d3}${IND}<div${styleAttr([
        ["display", "flex"],
        ["gap", s.gap],
        ["alignItems", ALIGN_CSS[s.alignColumns ?? "start"]],
      ])}>`,
    );
    for (const c of s.columns) {
      const d5 = IND.repeat(5);
      lines.push(
        `${d5}<div data-uai-block="${c.id}" data-uai-kind="column"${styleAttr([
          ["flex", c.flex],
          ["display", "flex"],
          ["flexDirection", "column"],
          ["gap", c.gap],
          ["alignItems", ALIGN_CSS[c.alignBlocks ?? "stretch"]],
          ["minWidth", 0],
        ])}>`,
      );
      for (const blk of c.blocks) {
        if (blk.type === "component") {
          const d6 = IND.repeat(6);
          lines.push(
            `${d6}<div data-uai-block="${blk.id}" data-uai-kind="block"${styleAttr(commonStyle(blk))}>`,
          );
          lines.push(
            `${d6}${IND}<${blk.exportName} {...${propsLiteral(blk.props, d6 + IND)}} />`,
          );
          lines.push(`${d6}</div>`);
        } else {
          lines.push(genBlock(blk, IND.repeat(6)));
        }
      }
      lines.push(`${d5}</div>`);
    }
    lines.push(`${d3}${IND}</div>`);
    lines.push(`${d3}</section>`);
  }

  lines.push(`${IND.repeat(2)}</main>`);
  lines.push(`${IND});`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function pagesDir(fixtureRoot: string): string {
  return path.join(fixtureRoot, "pages");
}

export function genDir(fixtureRoot: string): string {
  return path.join(fixtureRoot, "src", "pages-gen");
}

export function listPages(fixtureRoot: string): string[] {
  const dir = pagesDir(fixtureRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadPage(fixtureRoot: string, name: string): PageDoc {
  const file = path.join(pagesDir(fixtureRoot), `${name}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as PageDoc;
}

/** Write only when content differs — unchanged writes still bump mtime and
 * trigger a pointless HMR reload of the canvas. */
function writeIfChanged(file: string, content: string): void {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
  fs.writeFileSync(file, content, "utf8");
}

/** Save the document and regenerate its page module. */
export function savePage(fixtureRoot: string, doc: PageDoc): void {
  if (!/^[\w-]+$/.test(doc.name)) throw new Error("bad page name");
  fs.mkdirSync(pagesDir(fixtureRoot), { recursive: true });
  fs.mkdirSync(genDir(fixtureRoot), { recursive: true });
  writeIfChanged(
    path.join(pagesDir(fixtureRoot), `${doc.name}.json`),
    JSON.stringify(doc, null, 2) + "\n",
  );
  writeIfChanged(path.join(genDir(fixtureRoot), `${doc.name}.tsx`), generatePage(doc));
}
