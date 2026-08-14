"use client";

import { type ReactNode } from "react";

// ---------------------------------------------------------------------------
// <SectionCard />
// ---------------------------------------------------------------------------
// Card with a title pulled into the top-left padding zone. Overrides
// the default .ui-card CSS padding (1.25rem 1.5rem) with tighter values
// so the title sits near the card edge.

interface SectionCardProps {
  title: string;
  children: ReactNode;
}

export function SectionCard({ title, children }: SectionCardProps) {
  return (
    <div className="ui-card" style={{ padding: "0.5rem 1rem 0.75rem" }}>
      <span
        style={{
          display: "block",
          fontSize: "0.875rem",
          fontWeight: 700,
          color: "var(--ui-text-primary)",
          letterSpacing: "-0.01em",
          marginBottom: "0.3rem",
        }}
      >
        {title}
      </span>
      {children}
    </div>
  );
}
