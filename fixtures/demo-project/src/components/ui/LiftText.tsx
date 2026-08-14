"use client";

import type { ReactNode, ElementType, ComponentPropsWithoutRef } from "react";

// ---------------------------------------------------------------------------
// <LiftText />
// ---------------------------------------------------------------------------
// Theatrical drop-shadow for display text. Matches the shadow rigged behind
// the header logo and the hero splash — moderate single-layer in light mode,
// denser dual-layer in dark mode so glyphs read as lifted off the surface.
//
// Different from --ui-text-float-* (subtle glyph emboss applied across the
// UI). LiftText is the louder, showcase-scale version for hero copy, section
// titles, and any text that needs to feel raised rather than merely embossed.

type LiftTextProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

export function LiftText<T extends ElementType = "span">({
  as,
  className,
  children,
  ...rest
}: LiftTextProps<T>) {
  const Tag = (as ?? "span") as ElementType;
  return (
    <Tag
      className={`ui-text-lift${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
