"use client";

import { Divider } from "./Divider";

// ---------------------------------------------------------------------------
// <UseRow />
// ---------------------------------------------------------------------------
// Use-case display row — recessed trough pill with a ridge divider
// between the use name and its description.

interface UseRowProps {
  /** Use-case name, e.g. "Music Listening". */
  name: string;
  /** Optional description shown after a ridge divider. */
  description?: string | null;
}

export function UseRow({ name, description }: UseRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.375rem 0.75rem",
        borderRadius: 10,
        background:
          "linear-gradient(180deg, var(--ui-trough-grad-top), var(--ui-trough-grad-mid) 55%, var(--ui-trough-grad-bot))",
        boxShadow:
          "inset 0 2px 4px var(--ui-trough-inset-top), inset 0 -1px 0 var(--ui-trough-floor-hi)",
      }}
    >
      <span
        style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          color: "var(--ui-text-primary)",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      {description && (
        <>
          <Divider variant="ridge" orientation="vertical" />
          <span style={{ fontSize: "0.6875rem", color: "var(--ui-text-dim)" }}>
            {description}
          </span>
        </>
      )}
    </div>
  );
}
