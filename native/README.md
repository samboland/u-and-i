# Native u&i

The first Rust port covers project inspection in the Electron editor’s Layout workspace. Both frontends read the same route tree, component list, and JSX model from the existing project daemon. Rust handles the window, panel layout, navigation, selection, and property display. Requests run on a worker thread so parsing a component cannot block window input.

## Run

With the existing editor or its Vite daemon listening at localhost:4400, run:

```powershell
cargo run --manifest-path native/Cargo.toml
```

Start the daemon with `npm run dev` from the repository root if needed. Click **Reload project** in **File** after reconnecting.

Filter the **Insert** list and click a component. Click an element in the **File** outliner to inspect its properties. Switch to **Routes** to inspect a route and its layout chain. Click a route file in **Properties** to inspect its JSX.

The center pane currently shows the device frame. Live rendering, JSX edits, rearrangeable docks, and the other workspaces are pending. This version only reads the target project.
