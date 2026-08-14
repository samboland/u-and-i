/**
 * SourceDot — a small inline link that visually identifies which source
 * category a pro/con item came from.
 *
 * Each dot links to the per-category Source Breakdown section via
 * `href="#sources-{category}"`. The anchor targets are owned by Story 2.18;
 * this story establishes the contract.
 *
 * A colored 12px round span provides a decorative visual cue; the sibling text
 * label is the information carrier (NFR19 — color is never the sole carrier).
 */
import type { JSX } from "react";
import {
  ADAPTER_TO_CATEGORY,
  CATEGORY_LABELS,
  isAdapterKey,
} from "@/lib/source-categories";
import { cn } from "@/lib/utils";

export interface SourceDotProps {
  /** Adapter key from `ProConItem.sources[]` (e.g. "amazon" / "reddit" / "youtube"). */
  adapterKey: string;
  /** Optional count to render in the visible label, e.g. "Reddit (3)". */
  count?: number;
  /** Visual variant. `'default'` = full-color filled dot. `'muted'` = thin-data muted hue. */
  variant?: "default" | "muted";
  className?: string;
}

export function SourceDot({
  adapterKey,
  count,
  variant = "default",
  className,
}: SourceDotProps): JSX.Element | null {
  if (!isAdapterKey(adapterKey)) return null;

  const category = ADAPTER_TO_CATEGORY[adapterKey];
  const label = CATEGORY_LABELS[category];
  const colorVar =
    variant === "muted"
      ? `var(--source-${category}-muted)`
      : `var(--source-${category})`;

  const visibleLabel = count !== undefined ? `${label} (${count})` : label;
  const ariaLabel =
    count !== undefined
      ? `${label} — mentioned in source category ${category}, ${count} excerpt(s)`
      : `${label} — mentioned in source category ${category}`;

  return (
    <a
      href={`#sources-${category}`}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: colorVar }}
      />
      {visibleLabel}
    </a>
  );
}
