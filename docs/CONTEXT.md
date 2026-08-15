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

## Capability map — everything AA's frontend has, and how u-and-i builds it

This is the tool's requirements document. The editor shell must anticipate ALL
of it — panels designed only for today's features will be obsolete in weeks.

| AA has | u-and-i answer | Status |
|---|---|---|
| Shell chrome (sticky header, 158px collapsible rail, content offset, footer) | Page composition + a **generic style map** on every section/column/block (`position: sticky`, `calc()` heights, z-index, px widths, colors, typography) | Next build |
| ~43 design-system components | Code-is-truth workbench + drag-from-toolbox | ✅ Built (31 imported) |
| Layouts & route groups (`(main)`, `(auth)` chrome) | **Layout documents** — shared shell with a content slot; pages assign to a layout; codegen emits `layout.tsx` | Planned |
| Navigation between pages, role-gated rail items | Link wiring between u-and-i pages; gating is a context (below) + dev note | Planned |
| Data-driven lists (alerts list, search results, client kanban) | **Repeater block** bound to a *sample-data collection* — design the item once, see N rendered; real data source = dev note at the binding | Planned |
| Forms (signin, alert setup, client create) | Form components exist; submit/validation logic = dev note | Mostly covered |
| Loading / empty / error / role / tier variants; focus mode | **Context picker** — render the canvas under a chosen context (role=advisor, state=loading, alert-close). Every state designable; the logic that selects it = dev note | Planned (key concept) |
| Light/dark (abyss) themes, reduced effects | Token editor ✅ + **canvas theme toggle** | Toggle pending |
| Live elements (clocks, countdowns, streaming badges, beacon slam) | Real components run live on the canvas | ✅ Inherent |
| Modals, dropdowns, tooltips (open states) | Context picker ("render with this open") | Same as variants |
| Motion (GSAP, press states) | Press/hover live in tokens/CSS ✅; scripted motion = dev note | Acceptable |
| Assets (logos, fonts, images) | **Asset drawer** — drop files in, correct paths in codegen | Planned, small |
| Dynamic routes (`/product/[slug]`) | Page templates with sample params; data = dev note | Follows repeater |
| The actual app tree | **Real-repo targeting** — generate into AA's `app/` structure, edit AA's own components in place | The graduation step |

**Dev notes** thread through everything: an annotation attached to any
element/page marking where real coded behavior begins ("posts to
/api/waitlist", "fed by Meilisearch"). They render as badges on canvas, emit
`@dev-note` comments in generated code, and aggregate into a project-wide
Notes panel — the integration worklist handed to a developer or AI.

Build order: style map → dev notes → context picker → repeater/sample data →
layouts/nav → real-repo targeting; theme toggle + asset drawer as small wins.

## Note for editor-UI design specifically

The u-and-i editor's own chrome is a **tool**, not an AA surface — it should
look like a professional editor (Figma/Blender panel discipline), dark, quiet,
dense, out of the canvas's way. Design the shell to accommodate the FULL
capability map above, not just what exists today. Concretely that means homes
(panels, tabs, drawers, or modes) for:

- Pages list · Layouts list · Components list · Layers tree
- Insert/toolbox (drag onto canvas) — blocks, structure, components
- Inspector: generic style editing (layout, box-model, typography, arbitrary
  properties), classes, text, props
- **Dev notes**: per-element note editor + a project-wide notes/worklist panel
- **Context picker**: a canvas-level control choosing role/state/theme/breakpoint
  the page renders under (think: a bar above the canvas, not buried)
- **Sample data**: manage named collections; bind repeaters to them
- Design tokens browser + the future **material studio** (sculpting neumorphic
  surface recipes — gradients, shadow stacks, depth tiers — with live preview)
- Asset drawer
- Canvas chrome: zoom/width presets, theme toggle, current layout indicator
- Kernel rule for implementers: every panel talks to the daemon API /
  postMessage protocol only — no editor logic inside panel components.
