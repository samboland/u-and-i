/**
 * Source-category vocabulary shared between the synthesis output (which speaks
 * in adapter keys like `'amazon'` / `'reddit'` / `'youtube'`) and UI components
 * that render in canonical category slots (Community / Marketplace / Expert /
 * Hands-On).
 *
 * Lives in `src/lib/` (not `src/engine/` or `src/components/`) so both layers
 * may import from here without crossing the import-rule boundary defined in
 * architecture.md (src/components/ → src/engine/ is forbidden).
 *
 * Pure module: no DOM, no side effects, no `@/lib/types` only.
 */
import type { SynthesisJobStatus } from '@/lib/types';

/**
 * Canonical left-to-right order of the four source-category slots in the
 * ConfidenceBar. Never reorder by which slots are filled — users learn this
 * order across cards.
 */
export const SOURCE_CATEGORY_ORDER = [
  'community',
  'marketplace',
  'expert',
  'handson',
] as const;

export type SourceCategory = (typeof SOURCE_CATEGORY_ORDER)[number];

/**
 * Adapter-key → category-slot mapping.
 *
 * All four category slots are populated: Community (Reddit), Marketplace
 * (Amazon only — Walmart/Target/HomeDepot adapters removed per SQ15),
 * Expert (Wirecutter/RTINGS/etc via Brave discovery + Jina scraping, Firecrawl
 * fallback), Hands-On (YouTube via yt-dlp). The Expert slot was intentionally
 * empty at MVP launch but is now wired up with the expert-fetcher adapter.
 *
 * Declared with `as const` so the keys form a literal union (`AdapterKey`)
 * usable elsewhere as a strict type — e.g. `STAGE_TO_ADAPTER` constrains its
 * value type to `AdapterKey` so a typo doesn't silently break the mapping.
 */
export const ADAPTER_TO_CATEGORY = {
  reddit: 'community',
  amazon: 'marketplace',
  youtube: 'handson',
  expert: 'expert',
} as const satisfies Record<string, SourceCategory>;

export type AdapterKey = keyof typeof ADAPTER_TO_CATEGORY;

/**
 * Synthesis-job streaming-stage → adapter-key mapping. Used by the streaming
 * integration in ConfidenceBar to derive which segment is currently
 * `building` from the SSE stage events emitted by `/api/product/[slug]/stream`.
 *
 * Typed as `Partial<Record<SynthesisJobStatus, ...>>` so that any future
 * rename or addition to `SynthesisJobStatus` (e.g. `fetching_amazon` →
 * `fetch_amazon`) surfaces as a compile-time error rather than silently
 * losing its mapping at runtime.
 */
export const STAGE_TO_ADAPTER: Partial<
  Record<SynthesisJobStatus, AdapterKey>
> = {
  fetching_amazon: 'amazon',
  fetching_reddit: 'reddit',
  fetching_youtube: 'youtube',
  fetching_expert: 'expert',
};

/** Human-readable labels for the four category slots. */
export const CATEGORY_LABELS: Readonly<Record<SourceCategory, string>> = {
  community: 'Community',
  marketplace: 'Marketplace',
  expert: 'Expert',
  handson: 'Hands-On',
};

/** Map from category slot to its source-color CSS variable name. */
export const CATEGORY_COLOR_VAR: Readonly<Record<SourceCategory, string>> = {
  community: '--source-community',
  marketplace: '--source-marketplace',
  expert: '--source-expert',
  handson: '--source-handson',
};

/** Map from category slot to its muted (empty-state) CSS variable name. */
export const CATEGORY_MUTED_VAR: Readonly<Record<SourceCategory, string>> = {
  community: '--source-community-muted',
  marketplace: '--source-marketplace-muted',
  expert: '--source-expert-muted',
  handson: '--source-handson-muted',
};

export type CategorySlots = Record<SourceCategory, boolean>;

/**
 * Convert `sourceCategoriesPresent` (an array of adapter keys from the
 * synthesis output) into a fixed-shape record describing which of the four
 * canonical slots are filled. Unknown adapter keys are silently ignored.
 */
export function categoriesPresentToSlots(
  present: readonly string[],
): CategorySlots {
  const slots: CategorySlots = {
    community: false,
    marketplace: false,
    expert: false,
    handson: false,
  };
  for (const adapter of present) {
    if (isAdapterKey(adapter)) {
      slots[ADAPTER_TO_CATEGORY[adapter]] = true;
    }
  }
  return slots;
}

/** Type-narrowing predicate for adapter keys. */
export function isAdapterKey(value: string): value is AdapterKey {
  return value in ADAPTER_TO_CATEGORY;
}
