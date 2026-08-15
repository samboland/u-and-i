"use client";

import { type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

// ---------------------------------------------------------------------------
// <InfoHint />
// ---------------------------------------------------------------------------
// Small raised "i" glyph for clarifying terms on badges, labels, or headings
// the reader may not immediately understand. Hover/focus opens a tooltip
// carrying the explanation. A11y-friendly (keyboard focus, aria-label).
//
// Size sits small enough (12–14px) to pair with badges without fighting for
// visual weight.

interface InfoHintProps {
  /** Explanation text shown in the tooltip. */
  label: ReactNode;
  /** Accessible label announced by screen readers. Falls back to a generic
   *  phrase when `label` is not a plain string. */
  ariaLabel?: string;
  /** Visual size — pairs with Badge sizes. */
  size?: "xs" | "sm";
  /** Side the tooltip opens on. */
  side?: "top" | "right" | "bottom" | "left";
}

export function InfoHint({
  label,
  ariaLabel,
  size = "xs",
  side = "top",
}: InfoHintProps) {
  const resolvedAria =
    ariaLabel ?? (typeof label === "string" ? label : "More information");

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* ⚠️ NOT `role="button"`, and not pressable (Sam, 2026-08-05). Clicking it
              does nothing — the tooltip opens on hover and on focus — so announcing a
              button promised an action that does not exist, and the press animation
              backed the promise up. That animation was good and was kept: it moved to
              `<PressWell>`, for controls that really do respond to a press.
              ⛔ It stays FOCUSABLE. Removing `tabIndex` would make the explanation
              keyboard-unreachable, which is a real loss for the readers most likely to
              need it — losing the role costs an announcement, losing focus costs
              access. */}
          <span
            tabIndex={0}
            aria-label={resolvedAria}
            className="ui-info-hint"
            data-size={size}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="6" cy="3.1" r="0.85" fill="currentColor" />
              <rect x="5.2" y="5" width="1.6" height="4.2" rx="0.6" fill="currentColor" />
            </svg>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={6}
          className="ui-info-hint-tooltip"
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
