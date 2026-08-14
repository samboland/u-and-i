# u-and-i

A visual editor for React/CSS where **the code is the source of truth**. Click
an element on a canvas rendering your real component, change a style, and the
edit lands in your actual `.tsx`/`.css` source as a minimal, reviewable diff —
formatting, comments, and quote style preserved.

This is the **round-trip spike**: the go/no-go proof that visual edit →
surgical AST write-back feels good against real-world code. The fixtures are
verbatim copies of components from a production Next.js app (adventure-alerts),
spanning three styling idioms: inline `style` objects, Tailwind class lists via
`cn()`, and a CSS-custom-property design-token system.

## Run it

```
npm install
npm run dev        # http://localhost:4400
```

- **Left**: component list + JSX layers tree
- **Center**: the real component rendered in an iframe harness (click to select)
- **Right**: Style tab (layout controls, inline styles, class chunks, text),
  Props tab (controls derived from the TS props interface), Tokens tab
  (live-preview + write-back for CSS custom properties)

Every committed change writes straight to the files in
`fixtures/demo-project/` — run `git diff` after editing to see the point.

## How it works

```
server/ast.ts     recast + babel-ts. One parser, one preorder traversal, three
                  consumers: tag (inject data-uai ids into served code),
                  model (JSX tree → editor), edit (minimal write-back).
server/tokens.ts  CSS custom-property parse + offset-based surgical writes.
server/props.ts   ts-morph: *Props interface → editor controls.
server/api.ts     Vite plugins: uai-tagger (transform) + uai-api (endpoints).
web/src/editor    The editor app (left/canvas/right panels).
web/src/harness   Iframe stage: renders the component with mock props,
                  relays hover/click selection via postMessage.
```

Node identity = preorder index of the JSXElement in the file, injected as
`data-uai="<relpath>::<n>"` by a Vite transform. The same parse produces the
editor model and locates edit targets, so DOM ↔ source mapping is exact.

Hard-won printer details: recast defaults `lineTerminator` to `os.EOL`
(rewrites every line on Windows — pass it explicitly), and edits detect the
file's dominant quote style so diffs blend in.

## Pages (builder-owned layer)

Pages are Google-Sites-style documents the builder owns: sections (with the
design system's card/well materials) → columns → blocks (heading, text,
button, image, spacer, or any real component with props). Documents live in
`fixtures/demo-project/pages/*.json`; saving deterministically regenerates
`src/pages-gen/<name>.tsx` — clean, readable JSX — and the canvas renders
that generated file, so what you see is exactly the code that ships.
Components placed on pages remain code-is-truth and fully round-trippable.

## Known limitations (spike scope)

- Editing a JSXText child collapses its surrounding whitespace (semantically
  identical; a Prettier pass restores it).
- `style` attributes that aren't object literals, and non-literal style values,
  are shown read-only as "dynamic".
- Components are found by fixture manifest + `mocks.ts`, not discovery.
- No undo, no element insert/delete/reorder yet.

## Where this goes

Component workbench against any project (point the daemon at a repo), state
picker driven by prop types, token/theme editor as a first-class surface,
then page composition with an overlay on the app's own dev server.
