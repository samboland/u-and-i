# Native u&i

Run the Windows editor from the repository root:

```powershell
cargo run --locked --manifest-path native/Cargo.toml
```

Install the repository's Node dependencies first. The editor starts the existing Node project daemon or connects to one serving the same project. The target comes from `uai.config.json` or `UAI_TARGET`. Live pages also need the target's development server.

Rust and egui draw the editor and handle input. The canvas is an empty native surface. Device, zoom, mode, ruler, and path controls retain their settings during use. Open launches the selected path externally. Reload is disabled. The previous Windows preview is available only in builds with the `legacy-canvas` Cargo feature. The Node daemon still owns JSX parsing and guarded source writes. A background Rust worker exchanges requests with the daemon.

- **Layout** lets you select a route or choose a component in Insert to inspect its JSX.
- **Component** shares the Layout dock. Select an element in the Outliner to edit its properties. Undo and redo restore the source text.
- **Style** groups CSS declarations by purpose. Edit a value and press Enter to write it. The native specimen previews supported token values.
- **Workshop** edits the layers of a material. Drag nodes by their headers and adjust the controls to change the preview. **Write tokens** writes the CSS recipe.

The top strip contains the application menus, workspace tabs, project and component selectors, and window controls. Drag the empty strip to move the window. Double-click it to maximize or restore. Drag the outer edge to resize the window.

Use **+** to add a workspace. Right-click a workspace to duplicate, rename, delete, or reorder it. Ctrl+Page Up and Ctrl+Page Down switch workspaces.

Drag a pane's header icon onto another pane to stack or split them. Open its menu to change its contents. The editor saves its workspace arrangement per target.

## Check the port

With Cargo on PATH, run `node native/check.mjs`. It starts a daemon for a disposable project under `native/target`, drives the native controls, verifies source edits and undo, and saves workspace screenshots there. These offscreen screenshots cover the egui window contents. The default build has no embedded browser in the canvas.
