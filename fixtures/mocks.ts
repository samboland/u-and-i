/**
 * Mock props per fixture component — the data the harness feeds each component
 * so it renders standalone. Keyed by path relative to the repo root.
 * Only JSON-serializable values (they also flow into page documents).
 */
export interface ComponentMock {
  exportName: string;
  props: Record<string, unknown>;
}

const UI = "fixtures/demo-project/src/components/ui";

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

  // ---------------------------------------------------------------- ui/
  [`${UI}/ActionButton.tsx`]: {
    exportName: "ActionButton",
    props: { label: "Get started" },
  },
  [`${UI}/AppBar.tsx`]: {
    exportName: "AppBar",
    props: { children: "App bar content" },
  },
  [`${UI}/Badge.tsx`]: {
    exportName: "Badge",
    props: { label: "Verified", dot: true },
  },
  [`${UI}/Card.tsx`]: {
    exportName: "Card",
    props: { children: "Card content" },
  },
  [`${UI}/CardStack.tsx`]: {
    exportName: "CardStack",
    props: {
      levels: [
        { label: "Community", meta: "12" },
        { label: "Marketplace", meta: "8", content: "Bottom card content" },
      ],
    },
  },
  [`${UI}/Checkbox.tsx`]: {
    exportName: "Checkbox",
    props: { label: "I agree to the terms", checked: true },
  },
  [`${UI}/ComplianceBadge.tsx`]: {
    exportName: "ComplianceBadge",
    props: { cert: "Hi-Res Audio", authority: "JAS" },
  },
  [`${UI}/Divider.tsx`]: { exportName: "Divider", props: {} },
  [`${UI}/FormFactorBar.tsx`]: {
    exportName: "FormFactorBar",
    props: { title: "Form factor", labels: ["Powder", "Liquid", "Capsule"], selected: 1 },
  },
  [`${UI}/IconButton.tsx`]: {
    exportName: "IconButton",
    props: { children: "★", label: "favorite" },
  },
  [`${UI}/IconWell.tsx`]: { exportName: "IconWell", props: { children: "★" } },
  [`${UI}/LiftText.tsx`]: {
    exportName: "LiftText",
    props: { children: "Lifted text" },
  },
  [`${UI}/LinkText.tsx`]: {
    exportName: "LinkText",
    props: { href: "#", children: "Learn more" },
  },
  [`${UI}/Navbar.tsx`]: {
    exportName: "Navbar",
    props: {
      items: [
        { id: "home", label: "Home" },
        { id: "explore", label: "Explore" },
        { id: "settings", label: "Settings" },
      ],
      value: "home",
    },
  },
  [`${UI}/PressWell.tsx`]: {
    exportName: "PressWell",
    props: { children: "Press well content" },
  },
  [`${UI}/PrimaryButton.tsx`]: {
    exportName: "PrimaryButton",
    props: { label: "Continue" },
  },
  [`${UI}/SearchBar.tsx`]: {
    exportName: "SearchBar",
    props: { placeholder: "Search products..." },
  },
  [`${UI}/Secredit.tsx`]: { exportName: "Secredit", props: {} },
  [`${UI}/SectionCard.tsx`]: {
    exportName: "SectionCard",
    props: { title: "Details", children: "Section content" },
  },
  [`${UI}/source-dot.tsx`]: {
    exportName: "SourceDot",
    props: { adapterKey: "reddit", count: 12 },
  },
  [`${UI}/StarRating.tsx`]: {
    exportName: "StarRating",
    props: { label: "Overall", value: 4.2 },
  },
  [`${UI}/StatBar.tsx`]: {
    exportName: "StatBar",
    props: { label: "Durability", value: 78 },
  },
  [`${UI}/SubHeader.tsx`]: {
    exportName: "SubHeader",
    props: { children: "Section heading" },
  },
  [`${UI}/Switch.tsx`]: { exportName: "Switch", props: { value: true } },
  [`${UI}/TabBar.tsx`]: {
    exportName: "TabBar",
    props: {
      tabs: [
        { id: "overview", label: "Overview" },
        { id: "reviews", label: "Reviews" },
      ],
      value: "overview",
    },
  },
  [`${UI}/TextField.tsx`]: {
    exportName: "TextField",
    props: { label: "Email", placeholder: "you@example.com" },
  },
  [`${UI}/Toggle.tsx`]: {
    exportName: "Toggle",
    props: {
      options: [
        { id: "light", label: "Light" },
        { id: "dark", label: "Dark" },
      ],
      value: "light",
    },
  },
  [`${UI}/UseRow.tsx`]: {
    exportName: "UseRow",
    props: { name: "Music Listening", description: "Great clarity at low volume." },
  },
  [`${UI}/VoteButton.tsx`]: {
    exportName: "VoteButton",
    props: { direction: "up", count: 24, active: true },
  },
  [`${UI}/input.tsx`]: {
    exportName: "Input",
    props: { placeholder: "Plain input" },
  },
  [`${UI}/ProConCard.tsx`]: {
    exportName: "ProConCard",
    props: { type: "pro", text: "Opens reliably at the stated instant", defaultOpen: true },
  },
  [`${UI}/InfoHint.tsx`]: {
    exportName: "InfoHint",
    props: { label: "Times shown in your home timezone." },
  },
  [`${UI}/Modal.tsx`]: {
    exportName: "Modal",
    props: { open: true, title: "Confirm alert", subtitle: "Uses 1 credit", children: "Modal body content" },
  },
  [`${UI}/SubPanel.tsx`]: {
    exportName: "SubPanel",
    props: { label: "Details", children: "Sub panel content" },
  },
  [`${UI}/SidePanel.tsx`]: {
    exportName: "SidePanel",
    props: {
      items: [
        { id: "home", label: "Home" },
        { id: "alerts", label: "Alerts" },
        { id: "settings", label: "Settings", pinBottom: true },
      ],
      value: "home",
    },
  },
  [`${UI}/DropdownMenu.tsx`]: {
    exportName: "DropdownMenu",
    props: {
      items: [
        { id: "newest", label: "Newest" },
        { id: "oldest", label: "Oldest" },
      ],
    },
  },
  [`${UI}/DropdownButton.tsx`]: {
    exportName: "DropdownButton",
    props: {
      label: "Sort: Newest",
      items: [
        { id: "newest", label: "Newest" },
        { id: "oldest", label: "Oldest" },
      ],
    },
  },
  [`${UI}/NavCardStack.tsx`]: {
    exportName: "NavCardStack",
    props: {
      levels: [
        { key: "domain", label: "Domain", width: 180, children: "Level content" },
        { key: "detail", label: "Detail", children: "Detail content" },
      ],
    },
  },
  [`${UI}/Grainient.tsx`]: { exportName: "Grainient", props: {} },
  [`${UI}/tooltip.tsx`]: {
    exportName: "TooltipProvider",
    props: { children: "Tooltip primitives (see InfoHint for usage)" },
  },
  [`${UI}/icons.tsx`]: { exportName: "IconHome", props: {} },

  // The full /dev/ui playground from adventure-alerts — the design system's
  // living catalog, rendered verbatim.
  "fixtures/demo-project/src/components/playground/playground.tsx": {
    exportName: "UIPlayground",
    props: {},
  },
  "fixtures/demo-project/src/components/playground/palette-reference.tsx": {
    exportName: "PaletteReference",
    props: {},
  },
};
