"use client";

import { type ReactNode } from "react";
import { Divider } from "./Divider";

// ---------------------------------------------------------------------------
// <CardStack />
// ---------------------------------------------------------------------------
// Fanned card stack — each card peeks out from under the one above.
// Right-aligned: deeper levels indent from the right, showing parent
// cards extending further right (wider = higher in hierarchy).
//
// The point where a card disappears under the card above it is treated
// as the card's visual edge. Content is spaced from that edge inward,
// not from the card's physical top. This means covered cards position
// their label with bottom-padding relative to the overlap line.

export interface CardStackLevel {
  /** Label shown on the exposed tab edge. */
  label: string;
  /** Optional value text beside the label. */
  meta?: string;
  /** Content for the bottom (fully exposed) card. */
  content?: ReactNode;
}

interface CardStackProps {
  /** Ordered levels, topmost (widest) first. */
  levels: CardStackLevel[];
  /** Content inside the bottommost (fully exposed) card. */
  children?: ReactNode;
  /** Height of exposed tab strip in px. Defaults to 22. */
  tabHeight?: number;
  /** Right inset per level in px. Defaults to 14. */
  inset?: number;
}

export function CardStack({
  levels,
  children,
  tabHeight = 32,
  inset = 14,
}: CardStackProps) {
  const total = levels.length;

  return (
    <div className="ui-cardstack">
      {levels.map((level, i) => {
        const isLast = i === total - 1;
        const zIndex = total - i;
        // The overlap line: where the card above covers this card.
        // Content below this line is hidden. We pad FROM this line.
        const overlap = i === 0 ? 0 : tabHeight;

        return (
          <div
            key={i}
            className="ui-card ui-cardstack-card"
            data-tier={i % 2 === 0 ? "a" : "b"}
            data-last={isLast || undefined}
            style={{
              zIndex,
              // Pull up under the card above
              marginTop: i === 0 ? 0 : -overlap,
              // Right-aligned hierarchy: deeper = more right margin
              marginRight: i * inset,
              // Covered cards: tab strip height + padding for the
              // overlap zone (the part hidden under the card above).
              // The overlap zone acts as dead space at the top of the
              // card; the tab text sits below it, in the visible strip.
              // Center text in the visible strip. The overlap zone
              // (hidden under card above) is `tabHeight` px of dead
              // space. Visible strip is also `tabHeight` px. Text
              // (~14px) centers with (tabHeight - 14) / 2 offset.
              paddingTop: i === 0
                ? Math.round(tabHeight * 0.4)
                : overlap + Math.round((tabHeight - 14) / 2),
              paddingBottom: isLast
                ? undefined
                : i === 0
                  ? Math.round(tabHeight * 0.4)
                  : Math.round((tabHeight - 14) / 2),
            }}
          >
            <div className="ui-cardstack-tab">
              <span className="ui-cardstack-label">{level.label}</span>
              {level.meta && (
                <>
                  <span className="ui-cardstack-sep" aria-hidden="true">|</span>
                  <span className="ui-cardstack-meta">{level.meta}</span>
                </>
              )}
            </div>
            {isLast && (level.content || children) && (
              <>
                <div style={{ margin: "0.5rem 0 0.375rem" }}>
                  <Divider variant="recess" />
                </div>
                <div className="ui-cardstack-content">
                  {level.content}
                  {children}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
