#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
#[cfg(windows)]
mod canvas;
mod chrome;
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
    path: String,
    draft: String,
    canvas_rect: egui::Rect,
    reload: bool,
    #[cfg(windows)]
    web: Option<canvas::Canvas>,
    #[cfg(windows)]
    web_error: Option<String>,
}

impl Editor {
    fn new(ctx: &egui::Context) -> Self {
        chrome::fonts(ctx);
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = PANEL;
        visuals.extreme_bg_color = BAR;
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(36, 41, 53);
        visuals.widgets.inactive.weak_bg_fill = Color32::from_rgb(36, 41, 53);
        visuals.selection.bg_fill = Color32::from_rgb(43, 51, 66);
        visuals.override_text_color = Some(Color32::from_rgb(215, 218, 224));
        ctx.set_visuals(visuals);
        ctx.global_style_mut(|s| {
            s.spacing.window_margin = egui::Margin::ZERO;
            s.spacing.item_spacing = egui::vec2(4., 3.);
            s.text_styles
                .insert(egui::TextStyle::Body, egui::FontId::proportional(12.));
            s.text_styles
                .insert(egui::TextStyle::Button, egui::FontId::proportional(12.));
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
            path: "/".into(),
            draft: "/".into(),
            canvas_rect: egui::Rect::NOTHING,
            reload: false,
            #[cfg(windows)]
            web: None,
            #[cfg(windows)]
            web_error: None,
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
            .frame(
                egui::Frame::new()
                    .fill(BAR)
                    .inner_margin(egui::Margin::symmetric(10, 4)),
            )
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.set_min_height(24.);
                    ui.spacing_mut().item_spacing.x = 9.;
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
                    ui.selectable_label(true, "Layout")
                        .on_hover_text("Layout workspace");
                    for ws in ["Style", "Workshop", "Component"] {
                        ui.add_enabled(false, egui::Button::new(ws).frame(false));
                    }
                });
            });
        egui::Panel::left("insert")
            .frame(chrome::pane(PANEL))
            .default_size(width * 0.15)
            .size_range(100.0..=360.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    chrome::header_icon(ui, '\u{e1bd}', "Insert");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.search)
                            .hint_text(if self.file.is_some() {
                                "Search components"
                            } else {
                                "open a file first"
                            })
                            .desired_width(f32::INFINITY),
                    );
                });
                ui.separator();
                let mut open = None;
                egui::ScrollArea::vertical()
                    .id_salt("library")
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.strong("Primitives");
                            ui.weak("plain html");
                        });
                        let half = (ui.available_width() - 4.) * 0.5;
                        for pair in [
                            [("▤", "Container"), ("H", "Heading")],
                            [("¶", "Paragraph"), ("▭", "Button")],
                            [("↗", "Link"), ("▨", "Image")],
                        ] {
                            ui.horizontal(|ui| {
                                for (icon, name) in pair {
                                    ui.add_enabled_ui(false, |ui| {
                                        chrome::part_button(ui, [half, 28.], icon, name, false);
                                    });
                                }
                            });
                        }
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
                                    if chrome::part_button(
                                        ui,
                                        [ui.available_width(), 26.],
                                        "\u{e14d}",
                                        name,
                                        self.file.as_ref() == Some(file),
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
            .frame(egui::Frame::new().outer_margin(1)).default_size(width * 0.19)
            .size_range(140.0..=500.0)
            .show(ui, |ui| {
                let height = ui.available_height() * 0.44;
                egui::Panel::top("outliner")
                    .frame(chrome::pane(PANEL)).default_size(height)
                    .resizable(true)
                    .show(ui, |ui| {
                        ui.set_min_height(ui.available_height());
                        ui.horizontal(|ui| {
                            chrome::header_icon(ui,'\u{e97a}',"Outliner");
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
                                            if route.files.contains_key("page") && !route.path.contains('['){self.path=route.path.clone();self.draft=self.path.clone();}
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
                chrome::pane(PANEL).show(ui,|ui|{ui.set_min_height(ui.available_height());ui.set_min_width(ui.available_width());egui::ScrollArea::vertical()
                    .id_salt("props")
                    .show(ui, |ui| {
                        ui.horizontal(|ui|{chrome::header_icon(ui,'\u{e429}',"Properties");ui.label(if self.selected.is_some(){"Element"}else if self.route.is_some(){"Route"}else{"▪  Nothing open"});});
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
                            ui.weak("Nothing open. The Routes tree shows the app’s structure; Insert lists its components.");
                        }
                    });});
            });
        egui::CentralPanel::default()
            .frame(chrome::pane(VOID))
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    chrome::header_icon(ui, '\u{e30c}', "Canvas");
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
                ui.horizontal(|ui| {
                    ui.weak("PATH");
                    let input = ui.add_sized(
                        [(ui.available_width() - 112.).max(30.), 22.],
                        egui::TextEdit::singleline(&mut self.draft),
                    );
                    if input.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                        self.path = format!("/{}", self.draft.trim_start_matches('/'));
                        self.draft = self.path.clone();
                    }
                    if ui.button("Reload").clicked() {
                        self.reload = true;
                        #[cfg(windows)]
                        {
                            self.web_error = None;
                        }
                    }
                    if ui.button("Open").clicked()
                        && let Some(c) = &self.catalog
                    {
                        let url = format!(
                            "{}/{}",
                            c.live.upstream.trim_end_matches('/'),
                            self.path.trim_start_matches('/')
                        );
                        ui.ctx().open_url(egui::OpenUrl::new_tab(url));
                    }
                });
                ui.separator();
                ui.add_space(10.);
                self.canvas_rect = ui.available_rect_before_wrap();
                #[cfg(windows)]
                if let Some(err) = &self.web_error {
                    ui.colored_label(egui::Color32::LIGHT_RED, err);
                }
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
    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.render(ui);
        #[cfg(windows)]
        if self.web_error.is_none()
            && let Some(c) = &self.catalog
            && let Some(url) = canvas::page_url(&c.live.origin, &self.path)
        {
            let size = (
                DEVICES[self.device].1 as u32,
                [790, 1112, 844][self.device],
                self.zoom,
            );
            let result = (|| {
                if self.web.is_none() {
                    self.web = Some(canvas::Canvas::create(frame, &url, size)?);
                }
                self.web.as_mut().unwrap().update(
                    self.canvas_rect,
                    ui.ctx().pixels_per_point(),
                    &url,
                    size,
                    std::mem::take(&mut self.reload),
                )
            })();
            if let Err(e) = result {
                self.web = None;
                self.web_error = Some(e.to_string());
                ui.ctx().request_repaint();
            }
        }
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
