use eframe::egui;

// Coordinates are logical points measured from the canvas, independent of the pane widths.
struct Label {
    text: String,
    x: f32,
    y: f32,
}

#[derive(Default)]
struct Editor {
    labels: Vec<Label>,
    selected: Option<usize>,
}

impl eframe::App for Editor {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.show(ui);
    }
}

impl Editor {
    fn show(&mut self, ui: &mut egui::Ui) {
        egui::Panel::left("parts")
            .default_size(160.0)
            .show(ui, |ui| {
                ui.heading("Parts");
                if ui.button("Add label").clicked() {
                    let index = self.labels.len();
                    let offset = 24.0 * (1 + index % 8) as f32;
                    self.labels.push(Label {
                        text: "Label".into(),
                        x: offset,
                        y: offset,
                    });
                    self.selected = Some(index);
                }
            });

        egui::Panel::right("properties")
            .default_size(220.0)
            .show(ui, |ui| {
                ui.heading("Properties");
                if let Some(index) = self.selected {
                    let label = &mut self.labels[index];
                    ui.label("Text");
                    ui.text_edit_singleline(&mut label.text);
                    ui.horizontal(|ui| {
                        ui.add(egui::DragValue::new(&mut label.x).prefix("X "));
                        ui.add(egui::DragValue::new(&mut label.y).prefix("Y "));
                    });
                }
            });

        egui::CentralPanel::default().show(ui, |ui| {
            let origin = ui.max_rect().min;
            for (index, label) in self.labels.iter_mut().enumerate() {
                let font = egui::TextStyle::Body.resolve(ui.style());
                let galley = ui.painter().layout_no_wrap(
                    label.text.clone(),
                    font,
                    ui.visuals().text_color(),
                );
                let position = origin + egui::vec2(label.x, label.y);
                let bounds =
                    egui::Rect::from_min_size(position, galley.size().max(egui::vec2(12.0, 16.0)));
                let response = ui.interact(
                    bounds.expand(3.0),
                    ui.id().with(index),
                    egui::Sense::click_and_drag(),
                );
                if response.clicked() || response.dragged() {
                    self.selected = Some(index);
                }
                let delta = response.drag_delta();
                label.x += delta.x;
                label.y += delta.y;
                ui.painter()
                    .galley(position + delta, galley, ui.visuals().text_color());
                if self.selected == Some(index) {
                    ui.painter().rect_stroke(
                        bounds.translate(delta).expand(3.0),
                        2.0,
                        ui.visuals().selection.stroke,
                        egui::StrokeKind::Outside,
                    );
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui::{Event, Modifiers, PointerButton, Pos2, RawInput};

    // Drive the same widgets as the desktop app without taking over the desktop cursor.
    #[test]
    fn add_and_drag_a_label() {
        let ctx = egui::Context::default();
        let mut editor = Editor::default();
        let mut frame = |events: Vec<Event>| {
            let mut output = ctx.run_ui(
                RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        Pos2::ZERO,
                        egui::vec2(960.0, 600.0),
                    )),
                    events,
                    ..Default::default()
                },
                |ui| editor.show(ui),
            );
            output.textures_delta.clear();
            output
        };
        let find_text = |output: &egui::FullOutput, caption: &str| {
            output
                .shapes
                .iter()
                .rev()
                .find_map(|shape| match &shape.shape {
                    egui::Shape::Text(text) if text.galley.text() == caption => {
                        Some(text.pos + text.galley.size() * 0.5)
                    }
                    _ => None,
                })
                .expect("visible label")
        };
        let button = |pos, pressed| Event::PointerButton {
            pos,
            button: PointerButton::Primary,
            pressed,
            modifiers: Modifiers::NONE,
        };
        frame(vec![]);
        let add = find_text(&frame(vec![]), "Add label");
        frame(vec![Event::PointerMoved(add), button(add, true)]);
        frame(vec![button(add, false)]);
        let label = find_text(&frame(vec![]), "Label");
        let moved = label + egui::vec2(40.0, 20.0);
        frame(vec![Event::PointerMoved(label), button(label, true)]);
        frame(vec![Event::PointerMoved(moved)]);
        frame(vec![button(moved, false)]);
        assert_eq!(editor.selected, Some(0));
        assert_eq!((editor.labels[0].x, editor.labels[0].y), (64.0, 44.0));
    }
}

fn main() -> eframe::Result {
    eframe::run_native(
        "u&i",
        eframe::NativeOptions::default(),
        Box::new(|_| Ok(Box::new(Editor::default()))),
    )
}
