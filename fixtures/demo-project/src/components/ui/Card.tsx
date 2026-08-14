"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <Card />
// ---------------------------------------------------------------------------
// Ref: ui-spec §3.5. Convex panel — same shading family as PrimaryButton
// (surface gradient + outer shadow stack + soft rim). Not interactive by
// default, so no hover/press states unless clickable.

interface CardProps {
  children: ReactNode;
}

export function Card({ children }: CardProps) {
  return <div className="ui-card">{children}</div>;
}
