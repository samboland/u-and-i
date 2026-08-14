"use client";

import { Badge } from "./Badge";

// ---------------------------------------------------------------------------
// <ComplianceBadge />
// ---------------------------------------------------------------------------
// Compliance certification badge (success variant, dot) paired with an
// optional authority recess pill. Matches the visual from the taxonomy
// explorer's modifier types panel.

interface ComplianceBadgeProps {
  /** Certification name, e.g. "Hi-Res Audio". */
  cert: string;
  /** Certifying authority, e.g. "JAS". Rendered in a recessed trough pill. */
  authority?: string | null;
  size?: "sm" | "md" | "lg";
}

export function ComplianceBadge({ cert, authority, size = "sm" }: ComplianceBadgeProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <Badge label={cert} variant="success" size={size} dot />
      {authority && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "0.1875rem 0.5rem",
            lineHeight: "1",
            borderRadius: "9999px",
            fontSize: "0.625rem",
            fontWeight: 700,
            fontStyle: "oblique",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--ui-text-faint)",
            background:
              "linear-gradient(180deg, var(--ui-trough-grad-top), var(--ui-trough-grad-mid) 55%, var(--ui-trough-grad-bot))",
            boxShadow:
              "inset 0 1px 2px var(--ui-trough-inset-top), inset 0 -1px 0 var(--ui-trough-floor-hi)",
          }}
        >
          {authority}
        </span>
      )}
    </div>
  );
}
