/**
 * Mock props per fixture component — the data the harness feeds each component
 * so it renders standalone. Keyed by path relative to the repo root.
 */
export interface ComponentMock {
  exportName: string;
  props: Record<string, unknown>;
}

export const mocks: Record<string, ComponentMock> = {
  "fixtures/demo-project/src/components/explore/result-card.tsx": {
    exportName: "ExploreResultCard",
    props: {
      product: {
        id: "demo-1",
        slug: "demo-product",
        name: "Osprey Talon 22 Daypack — Men's S/M",
        brand: "Osprey",
        category: "daypacks",
        imageUrl: null,
        score: 6,
        recallFlag: false,
      },
    },
  },
  "fixtures/demo-project/src/components/product-card/confidence-bar.tsx": {
    exportName: "ConfidenceBar",
    props: {
      sourceCategoriesPresent: ["reddit", "amazon", "youtube"],
      confidenceLevel: "medium",
      state: "final",
      streamingStages: [],
    },
  },
};
