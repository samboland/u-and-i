"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <NavCardStack />
// ---------------------------------------------------------------------------
// Horizontal fanning card layout — cards overlap left-to-right with
// increasing top inset per depth level, alternating tier colors.
// Each level typically contains a Navbar for hierarchical navigation.

/** A single column/level in the horizontal card stack. */
export interface NavCardLevel {
  /** Unique key for React. */
  key: string;
  /** Small label above the Navbar (e.g. "Domain", "Class"). */
  label?: string;
  /** Fixed pixel width. Omit for flex (last level). */
  width?: number;
  /** Content — typically a <Navbar /> or detail panel. */
  children: ReactNode;
}

interface NavCardStackProps {
  levels: NavCardLevel[];
  /** Horizontal overlap between adjacent cards in px. Default 28. */
  overlap?: number;
  /** Top inset per depth level in px. Default 10. */
  topInset?: number;
}

export function NavCardStack({
  levels,
  overlap = 28,
  topInset = 10,
}: NavCardStackProps) {
  const total = levels.length;

  return (
    <div style={{ display: "flex", alignItems: "stretch" }}>
      {levels.map((level, i) => {
        const isFirst = i === 0;
        const isLast = i === total - 1;
        const tier = i % 2 === 0 ? "a" : "b";
        const zIndex = total - i;

        return (
          <div
            key={level.key}
            className="ui-card"
            data-tier={tier}
            style={{
              zIndex,
              position: "relative",
              // Fixed width or flex for last level
              ...(level.width
                ? { width: level.width, flexShrink: 0 }
                : { flex: 1, minWidth: 0 }),
              // Overlap: tuck under previous card
              marginLeft: isFirst ? 0 : -overlap,
              // Pad left content past the hidden zone
              paddingLeft: isFirst ? "0.5rem" : overlap + (isLast ? 12 : 8),
              paddingTop: "0.625rem",
              paddingRight: isLast ? "1.25rem" : "0.5rem",
              paddingBottom: "0.625rem",
              // Deeper levels indent from top
              marginTop: i * topInset,
            }}
          >
            {level.label && (
              <span
                style={{
                  display: "block",
                  fontSize: "0.5625rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--ui-text-faint)",
                  marginBottom: "0.25rem",
                  paddingLeft: "0.375rem",
                  fontWeight: 600,
                }}
              >
                {level.label}
              </span>
            )}
            {level.children}
          </div>
        );
      })}
    </div>
  );
}
