/**
 * Style workspace — theme tokens with a live preview, per the v3 design.
 * Rows are wired to the REAL declarations in the fixture's CSS (theme.css,
 * ui.css, fonts.css) via /api/tokens; edits live-preview into the canvas
 * (token-preview messages) and commit as surgical writes. Rows whose token
 * does not exist yet are shown dashed and read-only — honesty over mockery.
 */
import { useCallback, useEffect, useState } from "react";
import type { EditorToHarness } from "../../shared/protocol";
import { C, MONO, inputStyle, sectionHeader } from "./chrome";

interface TokenDecl {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
  line: number;
}
interface TokenFile {
  file: string;
  decls: TokenDecl[];
}

interface RowSpec {
  token: string;
  /** CSS var name to look up; occurrence index picks light (0) vs dark (1). */
  cssVar?: string;
  occurrence?: number;
  usage: string;
  render?: "swatch" | "sample" | "bar";
  missingNote?: string;
}
interface GroupSpec {
  name: string;
  rows: RowSpec[];
}

const CATS: Record<string, { note: string; groups: GroupSpec[] }> = {
  Colors: {
    note: "src/theme.css",
    groups: [
      { name: "Provenance trust ladder", rows: [
        { token: "--source-community", cssVar: "--source-community", usage: "where a crawled fact came from" },
        { token: "--source-marketplace", cssVar: "--source-marketplace", usage: "never status, never the beacon" },
        { token: "--source-expert", cssVar: "--source-expert", usage: "rung 3 of 6" },
        { token: "--source-handson", cssVar: "--source-handson", usage: "rung 4 of 6" },
        { token: "--source-exclusive", cssVar: "--source-exclusive", usage: "rung 5 of 6" },
        { token: "--source-verified", cssVar: "--source-verified", usage: "rung 6 of 6" },
      ]},
      { name: "Seven Seas · light", rows: [
        { token: "--background", cssVar: "--background", usage: "parchment ground · L* 93.2" },
        { token: "--foreground", cssVar: "--foreground", usage: "warm ink · never pure black" },
        { token: "--muted", cssVar: "--muted", usage: "wells and placeholders" },
        { token: "--muted-foreground", cssVar: "--muted-foreground", usage: "captions, absent labels" },
        { token: "--ring", cssVar: "--ring", usage: "focus outlines" },
        { token: "--primary", cssVar: "--primary", usage: "interaction fill · teal, never gold" },
      ]},
      { name: "Dark · abyss", rows: [
        { token: "--background (dark)", cssVar: "--background", occurrence: 1, usage: "abyss canvas ground" },
        { token: "--foreground (dark)", cssVar: "--foreground", occurrence: 1, usage: "body copy on abyss" },
        { token: "--muted-foreground (dark)", cssVar: "--muted-foreground", occurrence: 1, usage: "cards go lighter than the canvas" },
      ]},
      { name: "Beacon · one bit", rows: [
        { token: "--beacon-armed", cssVar: "--beacon-armed", usage: "luminance slam, from", missingNote: "no token in theme.css yet" },
        { token: "--beacon-fired", cssVar: "--beacon-fired", usage: "…to. Never hue.", missingNote: "no token in theme.css yet" },
      ]},
    ],
  },
  Type: {
    note: "src/fonts.css",
    groups: [
      { name: "Families", rows: [
        { token: "--font-display", cssVar: "--font-display", usage: "a punctuation mark, not the default voice", render: "sample" },
        { token: "--font-body", cssVar: "--font-body", usage: "body and UI", render: "sample" },
        { token: "--font-mono", cssVar: "--font-mono", usage: "mono", render: "sample" },
      ]},
      { name: "Heading scale", rows: [
        { token: "--text-h1", usage: "Page title", render: "sample", missingNote: "sizes live per-component today" },
        { token: "--text-h2", usage: "Section title", render: "sample", missingNote: "sizes live per-component today" },
        { token: "--text-h3", usage: "Sub-heading", render: "sample", missingNote: "sizes live per-component today" },
      ]},
    ],
  },
  Surfaces: {
    note: "ui.css recipes",
    groups: [
      { name: "Radius", rows: [
        { token: "--radius", cssVar: "--radius", usage: "default · sections and cards", render: "bar" },
      ]},
      { name: "Card material · straddle", rows: [
        { token: "--ui-card-t1-start", cssVar: "--ui-card-t1-start", usage: "tier-1 top stop · above the ground" },
        { token: "--ui-card-t1-mid", cssVar: "--ui-card-t1-mid", usage: "tier-1 bottom stop · below the ground" },
        { token: "--ui-surface-grad-start", cssVar: "--ui-surface-grad-start", usage: "control surface · top stop" },
        { token: "--ui-surface-grad-mid", cssVar: "--ui-surface-grad-mid", usage: "control surface · mid stop" },
        { token: "--ui-surface-grad-end", cssVar: "--ui-surface-grad-end", usage: "control surface · lower boundary" },
      ]},
    ],
  },
  Spacing: {
    note: "page document",
    groups: [
      { name: "Block spacing", rows: [
        { token: "Space · None", usage: "0 — spacing lives in the page document, not tokens", render: "bar", missingNote: "" },
        { token: "Space · 1rem", usage: "the Space control on any element", render: "bar", missingNote: "" },
        { token: "Space · 2rem", usage: "…and the box model takes any CSS length", render: "bar", missingNote: "" },
      ]},
    ],
  },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export function useStyleTokens(send: (m: EditorToHarness) => void, onEdit: () => void) {
  const [files, setFiles] = useState<TokenFile[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const refetch = useCallback(async () => {
    const d = await api<{ tokens: TokenFile[] }>("/api/tokens");
    setFiles(d.tokens);
    setOverrides({});
  }, []);
  useEffect(() => void refetch(), [refetch]);

  const lookup = useCallback(
    (cssVar: string, occurrence = 0) => {
      let seen = 0;
      for (const f of files) {
        for (const decl of f.decls) {
          if (decl.name === cssVar) {
            if (seen === occurrence) return { file: f.file, decl };
            seen++;
          }
        }
      }
      return null;
    },
    [files],
  );

  const valueOf = useCallback(
    (cssVar: string | undefined, occurrence = 0) => {
      if (!cssVar) return null;
      const key = `${cssVar}#${occurrence}`;
      if (key in overrides) return overrides[key];
      return lookup(cssVar, occurrence)?.decl.value ?? null;
    },
    [lookup, overrides],
  );

  const commit = useCallback(
    async (cssVar: string, occurrence: number, value: string) => {
      const hit = lookup(cssVar, occurrence);
      if (!hit) return;
      setOverrides((o) => ({ ...o, [`${cssVar}#${occurrence}`]: value }));
      if (occurrence === 0) send({ type: "token-preview", name: cssVar, value });
      onEdit();
      await api("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: hit.file,
          decl: { valueStart: hit.decl.valueStart, valueEnd: hit.decl.valueEnd, oldValue: hit.decl.value },
          value,
        }),
      });
      send({ type: "token-clear" });
      await refetch();
    },
    [lookup, send, onEdit, refetch],
  );

  return { valueOf, commit, refetch };
}

// ---------------------------------------------------------------------------

function TokenInput({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  return (
    <input
      className="fc"
      type="text"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      style={{ ...inputStyle, flex: "0 0 94px", width: 94, fontFamily: MONO, fontSize: 11, opacity: disabled ? 0.5 : 1 }}
    />
  );
}

export function StyleBody({
  tokens,
  dark,
}: {
  tokens: ReturnType<typeof useStyleTokens>;
  dark: boolean;
}) {
  const [cat, setCat] = useState<keyof typeof CATS>("Colors");
  const { valueOf, commit } = tokens;

  const catDef = CATS[cat];
  const tokenCount = catDef.groups.reduce((a, g) => a + g.rows.length, 0);

  const v = (name: string, occ = 0, fallback = "") => valueOf(name, occ) ?? fallback;

  // Preview values
  const bg = dark ? v("--background", 1, "#0B1D33") : v("--background", 0, "#F5EADD");
  const fg = dark ? v("--foreground", 1, "#F4EBE1") : v("--foreground", 0, "#2C221E");
  const mutedFg = dark ? "rgba(232,239,246,0.62)" : v("--muted-foreground", 0, "rgba(44,34,30,0.62)");
  const muted = dark ? "color-mix(in oklab, #0B1D33 90%, #FFFFFF)" : v("--muted", 0, "#F0E5D9");
  const cardTop = v("--ui-card-t1-start", 0, "#f9f3eb");
  const cardBottom = v("--ui-card-t1-mid", 0, "#f3e8db");
  const cardBg = dark
    ? "color-mix(in oklab, #0B1D33 84%, #FFFFFF)"
    : `linear-gradient(180deg,${cardTop} 0,${cardBottom} 24px,${cardBottom} 100%)`;
  const cardShadow = dark
    ? "0 1px 0 rgba(255,255,255,0.10) inset, 0 8px 18px rgba(0,0,0,0.45)"
    : "0 0 4px 0 rgba(44,34,30,0.07),-1px -1px 3px rgba(255,255,255,0.5),3px 3px 8px rgba(44,34,30,0.18),0 4px 6px -2px rgba(44,34,30,0.12),inset 0 1px 0 rgba(255,255,255,0.95),inset 0 -2px 4px rgba(44,34,30,0.18)";
  const radius = v("--radius", 0, "0.625rem");

  const segs = [
    { label: "Community", fill: v("--source-community", 0, "#FF1414"), absent: false },
    { label: "Marketplace", fill: v("--source-marketplace", 0, "#0052FF"), absent: false },
    { label: "Expert", fill: `color-mix(in oklab, ${v("--source-expert", 0, "#F5A800")} 46%, ${bg})`, absent: true },
    { label: "Hands-On", fill: v("--source-handson", 0, "#1FB35A"), absent: false },
  ];
  const ladder = [
    ["community", v("--source-community")],
    ["marketplace", v("--source-marketplace")],
    ["expert", v("--source-expert")],
    ["hands-on", v("--source-handson")],
    ["exclusive", v("--source-exclusive")],
    ["verified", v("--source-verified")],
  ] as [string, string][];

  const railCats = Object.keys(CATS) as (keyof typeof CATS)[];
  const glyphs = ["◐", "A", "▤", "↕"];

  return (
    <>
      {/* category rail */}
      <div style={{ flex: "0 0 62px", display: "flex", flexDirection: "column", background: C.panel, borderRight: `1px solid ${C.border}`, paddingTop: 4, gap: 2 }}>
        {railCats.map((label, i) => (
          <button key={label} className="hv-ctl" onClick={() => setCat(label)}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: "100%", padding: "7px 0 6px", background: cat === label ? C.ctlHover : "transparent", border: "none", borderLeft: `2px solid ${cat === label ? C.blue : "transparent"}`, color: cat === label ? "#fff" : C.muted, cursor: "pointer" }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>{glyphs[i]}</span>
            <span style={{ fontSize: 9.5, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ padding: "8px 6px", fontSize: 9.5, color: C.faint, textAlign: "center", lineHeight: 1.35 }}>theme<br />.css</div>
      </div>

      {/* token list */}
      <div style={{ flex: "1.15 1 0", minWidth: 300, display: "flex", flexDirection: "column", background: C.win, borderRight: `1px solid ${C.border}`, minHeight: 0 }}>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "baseline", gap: 8, padding: "9px 12px 7px", borderBottom: `1px solid ${C.softDiv}`, whiteSpace: "nowrap" }}>
          <h2 style={sectionHeader}>{cat}</h2>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10.5, color: C.faint }}>
            {tokenCount} token{tokenCount === 1 ? "" : "s"} · {catDef.note}
          </span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: 12 }}>
          {catDef.groups.map((g) => (
            <div key={g.name}>
              <div style={{ padding: "9px 12px 5px", fontSize: 11, color: C.body, fontWeight: 600 }}>{g.name}</div>
              {g.rows.map((r) => {
                const occ = r.occurrence ?? 0;
                const val = r.cssVar ? valueOf(r.cssVar, occ) : null;
                const missing = val == null;
                return (
                  <div key={r.token} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 12px", borderBottom: `1px solid ${C.canvasEdge}` }}>
                    {r.render === "sample" ? (
                      <span style={{ flex: "0 0 auto", color: C.text, fontSize: "1.2em", fontWeight: 700, lineHeight: 1, whiteSpace: "nowrap", fontFamily: val ?? undefined }}>Ag</span>
                    ) : r.render === "bar" ? (
                      <span style={{ flex: "0 0 auto", width: 24, height: 8, borderRadius: 2, background: C.borderHover }} />
                    ) : (
                      <span style={{ flex: "0 0 auto", width: 22, height: 22, borderRadius: 5, border: missing ? `1px dashed rgba(255,255,255,0.25)` : `1px solid rgba(255,255,255,0.12)`, background: missing ? "transparent" : val ?? "transparent" }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: C.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.token}</span>
                      <span style={{ fontSize: 10, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {missing && r.missingNote !== "" ? (r.missingNote ?? "no token yet") + " · " + r.usage : r.usage}
                      </span>
                    </div>
                    <TokenInput
                      value={val ?? ""}
                      disabled={missing}
                      onCommit={(nv) => r.cssVar && void commit(r.cssVar, occ, nv)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* live preview */}
      <div style={{ flex: "1 1 0", minWidth: 260, display: "flex", flexDirection: "column", background: C.void, minHeight: 0 }}>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "baseline", gap: 8, padding: "9px 12px 7px", borderBottom: `1px solid ${C.canvasEdge}`, background: C.canvasBar, whiteSpace: "nowrap" }}>
          <h2 style={sectionHeader}>Live preview</h2>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10.5, color: C.faint }}>
            edits write to source on commit
          </span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: 16 }}>
          <div style={{ background: bg, color: fg, borderRadius: 6, padding: 18, display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 14px 30px rgba(0,0,0,0.4)", fontFamily: "Cabin, system-ui, sans-serif" }}>
            <PreviewBlock label="type scale" mutedFg={mutedFg}>
              <span style={{ fontSize: "1.9em", fontWeight: 700, lineHeight: 1.15, fontFamily: "'Goudy Old Style', Georgia, serif" }}>Not-missing</span>
              <span style={{ fontSize: "1.5em", fontWeight: 700, lineHeight: 1.15 }}>Source coverage</span>
              <span style={{ fontSize: "1.15em", fontWeight: 700, lineHeight: 1.2 }}>Booking window</span>
              <span style={{ fontSize: "1em", lineHeight: 1.5 }}>Opens exactly 30 days ahead at midnight HST.</span>
            </PreviewBlock>
            <PreviewBlock label="tier 1 surface" mutedFg={mutedFg}>
              <div style={{ padding: 16, borderRadius: radius, background: cardBg, boxShadow: cardShadow, display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: "1.5em", fontWeight: 700 }}>Not-missing</span>
                <span style={{ fontSize: "1em" }}>Calm, prepared, present.</span>
                <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                  <span style={{ padding: "0.5rem 1.25rem", borderRadius: "14px", background: cardBg, boxShadow: "0 0 4px 0 rgba(44,34,30,0.07),3px 3px 8px rgba(44,34,30,0.18),inset 0 1px 0 rgba(255,255,255,0.95),inset 0 -2px 4px rgba(44,34,30,0.18)", fontSize: "1em" }}>Set alert</span>
                </div>
              </div>
            </PreviewBlock>
            <PreviewBlock label="ConfidenceBar" mutedFg={mutedFg}>
              <div style={{ display: "flex", gap: 6 }}>
                {segs.map((s) => (
                  <div key={s.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderRadius: 2, border: s.absent ? "1px dashed rgba(44,34,30,0.25)" : "1px solid transparent", opacity: s.absent ? 0.6 : 1, backgroundColor: s.fill }}>
                    <span style={{ marginTop: 12, padding: "0 4px 4px", textAlign: "center", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.025em", color: s.absent ? mutedFg : fg, mixBlendMode: s.absent ? "normal" : "luminosity" }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </PreviewBlock>
            <PreviewBlock label="provenance ladder · six rungs" mutedFg={mutedFg}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {ladder.map(([label, val]) => (
                  <span key={label} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 9999, border: val ? "1px solid rgba(44,34,30,0.18)" : "1px dashed rgba(44,34,30,0.35)", background: muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 9999, background: val || "transparent", border: val ? "1px solid rgba(44,34,30,0.18)" : "1px dashed rgba(44,34,30,0.35)" }} />
                    {label}
                    {!val && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: mutedFg }}>no token</span>}
                  </span>
                ))}
              </div>
            </PreviewBlock>
            <PreviewBlock label="states" mutedFg={mutedFg}>
              <div style={{ padding: "10px 12px", border: "1px dashed rgba(44,34,30,0.28)", borderRadius: 8, background: muted, fontSize: 12, color: mutedFg }}>No sources yet</div>
              <div style={{ padding: "10px 12px", border: "1px dashed #d9b45b", borderRadius: 8, background: "rgba(217,180,91,0.10)", fontSize: 12 }}>Needs data hookup</div>
            </PreviewBlock>
          </div>
        </div>
      </div>
    </>
  );
}

function PreviewBlock({ label, mutedFg, children }: { label: string; mutedFg: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: mutedFg }}>{label}</span>
      {children}
    </div>
  );
}

