"use client";

/**
 * Palette reference — every accent in ONE place.
 *
 * The component sections cannot give you this: they show a colour only where
 * some component happens to use it, so judging the palette as a palette meant
 * scrolling and inferring.
 *
 * ⚠️ Values are READ AT RUNTIME from the CSS custom properties, never
 * duplicated here. A hardcoded swatch list is a second source of truth that
 * goes stale the moment a token moves, and this page exists to be trusted.
 * It also means a token that never reaches the browser renders as a visible
 * UNSET marker instead of silently inheriting — which is exactly how
 * `--primary-text` hid a Tailwind `@theme` pruning bug (migration doc §12).
 *
 * Contrast is computed here, not annotated, for the same reason.
 */

import { useCallback, useState } from "react";

interface Row {
  token: string;
  role: string;
}

const PALETTE_GROUPS: { title: string; note?: string; rows: Row[] }[] = [
  {
    title: "Ground & ink",
    rows: [
      { token: "--background", role: "Page canvas" },
      { token: "--foreground", role: "Body text" },
      { token: "--card", role: "Card surface" },
      { token: "--muted", role: "Recessed surface" },
    ],
  },
  {
    title: "Interaction",
    note: "--primary is FILL / large-text only. Teal as body text must use --primary-text.",
    rows: [
      { token: "--primary", role: "Fills, focus rings, hover glow" },
      { token: "--primary-text", role: "Teal as TEXT (links, text buttons)" },
    ],
  },
  {
    title: "Structural chrome",
    rows: [
      { token: "--nav-anchor", role: "Nav rail, header, tooltips" },
      { token: "--nav-anchor-foreground", role: "Text on chrome" },
    ],
  },
  {
    title: "Status",
    note: "Gold is fills / borders / icons only — it fails as text on parchment at every candidate value. Warning shares it by decision, not by accident.",
    rows: [
      { token: "--brand-accent", role: "Premium / selection" },
      { token: "--semantic-success", role: "Success fill" },
      { token: "--success-text", role: "Success as TEXT" },
      { token: "--semantic-warning", role: "Warning — deliberately the same as gold" },
      { token: "--semantic-error", role: "Error" },
      { token: "--destructive", role: "Destructive action" },
    ],
  },
  {
    title: "Beacon",
    note: "⛔ THEME-INVARIANT. The T-0 signal is carried by luminance, not hue — never re-theme these.",
    rows: [
      { token: "--beacon-armed", role: "Pre-arm field" },
      { token: "--beacon-fired", role: "Fire slam" },
    ],
  },
];

function parseRgb(value: string): [number, number, number] | null {
  const nums = value.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(a: string, b: string): number | null {
  const ra = parseRgb(a);
  const rb = parseRgb(b);
  if (!ra || !rb) return null;
  const la = luminance(ra);
  const lb = luminance(rb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG verdict at the NORMAL-text threshold (4.5). The large-text allowance of
 * 3.0 is deliberately NOT credited: it is a property of the label's size and
 * weight, not of the colour, so crediting it here would make a value look safe
 * in contexts where it is not.
 */
function verdict(ratio: number | null): { label: string; ok: boolean } {
  if (ratio === null) return { label: "", ok: false };
  if (ratio >= 4.5) return { label: "AA", ok: true };
  if (ratio >= 3) return { label: "large only", ok: false };
  return { label: "fill only", ok: false };
}

const UNSET = "unset";

/**
 * Resolve every token by probing a throwaway element. Must run in the browser.
 *
 * ⚠️ Unset detection uses an IMPOSSIBLE SENTINEL FALLBACK, not a comparison
 * against a control var. The first attempt compared each token's resolved value
 * to `var(--not-a-real-token)`, which falls back to the INHERITED colour — and
 * `--foreground` is the inherited colour, so a perfectly healthy token was
 * reported UNSET. `var(--x, SENTINEL)` yields the sentinel if and only if `--x`
 * does not resolve, regardless of what is inherited.
 */
const SENTINEL = "rgb(1, 2, 3)";

function readTokens(): Record<string, string> {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);

  const out: Record<string, string> = {};
  for (const group of PALETTE_GROUPS) {
    for (const row of group.rows) {
      probe.style.color = "";
      probe.style.color = `var(${row.token}, ${SENTINEL})`;
      const value = getComputedStyle(probe).color;
      out[row.token] = value === SENTINEL ? UNSET : value;
    }
  }
  probe.remove();
  return out;
}

export function PaletteReference() {
  const [resolved, setResolved] = useState<Record<string, string> | null>(null);

  /* Read on mount via a CALLBACK REF, not an effect. Two reasons: the repo lints
     against setState-in-effect (react-hooks/set-state-in-effect), and a lazy
     useState initializer would touch `document` during render — fine on the
     client, but this component still server-renders, and reading tokens there
     would produce a hydration mismatch against the client's real values. A ref
     callback runs after mount with the DOM present and styles applied. */
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    setResolved(readTokens());
  }, []);

  const ground = resolved?.["--background"] ?? "";
  const card = resolved?.["--card"] ?? "";

  return (
    <div ref={measure} style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {PALETTE_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.9375rem", fontWeight: 700 }}>
            {group.title}
          </h3>
          {group.note && (
            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.75rem",
                color: "var(--ui-text-dim)",
                maxWidth: "74ch",
                lineHeight: 1.5,
              }}
            >
              {group.note}
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {group.rows.map((row) => {
              const value = resolved?.[row.token] ?? "";
              const missing = value === UNSET;
              const vsGround = missing ? null : contrast(value, ground);
              const vsCard = missing ? null : contrast(value, card);
              const vg = verdict(vsGround);
              const vc = verdict(vsCard);
              return (
                <div
                  key={row.token}
                  style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.8125rem" }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 54,
                      height: 30,
                      borderRadius: 7,
                      flexShrink: 0,
                      background: missing
                        ? "repeating-linear-gradient(45deg, var(--semantic-error) 0 5px, transparent 5px 10px)"
                        : value,
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 3px rgba(44,34,30,0.22), 0 1px 2px rgba(44,34,30,0.14)",
                    }}
                  />
                  <code style={{ width: 208, fontSize: "0.75rem" }}>{row.token}</code>
                  <span
                    style={{
                      width: 118,
                      fontSize: "0.72rem",
                      color: missing ? "var(--semantic-error)" : "var(--ui-text-dim)",
                      fontWeight: missing ? 700 : 400,
                    }}
                  >
                    {missing ? "UNSET" : value}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, color: "var(--ui-text-dim)" }}>{row.role}</span>
                  <span style={{ width: 152, fontSize: "0.72rem", color: "var(--ui-text-dim)", textAlign: "right" }}>
                    {vsGround !== null && (
                      <>
                        ground {vsGround.toFixed(2)}{" "}
                        <strong
                          className={vg.ok ? "ui-text-success" : undefined}
                          style={vg.ok ? undefined : { color: "var(--ui-text-faint)" }}
                        >
                          {vg.label}
                        </strong>
                      </>
                    )}
                  </span>
                  <span style={{ width: 140, fontSize: "0.72rem", color: "var(--ui-text-dim)", textAlign: "right" }}>
                    {vsCard !== null && (
                      <>
                        card {vsCard.toFixed(2)}{" "}
                        <strong
                          className={vc.ok ? "ui-text-success" : undefined}
                          style={vc.ok ? undefined : { color: "var(--ui-text-faint)" }}
                        >
                          {vc.label}
                        </strong>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
