# Context for anyone (human or AI) designing or building on u-and-i

Read this before designing UI or composing demo content. It corrects a
misunderstanding that previously leaked into this repo's fixtures and demos.

## What u-and-i is

A visual frontend studio where **real code is the source of truth**. Panels are
HTML/CSS in an Electron shell (VS Code/Figma architecture); the canvas renders
the user's actual React components through Vite. Edits land in source files as
minimal diffs. Two layers:

- **Components** — code-is-truth: real `.tsx` files, round-tripped via AST
  (recast). Click an element on the canvas, edit styles/classes/text/props,
  the file changes surgically.
- **Pages** — builder-owned documents (JSON) that deterministically generate
  clean React/Next code. The canvas renders the *generated file*, so preview
  and output can never diverge.

**Kernel/shell split (architectural rule):** all editor logic lives behind the
daemon HTTP API (`server/api.ts`) and the canvas postMessage protocol
(`web/src/shared/protocol.ts`). Panels are a swappable shell over that kernel —
new panel UI must talk to the same API, never embed logic.

The medium-term goal: **reconstruct and then manage the entire frontend of
Adventure Alerts** in u-and-i, leaving "Dev notes" wherever real coded behavior
begins (planned feature: notes attach to elements, emit `@dev-note` comments in
generated code, and aggregate into an integration worklist).

## What Adventure Alerts actually is

A **booking-intelligence engine for time-sensitive travel bookings** — booking
windows that open at a precise instant (park permits, restaurant reservations,
ticket drops). The user books on their PC; their phone is a **beacon** that
fires at exactly T-0. The product's spine is *not-missing*: calm, prepared,
present. Never "beat the crowd" / race / urgency-to-win language.

- Two halves: the **Booking Intelligence Engine** (shared crawled → synthesized
  → verified corpus; its UX face is the "Booking Browser" tab — label TBD) and
  **Alerts** (per-user subscriptions, trips, clients, the beacon).
- Advisor vertical: travel advisors manage multiple clients (Tern-style kanban)
  — this is the revenue engine.
- The **beacon is one bit**: a full-screen luminance slam from `beacon-armed`
  (#0B0C12, near-black) to `beacon-fired` (#FFFFFF). Luminance and motion carry
  the signal — never hue. Theme-invariant.
- Confidence/precision is expressed **in words**, never rendered as a meter,
  gauge, ramp, or sweep.

### ⚠️ The residue trap

`result-card.tsx`, `confidence-bar.tsx`, and anything product-review-shaped
(scores "/7", Browse/Explore) are **ported residue from `secretless`**, a
previous product whose *design system* Adventure Alerts inherits. They are
excellent examples of the visual system but they are **not the AA domain** —
do not design AA surfaces around product cards or review scores. The
`--source-*` colors are a **provenance trust ladder** (community / marketplace
/ expert / hands-on / exclusive / verified) labeling where a crawled fact came
from — never status, never the beacon.

## The Adventure Alerts web shell (what u-and-i must be able to rebuild)

- **Header** — sticky, 48px: logo + sidebar toggle · centered SearchBar ·
  account/accessibility cluster on the right.
- **Sidebar** — collapsible, role-gated, 158px rail: Home · Alerts · Booking
  Browser · [Clients: advisors] · — · [Admin] · [Dev: operators] · Settings
  (bottom-pinned). Source: `src/components/layout/nav-items.tsx` in the AA repo.
- **ContentArea** — `min-height: calc(100vh - 48px)`, centered max-width column
  clearing the sidebar.
- **Footer**.
- **Home doubles as the booking cockpit** — enters a "focus mode" when an alert
  is close (big clock, next-up).

## Visual system ("secretless shell" + Seven Seas palette)

- **Neumorphic**: soft convex surfaces lit from above, inset troughs for
  pressed/inputs. Depth is the primary device, not flat layers. Recipes live in
  `ui.css` (`--ui-*` family) — reference by name, never restate values.
- **Seven Seas** (light): parchment ground (L* 93.2), warm ink (never pure
  black), caribbean-teal primary, compass-gold accent. Surfaces **straddle**
  the ground's luminance (top stop above it, bottom stop below) — that straddle
  is what makes a control read as raised; collapse it and the edge merges with
  the page.
- **Dark**: navy "abyss" (#0B1D33) canvas; cards go **lighter** than the
  canvas, never darker.
- **Type**: Goudy Old Style (display — a punctuation mark, not the default
  voice) · Cabin (body/UI) · Inconsolata (mono). Uppercase labels: 600 weight,
  0.04em tracking.
- **Radii**: 10px default, 14px for search bar, pills at 9999px. No hard
  corners on raised surfaces.
- Chrome stays near-monochrome and recedes; **the moment carries attention**.

Canonical AA docs (in the adventure-alerts repo): `README.md`, `CLAUDE.md`
(invariants), `_bmad-output/planning-artifacts/navigation-and-product-model.md`,
`.../ux-designs/ux-adventure-alerts-2026-06-22/DESIGN.md`,
`.../seven-seas-token-migration.md`.

## Note for editor-UI design specifically

The u-and-i editor's own chrome is a **tool**, not an AA surface — it should
look like a professional editor (think Figma/Blender panel discipline), stay
out of the canvas's way, and support: Pages/Components lists, Layers tree,
insert/toolbox (drag onto canvas), style inspector (layout, box-model margins,
classes, text), props, design tokens, and (planned) Dev notes and a material
studio for sculpting the neumorphic token system. Dark, quiet, dense.
