# u—i

See `ROADMAP.md` for what's next and why.

Visual editor for one real Next.js app. **The code is the document** — no
save format, no codegen, no mirrors. We parse the target app's source,
render it on a canvas, and write visual edits back as surgical AST changes.

The target is the folder in `uai.config.json` (`UAI_TARGET` overrides),
currently `../adventure-alerts` — Sam's real app. Its git is the safety
net; **never run git inside the target repo**, and note Sam keeps
uncommitted WIP there: verify per-file cleanliness, not repo-wide.

## Architecture

- `server/` — vite plugins forming the daemon:
  - `ast.ts` — the core. recast + babel-ts round-trip. Node identity =
    preorder index per file, **ephemeral**: structural edits shift indices,
    so every `/api/edit` returns `{model, focusId, before, after}` and the
    editor rebuilds wholesale. A **fidelity guard** rejects (unwritten) any
    edit whose printed diff strays outside the edited element's lines.
  - `api.ts` — endpoints (`/api/project|routes|page-shell|components|
    component|edit|restore|tokens|token|material`) + `uaiTagger` (injects
    `data-uai="app:<rel>::<index>"` into served .tsx, transform-only) +
    target `public/` passthrough + boot-time generation of
    `web/src/harness/target-canvas.css` (gitignored; Tailwind `@source`
    needs literal paths).
  - `aa-resolve.ts` — importer-aware resolver: only for modules inside the
    target, maps `next/*`, `next-auth`, `server-only` → `harness/next-shims/`,
    `@/db` + `@/auth` → throwing stubs, other `@/…` → target src.
    Global `resolve.alias` runs before all plugins — never put `@` there.
  - `live-proxy.ts` — mirrors the target's *own* running `next dev` on a
    port we own (default 4410) so the canvas can show the real app with
    real data. Forwards everything incl. websockets (HMR), strips
    `X-Frame-Options` + CSP, injects `harness/live-probe.js`. The target app
    is never modified. See "Render the real app" in `ROADMAP.md`.
  - `routes.ts` (app-router interpreter), `shell.ts` (page → view-component
    resolution — currently mis-resolves ~⅓ of routes, see ROADMAP),
    `projects.ts` (target), `props.ts` (ts-morph prop specs,
    wired to the target's tsconfig).
- `web/src/editor/v3/` — chrome. `App.tsx` owns all state; every mutation
  goes through the `editFile` funnel (write → replace model → re-anchor
  selection to focusId → push undo → touched-files). Undo = byte-verbatim
  `/api/restore` of `before`/`after`. `FileMode.tsx` = JSX outliner + node
  card. Sample render props live in localStorage only.
  `dock.tsx` = the docking layout: panels are cards in a pure-data
  split/tab tree, dragged by their tabs, persisted per project. Layout and
  Component **share one tree** so the harness iframe survives that switch;
  panel bodies are the `renderPanel` switch in `App.tsx`.
- `web/src/harness/` — canvas iframe. One stage: void apron, device width,
  cursor-anchored zoom, middle-drag pan. Modules load via dynamic
  `/@fs/` imports (no compile-time globs). Clicks post `selected` with the
  **ancestor id chain** (nested components carry their own file's ids);
  dbl-click = descend into source; drag/drop posts `file-drop` → AST edit.
  F2 / Alt+dbl-click = in-place text editing (contentEditable) for elements
  whose whole content is one text child; the editor vets the request against
  the model, the canvas posts `set-text` back on Enter/blur.
  Async server components aren't rendered yet (outliner-only) — a gap being
  closed by "Render the real app" in `ROADMAP.md`, not a design rule.
- `web/src/harness/live-probe.js` — **plain JS, no build step**: it is
  injected into the target's own pages by `live-proxy.ts`, so it must
  assume nothing about the page. Talks to the editor by `postMessage`
  (`{uai:true, …}`, cross-origin). Finds the React fiber behind a DOM node
  and reads `fiber._debugStack` — React 19 dropped `_debugSource`, but the
  owner stack still gives a compiled file/line/col to map back to source.
- `electron/main.mjs` — shell; vite runs as an `ELECTRON_RUN_AS_NODE`
  child (`server.mjs`) — moving it into the GUI process makes Windows play
  an error sound on failed DLL probes.

## Gotchas (learned the hard way)

- recast: pass `lineTerminator: "\n"` explicitly (defaults to os.EOL →
  CRLF rewrite of whole files); quote style detected per file. A reprinted
  element is re-indented from scratch, so `set-text` splices the JSXText
  span in the source string instead of printing the AST.
- JSXText entities decode into `node.value` and recast prints `value`
  verbatim — `print()` re-escapes `<>{}` so `&lt;` survives a reprint, and
  `set-text` escapes what the user types (`&<>{}`) on the way in.
- Rollup's `resolve` won't extension-infer absolute paths — do it manually.
- Two React copies break hooks: `resolve.dedupe` react/react-dom;
  react-query aliases to the *target's* node_modules copy.
- Editor and harness share localStorage (same origin, port 4400).
- Vite hands importers outside its root as absolute, `/@fs/`, *or*
  relative paths — match on the directory-name marker.

## Working rules

- `npx tsc --noEmit -p .` must pass; verify behavior with Playwright
  (u-and-i doesn't depend on it — borrow the target's copy via
  `createRequire(<target>/package.json)`, resolving `<target>` from
  `uai.config.json` rather than hardcoding a path, and
  `chromium.launch({ channel: "chrome" })`) against a dev server on 4400.
- Testing **live mode** additionally needs the target's own `npm run dev`
  running (default `http://localhost:3000`), and the canvas is signed out —
  most authed routes will 307 to `/signin`. Use `/terms` or `/support` as
  no-redirect probes. Don't assume a port is free: check first.
- **Kill any dev server you start** — a leftover instance steals port 4400
  and breaks Sam's `npm run app`.
- Tests that edit the target must undo via the tool's own restore and
  assert the touched file is git-clean after (fallback `git checkout` on
  that one file = test failure).
- `scripts/checks/*.mjs` are the standing Playwright checks (`_shared.mjs`
  resolves the target + borrows Playwright). Run them after touching the
  canvas, the edit funnel, or the live proxy; add one when you add a
  feature worth re-verifying on another machine.
- Push freely to main (repo is Sam's, private).
