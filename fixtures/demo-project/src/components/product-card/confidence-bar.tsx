import type { ConfidenceLevel, SynthesisJobStatus } from '@/lib/types';
import {
  CATEGORY_COLOR_VAR,
  CATEGORY_LABELS,
  CATEGORY_MUTED_VAR,
  SOURCE_CATEGORY_ORDER,
  STAGE_TO_ADAPTER,
  type SourceCategory,
  categoriesPresentToSlots,
} from '@/lib/source-categories';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceBarState = 'resolving' | 'final';
export type SegmentState = 'filled' | 'empty' | 'building';

export interface ConfidenceBarProps {
  /** Adapter keys from `ReviewSynthesisOutput.sourceCategoriesPresent`. */
  sourceCategoriesPresent: readonly string[];
  /** From `ReviewSynthesisOutput.confidenceLevel`. */
  confidenceLevel: ConfidenceLevel;
  /**
   * `'final'` (default) renders empty/filled segments only.
   * `'resolving'` enables the per-segment `building` state, driven by
   * `streamingStages`.
   */
  state?: ConfidenceBarState;
  /**
   * Optional list of currently-active SSE stages (e.g. `['fetching_amazon']`).
   * Only honored when `state === 'resolving'`. The component does NOT open
   * its own SSE connection — the parent (Story 2.19's SynthesisStream) drives
   * this via props.
   */
  streamingStages?: readonly SynthesisJobStatus[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute which categories are currently in flight, given the active SSE
 * stages. Returns `null` when streaming is not active.
 */
function getBuildingCategories(
  state: ConfidenceBarState,
  streamingStages: readonly SynthesisJobStatus[] | undefined,
): Set<SourceCategory> | null {
  if (state !== 'resolving' || !streamingStages?.length) return null;

  const building = new Set<SourceCategory>();
  for (const stage of streamingStages) {
    const adapter = STAGE_TO_ADAPTER[stage];
    if (adapter === undefined) continue;
    // Re-use the canonical adapter→category mapping by feeding the adapter
    // through `categoriesPresentToSlots` (a set of size 1). This keeps the
    // mapping defined in exactly one place.
    const slots = categoriesPresentToSlots([adapter]);
    for (const category of SOURCE_CATEGORY_ORDER) {
      if (slots[category]) building.add(category);
    }
  }
  return building;
}

function describeSegment(category: SourceCategory, state: SegmentState): string {
  const label = CATEGORY_LABELS[category];
  switch (state) {
    case 'filled':
      return `${label} source data present`;
    case 'building':
      return `${label} source data in progress`;
    case 'empty':
      return `${label} source data missing`;
    default: {
      // Exhaustiveness check — if `SegmentState` is widened without
      // updating this switch, TypeScript will flag this branch.
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/**
 * Build the inline `style` for a segment based on its state. The `building`
 * state uses a CSS-only diagonal stripe pattern so it remains visually
 * distinct from `filled` (solid) and `empty` (muted with dashed border)
 * even when motion is disabled and even for color-blind users.
 */
function segmentStyle(
  category: SourceCategory,
  state: SegmentState,
): React.CSSProperties {
  const colorVar = CATEGORY_COLOR_VAR[category];
  const mutedVar = CATEGORY_MUTED_VAR[category];

  if (state === 'filled') {
    return { backgroundColor: `var(${colorVar})` };
  }
  if (state === 'building') {
    // Diagonal stripes alternating between the saturated and muted hues.
    // The motion-safe pulse layered on top adds animation when allowed,
    // but the stripes alone are enough to distinguish "in progress" from
    // "filled" without color or motion.
    return {
      backgroundImage: `repeating-linear-gradient(45deg, var(${colorVar}) 0 4px, var(${mutedVar}) 4px 8px)`,
    };
  }
  return { backgroundColor: `var(${mutedVar})` };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 4-segment horizontal bar showing source-category presence at a glance.
 * Renders Community / Marketplace / Expert / Hands-On in fixed left-to-right
 * order regardless of which slots are filled.
 *
 * Accessibility model: each segment is a single semantic unit (`role="img"`)
 * whose `aria-label` carries the category name AND its current state. The
 * visible text label inside each segment is `aria-hidden` so screen readers
 * read the descriptive aria-label, not just the bare category name. The bar
 * root carries an `aria-label` summarizing total coverage and is the single
 * keyboard tab stop.
 *
 * Server-renderable (no client-only APIs in the render path). The `building`
 * state's pulse animation is CSS-only and respects `prefers-reduced-motion`
 * via Tailwind's `motion-reduce:` modifier — but a static diagonal-stripe
 * background distinguishes `building` from `filled` and `empty` even when
 * the pulse is suppressed.
 */
export function ConfidenceBar({
  sourceCategoriesPresent,
  confidenceLevel,
  state = 'final',
  streamingStages,
  className,
}: ConfidenceBarProps) {
  const slots = categoriesPresentToSlots(sourceCategoriesPresent);
  const buildingCategories = getBuildingCategories(state, streamingStages);

  const filledCount = SOURCE_CATEGORY_ORDER.filter((c) => slots[c]).length;
  const totalCount = SOURCE_CATEGORY_ORDER.length;

  // Low confidence is derived from the number of *valid* mapped categories,
  // NOT the raw `sourceCategoriesPresent.length` — duplicates or unknown
  // adapter keys must not mask thin coverage.
  const isLowConfidence =
    state === 'final' && (confidenceLevel === 'low' || filledCount < 3);

  const groupLabel = `Source coverage: ${filledCount} of ${totalCount} source categories provided data`;

  return (
    <div
      role="group"
      aria-label={groupLabel}
      tabIndex={0}
      className={cn(
        'inline-flex flex-col gap-2 rounded-md p-2 outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isLowConfidence && 'opacity-80',
        className,
      )}
      data-state={state}
      data-confidence={confidenceLevel}
      data-low-confidence={isLowConfidence ? 'true' : undefined}
    >
      <div className="flex w-full gap-1.5">
        {SOURCE_CATEGORY_ORDER.map((category) => {
          const isFilled = slots[category];
          const isBuilding = buildingCategories?.has(category) ?? false;
          // Filled wins over building: a segment that has already delivered
          // data should NOT regress to "in progress" just because its stage
          // is still in `streamingStages`. AC #5.
          const segmentState: SegmentState = isFilled
            ? 'filled'
            : isBuilding
              ? 'building'
              : 'empty';

          return (
            <div
              key={category}
              role="img"
              aria-label={describeSegment(category, segmentState)}
              data-segment={category}
              data-segment-state={segmentState}
              className={cn(
                'flex flex-1 flex-col gap-1 rounded-sm border transition-opacity',
                segmentState === 'filled' && 'border-transparent',
                segmentState === 'empty' &&
                  'border-dashed border-muted-foreground/40 opacity-60',
                segmentState === 'building' &&
                  'border-transparent motion-safe:animate-pulse',
              )}
              style={segmentStyle(category, segmentState)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-3 truncate px-1 pb-1 text-center text-[10px] font-medium uppercase tracking-wide',
                  segmentState === 'empty'
                    ? 'text-muted-foreground'
                    : 'text-foreground mix-blend-luminosity',
                )}
              >
                {CATEGORY_LABELS[category]}
                {segmentState === 'building' && '…'}
              </span>
            </div>
          );
        })}
      </div>
      {isLowConfidence && (
        <span
          className="self-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          aria-label="Low confidence — limited source coverage"
        >
          Low confidence
        </span>
      )}
    </div>
  );
}
