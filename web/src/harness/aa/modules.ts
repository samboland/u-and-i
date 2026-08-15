/**
 * Lazy module map over the adventure-alerts component tree. import.meta.glob
 * needs a literal pattern, so the sibling-checkout location is baked in; if
 * the repo is absent the glob is simply empty and AA features disappear.
 * Keys are project-prefixed: "aa:src/components/layout/footer.tsx".
 */
export const aaModules: Record<string, () => Promise<unknown>> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../../../../adventure-alerts/src/components/**/*.tsx"),
  ).map(([k, loader]) => {
    const rel = k.slice(k.indexOf("/src/components/") + 1);
    return [`aa:${rel}`, loader as () => Promise<unknown>];
  }),
);
