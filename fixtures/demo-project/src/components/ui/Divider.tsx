"use client";

// ---------------------------------------------------------------------------
// <Divider />
// ---------------------------------------------------------------------------
// Thin rule — two variants (recess groove / ridge bead) and two
// orientations (horizontal / vertical). Vertical dividers stretch to
// parent height via align-self: stretch in flex contexts, or require
// the parent to have a defined height otherwise.

interface DividerProps {
  variant?: "recess" | "ridge";
  orientation?: "horizontal" | "vertical";
}

export function Divider({ variant = "recess", orientation = "horizontal" }: DividerProps) {
  return (
    <div
      className={`ui-divider ui-divider--${variant} ui-divider--${orientation}`}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
