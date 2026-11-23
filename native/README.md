# Native u&i

Run the Windows editor from the repository root:

```powershell
cargo run --locked --manifest-path native/Cargo.toml
```

Install the repository's Node dependencies first. The editor starts the existing Node project daemon or connects to one serving the same project. The target comes from `uai.config.json` or `UAI_TARGET`. Live pages also need the target's development server.

Rust and egui draw the editor and handle input. WebView2 renders the target page and isolated React components with their own CSS. The Node daemon still owns JSX parsing and guarded source writes. A background Rust worker exchanges requests with the daemon.

- **Layout** opens routes in the live canvas. Choose a component in Insert to inspect its JSX.
- **Component** shares the Layout dock and shows the selected component in isolation. Select an element to edit its properties. Press F2 over editable text. Undo and redo restore the source text.
- **Style** groups CSS declarations by purpose. Edit a value and press Enter to write it. The native specimen previews supported token values.
- **Workshop** edits the layers of a material. Drag nodes by their headers and adjust the controls to change the preview. **Write tokens** writes the CSS recipe.

Drag a pane's header icon onto another pane to stack or split them. Open its menu to change its contents. The editor saves its workspace arrangement per target.

## Check the port

With Cargo on PATH, run `node native/check.mjs`. It starts a daemon for a disposable project under `native/target`, drives the native controls, verifies source edits and undo, and saves workspace screenshots there. These offscreen screenshots cover the egui window contents. WebView2 is a separate Windows child window.
