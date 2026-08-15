# Roadmap

Where u-and-i is and what's next. Update this as priorities shift — it's the
first thing a new session should read after CLAUDE.md.

## Where we are (2026-08-15)

Code-is-truth editor serving one real Next.js app (adventure-alerts).
Working today: route interpretation + follow-the-shell, live rendering of
client components with sample props, full structural AST editing (insert/
delete/move/duplicate/drag-drop with import management + fidelity guard),
in-place text editing on the canvas, byte-perfect undo, per-project session
+ preferences, Style/Workshop writing to the app's real globals.css.

## Next (near-term, high value)

- **Render the real app** — IN PROGRESS, the headline work. See the
  dedicated section below before touching anything else.
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

## Render the real app (in progress — read this first)

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

### Next: step 3 — click an element, land on its source line

This is the piece that turns live mode from a viewer into an editor.

The chain, all verified to be available except the last hop:

- DOM node → React fiber (`el.__reactFiber$…`).
- fiber → **`fiber._debugStack`**, an Error whose stack names the component
  that created the element, at a position in the *compiled* bundle.
  React 19 removed `_debugSource`; this replaces it. `live-probe.js`
  already has `ownerFrame()` for this.
- Client components resolve to `/_next/static/chunks/src_*.js:LINE:COL`.
  Server components resolve to
  `about://React/Server/<url-encoded .next/dev/server/chunks/ssr/*.js>?N:LINE:COL`
  — note the `?N` cache-buster before the line number, and that the path is
  percent-encoded and Windows-backslashed.
- compiled position → **source map** → real file + line + column. Turbopack
  serves `.map` files next to the chunks; server chunks are on disk under
  the target's `.next/dev/server/chunks/`. NOT YET BUILT.
- file + line/col → JSX node. `server/ast.ts` already knows every
  JSXElement's `loc`; add a lookup that returns the preorder index whose
  span contains the position (innermost wins). Then the existing model,
  selection, Properties card, AST edits and undo all work unchanged.

Open questions for whoever picks this up:

- The owner stack names the *creating component*, so the position is the
  JSX call site. Confirm it lands on the element itself and not the parent
  when components are nested.
- Decide where source-map resolution runs. Server-side (`server/`) is
  easier: it can read `.next/dev/**` off disk, and Node has no CORS.
- Editing a live page means the file changes underneath a running Next dev
  server. HMR should handle it; verify the fidelity guard and undo behave
  when the app reloads mid-edit.

### Known rough edges

- The canvas has no session, so `/account` and `/waitlist` redirect to
  `/signin`. Signing in inside the canvas should stick (cookies ignore
  port), but this is untested.
- The Next dev-tools badge shows in the corner of the live canvas.
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
