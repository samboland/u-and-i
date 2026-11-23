#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
#[cfg(windows)]
mod canvas;
mod chrome;
mod daemon;
mod dock;
mod edit;
mod studio;
mod surface;
mod topbar;
#[cfg(windows)]
mod window_frame;
mod workspace;
use dock::{Action, Dock, Panel};
use serde_json::{Value, json};
use std::collections::HashMap;
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
    reopen: bool,
    app_zoom: f32,
    saved_samples: serde_json::Map<String, Value>,
    samples: Value,
    specs: Vec<Value>,
    renderable: bool,
    topbar: topbar::TopBar,
    workspace: usize,
    docks: Vec<Dock>,
    next_id: u64,
    studio: studio::Studio,
    primitives: Value,
    editing: edit::Editing,
    interact: bool,
    rulers: bool,
    rem: bool,
    prefs: bool,
    pending_split: Option<bool>,
    finishing_split: bool,
    resizing_pane: bool,
    drag: Option<u64>,
    dock_preview: Option<egui::Rect>,
    states: HashMap<u64, (String, bool)>,
    canvas_views: HashMap<u64, egui::Rect>,
    landed: HashMap<u64, String>,
    extra_paths: HashMap<u64, (String, String)>,
    collapsed: std::collections::HashSet<String>,
    visible_nodes: Vec<usize>,
    stage: egui::Vec2,
    context: Option<egui::Pos2>,
    shell: Value,
    help: bool,
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
    web: HashMap<u64, canvas::Canvas>,
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
            s.spacing.scroll.floating = true;
            s.spacing.scroll.floating_allocated_width = 8.;
            s.spacing.scroll.floating_width = 5.;
            for widget in [
                &mut s.visuals.widgets.inactive,
                &mut s.visuals.widgets.hovered,
                &mut s.visuals.widgets.active,
                &mut s.visuals.widgets.open,
            ] {
                widget.bg_stroke = egui::Stroke::NONE;
                widget.expansion = 0.;
            }
            s.spacing.scroll.bar_width = 5.;
            s.spacing.scroll.bar_inner_margin = 3.;
        });
        let (requests, replies) = project::connect(ctx.clone());
        let _ = requests.send(Request::Reload);
        let (docks, next_id, workspace, rulers, rem) = workspace::load();
        let mut editor = Self {
            reopen: true,
            app_zoom: 1.,
            saved_samples: Default::default(),
            samples: json!({}),
            specs: vec![],
            renderable: false,
            topbar: topbar::TopBar::new(workspace),
            workspace,
            docks,
            next_id,
            studio: Default::default(),
            primitives: serde_json::from_str(include_str!("../assets/primitives.json")).unwrap(),
            editing: Default::default(),
            interact: false,
            rulers,
            rem,
            prefs: false,
            pending_split: None,
            finishing_split: false,
            resizing_pane: false,
            drag: None,
            dock_preview: None,
            states: HashMap::new(),
            canvas_views: HashMap::new(),
            landed: HashMap::new(),
            extra_paths: HashMap::new(),
            collapsed: Default::default(),
            visible_nodes: vec![],
            stage: egui::Vec2::ZERO,
            context: None,
            shell: Value::Null,
            help: false,
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
            web: HashMap::new(),
            #[cfg(windows)]
            web_error: None,
        };
        editor.resume_session(ctx);
        editor
    }
    fn open(&mut self, file: String) {
        let _ = self.requests.send(Request::Open(file.clone()));
        self.editing.next_selection = None;
        self.editing.drafts.clear();
        self.collapsed.clear();
        for state in self.states.values_mut() {
            state.1 = false;
        }
        if self.renderable
            && let Some(old) = &self.file
        {
            self.saved_samples.insert(old.clone(), self.samples.clone());
        }
        self.renderable = false;
        self.specs.clear();
        self.samples = json!({});
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
                    Ok(file) => {
                        self.specs = file.props;
                        self.renderable = file.renderable;
                        self.samples = json!({});
                        for p in &self.specs {
                            if p["optional"] != true {
                                let value = match studio::string(&p["control"], "kind") {
                                    "string" => p["name"].clone(),
                                    "boolean" => json!(false),
                                    "number" => json!(0),
                                    "select" => p["control"]["options"][0].clone(),
                                    _ => continue,
                                };
                                self.samples[studio::string(p, "name")] = value;
                            }
                        }
                        if let Some(samples) = self.saved_samples.get(&path) {
                            self.samples = samples.clone();
                        }
                        let nodes = file.model;
                        self.selected = self.editing.next_selection.take();
                        self.elements = nodes;
                    }
                    Err(e) => self.error = Some(e),
                },
                Reply::Shell(f, Ok(v))
                    if self.route.as_ref().is_some_and(|(_, files, _)| {
                        files.iter().any(|(k, path)| k == "page" && path == &f)
                    }) =>
                {
                    self.shell = v
                }
                Reply::Write(f, r) => self.changed(f, r),
                Reply::Restored(f, r) => self.restored(f, r),
                Reply::Api(name, Ok(v)) => match name {
                    "tokens" => self.studio.tokens_received(v),
                    "token" => {
                        let _ = self.requests.send(Request::Api("tokens", None));
                    }
                    "material" => self.studio.written = true,
                    "live-resolve" => {
                        if let Some(f) = v["file"].as_str() {
                            self.pick(f, v["id"].as_str().and_then(edit::index));
                        }
                    }
                    _ => {}
                },
                Reply::Api(_, Err(e)) => self.error = Some(e),
                _ => {}
            }
        }
        self.canvas_views.clear();
        let full = ui.available_rect_before_wrap();
        let inset = if ui.input(|i| {
            i.viewport().maximized == Some(true) || i.viewport().fullscreen == Some(true)
        }) {
            0.
        } else {
            topbar::FRAME_WIDTH
        };
        ui.painter().rect_stroke(
            full,
            0.,
            (inset, Color32::from_gray(52)),
            egui::StrokeKind::Inside,
        );
        let mut client = ui.new_child(
            egui::UiBuilder::new()
                .id_salt("editor client")
                .max_rect(full.shrink(inset)),
        );
        if self.pending_split.is_some()
            || self.finishing_split
            || self.context.is_some()
            || self.prefs
            || self.help
        {
            client.visuals_mut().disabled_alpha = 1.;
            client.disable();
        }
        self.top_strip(&mut client);
        self.draw_workspace(&mut client);
        if self.finishing_split && !ui.input(|i| i.pointer.primary_down()) {
            self.finishing_split = false;
        }
        #[cfg(not(windows))]
        topbar::frame_edges(ui);
    }
    fn insert_body(&mut self, ui: &mut egui::Ui, id: u64) {
        ui.horizontal(|ui| {
            self.pane_button(ui, id, Panel::Insert);
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
                        let mut insert=None;
                        for pair in self.primitives["PRIMITIVES"].as_array().unwrap().chunks(2){
                            ui.horizontal(|ui|{for p in pair{
                                let r=ui.add_enabled_ui(self.file.is_some(),|ui|chrome::part_button(ui,[half,28.],studio::string(p,"icon"),studio::string(p,"label"),false)).inner;
                                if r.clicked(){insert=Some(studio::string(p,"jsx").to_owned());}
                                if r.drag_started_by(egui::PointerButton::Primary) {r.dnd_set_drag_payload(json!({"insert":{"jsx":p["jsx"]}}));}
                            }});
                        }
                        if let Some(jsx)=insert{self.insert(&jsx,json!([]));}
                        let mut component_insert=None;
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
                                    let meta=c.meta.get(file);let server=meta.is_some_and(|m|m.server_only);
                                    ui.horizontal(|ui|{
                                        let export=meta.and_then(|m|m.export_name.as_deref()).filter(|_|self.file.is_some()&&!server);
                                        let w=(ui.available_width()-if export.is_some(){24.}else{0.}).max(12.);
                                        let caption=if server{format!("{name}   SERVER")}else{name.to_owned()};
                                        let response=ui.add_enabled_ui(!server,|ui|chrome::part_button(ui,[w,26.],"\u{e14d}",&caption,self.file.as_ref()==Some(file))).inner.on_hover_text(file);
                                        if response.clicked(){open=Some(file.clone());}
                                        if let Some(export)=export{let jsx=format!("<{export} />");let imports=json!([{"source":format!("@/{}",file.trim_start_matches("src/").trim_end_matches(".tsx")),"named":[export]}]);
                                            if response.drag_started_by(egui::PointerButton::Primary) {response.dnd_set_drag_payload(json!({"insert":{"jsx":jsx,"imports":imports}}));}
                                            if ui.small_button("+").clicked(){component_insert=Some((jsx,imports));}
                                        }
                                    });

                                }
                            }
                        }
                        if let Some((jsx,imports))=component_insert{self.insert(&jsx,imports);}
                    });
        if let Some(f) = open {
            self.open(f)
        }
    }
    fn outliner(&mut self, ui: &mut egui::Ui, id: u64) {
        ui.horizontal(|ui| {
            self.pane_button(ui, id, Panel::Outliner);
            ui.selectable_value(&mut self.routes, false, "File");
            ui.selectable_value(&mut self.routes, true, "Routes");
        });
        ui.separator();
        egui::ScrollArea::vertical()
            .id_salt(("tree", self.routes, self.file.as_deref()))
            .show(ui, |ui| {
                if self.routes {
                    if let Some(c) = &self.catalog {
                        if let Some(route) = route_tree(ui, &c.routes, "app") {
                            if route.files.contains_key("page") && !route.path.contains('[') {
                                self.path = route.path.clone();
                                self.draft = self.path.clone();
                            }
                            self.shell = Value::Null;
                            if let Some(f) = route.files.get("page") {
                                let _ = self.requests.send(Request::Shell(f.clone()));
                            }
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
                    if ui
                        .selectable_label(
                            self.selected.is_none(),
                            self.file.as_deref().unwrap_or("Sample props"),
                        )
                        .on_hover_text("Sample props")
                        .clicked()
                    {
                        self.selected = None;
                    }
                    let mut drop = None;
                    let mut visible = vec![];
                    for root in &self.elements {
                        element_tree(
                            ui,
                            root,
                            &mut self.selected,
                            &mut self.collapsed,
                            &mut visible,
                            &mut drop,
                        );
                    }
                    self.visible_nodes = visible;
                    if let Some(op) = drop {
                        self.drop_at(&op);
                    }
                }
            });
    }
    fn properties(&mut self, ui: &mut egui::Ui, id: u64) {
        ui.horizontal(|ui| {
            self.pane_button(ui, id, Panel::Properties);
            let name = self
                .focus()
                .map(|n| format!("<{}>", n.tag))
                .or_else(|| self.route.as_ref().map(|r| r.0.clone()))
                .unwrap_or_else(|| {
                    if self.file.is_some() {
                        "Sample props".into()
                    } else {
                        "Nothing open".into()
                    }
                });
            ui.strong(name);
        });
        ui.separator();
        egui::ScrollArea::vertical()
                    .id_salt("props")
                    .show(ui, |ui| {
                        if let Some(node)=self.selected.and_then(|i|self.elements.iter().find_map(|e|e.find(i))){
                            let source=node.component_source.clone();
                            let structural=node.can.structural;
                            if let Some(op)=edit::inspector(ui,node,&mut self.editing.drafts){self.edit(op);}
                            if let Some(f)=source && ui.button("Open component source").clicked(){self.open(f);}
                            ui.separator();ui.strong("Placement");ui.horizontal_wrapped(|ui|{for label in ["Move up","Move down","Duplicate","Delete"]{if ui.add_enabled(structural,egui::Button::new(label)).clicked(){self.structural(label);}}});
                        } else if let Some((url, files, layouts)) = &self.route {
                            ui.strong(url);
                            let mut open = None;
                            for (kind, f) in files {
                                if ui.link(format!("{kind} · {f}")).clicked() {
                                    open = Some(f.clone());
                                }
                            }
                            if let Some(note)=self.shell["contentNote"].as_str(){ui.label(note);}
                            if let Some(view)=self.shell["viewFile"].as_str() && ui.button(format!("Open {}",studio::string(&self.shell,"viewTag"))).clicked(){open=Some(view.into());}
                            if !layouts.is_empty() {
                                ui.label("Layout chain");
                                for f in layouts {
                                    ui.label(f);
                                }
                            }
                            if let Some(f) = open {
                                self.open(f)
                            }
                        } else if self.file.is_some(){
                            ui.strong("Sample props");for spec in &self.specs{let name=studio::string(spec,"name");ui.label(name);
                                match studio::string(&spec["control"],"kind"){
                                    "boolean"=>{let mut v=self.samples[name].as_bool().unwrap_or(false);if ui.checkbox(&mut v,name).changed(){self.samples[name]=json!(v);}},
                                    "number"=>{let mut v=self.samples[name].as_f64().unwrap_or_default();if ui.add(egui::DragValue::new(&mut v)).changed(){self.samples[name]=json!(v);}},
                                    "string"=>{let mut v=self.samples[name].as_str().unwrap_or("").to_owned();if ui.text_edit_singleline(&mut v).changed(){self.samples[name]=json!(v);}},
                                    "select"=>{egui::ComboBox::from_id_salt(name).selected_text(self.samples[name].as_str().unwrap_or("")).show_ui(ui,|ui|{for v in spec["control"]["options"].as_array().into_iter().flatten(){ui.selectable_value(&mut self.samples[name],v.clone(),v.as_str().unwrap_or(""));}});},
                                    _=>{ui.weak(studio::string(spec,"typeText"));}
                                }
                            }
                        } else {
                            ui.weak("Nothing open. The Routes tree shows the app’s structure; Insert lists its components.");
                        }
                    });
    }
    fn canvas_body(&mut self, ui: &mut egui::Ui, id: u64) {
        ui.horizontal_wrapped(|ui| {
            self.pane_button(ui, id, Panel::Canvas);
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
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.selectable_value(&mut self.interact, true, "View");
                ui.selectable_value(&mut self.interact, false, "Edit");
            });
        });
        ui.separator();
        if let Some(error) = &self.error {
            ui.label(error);
            if ui.button("Retry project connection").clicked() {
                let _ = self.requests.send(Request::Reload);
            }
        }
        let primary = id == 1;
        let component = self.workspace == 3 && primary;
        if !component {
            ui.horizontal(|ui| {
                ui.weak("PATH");
                let (path, draft) = if primary {
                    (&mut self.path, &mut self.draft)
                } else {
                    let pair = self
                        .extra_paths
                        .entry(id)
                        .or_insert_with(|| (self.path.clone(), self.path.clone()));
                    (&mut pair.0, &mut pair.1)
                };
                let input = ui.add_sized(
                    [(ui.available_width() - 112.).max(30.), 22.],
                    egui::TextEdit::singleline(draft),
                );
                if input.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                    *path = format!("/{}", draft.trim_start_matches('/'));
                    *draft = path.clone();
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
                        path.trim_start_matches('/')
                    );
                    ui.ctx().open_url(egui::OpenUrl::new_tab(url));
                }
            });
            ui.separator();
            if let Some(landed) = self.landed.get(&id)
                && landed
                    != self
                        .extra_paths
                        .get(&id)
                        .map(|p| &p.0)
                        .unwrap_or(&self.path)
            {
                ui.horizontal(|ui| {
                    ui.weak(format!("The app sent us to {landed}"));
                    if ui.button("Sign in…").clicked() {
                        #[cfg(windows)]
                        if let Some(view) = self.web.get(&id) {
                            view.sign_in();
                        }
                    }
                });
            }
        } else if self.rulers {
            self.draw_ruler(ui);
        }
        self.canvas_rect = ui.available_rect_before_wrap();
        if component && self.route.is_some() {
            ui.weak("Open the page’s view or its code from Properties.");
        } else if component && self.file.is_some() && !self.renderable {
            ui.weak("Server component. Use the Outliner to inspect its source.");
        } else {
            self.canvas_views.insert(id, self.canvas_rect);
            #[cfg(windows)]
            if let Some(view) = self.web.get_mut(&id) {
                view.paint_snapshot(ui, self.canvas_rect);
            }
        }
        #[cfg(windows)]
        if let Some(err) = &self.web_error {
            ui.colored_label(egui::Color32::LIGHT_RED, err);
        }
    }
}
fn route_tree<'a>(ui: &mut egui::Ui, node: &'a Route, id: &str) -> Option<&'a Route> {
    let label = if node.segment.is_empty() {
        "app"
    } else {
        &node.segment
    };
    let mut selected = None;
    let mut state = egui::collapsing_header::CollapsingState::load_with_default_open(
        ui.ctx(),
        ui.make_persistent_id(id),
        node.segment.is_empty(),
    );
    let children = !node.children.is_empty();
    let page = node.files.contains_key("page");
    let api = node.files.contains_key("route") && !page;
    let r = ui.horizontal(|ui| {
        let caret = ui.add_sized(
            [9., 16.],
            egui::Button::new(if children {
                if state.is_open() {
                    "\u{e5c5}"
                } else {
                    "\u{e5cc}"
                }
            } else {
                ""
            })
            .frame(false),
        );
        if caret.clicked() && children {
            state.toggle(ui);
        }
        let glyph = if node.dynamic {
            "\u{ead1}"
        } else if page {
            "\u{e873}"
        } else if api {
            "\u{f1b7}"
        } else if node.group {
            "\u{e2c8}"
        } else {
            "\u{e2c7}"
        };
        let r = ui.selectable_label(
            false,
            RichText::new(format!("{glyph}  {label}")).color(if page {
                BLUE
            } else {
                chrome::FAINT
            }),
        );
        let mut badges = vec![];
        if api {
            badges.push("API")
        }
        if node.files.contains_key("layout") {
            badges.push("layout")
        }
        if node.ownership.as_deref() == Some("owned") {
            badges.push("owned")
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.small(RichText::new(badges.join(" · ")).color(chrome::FAINT));
        });
        r.clicked()
    });
    if r.inner {
        if page || api {
            selected = Some(node)
        } else if children {
            state.toggle(ui);
        }
    }
    if children {
        state.show_body_indented(&r.response, ui, |ui| {
            for child in &node.children {
                if let Some(n) = route_tree(ui, child, &format!("{id}/{}", child.segment)) {
                    selected = Some(n);
                }
            }
        });
    }
    selected
}
fn element_tree(
    ui: &mut egui::Ui,
    node: &Element,
    selected: &mut Option<usize>,
    collapsed: &mut std::collections::HashSet<String>,
    visible: &mut Vec<usize>,
    drop: &mut Option<Value>,
) {
    visible.push(node.index);
    let open = !collapsed.contains(&node.id);
    ui.horizontal(|ui| {
        let caret = if node.children.is_empty() {
            " "
        } else if open {
            "\u{e5c5}"
        } else {
            "\u{e5cc}"
        };
        if ui.small_button(caret).clicked() {
            if open {
                collapsed.insert(node.id.clone());
            } else {
                collapsed.remove(&node.id);
            }
        }
        let glyph = match node.tag.as_str() {
            "p" | "span" => '\u{e26c}',
            "button" => '\u{f1c1}',
            "a" => '\u{e250}',
            "img" | "svg" => '\u{e3f4}',
            t if t.starts_with(|c: char| c.is_ascii_uppercase()) => '\u{f720}',
            _ => '\u{e3c6}',
        };
        let r = ui.add(
            egui::Button::selectable(
                *selected == Some(node.index),
                format!("{glyph}  {}", node.tag),
            )
            .sense(egui::Sense::click_and_drag()),
        );
        if r.clicked() {
            *selected = Some(node.index);
        }
        if node.can.structural && r.drag_started_by(egui::PointerButton::Primary) {
            r.dnd_set_drag_payload(json!({"moveId":node.id}));
        }
        if ui.input(|i| i.pointer.primary_released())
            && let Some(v) = r.dnd_release_payload::<Value>()
        {
            let mut v = (*v).clone();
            v["targetId"] = json!(node.id);
            v["position"] = json!(if r
                .interact_pointer_pos()
                .is_some_and(|p| p.y < r.rect.center().y)
            {
                "before"
            } else {
                "after"
            });
            *drop = Some(v);
        }
    });
    if open && !node.children.is_empty() {
        ui.indent(&node.id, |ui| {
            for child in &node.children {
                element_tree(ui, child, selected, collapsed, visible, drop);
            }
        });
    }
}
impl eframe::App for Editor {
    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.render(ui);
        #[cfg(windows)]
        {
            window_frame::update(
                frame,
                ui.ctx(),
                self.topbar.caption,
                self.input_blocked(ui) || self.drag.is_some() || ui.ctx().dragged_id().is_some(),
            );
            self.update_canvases(ui, frame);
        }
    }
    fn save(&mut self, _storage: &mut dyn eframe::Storage) {
        self.persist();
    }
}
fn main() -> eframe::Result {
    let daemon = daemon::start();
    let startup_error = daemon.as_ref().err().cloned();
    eframe::run_native(
        "u-and-i · Rust",
        eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_decorations(false)
                .with_min_inner_size([480., 320.])
                .with_inner_size([1500., 950.]),
            ..Default::default()
        },
        Box::new(move |cc| {
            let mut editor = Editor::new(&cc.egui_ctx);
            editor.error = startup_error;
            Ok(Box::new(editor))
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_kittest::{Harness, kittest::Queryable};

    #[test]
    fn drag_pane_across_canvas_and_cancel() {
        let mut h = Harness::builder()
            .with_size(egui::vec2(1500., 950.))
            .build_ui_state(
                |ui, editor: &mut Option<Editor>| {
                    editor
                        .get_or_insert_with(|| Editor::new(ui.ctx()))
                        .render(ui)
                },
                None,
            );
        h.run();
        let handle = format!("{}\u{e5c5}", Panel::Insert.glyph());
        let widget = h.get_by_label(handle.as_str());
        let start = widget.rect().center();
        let canvas = h.state().as_ref().unwrap().canvas_views[&1];
        h.event(egui::Event::PointerMoved(start));
        h.step();
        h.event(egui::Event::PointerButton {
            pos: start,
            button: egui::PointerButton::Primary,
            pressed: true,
            modifiers: egui::Modifiers::NONE,
        });
        h.step();
        h.event(egui::Event::PointerMoved(canvas.center()));
        h.step();
        h.run();
        let editor = h.state().as_ref().unwrap();
        assert_eq!(editor.drag, Some(0));
        assert!(editor.dock_preview.unwrap().contains(canvas.center()));
        h.key_press(egui::Key::Escape);
        h.run();
        assert!(h.state().as_ref().unwrap().dock_preview.is_none());
    }

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
        for (index, name) in ["Style", "Workshop", "Component", "Layout"]
            .iter()
            .enumerate()
        {
            h.get_by_label(*name).click();
            h.run();
            let expected = [1, 2, 3, 0][index];
            assert_eq!(h.state().as_ref().unwrap().workspace, expected);
            h.render()
                .unwrap()
                .save(format!("target/native-{name}.png"))
                .unwrap();
        }
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
                "component model timed out: file={:?} error={:?}",
                h.state().as_ref().unwrap().file,
                h.state().as_ref().unwrap().error
            );
            std::thread::sleep(std::time::Duration::from_millis(30));
            h.step();
        }
        let editor = h.state().as_ref().unwrap();
        assert_eq!(editor.file.as_ref(), Some(&file));
        assert!(editor.selected.is_none());
        if std::env::var_os("UAI_NATIVE_FIXTURE").is_some() {
            let root = std::path::PathBuf::from(std::env::var_os("UAI_NATIVE_FIXTURE").unwrap())
                .canonicalize()
                .unwrap();
            assert!(
                root.starts_with(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("target")
                        .canonicalize()
                        .unwrap()
                )
            );
            assert_eq!(
                editor.catalog.as_ref().unwrap().name,
                root.file_name().unwrap().to_string_lossy()
            );
            let css = root.join("src/app/globals.css");
            let prior_css = std::fs::read_to_string(&css).unwrap();
            h.get_by_label("Style").click();
            h.run();
            for _ in 0..100 {
                h.step();
                if h.query_all_by_value("#ff1414").next().is_some() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            let input = h.get_all_by_value("#ff1414").next().unwrap();
            input.click();
            h.run();
            h.key_press_modifiers(egui::Modifiers::CTRL, egui::Key::A);
            h.run();
            h.event(egui::Event::Text("#102030".into()));
            h.run();
            h.key_press(egui::Key::Enter);
            h.run();
            for _ in 0..100 {
                h.step();
                if std::fs::read_to_string(&css).unwrap().contains("#102030") {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            assert!(std::fs::read_to_string(&css).unwrap().contains("#102030"));
            h.get_by_label("Workshop").click();
            h.run();
            h.get_by_label("Inset").click();
            h.run();
            h.get_by_label("Write tokens").click();
            h.run();
            for _ in 0..150 {
                h.step();
                if h.state().as_ref().unwrap().studio.written {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            assert!(
                std::fs::read_to_string(&css)
                    .unwrap()
                    .contains("--material-surface-inset-shadow-pressed: inset")
                    || std::fs::read_to_string(&css)
                        .unwrap()
                        .contains("--material-surface-inset-shadow-pressed: ")
            );
            let edited_css = std::fs::read_to_string(&css).unwrap();
            assert_ne!(edited_css, prior_css);
            let client = reqwest::blocking::Client::new();
            client
                .post(format!("{}/api/restore", project::origin()))
                .json(&json!({"file":"src/app/globals.css","text":prior_css}))
                .send()
                .unwrap()
                .error_for_status()
                .unwrap();
            assert_eq!(std::fs::read_to_string(&css).unwrap(), prior_css);
            h.set_size(egui::vec2(900., 640.));
            h.run();
            h.render()
                .unwrap()
                .save("target/native-workshop-small.png")
                .unwrap();
            h.set_size(egui::vec2(1500., 950.));
            h.run();
            h.get_by_label("Layout").click();
            h.run();
            let target = root.join(&file);
            let before = std::fs::read(&target).unwrap();
            h.get_by_label("Heading").click();
            h.run();
            let wait = |h: &mut Harness<'_, Option<Editor>>, want: bool| {
                for _ in 0..300 {
                    h.step();
                    if h.state().as_ref().unwrap().can_restore(want) {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(15));
                }
                panic!("history timed out");
            };
            wait(&mut h, false);
            assert!(
                String::from_utf8(std::fs::read(&target).unwrap())
                    .unwrap()
                    .contains("<h2>Heading</h2>")
            );
            h.get_all_by_label("Edit").next().unwrap().click();
            h.run();
            h.get_by_label("Undo").click();
            h.run();
            wait(&mut h, true);
            assert_eq!(std::fs::read(&target).unwrap(), before);
            h.get_all_by_label("Edit").next().unwrap().click();
            h.run();
            h.get_by_label("Redo").click();
            h.run();
            wait(&mut h, false);
            assert_ne!(std::fs::read(&target).unwrap(), before);
            h.get_all_by_label("Edit").next().unwrap().click();
            h.run();
            h.get_by_label("Undo").click();
            h.run();
            wait(&mut h, true);
            assert_eq!(std::fs::read(&target).unwrap(), before);
        }
        h.render()
            .unwrap()
            .save("target/native-component.png")
            .unwrap();
    }
}

impl Drop for Editor {
    fn drop(&mut self) {
        self.persist();
    }
}
#[cfg(not(windows))]
impl Editor {
    fn begin_text(&self) {}
}
