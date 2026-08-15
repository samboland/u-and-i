# u—i

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
  - `routes.ts` (app-router interpreter), `shell.ts` (page → view-component
    resolution), `projects.ts` (target), `props.ts` (ts-morph prop specs,
    wired to the target's tsconfig).
- `web/src/editor/v3/` — chrome. `App.tsx` owns all state; every mutation
  goes through the `editFile` funnel (write → replace model → re-anchor
  selection to focusId → push undo → touched-files). Undo = byte-verbatim
  `/api/restore` of `before`/`after`. `FileMode.tsx` = JSX outliner + node
  card. Sample render props live in localStorage only.
- `web/src/harness/` — canvas iframe. One stage: void apron, device width,
  cursor-anchored zoom, middle-drag pan. Modules load via dynamic
  `/@fs/` imports (no compile-time globs). Clicks post `selected` with the
  **ancestor id chain** (nested components carry their own file's ids);
  dbl-click = descend into source; drag/drop posts `file-drop` → AST edit.
  Async server components aren't rendered (assisted mode: outliner-only).
- `electron/main.mjs` — shell; vite runs as an `ELECTRON_RUN_AS_NODE`
  child (`server.mjs`) — moving it into the GUI process makes Windows play
  an error sound on failed DLL probes.

## Gotchas (learned the hard way)

- recast: pass `lineTerminator: "\n"` explicitly (defaults to os.EOL →
  CRLF rewrite of whole files); quote style detected per file; JSXText
  edits collapse adjacent whitespace.
- Rollup's `resolve` won't extension-infer absolute paths — do it manually.
- Two React copies break hooks: `resolve.dedupe` react/react-dom;
  react-query aliases to the *target's* node_modules copy.
- Editor and harness share localStorage (same origin, port 4400).
- Vite hands importers outside its root as absolute, `/@fs/`, *or*
  relative paths — match on the directory-name marker.

## Working rules

- `npx tsc --noEmit -p .` must pass; verify behavior with Playwright
  (borrow it via `createRequire("C:\\Users\\sam\\Dev-Projects\\adventure-alerts\\package.json")`,
  `chromium.launch({ channel: "chrome" })`) against a dev server on 4400.
- **Kill any dev server you start** — a leftover instance steals port 4400
  and breaks Sam's `npm run app`.
- Tests that edit the target must undo via the tool's own restore and
  assert the touched file is git-clean after (fallback `git checkout` on
  that one file = test failure).
- Push freely to main (repo is Sam's, private).
