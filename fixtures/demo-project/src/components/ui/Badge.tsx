"use client";

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// <Badge />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.15 (pending). Small colored pill label for category
// attribution, status, tags. Uses the subtle background + saturated text
// pattern so it reads clearly on both card and page surfaces.

type BadgeVariant = "default" | "community" | "marketplace" | "expert" | "handson" | "success" | "warning" | "danger" | "accent" | "ghost";
type BadgeSize = "sm" | "md" | "lg";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Optional small dot before the label. */
  dot?: boolean;
  /** Arbitrary accent color (hex). Only used when variant="accent".
   *  Follows the colored-surfaces rule: hardcoded hue + neumorphic
   *  gradient overlay, identical in light/dark mode. */
  color?: string;
  /**
   * Foreground for an `accent` fill. Defaults to white.
   *
   * ⚠️ It exists because white is NOT always the right answer, and assuming it is
   * ships unreadable labels. The Desk palette derives each fill's foreground rather
   * than listing one, precisely because `gold` and `amber` are light enough that
   * they must carry INK — cream on them needs ΔL* 22.9 and 15.5, at which depth gold
   * reads as dark bronze (`desk-color.ts`). A caller with a computed foreground has
   * to be able to pass it.
   */
  foreground?: string;
  /** Optional suffix rendered in a subdued pill (e.g. weight "0.7"). */
  suffix?: string;
  /** When "count", wraps the suffix in smaller parenthesis glyphs via
   *  pseudo-elements so the parens don't blow up the divot height. */
  suffixKind?: "default" | "count";
  /** When true, renders the label as upright tabular digits — cancels
   *  variant-level italic (e.g. ghost) and uses `tnum` + `lnum` so
   *  numeric labels visually center on the pill. */
  numeric?: boolean;
  /** Optional icon rendered inside a recessed circular well at the
   *  left of the label. Intended for colored accent badges where the
   *  well punches a small dark hole into the badge surface. */
  icon?: ReactNode;
  /**
   * Trim the horizontal padding — for SHORT all-caps markers ("DST", "NEW", "PRO").
   *
   * ⚠️ It is a ratio fix, not a size fix, and the difference matters because
   * reaching for `size` cannot solve it: every size scales padding AND text
   * together, so a 3-letter label keeps the same too-much-pill-for-too-little-text
   * proportion at every one of them (Sam: "still too much badge and not enough
   * DST"). The pill's padding is tuned for labels long enough to need it.
   */
  tight?: boolean;
}

export function Badge({
  label,
  variant = "default",
  size = "sm",
  dot,
  color,
  foreground,
  suffix,
  suffixKind = "default",
  numeric,
  icon,
  tight,
}: BadgeProps) {
  const isAccent = variant === "accent" && color;

  return (
    <span
      className="ui-badge"
      data-variant={isAccent ? "accent" : variant}
      data-size={size}
      data-numeric={numeric ? "true" : undefined}
      data-has-icon={icon ? "true" : undefined}
      data-tight={tight ? "true" : undefined}
      style={isAccent ? {
        background: `linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.05) 45%, rgba(0,0,0,0.12) 100%), ${color}`,
        color: foreground ?? "#fff",
      } : undefined}
    >
      {icon}
      {dot && <span className="ui-badge-dot" aria-hidden="true" />}
      {label}
      {suffix && (
        <span className="ui-badge-suffix" data-kind={suffixKind}>
          {suffix}
        </span>
      )}
    </span>
  );
}
