# Roadmap

Where u-and-i is and what's next. Update this as priorities shift — it's the
first thing a new session should read after CLAUDE.md.

## Docking windows (DONE — 2026-08-18)

The three fixed columns are gone. Panels — Insert, Canvas, Outliner,
Properties, Style, Workshop — are cards in a split/tab tree
(`web/src/editor/v3/dock.tsx`); drag a pane's icon onto another pane's header
to stack them, or onto a pane's edge to split it. Drag to the dock's outer
edge for a full-width/height band. Splitters resize; the × closes a panel and
View ▸ Panels reopens it (plus **New canvas pane** and **Reset layout**).

**Headers follow Blender, not VS Code** (Sam, 2026-08-18: text tabs ate too
much room). Each pane has ONE header row: a small icon dropdown naming the
panel, then that panel's own controls inline beside it. Panels sharing a pane
show as bare icons — no labels anywhere, names live in the dropdown and in
tooltips. That folded four title bars into the tab strip and bought back a
row per pane (Insert's search box, the Outliner's File/Routes switch, the
Properties selection name and the whole canvas toolbar all moved up there).

**Drop targeting** (reworked 2026-08-18 after Sam found drags "weird" and
some arrangements unreachable). Three bugs, all now covered by checks:

- **The canvas iframe ate the drag.** A pointer over an iframe delivers its
  events to *that* document, so the preview froze at whatever it read just
  before the cursor crossed the frame — and the canvas is most of the window.
  A transparent shield over the dock for the duration of the drag fixes it.
  Any future pointer-drag across the canvas needs the same treatment.
- **The outer top edge was unreachable**, so no full-width top band. The
  invisible edge band and the top row's headers overlapped and the header
  won. The four outer strips are now *drawn* during a drag, and take
  precedence — visible precedence is honest; invisible precedence is a trap.
  Nothing is lost: a pane's middle also means "add a tab".
- **Zones were pixel bands**, so a 240px sidebar behaved unlike a 900px
  canvas — the side bands nearly met and the middle was a sliver. Zones are
  proportional now: middle two-fifths tabs, the rest splits.

**Drop feedback follows VS Code** (Sam, 2026-08-18, pointing out VSCodium is
open source — so the numbers below are read off `editordroptarget.css` and
`editorDropTarget.ts`, not eyeballed):

- One flat translucent panel, `rgba(83,89,93,0.5)` — their dark-theme
  `editorGroup.dropBackground`, a neutral wash rather than an accent tint.
  No border, no radius.
- It *glides* between targets: `top/left/width/height` at 70ms ease-out,
  opacity at 150ms. The move transition is enabled only **after** the overlay
  first appears, so it fades in where it belongs instead of sliding in from
  wherever it last sat. Copy that if you ever rebuild this.
- Their merge-vs-split rule is the middle 30–70% on both axes, which is what
  `zoneOf` already did.
- Aimed at a pane header, a **caret** shows the exact insertion point in the
  tab order — which is also how tabs are re-ordered, previously impossible.
- The dock has a `GUTTER` so the outer drop zone sits beside the panes rather
  than on top of the top row's headers, which had made a caret drop there
  nearly unhittable.

We keep a 32% split rather than VS Code's 50%, because the preview must match
what you actually get and a half-and-half sidebar is wrong for this app.

**Panes are rounded cards on a void, not flush surfaces with a divider** (Sam,
2026-08-18, with a screenshot of VS Code's window chrome). The barrier is the
*gap*: `GAP`/`GUTTER` of 8px, `RADIUS` 8, one hairline outline per card, and a
three-dot grip at the middle of each sash. Two earlier attempts at a drawn
divider — a 6px slab, then a 1px hairline — both read as a smudge, because a
line between two flush surfaces has nothing to separate. The outline matters
for the canvas pane specifically: its body is the same near-black as the gap,
so without it the card dissolves into the background.

Decisions Sam settled at design time: **individual cards**, not whole
workspaces; cards always dock somewhere — nothing floats FL-Studio-style;
the arrangement saves itself into the per-project session; and yes, the
canvas may be more than one pane.

Two things worth knowing:

- **Layout and Component share one tree.** They hold the same panels and
  differ only in what the canvas draws. Sharing keeps the canvas leaf in the
  same position across that switch, so the harness iframe (mounted module +
  sample props) survives it — as it did before docking. Style and Workshop
  keep their own trees.
- **Extra canvas panes are extra *live* views**, each with its own path.
  The component harness is a single iframe (one mounted module), so it stays
  with the primary pane. Probe messages reach every live frame, so each pane
  filters on `event.source` being its own.

Standing check: `scripts/checks/dock.mjs` (u-and-i's dev server only).

## Where we are (2026-08-16)

Code-is-truth editor serving one real Next.js app (adventure-alerts).
Working today: route interpretation + follow-the-shell, live rendering of
client components with sample props, full structural AST editing (insert/
delete/move/duplicate/drag-drop with import management + fidelity guard),
in-place text editing on the canvas, byte-perfect undo, per-project session
+ preferences, Style/Workshop writing to the app's real globals.css, and
**live mode**: the target's own running `next dev` mirrored on the canvas,
click-to-source selection through its source maps, and edits that HMR back
into the live page (see "Render the real app" below).

## Next (near-term, high value)

- **Editing dynamic regions** — the biggest editability gap. Map callbacks,
  ternary branches, expression props, dynamic `style`/`className` are
  read-only pseudo-content today. Start with the safest slices: editing
  string literals inside expressions, then the JSX inside map callbacks
  (already real indexed nodes — mostly a UI trust problem, edits apply to
  the template).
- **Compose views in their shells** — render a page's view inside the real
  layout chrome (Header/Sidebar/ContentArea around HomeView) so editing
  happens in context. The shell components already render; this is a
  wrapper-composition feature in the harness.
- **wrap-element** AST op (wrap selection in a flex container) — deferred
  from the edit-engine milestone for reprint risk; the fidelity guard makes
  it safe to attempt now.

## Render the real app (core loop DONE — rough edges remain)

**Why.** `npm run dev` eats real data, so u-and-i should too. Pages that
load data (`/account` is the reference case) never rendered on the canvas.
That was our rule, not a Next.js limit: the harness aliases `@/db`,
`@/auth` and `next/headers` to stubs that raise on any access, so the page
dies before React sees it. The fix is not to fake the data — it is to show
the app that already has it.

**Shape.** u-and-i mirrors the target's own `next dev` and frames it. The
target app is never modified: no `next.config.ts` entry, no CSP change.
Everything the canvas shows inside live mode is the real running app.

### Done

1. **Mirror** — `server/live-proxy.ts`. Forwards everything to the target's
   dev server (`uai.config.json` → `devUrl`, `UAI_DEV_URL`, default
   `http://localhost:3000`) on a port we own (`livePort` /`UAI_LIVE_PORT`,
   default 4410, walks up on EADDRINUSE — **4401 was already taken on Sam's
   box by another node app**). Websocket upgrades proxy too, so the
   target's HMR still works. Strips `X-Frame-Options` and the per-request
   CSP (its nonce + strict-dynamic would block our script), and injects
   `web/src/harness/live-probe.js` into every HTML response.
   `/api/project` reports the chosen origin as `live`.
2. **Live canvas** — `LiveCanvas` in `App.tsx`. Device width + zoom are
   applied editor-side (we can't inject a stage into a page we don't
   render). Steered by a path bar and by clicking a route in the Routes
   tree. The probe reports where the app actually landed, and a banner
   calls out redirects. The live app IS the Layout workspace's canvas —
   there is no Component/Live toggle. The old per-component canvas moved
   to a fourth workspace tab (`Component`, after Workshop) that reuses the
   same body; `canvasMode` derives from the workspace, and workspace +
   live path persist in the per-project session, so an editor reload (F5,
   vite restart — server/*.ts are vite-config deps, editing them restarts
   the running dev server and reloads the editor) always comes back to the
   live view it was on.

3. **Click → source** — clicking an element in the live canvas lands the
   editor on its file with the JSX node selected (outliner + Properties
   card; the canvas stays live). The chain: probe click handler →
   `fiber._debugStack` owner frame → `/api/live-resolve`
   (`server/live-resolve.ts`, source maps via `source-map-js`) →
   `nodeAtPosition` in `server/ast.ts` → `openFile` + focus. Select is the
   probe's default; the editor's Interact toggle passes clicks through.
   Verified for both map sources: client chunks (`.map` fetched from the
   upstream dev server) and server components (`about://React/Server/…`
   paths read off `.next/dev/server/chunks/ssr/` disk). Standing check:
   `scripts/checks/live-click.mjs`.

   Answers to the old open questions: the owner frame lands on the clicked
   element itself, not its parent (a `/terms` h1 resolved to the exact
   `<Tag>` in `markdown.tsx`); resolution runs server-side (disk access, no
   CORS); Turbopack's dev maps are indexed (`sections`) and line-granular
   (column often 0), which is why `nodeAtPosition` prefers "element
   starting on that line" over strict containment.

4. **Edit through a live selection** — verified, no new machinery needed:
   the funnel writes the file, the target's own HMR carries the change into
   the live frame within a few seconds, undo (byte-verbatim restore) rolls
   it back the same way, the file ends git-clean, and the editor's open
   file + selection survive the reload. Standing check:
   `scripts/checks/live-edit.mjs` (needs both dev servers). F2 in-place
   editing is component-canvas-only (guarded — the live iframe is a page we
   don't render into); the Properties Content field is the live-mode path
   for text.

### Known rough edges

- The probe's highlight box is a selection flash, not a tracked overlay —
  it goes stale on scroll. Fine for now; revisit with hover outlines.
- ~~The canvas has no session, so `/account` and `/waitlist` redirect to
  `/signin`.~~ Fixed: OAuth can't run inside the iframe (GitHub won't be
  framed), so the redirect banner's "Sign in…" opens the target's own
  `/signin` in a top-level window and reloads the frame when it closes —
  the session cookie is host-scoped (`localhost` ignores ports), so the
  mirror sees it. Works in Electron too (default `window.open` shares the
  session). Check: `scripts/checks/live-signin.mjs` verifies each
  mechanical link; the actual OAuth completion needs human credentials.
  The same investigation fixed the mirror forwarding `Transfer-Encoding`
  alongside its recomputed `Content-Length` — invalid HTTP that strict
  clients reject. Verified in the real Electron shell (Playwright
  `_electron`): the popup reaches GitHub's login with the right
  `localhost:3000` callback, and a host-scoped `localhost` cookie set via
  port 3000 is visible to the live iframe on the mirror port. The one
  unautomatable hop is typing real GitHub credentials.
- ~~The Next dev-tools badge shows in the corner of the live canvas.~~
  Fixed: the probe styles `#devtools-indicator` inside the `nextjs-portal`
  shadow root to `display:none` — only the badge; build-error overlays in
  the same root stay visible.
- `Preview` and the component canvas are unchanged and still per-component.

## Later

- **Route scaffolding** — "new page" returns: create `src/app/<route>/page.tsx`
  as plain hand-editable code from the Routes tree.
- **Sample-prop capture depth** — richer payloads for big view-model props
  (home-view's 14 props); possibly record real props from a running
  `next dev` session.
- **Generic targets** — the canvas chrome (fonts, session shape, provider
  stack, icon SVG defs) has adventure-alerts-specific pieces; make them a
  per-target config so any Next app renders faithfully. Add target
  switching to Preferences / an Electron folder picker.
- **Style workspace depth** — the token category map was tuned against the
  old fixture copy of globals.css; re-verify occurrence mapping against the
  real file, and grow token coverage.
- **Cross-file cut/paste** of elements.

## Someday

- Electron packaging (electron-builder), app icon, auto-update.
- Multi-select, marquee selection, alignment guides.
- Keyboard remapping, default-device preference (placeholders already in
  the Preferences window).
- Visual diff/review panel (show the session's git diff inside the editor).

## Standing constraints

No save format ever; no git operations in the target; fidelity guard stays
mandatory for every new edit op.

Not a constraint — a gap: today's canvas can't show pages that load real
data, because the harness aliases `@/db`, `@/auth` and `next/headers` to
stubs that raise an error on any access. `npm run dev` eats real data, so
this should too. See "Render the real app" above; the old "assisted mode"
wording made a workaround sound permanent.
