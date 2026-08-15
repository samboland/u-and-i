/**
 * Prop-control extraction: find the `*Props` interface in a component file and
 * derive editor controls from member types via ts-morph.
 */
import path from "node:path";
import { Project, SyntaxKind, type InterfaceDeclaration } from "ts-morph";

export interface PropSpec {
  name: string;
  typeText: string;
  optional: boolean;
  control:
    | { kind: "string" }
    | { kind: "number" }
    | { kind: "boolean" }
    | { kind: "select"; options: string[] }
    | { kind: "json" };
}

const projectCache = new Map<string, Project>();

function getProject(root: string, useTsconfig: boolean): Project {
  const key = `${root}:${useTsconfig}`;
  let p = projectCache.get(key);
  if (!p) {
    // Wiring the target repo's tsconfig gives ts-morph its "@/*" path
    // mapping — without it, prop extraction in a Next repo can't resolve
    // imported types.
    p = useTsconfig
      ? new Project({
          tsConfigFilePath: path.join(root, "tsconfig.json"),
          skipAddingFilesFromTsConfig: true,
        })
      : new Project({
          useInMemoryFileSystem: false,
          compilerOptions: { allowJs: false, strict: true },
          skipAddingFilesFromTsConfig: true,
        });
    projectCache.set(key, p);
  }
  return p;
}

function controlFor(typeText: string): PropSpec["control"] {
  const t = typeText.trim();
  if (t === "string") return { kind: "string" };
  if (t === "number") return { kind: "number" };
  if (t === "boolean") return { kind: "boolean" };
  // Union of string literals, e.g. 'low' | 'medium' | 'high'
  const parts = t.split("|").map((s) => s.trim()).filter(Boolean);
  if (
    parts.length > 1 &&
    parts.every((s) => /^['"].*['"]$/.test(s) || s === "undefined")
  ) {
    return {
      kind: "select",
      options: parts.filter((s) => s !== "undefined").map((s) => s.slice(1, -1)),
    };
  }
  return { kind: "json" };
}

export function extractProps(
  root: string,
  absFile: string,
  opts?: { tsconfig?: boolean },
): PropSpec[] {
  const project = getProject(root, opts?.tsconfig ?? false);
  const source =
    project.getSourceFile(absFile) ?? project.addSourceFileAtPath(absFile);
  source.refreshFromFileSystemSync();

  const iface: InterfaceDeclaration | undefined = source
    .getInterfaces()
    .find((i) => /Props$/.test(i.getName())) ?? source.getInterfaces()[0];
  if (!iface) return [];

  return iface.getMembers().flatMap((m) => {
    const sig = m.asKind(SyntaxKind.PropertySignature);
    if (!sig) return [];
    const typeNode = sig.getTypeNode();
    const typeText = typeNode ? typeNode.getText() : sig.getType().getText();
    return [
      {
        name: sig.getName(),
        typeText,
        optional: sig.hasQuestionToken(),
        control: controlFor(typeText),
      },
    ];
  });
}
