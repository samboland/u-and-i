/**
 * Minimal stand-in for adventure-alerts' `@/lib/types` — only the types the
 * fixture components actually import.
 */
export type ConfidenceLevel = "low" | "medium" | "high";

export type SynthesisJobStatus =
  | "queued"
  | "fetching_amazon"
  | "fetching_reddit"
  | "fetching_youtube"
  | "fetching_expert"
  | "synthesizing"
  | "complete"
  | "failed";
