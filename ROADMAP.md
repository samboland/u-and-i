# Roadmap

Where u-and-i is and what's next. Update this as priorities shift — it's the
first thing a new session should read after CLAUDE.md.

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
2. **Live canvas** — `Component / Live app` toggle in the canvas toolbar
   (`LiveCanvas` in `App.tsx`). Device width + zoom are applied editor-side
   (we can't inject a stage into a page we don't render). Steered by a path
   bar and by clicking a route in the Routes tree. The probe reports where
   the app actually landed, and a banner calls out redirects.

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
- The canvas has no session, so `/account` and `/waitlist` redirect to
  `/signin`. Signing in inside the canvas should stick (cookies ignore
  port), but this is untested.
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
