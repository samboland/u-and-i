#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod project;
use eframe::egui::{self, Color32, RichText};
use project::{Catalog, Element, Reply, Request, Route};
use std::sync::mpsc::{Receiver, Sender};

const PANEL: Color32 = Color32::from_rgb(27, 30, 36);
const BAR: Color32 = Color32::from_rgb(18, 20, 26);
const VOID: Color32 = Color32::from_rgb(16, 18, 22);
const BLUE: Color32 = Color32::from_rgb(111, 184, 234);
const DEVICES: [(&str, f32, f32); 3] = [
    ("Desktop", 1440., 0.5),
    ("Tablet", 834., 0.75),
    ("Phone", 390., 1.),
];
const ZOOM: [f32; 12] = [0.25, 0.4, 0.5, 0.62, 0.75, 0.9, 1., 1.25, 1.5, 2., 3., 4.];

struct Editor {
    requests: Sender<Request>,
    replies: Receiver<Reply>,
    catalog: Option<Catalog>,
    error: Option<String>,
    search: String,
    file: Option<String>,
    elements: Vec<Element>,
    selected: Option<usize>,
    route: Option<(String, Vec<(String, String)>, Vec<String>)>,
    routes: bool,
    device: usize,
    zoom: f32,
}

impl Editor {
    fn new(ctx: &egui::Context) -> Self {
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = PANEL;
        visuals.extreme_bg_color = BAR;
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(36, 41, 53);
        visuals.widgets.inactive.weak_bg_fill = Color32::from_rgb(36, 41, 53);
        visuals.selection.bg_fill = Color32::from_rgb(43, 51, 66);
        visuals.override_text_color = Some(Color32::from_rgb(215, 218, 224));
        ctx.set_visuals(visuals);
        ctx.global_style_mut(|s| {
            s.spacing.scroll.floating = false;
            s.spacing.scroll.bar_width = 5.;
            s.spacing.scroll.bar_inner_margin = 3.;
        });
        let (requests, replies) = project::connect(ctx.clone());
        let _ = requests.send(Request::Reload);
        Self {
            requests,
            replies,
            catalog: None,
            error: None,
            search: String::new(),
            file: None,
            elements: Vec::new(),
            selected: None,
            route: None,
            routes: true,
            device: 0,
            zoom: 0.5,
        }
    }
    fn open(&mut self, file: String) {
        let _ = self.requests.send(Request::Open(file.clone()));
        self.file = Some(file);
        self.elements.clear();
        self.selected = None;
        self.route = None;
        self.routes = false;
        self.error = None;
    }
    fn render(&mut self, ui: &mut egui::Ui) {
        while let Ok(reply) = self.replies.try_recv() {
            match reply {
                Reply::Catalog(Ok(c)) => {
                    self.catalog = Some(c);
                    self.error = None;
                }
                Reply::Catalog(Err(e)) => self.error = Some(e),
                Reply::File(path, r) if Some(&path) == self.file.as_ref() => match r {
                    Ok(nodes) => {
                        self.selected = nodes.first().map(|n| n.index);
                        self.elements = nodes;
                    }
                    Err(e) => self.error = Some(e),
                },
                _ => {}
            }
        }
        let width = ui.available_width();
        egui::Panel::top("menus")
            .frame(egui::Frame::new().fill(BAR).inner_margin(5))
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.label(RichText::new("u—i").color(BLUE).monospace());
                    ui.menu_button("File", |ui| {
                        ui.label(format!(
                            "Target: {}",
                            self.catalog.as_ref().map_or("…", |c| &c.name)
                        ));
                        if ui.button("Reload project").clicked() {
                            let _ = self.requests.send(Request::Reload);
                            ui.close();
                        }
                        if ui.button("Exit").clicked() {
                            ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                    });
                    for menu in ["Edit", "Insert", "View", "Canvas", "Help"] {
                        ui.add_enabled(false, egui::Button::new(menu).frame(false));
                    }
                    ui.separator();
                    ui.label(RichText::new("Layout").strong());
                    for ws in ["Style", "Workshop", "Component"] {
                        ui.add_enabled(false, egui::Button::new(ws).frame(false));
                    }
                });
            });
        egui::Panel::left("insert")
            .default_size(width * 0.15)
            .size_range(100.0..=360.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label("Insert");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.search)
                            .hint_text("Search components")
                            .desired_width(f32::INFINITY),
                    );
                });
                ui.separator();
                let mut open = None;
                egui::ScrollArea::vertical()
                    .id_salt("library")
                    .show(ui, |ui| {
                        ui.strong("Primitives");
                        egui::Grid::new("primitives").num_columns(2).show(ui, |ui| {
                            for (i, name) in [
                                "Container",
                                "Heading",
                                "Paragraph",
                                "Button",
                                "Link",
                                "Image",
                            ]
                            .iter()
                            .enumerate()
                            {
                                ui.add_enabled_ui(false, |ui| {
                                    ui.add_sized(
                                        [((ui.available_width() - 6.) * 0.5).clamp(46., 90.), 24.],
                                        egui::Button::new(*name),
                                    );
                                });
                                if i % 2 == 1 {
                                    ui.end_row();
                                }
                            }
                        });
                        if let Some(c) = &self.catalog {
                            let query = self.search.trim().to_lowercase();
                            for (group, files) in &c.groups {
                                let matches: Vec<_> = files
                                    .iter()
                                    .filter(|f| f.to_lowercase().contains(&query))
                                    .collect();
                                if matches.is_empty() {
                                    continue;
                                }
                                ui.separator();
                                ui.strong(format!("{group}  {}", matches.len()));
                                for file in matches {
                                    let name = file
                                        .rsplit('/')
                                        .next()
                                        .unwrap_or(file)
                                        .trim_end_matches(".tsx");
                                    if ui
                                        .add_sized(
                                            [ui.available_width(), 22.],
                                            egui::Button::new(name)
                                                .truncate()
                                                .selected(self.file.as_ref() == Some(file)),
                                        )
                                        .on_hover_text(file)
                                        .clicked()
                                    {
                                        open = Some(file.clone());
                                    }
                                }
                            }
                        }
                    });
                if let Some(f) = open {
                    self.open(f)
                }
            });
        egui::Panel::right("details")
            .default_size(width * 0.19)
            .size_range(140.0..=500.0)
            .show(ui, |ui| {
                let height = ui.available_height() * 0.44;
                egui::Panel::top("outliner")
                    .default_size(height)
                    .resizable(true)
                    .show(ui, |ui| {
                        ui.set_min_height(ui.available_height());
                        ui.horizontal(|ui| {
                            ui.label("Outliner");
                            ui.selectable_value(&mut self.routes, false, "File");
                            ui.selectable_value(&mut self.routes, true, "Routes");
                        });
                        ui.separator();
                        egui::ScrollArea::both()
                            .id_salt(("tree", self.routes, self.file.as_deref()))
                            .show(ui, |ui| {
                                if self.routes {
                                    if let Some(c) = &self.catalog {
                                        if let Some(route) = route_tree(ui, &c.routes, "app") {
                                            self.route = Some((
                                                route.path.clone(),
                                                route.files.clone().into_iter().collect(),
                                                route.layouts.clone(),
                                            ));
                                            self.selected = None;
                                        }
                                    }
                                } else if self.file.is_none() {
                                    ui.weak("No file open.");
                                } else {
                                    for root in &self.elements {
                                        element_tree(ui, root, &mut self.selected)
                                    }
                                }
                            });
                    });
                egui::ScrollArea::vertical()
                    .id_salt("props")
                    .show(ui, |ui| {
                        ui.strong("Properties");
                        ui.separator();
                        if let Some(i) = self
                            .selected
                            .and_then(|id| self.elements.iter().find_map(|e| e.find(id)))
                        {
                            ui.strong(format!("<{}>", i.tag));
                            for prop in &i.props {
                                ui.label(format!("{}: {}", prop.name, prop.value));
                            }
                            for style in i.style_props.iter().flatten() {
                                ui.label(format!(
                                    "{}: {}",
                                    style.name,
                                    style.value.as_deref().unwrap_or("(expression)")
                                ));
                            }
                            for text in &i.text_children {
                                ui.label(format!("Text: {}", text.value));
                            }
                            for chunk in &i.class_chunks {
                                ui.label(format!("className: {}", chunk.value));
                            }
                        } else if let Some((url, files, layouts)) = &self.route {
                            ui.strong(url);
                            let mut open = None;
                            for (kind, f) in files {
                                if ui.link(format!("{kind} · {f}")).clicked() {
                                    open = Some(f.clone());
                                }
                            }
                            if !layouts.is_empty() {
                                ui.label("Layout chain");
                                for f in layouts {
                                    ui.label(f);
                                }
                            }
                            if let Some(f) = open {
                                self.open(f)
                            }
                        } else {
                            ui.weak("Nothing open.");
                        }
                    });
            });
        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(VOID).inner_margin(8))
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    for (i, (name, _, zoom)) in DEVICES.iter().enumerate() {
                        if ui.selectable_label(self.device == i, *name).clicked() {
                            self.device = i;
                            self.zoom = *zoom;
                        }
                    }
                    ui.monospace(format!("{}px", DEVICES[self.device].1));
                    if ui.button("−").clicked() {
                        self.zoom = ZOOM
                            .iter()
                            .copied()
                            .rev()
                            .find(|v| *v < self.zoom)
                            .unwrap_or(ZOOM[0]);
                    }
                    ui.label(format!("{:.0}%", self.zoom * 100.));
                    if ui.button("+").clicked() {
                        self.zoom = ZOOM.iter().copied().find(|v| *v > self.zoom).unwrap_or(4.);
                    }
                });
                ui.separator();
                if let Some(error) = &self.error {
                    ui.label(error);
                    if ui.button("Retry project connection").clicked() {
                        let _ = self.requests.send(Request::Reload);
                    }
                }
                let path = self
                    .route
                    .as_ref()
                    .map(|r| r.0.as_str())
                    .or(self.file.as_deref())
                    .unwrap_or("/");
                ui.monospace(path);
                ui.separator();
                egui::ScrollArea::both().show(ui, |ui| {
                    let size = egui::vec2(DEVICES[self.device].1 * self.zoom, 790. * self.zoom);
                    ui.add_space(8.);
                    ui.horizontal(|ui| {
                        ui.add_space(((ui.available_width() - size.x) * 0.5).max(0.));
                        let (rect, _) = ui.allocate_exact_size(size, egui::Sense::hover());
                        ui.painter()
                            .rect_filled(rect, 0., Color32::from_rgb(22, 24, 29));
                        ui.painter().text(
                            rect.center(),
                            egui::Align2::CENTER_CENTER,
                            "Live preview is not ported yet.",
                            egui::FontId::proportional(12.),
                            Color32::GRAY,
                        );
                    });
                });
            });
    }
}
fn route_tree<'a>(ui: &mut egui::Ui, node: &'a Route, id: &str) -> Option<&'a Route> {
    let label = if node.segment.is_empty() {
        "app"
    } else {
        &node.segment
    };
    let mut selected = None;
    if node.children.is_empty() {
        if ui.selectable_label(false, label).clicked() {
            selected = Some(node)
        }
    } else {
        let state = egui::collapsing_header::CollapsingState::load_with_default_open(
            ui.ctx(),
            ui.make_persistent_id(id),
            node.segment.is_empty(),
        );
        state
            .show_header(ui, |ui| {
                if ui.selectable_label(false, label).clicked() {
                    selected = Some(node)
                }
            })
            .body(|ui| {
                for child in &node.children {
                    if let Some(n) = route_tree(ui, child, &format!("{id}/{}", child.segment)) {
                        selected = Some(n);
                    }
                }
            });
    }
    selected
}
fn element_tree(ui: &mut egui::Ui, node: &Element, selected: &mut Option<usize>) {
    let label = format!("<{}>", node.tag);
    if node.children.is_empty() {
        if ui
            .selectable_label(*selected == Some(node.index), label)
            .clicked()
        {
            *selected = Some(node.index)
        }
    } else {
        let state = egui::collapsing_header::CollapsingState::load_with_default_open(
            ui.ctx(),
            ui.make_persistent_id(node.index),
            node.index == 0,
        );
        state
            .show_header(ui, |ui| {
                if ui
                    .selectable_label(*selected == Some(node.index), label)
                    .clicked()
                {
                    *selected = Some(node.index)
                }
            })
            .body(|ui| {
                for child in &node.children {
                    element_tree(ui, child, selected)
                }
            });
    }
}
impl eframe::App for Editor {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.render(ui)
    }
}
fn main() -> eframe::Result {
    eframe::run_native(
        "u-and-i · Rust",
        eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default().with_inner_size([1500., 950.]),
            ..Default::default()
        },
        Box::new(|cc| Ok(Box::new(Editor::new(&cc.egui_ctx)))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_kittest::{Harness, kittest::Queryable};

    #[test]
    #[ignore = "requires the existing u-and-i project daemon on port 4400"]
    fn inspect_component_in_layout() {
        let mut h = Harness::builder()
            .with_size(egui::vec2(1500., 950.))
            .wgpu()
            .build_ui_state(
                |ui, editor: &mut Option<Editor>| {
                    editor
                        .get_or_insert_with(|| Editor::new(ui.ctx()))
                        .render(ui);
                },
                None,
            );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while h.state().as_ref().unwrap().catalog.is_none() {
            assert!(
                std::time::Instant::now() < deadline,
                "project catalog timed out"
            );
            std::thread::sleep(std::time::Duration::from_millis(30));
            h.step();
        }
        h.run();
        h.render()
            .unwrap()
            .save("target/native-layout.png")
            .unwrap();
        // Select through the same component button the user sees.
        let file = h
            .state()
            .as_ref()
            .unwrap()
            .catalog
            .as_ref()
            .unwrap()
            .groups
            .values()
            .next()
            .unwrap()[0]
            .clone();
        let caption = file.rsplit('/').next().unwrap().trim_end_matches(".tsx");
        h.get_by_label(caption).click();
        h.run();
        while h.state().as_ref().unwrap().elements.is_empty() {
            assert!(
                std::time::Instant::now() < deadline,
                "component model timed out"
            );
            std::thread::sleep(std::time::Duration::from_millis(30));
            h.step();
        }
        let editor = h.state().as_ref().unwrap();
        assert_eq!(editor.file.as_ref(), Some(&file));
        assert_eq!(editor.selected, Some(editor.elements[0].index));
        h.render()
            .unwrap()
            .save("target/native-component.png")
            .unwrap();
    }
}
