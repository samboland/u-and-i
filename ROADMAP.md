# Roadmap

Where u-and-i is and what's next. Update this as priorities shift — it's the
first thing a new session should read after CLAUDE.md.

## Docking windows (DONE — built 2026-08-18, reworked through 2026-08-26)

The three fixed columns are gone. Panels are cards in a split/tab tree
(`web/src/editor/v3/dock.tsx`), rearranged by dragging a pane's header icon,
persisted per project. Written as current state: this was six rounds of Sam's
feedback and an append-only log had started correcting itself in place.

### The model is Blender's

**Any pane can hold any panel, any number of times.** Nothing is restricted:

- Every panel is duplicable (`insert`, `insert#2`, …), so a split always has
  something to clone into the new half.
- Every panel is in every pane's type dropdown, in every workspace — Style and
  Workshop included on Layout.
- The **workspace tabs are preset arrangements**, not filters. A `Preset` is
  just which saved tree a tab shows and what it starts as. There is no
  mandatory panel; `closePanel` refuses to remove the last one, so no tree can
  empty out.
- The **type dropdown sets what the pane IS** (`setPaneType`) — Blender's
  editor menu. It clones the chosen panel here and leaves any existing one
  alone. (It used to *pull* the named panel here from wherever it lived, which
  only made sense while panels were unique: picking "Outliner" ripped the
  Outliner out of the sidebar.)
- **Per-instance panel state** goes through `usePaneState` in `App.tsx`. A
  panel is one component rendered once per instance id, not an independent
  editor, so without this two Outliners move as one. `setAll` covers the
  genuinely global acts — opening a file switches every Outliner to File.

Sam settled the frame at design time: individual cards, not whole workspaces;
cards always dock somewhere, nothing floats FL-Studio-style; the arrangement
saves itself into the per-project session.

**Layout and Component share one tree.** They hold the same panels and differ
only in what the canvas draws, and sharing keeps the canvas leaf in place
across that switch so the harness iframe (mounted module + sample props)
survives it. Style and Workshop keep their own.

**Extra canvas panes are extra *live* views**, each with its own path. The
component harness is a single iframe (one mounted module), so it stays with
the primary pane. Probe messages reach every live frame, so each pane filters
on `event.source` being its own.

### Pane chrome

**One header row per pane** — a small icon dropdown naming the panel, then
that panel's own controls inline beside it (Insert's search, the Outliner's
File/Routes switch, the Properties selection name, the canvas toolbar and its
zoom stepper). Panels sharing a pane show as bare icons. No labels anywhere:
names live in the dropdown and in tooltips. That folded four title bars into
the tab strip and bought back a row per pane.

**No close button.** Join is how a pane goes away, View ▸ Panels is how a
panel does; the × was a third mechanism for neither.

**Panes are rounded cards on a void, not flush surfaces with a divider.** The
barrier is the *gap*: `GAP` and `GUTTER` 4, `RADIUS` 8, one hairline outline
per card, a three-dot grip at the middle of each sash, and `GRAB` of overhang
each side so a seam that narrow is still easy to catch. Two earlier attempts
at a drawn divider — a 6px slab, then a 1px hairline — both read as a smudge:
**a line between two flush surfaces has nothing to separate.** The outline
matters most for the canvas pane, whose body is the same near-black as the
gap.

The grip is centred by `transform`, not flex — see the zoom trap below.

**Cursors.** `ew-`/`ns-resize` on a sash (you drag it to resize);
`col-`/`row-resize` inside the split modal (there it means what it draws);
`context-menu` on the outer border (it opens a menu and cannot be dragged).

**`MIN_PANE` is 72** — the smallest a splitter drag may squeeze a pane to,
and doubled, the narrowest a pane can be and still split. It was 120, which
quietly excluded every sidebar from splitting: the Insert column is ~238px,
just under the 240 that needed. Blender's own minimum is about one header's
worth.

### The outer border is live

The gutter ring used to be the one piece of dock chrome you could see and not
use — a scan of every non-pane pixel found ~7000 dead ones, all of it that
ring. `EdgeBorders` makes it clickable: right-click gets the adjoining pane's
Split options, and only those, because with one neighbour there is nothing to
Join or Swap it with (Blender guards its own entries with `if (sa1 && sa2)`).
The scan now reports zero dead pixels.

**Not cosmetic.** A dock reduced to one pane has no sashes at all, so without
a clickable outer border there is no way to ever split again. That rules out
the tidier-looking fix of deleting the gutter entirely, which is what Blender
does — `screen_geom_area_map_find_active_scredge` explicitly skips edges lying
on the window bounds. Blender can, because its top and bottom work-area edges
are shared with the global topbar and status bar and so are real, actionable
edges. Ours have no neighbour, so the border itself has to be the target.

The strips overhang 2px into the panes' rounded edges to make a 4px ring
comfortable, and sit above the panes — a right-click over the canvas would
otherwise be swallowed by the iframe.

### Drag and drop follows VS Code

Drag a pane's icon onto another pane's header to stack them, onto a pane's
edge to split it, or to the dock's outer edge for a full-span band. The
numbers are read off `editordroptarget.css` and `editorDropTarget.ts` (Sam
pointed out VSCodium is open source), not eyeballed:

- One flat translucent panel, `rgba(83,89,93,0.5)` — their dark-theme
  `editorGroup.dropBackground`, a neutral wash rather than an accent tint. No
  border, no radius.
- It *glides* between targets: `top/left/width/height` at 70ms ease-out,
  opacity at 150ms. The move transition is enabled only **after** the overlay
  first appears, so it fades in where it belongs instead of sliding in from
  wherever it last sat. Copy that if you ever rebuild this.
- Their merge-vs-split rule is the middle 30–70% on both axes, which is what
  `zoneOf` does. Zones are proportional, not pixel bands — bands made a 240px
  sidebar behave unlike a 900px canvas, the side bands nearly meeting and the
  middle reduced to a sliver.
- Aimed at a pane header, a **caret** shows the exact insertion point in the
  tab order — which is also the only way to re-order tabs.
- The four outer strips are *drawn* during a drag and take precedence over the
  pane beneath. They were invisible and lost to the top row's headers, which
  made a full-width top band unreachable; visible precedence is honest,
  invisible precedence is a trap. Nothing is lost, because a pane's middle
  also means "add a tab".

We keep a 32% split rather than VS Code's 50%: the preview must match what you
actually get, and a half-and-half sidebar is wrong for this app.

### Area Options, from Blender's source

Right-click a sash: Vertical Split, Horizontal Split, Join ×2, Swap Areas.
Read off `editors/screen/screen_ops.cc` (`screen_area_options_invoke`), which
corrected two things we had guessed wrong.

- **Join** labels the direction the *survivor grows*, not the side you keep:
  "Join Right" keeps the LEFT pane and expands it rightwards. We had it
  inverted. The menu order follows the same rule — Right-then-Left on a
  vertical sash, Up-then-Down on a horizontal one (Blender's Y axis points up,
  ours down, so the two cases keep opposite children).
  Blender's `screen_area_join_aligned` ends in `screen_delarea(sa2)`; we fold
  the losing pane's panels in as tabs instead, because our panes stack and
  Blender's don't. Nothing is lost either way now that any panel can be
  recreated from any type dropdown.
- **Swap** trades the pair. Sizes stay with the *position*, not the pane, so
  the geometry is untouched and only the contents move.
- **Split is modal** — picking it cuts nothing, it arms a phantom you place by
  hand (`area_split_modal` + `screen_draw_split_preview`):
  - The target is **re-picked on every move** (`BKE_screen_find_area_xy` per
    event), so sliding into another pane re-aims. That is why Split names no
    target and greys out for nothing — there is nothing to name until you move.
  - The phantom is **two outlined ghosts** either side of the pending line,
    white at 10% fill / 40% outline. At the extremes
    (`factor < 0.0001 || factor > 0.9999`) it stops proposing a cut and
    highlights the whole area, which is also our "can't split this" state.
  - **Tab** or middle-click flips the axis, **Ctrl** snaps, **click** commits,
    **Escape** or right-click cancels.
  - Snapping is Blender's twelfths plus its align-to-other-edges pass. Blender
    aligns to free vertices; we have none, so we snap to the other panes'
    sashes on the same axis.
  - `area_split_allowed` (≥2× the minimum on the axis) carries over and is now
    the *only* thing that refuses a split. A stacked pane tears its ACTIVE tab
    into the new half — Blender has no tabs, so no equivalent — and a pane
    holding one panel clones it, which is what Blender does every time.
- **Merge Edge**, Blender's fourth item, is deliberately absent. It extends a
  sash across aligned neighbours, which needs free-form vertex geometry; our
  layout is a split tree with no vertices to align.

### Traps that cost real time

- **A pointer over an iframe delivers its events to that document, not ours.**
  The canvas is most of the window, so a drag across it froze the preview at
  whatever it last read. Every pointer-drag that crosses the canvas needs a
  transparent shield over it for the drag's duration — the tab drag and the
  split modal both do this.
- **The shell carries `zoom: appZoom`**, so `getBoundingClientRect()` reports
  *visual* pixels while an absolutely-positioned overlay is laid out in
  *local* ones. At 1.3 the split phantom sat 75px right of the pane it
  described and was 30% too wide; the drop overlay and the caret were wrong
  the same way, and everything only ever looked right at zoom 1. Measurements
  go through `zoomOf()` / `localRect()`; constants like GAP and RADIUS are
  already local and must **not** be divided. `position: fixed` inside the
  zoomed subtree is not exempt. The same rounding broke the sash grip, which
  is why it is centred by transform.
- **A running modal owns the keyboard**, as in Blender where a modal operator
  eats events before the keymap. `dockModalActive()` makes App's global chord
  handler stand down; without it App's Tab (toggle interact) `stopPropagation`s
  the split's axis flip before the modal's own listener runs.
- **The committed split `factor` must account for the splitter** that appears
  between the halves: a `flexBasis` child shrinks to make room for it, so a
  plain cursor-over-pane fraction landed ~2px off the drawn line. `factor` is
  the fraction of the *gapless* span with the cursor as the seam's centre, and
  the ghosts are drawn from that same definition.

**Known, not fixed:** a split whose axis matches its parent's is flattened
into that parent, which gains a splitter and re-flows its siblings by 1–2px.
The phantom describes the pane being split, not its neighbours' reaction to
the commit. Splits that nest (a different axis) are pixel-exact.

Standing check: `scripts/checks/dock.mjs` (u-and-i's dev server only).

## Editor chrome (2026-08-25)

**One strip**: `u—i`, the menus, the workspace tabs. Nothing else. It was
three — a top bar, a document row and a status bar — and the lower two mostly
restated the title bar. Removing them gave 60px of canvas back.

Sam's rule for the move: *"anything that had actual function that becomes
unreachable belongs under the menu bar dropdowns."* So Preview became
Canvas ▸ Preview in new window; Undo, Redo and the target were already in Edit
and File; the canvas zoom stepper moved into the canvas pane header next to
the device controls it modifies.

- **Session role and Theme pickers are gone.** The live canvas is the real
  running app, which signs in and themes itself — those only ever drove the
  component harness, which now takes a constant `CANVAS_ROLE`. The Style
  workspace keeps its own theme preview, which still does something.
- **Prose removed**: workspace hints ("edit the real running app"), the
  Preferences filler paragraph, the chattier status strings.
- **A rejected edit was the one exception.** `savedAt` did two jobs: a
  "saved at hh:mm" timestamp, which was noise, and `✗ <error>`, which was the
  only report of an edit the fidelity guard threw out. Status has no menu
  home, so failures raise a transient toast that clears after 8s. The steady
  state — it worked — costs no pixels.

Standing check: `scripts/checks/chrome.mjs`, which forces a rejection through
`page.route` rather than trusting that one would be shown.

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
- **Collapse Layout and Component into one workspace.** They already share a
  layout tree and differ only in what the canvas draws — which, under the
  panel model the dock now has, is a property of the *canvas panel*, not of
  the workspace. A canvas pane would carry its own mode (live app / one
  component with sample props), which also means both could be on screen at
  once. Surfaced while making every panel duplicable; not attempted.

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
- The component canvas is unchanged and still per-component. `Preview` is
  now Canvas ▸ Preview in new window rather than a button.

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
