# Native u&i

Run `cargo run --manifest-path native/Cargo.toml` from the repository root.

Click **Add label** in Parts. Drag the label on the canvas. The Properties pane edits its text and position. Positions use logical points measured from the canvas corner. The document lives in memory for this first interaction test.

## Runtime choices

Rust owns the document and input handling. egui draws the toolbox, canvas, and inspector from that document. eframe opens the desktop window and connects egui to the graphics system.

A label stores its text and two coordinates. Dragging the label and typing a coordinate update the same value. The canvas reads that value when it draws the next frame. This keeps a visual edit and its precise numerical adjustment together.

This prototype uses an empty local document so you can judge placement without loading another project. Startup time and drag latency still need measurements before comparing runtimes.
