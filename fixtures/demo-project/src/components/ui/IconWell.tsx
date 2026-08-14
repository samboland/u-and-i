"use client";

import { type CSSProperties, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <IconWell />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.3. Physical socket for holding a small glyph. Same visual
// language as the icon well inside PrimaryButton — pick a variant to match.

interface IconWellProps {
  children: ReactNode;
  size?: number;
  variant?: "recess" | "card";
}

export function IconWell({ children, size = 36, variant = "recess" }: IconWellProps) {
  return (
    <span
      className={`ui-iconwell ui-iconwell--${variant}`}
      style={{ "--ui-iconwell-size": `${size}px` } as CSSProperties}
    >
      {children}
    </span>
  );
}
