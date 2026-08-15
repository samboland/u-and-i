# u—i

A visual editor for real Next.js apps. **The code is the document**: there is
no save format, no export step, and no generated mirror — u-and-i parses the
target app's actual source, renders it on a canvas, and writes every visual
edit back as a surgical AST change, as if a developer had typed it.

## Targeting

u-and-i serves exactly one app at a time — the folder named in
`uai.config.json` (`{ "target": "../adventure-alerts" }`, relative to this
repo) or the `UAI_TARGET` environment variable. The target must be a Next.js
app-router project.

```
npm run app      # Electron shell (dev server runs as a child process)
npm run dev      # dev server only, editor at http://localhost:4400
```

## What it does

- **Interprets the app**: the route tree (groups, dynamic segments, layout
  chains) is read from `src/app`; thin shell pages resolve to their real view
  components ("Open HomeView"); Markdown-content pages are flagged as not
  JSX-editable.
- **Renders the real code**: components load through vite with shims for
  `next/link`, `next/navigation`, `next-auth/react`, `server-only`, and
  throwing stubs for `@/db` + `@/auth`. Client components render live with
  sample props (kept in localStorage, never in the repo); async server
  components get assisted editing without a live preview.
- **Edits the real code**: the Outliner is the file's JSX tree; the
  Properties panel edits text, style objects, class strings, and literal
  props; drag-and-drop, insert, delete, move, and duplicate are AST
  operations with automatic import management. IDs are ephemeral preorder
  indices — every edit returns a fresh model.
- **Protects the code**: a fidelity guard rejects any edit whose printed
  diff strays outside the edited element's own lines (comments and siblings
  are structurally safe). Undo restores exact prior bytes. u-and-i never
  runs git in the target — the status bar counts touched files and you
  review with `git diff`.

## Layout

- `server/` — the daemon: AST engine (recast + babel-ts), route interpreter,
  shell analysis, target registry, importer-aware resolver, API endpoints.
- `web/src/editor/` — the editor chrome (React, in the browser/Electron).
- `web/src/harness/` — the canvas iframe: stage framing (device widths,
  cursor-anchored zoom, pan apron), selection/drag affordances, next/* shims.
  `target-canvas.css` is generated at boot from the target's globals.
- `electron/` — the desktop shell.

## Known limitations

- Expression props, dynamic `style`/`className` values, map callbacks, and
  conditional guards are visible but read-only (edit them in code).
- Editing a JSXText child collapses its surrounding whitespace (semantically
  identical; a Prettier pass restores it).
- The canvas chrome (fonts, session shape, provider stack) has
  adventure-alerts-specific niceties; other targets get a generic fallback.
