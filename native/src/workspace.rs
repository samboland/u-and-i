use super::*;
pub const TABS: [&str; 4] = ["Layout", "Style", "Workshop", "Component"];
type Saved = (Vec<Dock>, u64, usize, bool, bool);
fn settings() -> std::path::PathBuf {
    if let Some(p) = std::env::var_os("UAI_NATIVE_SETTINGS") {
        return p.into();
    }
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (
        std::env::var_os("UAI_TARGET"),
        std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../uai.config.json"))
            .unwrap_or_default(),
    )
        .hash(&mut h);
    std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("u-and-i")
        .join(format!("workspace-{:x}.json", h.finish()))
}
pub fn load() -> Saved {
    if !cfg!(test)
        && let Ok(data) = std::fs::read(settings())
        && let Ok(v) = serde_json::from_slice::<Saved>(&data)
        && v.0.len() >= 3
        && v.2 < 4
        && v.0.iter().all(Dock::valid)
    {
        return v;
    }
    ((0..3).map(Dock::preset).collect(), 10, 0, true, false)
}
impl Editor {
    pub fn resume_session(&mut self, ctx: &egui::Context) {
        if cfg!(test) {
            return;
        }
        let path = settings().with_extension("session.json");
        if let Ok(data) = std::fs::read(path)
            && let Ok(v) = serde_json::from_slice::<Value>(&data)
        {
            if let Ok(bar) = serde_json::from_value::<topbar::TopBar>(v["topbar"].clone())
                && bar.valid(self.docks.len())
            {
                self.workspace = bar.tabs[bar.active].mode;
                self.topbar = bar;
            }
            self.reopen = v["reopen"] != false;
            self.app_zoom = v["appZoom"].as_f64().unwrap_or(1.).clamp(0.7, 1.5) as f32;
            ctx.set_zoom_factor(self.app_zoom);
            self.device = (v["device"].as_u64().unwrap_or_default() as usize).min(2);
            self.zoom = v["zoom"]
                .as_f64()
                .unwrap_or(DEVICES[self.device].2 as f64)
                .clamp(0.25, 4.) as f32;
            self.path = v["path"].as_str().unwrap_or("/").to_owned();
            self.draft = self.path.clone();
            self.saved_samples = v["samples"].as_object().cloned().unwrap_or_default();
            if self.reopen
                && let Some(file) = v["file"].as_str()
            {
                self.open(file.into());
            }
        }
    }
    pub fn persist(&self) {
        if cfg!(test) {
            return;
        }
        let p = settings();
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let mut samples = self.saved_samples.clone();
        if let Some(file) = &self.file {
            samples.insert(file.clone(), self.samples.clone());
        }
        let session = json!({"topbar":self.topbar,"file":self.file,"path":self.path,"device":self.device,"zoom":self.zoom,"samples":samples,"appZoom":self.app_zoom,"reopen":self.reopen});
        let _ = std::fs::write(p.with_extension("session.json"), session.to_string());
        if let Ok(data) = serde_json::to_vec(&(
            &self.docks,
            self.next_id,
            self.workspace,
            self.rulers,
            self.rem,
        )) {
            let _ = std::fs::write(p, data);
        }
    }
    pub fn group(&self) -> usize {
        self.topbar.tabs[self.topbar.active].group
    }
    pub fn activate_tab(&mut self, index: usize) {
        self.topbar.active = index;
        let i = self.topbar.tabs[index].mode;
        self.workspace = i;
        if i == 1 {
            let _ = self.requests.send(Request::Api("tokens", None));
        }
    }
    pub fn pick(&mut self, file: &str, id: Option<usize>) {
        if self.file.as_deref() != Some(file) {
            self.open(file.into());
            self.editing.next_selection = id;
        } else {
            self.selected = id;
            self.routes = false;
        }
    }
    pub fn zoom_by(&mut self, up: bool) {
        self.zoom = if up {
            ZOOM.iter().copied().find(|n| *n > self.zoom).unwrap_or(4.)
        } else {
            ZOOM.iter()
                .rev()
                .copied()
                .find(|n| *n < self.zoom)
                .unwrap_or(0.25)
        };
    }
    pub fn input_blocked(&self, ui: &egui::Ui) -> bool {
        self.prefs
            || self.help
            || self.context.is_some()
            || self.pending_split.is_some()
            || egui::Popup::is_any_open(ui.ctx())
    }
    fn keys(&mut self, ui: &egui::Ui, owner: Option<Panel>) {
        if self.input_blocked(ui) || self.drag.is_some() || self.finishing_split {
            return;
        }
        if ui
            .memory(|m| m.focused())
            .and_then(|id| egui::TextEdit::load_state(ui.ctx(), id))
            .is_some()
            || self.prefs
            || self.help
        {
            return;
        }
        use egui::Key;
        if ui.input(|i| i.modifiers.command && i.modifiers.shift) {
            let d = ui.input(|i| {
                if i.key_pressed(Key::Plus) || i.key_pressed(Key::Equals) {
                    0.1
                } else if i.key_pressed(Key::Minus) {
                    -0.1
                } else {
                    0.
                }
            });
            if d != 0. || ui.input(|i| i.key_pressed(Key::Num0)) {
                self.app_zoom = if d == 0. {
                    1.
                } else {
                    (self.app_zoom + d).clamp(0.7, 1.5)
                };
                ui.ctx().set_zoom_factor(self.app_zoom);
                return;
            }
        }
        if owner == Some(Panel::Outliner) && !ui.input(|i| i.modifiers.alt || i.modifiers.command) {
            for (key, name) in [
                (Key::ArrowUp, "ArrowUp"),
                (Key::ArrowDown, "ArrowDown"),
                (Key::ArrowLeft, "ArrowLeft"),
                (Key::ArrowRight, "ArrowRight"),
            ] {
                let modifiers = ui.input(|i| i.modifiers);
                if ui.input_mut(|i| i.consume_key(modifiers, key)) {
                    self.walk(name, modifiers.shift);
                }
            }
        }
        let modifiers = ui.input(|i| i.modifiers);
        let pressed = |key| ui.input_mut(|i| i.consume_key(modifiers, key));
        if owner == Some(Panel::Canvas) && !cfg!(all(windows, feature = "legacy-canvas")) {
            self.canvas_shortcuts(ui);
            return;
        }
        if modifiers.command && pressed(Key::Z) {
            self.restore(modifiers.shift);
        } else if matches!(
            owner,
            Some(Panel::Canvas | Panel::Outliner | Panel::Properties)
        ) {
            if modifiers.command && pressed(Key::D) {
                self.structural("Duplicate");
            } else if pressed(Key::Delete) {
                self.structural("Delete");
            } else if modifiers.alt && pressed(Key::ArrowUp) {
                self.structural("Move up");
            } else if modifiers.alt && pressed(Key::ArrowDown) {
                self.structural("Move down");
            } else if pressed(Key::F2) {
                self.begin_text();
            } else if owner == Some(Panel::Canvas) {
                self.canvas_shortcuts(ui);
            }
        }
    }
    fn canvas_shortcuts(&mut self, ui: &egui::Ui) {
        use egui::Key;
        let modifiers = ui.input(|i| i.modifiers);
        let pressed = |key| ui.input_mut(|i| i.consume_key(modifiers, key));
        if modifiers.is_none() && pressed(Key::Tab) {
            self.interact = !self.interact;
        } else if modifiers.command && pressed(Key::Minus) {
            self.zoom_by(false);
        } else if modifiers.command && (pressed(Key::Equals) || pressed(Key::Plus)) {
            self.zoom_by(true);
        } else if modifiers.command && pressed(Key::Num0) {
            self.zoom = DEVICES[self.device].2;
        }
    }
    pub fn walk(&mut self, key: &str, recursive: bool) {
        let pos = self
            .selected
            .and_then(|i| self.visible_nodes.iter().position(|n| *n == i));
        if key == "ArrowUp" || key == "ArrowDown" {
            if self.visible_nodes.is_empty() {
                return;
            }
            let last = self.visible_nodes.len() - 1;
            let pos = if key == "ArrowUp" {
                pos.map_or(last, |p| p.saturating_sub(1))
            } else {
                pos.map_or(0, |p| (p + 1).min(last))
            };
            self.selected = Some(self.visible_nodes[pos]);
            return;
        }
        let Some(node) = self.focus() else { return };
        let id = node.id.clone();
        if recursive {
            fn ids(n: &Element, out: &mut Vec<String>) {
                out.push(n.id.clone());
                for ch in &n.children {
                    ids(ch, out);
                }
            }
            let mut all = vec![];
            ids(node, &mut all);
            for id in all {
                if key == "ArrowLeft" {
                    self.collapsed.insert(id);
                } else {
                    self.collapsed.remove(&id);
                }
            }
        } else if key == "ArrowRight" {
            let first = node.children.first().map(|c| c.index);
            if !self.collapsed.remove(&id) && first.is_some() {
                self.selected = first;
            }
        } else if key == "ArrowLeft" {
            if node.children.is_empty() || self.collapsed.contains(&id) {
                self.selected = node
                    .parent_id
                    .as_deref()
                    .and_then(edit::index)
                    .or(self.selected);
            } else {
                self.collapsed.insert(id);
            }
        }
    }
    pub fn edit_menu(&mut self, ui: &mut egui::Ui) {
        let shortcut_item = |ui: &mut egui::Ui, enabled, label: &str, shortcut: &str| {
            let row = ui.add_enabled(enabled, egui::Button::new(label).shortcut_text(shortcut));
            ui.ctx().accesskit_node_builder(row.id, |node| {
                node.set_label(label);
                node.set_keyboard_shortcut(shortcut);
            });
            row.clicked()
        };
        if ui.button("Preferences…").clicked() {
            self.prefs = true;
            ui.close();
        }
        for (redo, label) in [(false, "Undo"), (true, "Redo")] {
            let shortcut = if redo { "Ctrl+Shift+Z" } else { "Ctrl+Z" };
            if shortcut_item(ui, self.can_restore(redo), label, shortcut) {
                self.restore(redo);
                ui.close();
            }
        }
        if shortcut_item(
            ui,
            cfg!(all(windows, feature = "legacy-canvas"))
                && self.focus().is_some_and(|n| n.can.text),
            "Edit text",
            "F2",
        ) {
            self.begin_text();
            ui.close();
        }
        for (label, shortcut) in [
            ("Duplicate", "Ctrl+D"),
            ("Delete", "Del"),
            ("Move up", "Alt+↑"),
            ("Move down", "Alt+↓"),
        ] {
            if shortcut_item(ui, self.focus().is_some_and(|n| n.can.structural), label, shortcut) {
                self.structural(label);
                ui.close();
            }
        }
        ui.separator();
        ui.menu_button("Insert", |ui| {
            let mut item = None;
            for p in self.primitives["PRIMITIVES"].as_array().unwrap() {
                if ui
                    .add_enabled(
                        self.file.is_some(),
                        egui::Button::new(studio::string(p, "label")),
                    )
                    .clicked()
                {
                    item = Some(studio::string(p, "jsx").to_owned());
                    ui.close();
                }
            }
            if let Some(jsx) = item {
                self.insert(&jsx, json!([]));
            }
        });
    }
    pub fn window_menu(&mut self, ui: &mut egui::Ui) {
        for (i, w) in self.topbar.tabs.clone().iter().enumerate() {
            if ui
                .selectable_label(self.topbar.active == i, format!("{} workspace", w.name))
                .clicked()
            {
                self.activate_tab(i);
                ui.close();
            }
        }
        let g = self.group();
        for p in dock::PANELS {
            if ui.button(format!("Panel: {p:?}")).clicked() {
                self.docks[g].toggle(p, &mut self.next_id);
                ui.close();
            }
        }
        if matches!(self.workspace, 0 | 3) && ui.button("New canvas pane").clicked() {
            let id = self.docks[g]
                .panel_id(Panel::Canvas)
                .unwrap_or_else(|| self.docks[g].first());
            self.docks[g].apply(id, Action::Tab(Panel::Canvas), &mut self.next_id);
            ui.close();
        }
        if ui.button("Reset layout").clicked() {
            self.docks[g] = Dock::preset(topbar::preset(self.workspace));
            ui.close();
        }
        ui.checkbox(&mut self.rulers, "Rulers");
        for (name, step) in [("Zoom in", 1), ("Zoom out", -1), ("Reset zoom", 0)] {
            if ui.button(name).clicked() {
                if step == 0 {
                    self.zoom = DEVICES[self.device].2
                } else {
                    self.zoom_by(step > 0)
                }
                ui.close();
            }
        }
    }
    pub fn render_menu(&mut self, ui: &mut egui::Ui) {
        for (i, (name, _, z)) in DEVICES.iter().enumerate() {
            if ui.selectable_label(self.device == i, *name).clicked() {
                self.device = i;
                self.zoom = *z;
                ui.close();
            }
        }
        if ui
            .add_enabled(
                cfg!(all(windows, feature = "legacy-canvas")),
                egui::Button::new("Reload canvas"),
            )
            .clicked()
        {
            self.reload = true;
            ui.close();
        }
        if let Some(file) = &self.file
            && ui.button("Preview in new window").clicked()
        {
            let mut url =
                reqwest::Url::parse(&format!("{}/harness.html", project::origin())).unwrap();
            url.query_pairs_mut()
                .append_pair("file", &format!("app:{file}"));
            ui.ctx().open_url(egui::OpenUrl::new_tab(url.to_string()));
            ui.close();
        }
    }
    pub fn pane_button(&mut self, ui: &mut egui::Ui, id: u64, p: Panel) {
        let handle = egui::Button::new(format!("{}\u{e5c5}", p.glyph()))
            .sense(egui::Sense::click_and_drag());
        let (response, _) = topbar::instant_menus(ui.ctx().clone(), || {
            egui::containers::menu::MenuButton::from_button(handle)
                .config(topbar::menu_config())
                .ui(ui, |ui| {
                    let mut action = None;
                    for kind in dock::PANELS {
                        if ui
                            .selectable_label(kind == p, format!("{kind:?}"))
                            .clicked()
                        {
                            action = Some(Action::Change(kind));
                        }
                    }
                    if let Some(act) = action {
                        let group = self.group();
                        self.docks[group].apply(id, act, &mut self.next_id);
                        if matches!(act, Action::Change(Panel::Style)) {
                            let _ = self.requests.send(Request::Api("tokens", None));
                        }
                        ui.close();
                    }
                })
        });
        let response = response.on_hover_text(format!("{p:?}"));
        if response.drag_started_by(egui::PointerButton::Primary) {
            self.drag = Some(id);
            egui::Popup::close_all(ui.ctx());
        }
    }
    pub fn draw_workspace(&mut self, ui: &mut egui::Ui) {
        if matches!(self.workspace, 1 | 2) {
            egui::Panel::top("workspace tools").show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    self.studio.toolbar(ui, self.workspace == 1, &self.requests)
                });
            });
        }
        if let Some(e) = self.error.clone() {
            egui::Panel::bottom("error").show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.colored_label(Color32::LIGHT_RED, e);
                    if ui.small_button("Dismiss").clicked() {
                        self.error = None;
                    }
                });
            });
        }
        let g = self.group();
        let mut panes = vec![];
        let root = ui.available_rect_before_wrap().shrink(2.);
        self.resizing_pane = false;
        ui.painter().rect_filled(root, 0., Color32::from_gray(22));
        topbar::instant_menus(ui.ctx().clone(), || {
            self.docks[g].panes(
                ui,
                root,
                &mut self.pending_split,
                &mut self.resizing_pane,
                &mut panes,
            )
        });
        let key_position = ui
            .memory(|m| m.focused())
            .and_then(|id| ui.ctx().read_response(id))
            .map(|r| r.rect.center())
            .or_else(|| ui.input(|i| i.pointer.hover_pos()));
        let owner = key_position
            .and_then(|pos| panes.iter().find(|(rect, _, _)| rect.contains(pos)))
            .map(|(_, tabs, active)| tabs[*active].1);
        self.keys(ui, owner);
        if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.pending_split = None;
            self.drag = None;
        }
        if let Some(h) = self.pending_split
            && ui.input(|i| i.key_pressed(egui::Key::Tab))
        {
            self.pending_split = Some(!h);
        }
        self.dock_preview = None;
        if let Some(src) = self.drag
            && let Some(pos) = ui
                .input(|i| i.pointer.interact_pos())
                .filter(|p| root.contains(*p))
        {
            let edges = [
                (pos.x - root.left(), true, true),
                (root.right() - pos.x, true, false),
                (pos.y - root.top(), false, true),
                (root.bottom() - pos.y, false, false),
            ];
            if let Some((_, h, before)) = edges
                .into_iter()
                .min_by(|a, b| a.0.total_cmp(&b.0))
                .filter(|e| e.0 < 10.)
            {
                self.dock_preview = Some(dock::preview_rect(root, Some((h, before))));
                if ui.input(|i| i.pointer.primary_released()) {
                    self.docks[g].move_outer(src, h, before);
                    self.drag = None;
                }
            }
        }
        let seam_rects: Vec<_> = panes.iter().map(|pane| pane.0).collect();
        for (rect, tabs, active) in panes {
            let (id, p) = tabs[active];
            if rect.width() < 12. || rect.height() < 12. {
                continue;
            }
            let mut u = ui.new_child(
                egui::UiBuilder::new()
                    .id_salt(("pane", g, id))
                    .max_rect(rect),
            );
            u.set_clip_rect(ui.clip_rect().intersect(rect));
            let frame = chrome::pane(if p == Panel::Canvas { VOID } else { PANEL });
            let active_outline = !self.resizing_pane
                && !self.input_blocked(ui)
                && ui.rect_contains_pointer(rect.shrink(1.));
            let outline = Color32::from_white_alpha(if active_outline { 42 } else { 21 });
            frame
                .outer_margin(0)
                .corner_radius(4)
                .stroke((1., outline))
                .show(&mut u, |ui| {
                    ui.set_min_size(ui.available_size());
                    if tabs.len() > 1 {
                        ui.horizontal_wrapped(|ui| {
                            for (n, (tab_id, kind)) in tabs.iter().enumerate() {
                                let button =
                                    egui::Button::selectable(n == active, format!("{kind:?}"))
                                        .sense(egui::Sense::click_and_drag());
                                let response = ui.add(button);
                                if response.clicked() {
                                    self.docks[g].apply(id, Action::Select(n), &mut self.next_id);
                                }
                                if response.drag_started_by(egui::PointerButton::Primary) {
                                    self.drag = Some(*tab_id);
                                }
                                if self.dock_preview.is_none()
                                    && response.contains_pointer()
                                    && ui.input(|i| i.pointer.primary_released())
                                    && let Some(source) = self.drag.take()
                                {
                                    self.docks[g].place_tab(source, *tab_id);
                                }
                            }
                        });
                    }
                    let state = self
                        .states
                        .entry(id)
                        .or_insert_with(|| (String::new(), self.file.is_none()));
                    self.search = state.0.clone();
                    self.routes = state.1;
                    match p {
                        Panel::Insert => self.insert_body(ui, id),
                        Panel::Outliner => self.outliner(ui, id),
                        Panel::Properties => self.properties(ui, id),
                        Panel::Canvas => self.canvas_body(ui, id),
                        Panel::Style | Panel::Workshop => {
                            self.pane_button(ui, id, p);
                            if p == Panel::Style {
                                self.studio.style(ui, &self.requests)
                            } else {
                                self.studio.workshop(ui)
                            }
                        }
                    }
                    self.states.insert(id, (self.search.clone(), self.routes));
                });
            if let Some(horizontal) = self.pending_split
                && let Some(pos) = ui
                    .input(|i| i.pointer.hover_pos())
                    .filter(|p| rect.contains(*p))
            {
                let (start, span, pointer) = if horizontal {
                    (rect.left(), rect.width(), pos.x)
                } else {
                    (rect.top(), rect.height(), pos.y)
                };
                let inner = span - 4.;
                let allowed = inner >= 144.;
                let mut cut = pointer - start - 2.;
                if ui.input(|i| i.modifiers.ctrl) && allowed {
                    let ticks = (0..=12).map(|n| inner * n as f32 / 12.);
                    let seams = seam_rects.iter().map(|r| {
                        if horizontal {
                            r.right() - start
                        } else {
                            r.bottom() - start
                        }
                    });
                    cut = ticks
                        .chain(seams)
                        .filter(|x| *x > 0. && *x < inner)
                        .min_by(|a, b| (a - cut).abs().total_cmp(&(b - cut).abs()))
                        .unwrap_or(cut);
                }
                let outline = |r: egui::Rect| {
                    ui.painter().rect_stroke(
                        r.shrink(2.),
                        4.,
                        (2., BLUE),
                        egui::StrokeKind::Inside,
                    );
                };
                if allowed {
                    cut = cut.clamp(72., inner - 72.);
                    let mut first = rect;
                    let mut second = rect;
                    if horizontal {
                        first.max.x = start + cut;
                        second.min.x = first.max.x + 4.;
                    } else {
                        first.max.y = start + cut;
                        second.min.y = first.max.y + 4.;
                    }
                    outline(first);
                    outline(second);
                    if ui.input(|i| i.pointer.primary_pressed()) {
                        self.docks[g].split_at(
                            id,
                            horizontal,
                            (cut + 2.) / span,
                            &mut self.next_id,
                        );
                        self.pending_split = None;
                        self.finishing_split = true;
                    }
                } else {
                    outline(rect);
                }
            }
            if let Some(src) = self.drag
                && self.dock_preview.is_none()
                && (src != id || tabs.len() > 1)
                && let Some(pos) = ui
                    .input(|i| i.pointer.interact_pos())
                    .filter(|pos| rect.contains(*pos))
            {
                let edge = if pos.y <= rect.top() + 27. {
                    None
                } else {
                    dock::drop_edge(rect, pos)
                };
                let target = if src == id && edge.is_some() {
                    tabs.iter()
                        .find(|(tab, _)| *tab != src)
                        .map(|t| t.0)
                        .unwrap_or(id)
                } else {
                    id
                };
                self.dock_preview = (src != target).then(|| dock::preview_rect(rect, edge));
                if ui.input(|i| i.pointer.primary_released()) {
                    self.docks[g].move_to(src, target, edge);
                    self.drag = None;
                }
            }
        }
        topbar::instant_menus(ui.ctx().clone(), || {
            dock::outer_borders(ui, root.expand(2.), &mut self.pending_split)
        });
        if ui.input(|i| i.pointer.primary_released()) {
            self.drag = None;
        }
        if self.drag.is_some() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
            if let Some(rect) = self.dock_preview {
                ui.painter().rect_filled(
                    rect,
                    0.,
                    Color32::from_rgba_unmultiplied(83, 89, 93, 128),
                );
            }
        } else {
            self.dock_preview = None;
        }
        if let Some(pos) = self.context {
            let mut close = false;
            egui::Area::new(egui::Id::new("canvas context"))
                .fixed_pos(pos)
                .order(egui::Order::Foreground)
                .show(ui.ctx(), |ui| {
                    egui::Frame::popup(ui.style()).show(ui, |ui| {
                        for label in ["Edit text", "Duplicate", "Delete", "Move up", "Move down"] {
                            if ui.button(label).clicked() {
                                if label == "Edit text" {
                                    self.begin_text()
                                } else {
                                    self.structural(label)
                                }
                                close = true;
                            }
                        }
                    });
                });
            if close || ui.input(|i| i.pointer.any_click() || i.key_pressed(egui::Key::Escape)) {
                self.context = None;
            }
        }
        if self.prefs {
            egui::Window::new("Preferences")
                .open(&mut self.prefs)
                .show(ui.ctx(), |ui| {
                    ui.label("Interface scale");
                    let mut zoom = ui.ctx().zoom_factor();
                    if ui.add(egui::Slider::new(&mut zoom, 0.7..=1.5)).changed() {
                        self.app_zoom = zoom;
                        ui.ctx().set_zoom_factor(zoom);
                    }
                    ui.strong("Canvas");
                    ui.horizontal(|ui| {
                        ui.label("Rulers");
                        ui.selectable_value(&mut self.rulers, true, "Shown");
                        ui.selectable_value(&mut self.rulers, false, "Hidden");
                    });
                    ui.horizontal(|ui| {
                        ui.label("Ruler units");
                        ui.selectable_value(&mut self.rem, false, "px");
                        ui.selectable_value(&mut self.rem, true, "rem");
                    });
                    ui.strong("Session");
                    ui.horizontal_wrapped(|ui| {
                        ui.label("On launch");
                        ui.selectable_value(&mut self.reopen, true, "Reopen last file");
                        ui.selectable_value(&mut self.reopen, false, "Start empty");
                    });
                    if ui.button("Clear session & sample props").clicked() {
                        self.saved_samples.clear();
                        self.samples = json!({});
                        self.reopen = false;
                        let _ = std::fs::remove_file(settings().with_extension("session.json"));
                    }
                });
        }
        if self.help {
            egui::Window::new("Keyboard shortcuts")
                .open(&mut self.help)
                .show(ui.ctx(), |ui| {
                    for s in [
                        "Tab    Edit / View",
                        #[cfg(all(windows, feature = "legacy-canvas"))]
                        "F2    Edit text",
                        "Ctrl+D    Duplicate",
                        "Delete    Delete element",
                        "Alt+↑ / ↓    Move element",
                        "Ctrl+Z    Undo",
                        "Ctrl+Shift+Z    Redo",
                        "Ctrl+±    Canvas zoom",
                    ] {
                        ui.label(s);
                    }
                });
        }
    }
    pub fn draw_ruler(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            if ui
                .small_button(if self.rem { "rem" } else { "px" })
                .clicked()
            {
                self.rem = !self.rem;
            }
            let (r, _) =
                ui.allocate_exact_size(egui::vec2(ui.available_width(), 15.), egui::Sense::hover());
            let step = 64. * self.zoom;
            let mut x = 0.;
            while x < r.width() {
                let pos = r.left_top() + egui::vec2(x, 0.);
                ui.painter().text(
                    pos,
                    egui::Align2::LEFT_TOP,
                    format!("{:.0}", x / self.zoom / if self.rem { 16. } else { 1. }),
                    egui::FontId::monospace(9.),
                    chrome::FAINT,
                );
                x += step;
            }
        });
    }
}
