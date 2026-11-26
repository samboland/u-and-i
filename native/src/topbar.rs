use super::*;
use egui::{Align, Button, Layout, Popup, Rect, Sense, Ui, ViewportCommand};
use serde::{Deserialize, Serialize};
fn no_caption() -> Rect {
    Rect::NOTHING
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Tab {
    pub name: String,
    pub mode: usize,
    pub group: usize,
}

#[derive(Serialize, Deserialize)]
pub struct TopBar {
    pub tabs: Vec<Tab>,
    pub active: usize,
    #[serde(skip)]
    rename: Option<(usize, String)>,
    #[serde(skip)]
    filter: String,
    #[serde(skip, default = "no_caption")]
    pub caption: Rect,
}
pub fn preset(mode: usize) -> usize {
    match mode {
        1 | 2 => mode,
        _ => 0,
    }
}
impl TopBar {
    pub fn new(active: usize) -> Self {
        Self {
            tabs: workspace::TABS
                .iter()
                .enumerate()
                .map(|(mode, name)| Tab {
                    name: name.to_string(),
                    mode,
                    group: preset(mode),
                })
                .collect(),
            active,
            rename: None,
            filter: String::new(),
            caption: Rect::NOTHING,
        }
    }
    pub fn valid(&self, groups: usize) -> bool {
        self.active < self.tabs.len()
            && self
                .tabs
                .iter()
                .all(|t| t.mode < 4 && t.group < groups && !t.name.trim().is_empty())
    }
}

fn maximize(ui: &Ui) {
    let maximized = ui.input(|i| i.viewport().maximized.unwrap_or(false));
    ui.ctx()
        .send_viewport_cmd(ViewportCommand::Maximized(!maximized));
}
fn fullscreen(ui: &Ui) {
    let fullscreen = ui.input(|i| i.viewport().fullscreen.unwrap_or(false));
    ui.ctx()
        .send_viewport_cmd(ViewportCommand::Fullscreen(!fullscreen));
}
const MENUS: [&str; 6] = ["u—i", "File", "Edit", "Render", "Window", "Help"];

impl Editor {
    fn add_tab(&mut self, mode: usize, source: Option<usize>) {
        let base = source
            .map(|i| self.topbar.tabs[i].name.as_str())
            .unwrap_or(workspace::TABS[mode]);
        let mut name = base.to_owned();
        let mut n = 1;
        while self.topbar.tabs.iter().any(|t| t.name == name) {
            name = format!("{base}.{n:03}");
            n += 1;
        }
        let group = self.docks.len();
        self.docks.push(
            source
                .map(|i| self.docks[self.topbar.tabs[i].group].clone())
                .unwrap_or_else(|| Dock::preset(preset(mode))),
        );
        let index = self.topbar.active + 1;
        self.topbar.tabs.insert(index, Tab { name, mode, group });
        self.activate_tab(index);
    }
    fn remove_tab(&mut self, index: usize) {
        if self.topbar.tabs.len() == 1 {
            return;
        }
        let group = self.topbar.tabs.remove(index).group;
        if group >= 3 && !self.topbar.tabs.iter().any(|t| t.group == group) {
            self.docks.remove(group);
            for tab in &mut self.topbar.tabs {
                if tab.group > group {
                    tab.group -= 1;
                }
            }
        }
        let active = self
            .topbar
            .active
            .saturating_sub(usize::from(index < self.topbar.active))
            .min(self.topbar.tabs.len() - 1);
        self.activate_tab(active);
    }
    fn reorder_tab(&mut self, from: usize, to: usize) {
        if from == to {
            return;
        }
        let active = self.topbar.active;
        let tab = self.topbar.tabs.remove(from);
        self.topbar.tabs.insert(to, tab);
        self.topbar.active = if active == from {
            to
        } else if from < active && active <= to {
            active - 1
        } else if to <= active && active < from {
            active + 1
        } else {
            active
        };
    }
    fn workspace_tabs(&mut self, ui: &mut Ui) -> f32 {
        for (index, tab) in self.topbar.tabs.clone().iter().enumerate() {
            if let Some((editing, value)) = &mut self.topbar.rename
                && *editing == index
            {
                let entry = ui.add(egui::TextEdit::singleline(value).desired_width(82.));
                if entry.gained_focus() {
                    ui.scroll_to_rect(entry.rect, None);
                }
                if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
                    self.topbar.rename = None;
                } else if entry.lost_focus() {
                    if !value.trim().is_empty() {
                        self.topbar.tabs[index].name = value.trim().into();
                    }
                    self.topbar.rename = None;
                } else {
                    entry.request_focus();
                }
                continue;
            }
            let selected = self.topbar.active == index;
            let button = Button::new(
                RichText::new(&tab.name).color(Color32::from_gray(if selected {
                    240
                } else {
                    174
                })),
            )
            .fill(Color32::from_gray(if selected { 49 } else { 32 }))
            .stroke(egui::Stroke::NONE)
            .corner_radius(egui::CornerRadius {
                nw: 4,
                ne: 4,
                sw: 0,
                se: 0,
            })
            .min_size(egui::vec2(0., 22.))
            .sense(Sense::click_and_drag());
            let r = ui.add(button);
            if r.clicked() {
                self.activate_tab(index);
            }
            if r.double_clicked() {
                self.topbar.rename = Some((index, tab.name.clone()));
            }
            if r.drag_started_by(egui::PointerButton::Primary) {
                r.dnd_set_drag_payload(("workspace", index));
            }
            if ui.input(|i| i.pointer.primary_released())
                && let Some(payload) = r.dnd_release_payload::<(&'static str, usize)>()
            {
                self.reorder_tab(payload.1, index);
                break;
            }
            let mut changed = false;
            r.context_menu(|ui| {
                if ui.button("Duplicate").clicked() {
                    self.add_tab(tab.mode, Some(index));
                    changed = true;
                    ui.close();
                }
                if ui.button("Rename").clicked() {
                    self.topbar.rename = Some((index, tab.name.clone()));
                    ui.close();
                }
                if ui
                    .add_enabled(self.topbar.tabs.len() > 1, Button::new("Delete Workspace"))
                    .clicked()
                {
                    self.remove_tab(index);
                    changed = true;
                    ui.close();
                }
                ui.separator();
                for (label, target) in [
                    ("Reorder to Front", 0),
                    ("Reorder to Back", self.topbar.tabs.len() - 1),
                ] {
                    if ui
                        .add_enabled(index != target, Button::new(label))
                        .clicked()
                    {
                        self.reorder_tab(index, target);
                        changed = true;
                        ui.close();
                    }
                }
            });
            if changed {
                break;
            }
        }
        ui.menu_button("+", |ui| {
            ui.weak("Add Workspace");
            for (mode, name) in workspace::TABS.iter().enumerate() {
                if ui.button(*name).clicked() {
                    self.add_tab(mode, None);
                    ui.close();
                }
            }
        })
        .response
        .on_hover_text("Add workspace")
        .rect
        .right()
    }

    fn strip_menu(&mut self, ui: &mut Ui, index: usize) {
        let name = MENUS[index];
        let id = egui::Id::new(("strip menu", index));
        let r = ui.add(
            Button::new(name)
                .selected(Popup::is_id_open(ui.ctx(), id))
                .frame(false),
        );
        let open = MENUS
            .iter()
            .enumerate()
            .any(|(i, _)| Popup::is_id_open(ui.ctx(), egui::Id::new(("strip menu", i))));
        if open && r.hovered() && ui.input(|i| i.pointer.delta() != egui::Vec2::ZERO) {
            Popup::open_id(ui.ctx(), id);
        }
        Popup::menu(&r).id(id).show(|ui| {
            ui.set_min_width(175.);
            self.menu_contents(ui, index);
        });
    }
    fn menu_contents(&mut self, ui: &mut Ui, index: usize) {
        match index {
            0 => {
                ui.strong("u—i");
                ui.label("Visual interface editor");
                ui.monospace(env!("CARGO_PKG_VERSION"));
            }
            1 => {
                if ui.button("Reload project").clicked() {
                    let _ = self.requests.send(Request::Reload);
                    ui.close();
                }
                ui.separator();
                if ui.button("Quit").clicked() {
                    ui.ctx().send_viewport_cmd(ViewportCommand::Close);
                    ui.close();
                }
            }
            2 => self.edit_menu(ui),
            3 => self.render_menu(ui),
            4 => {
                if ui.button("Toggle Window Fullscreen").clicked() {
                    fullscreen(ui);
                    ui.close();
                }
                ui.separator();
                self.window_menu(ui);
            }
            _ => {
                if ui.button("Keyboard shortcuts").clicked() {
                    self.help = true;
                    ui.close();
                }
            }
        }
    }
    fn context_selectors(&mut self, ui: &mut Ui) {
        let title = self.catalog.as_ref().map_or("Project", |c| c.name.as_str());
        selector(ui, "Project options", "\u{e1bd}", title, |ui| {
            ui.weak("Project");
            if ui.button("Reload project").clicked() {
                let _ = self.requests.send(Request::Reload);
                ui.close();
            }
        });
        let name = self
            .file
            .as_deref()
            .and_then(|f| f.rsplit('/').next())
            .unwrap_or("Component");
        let mut open = None;
        selector(ui, "Select component", "\u{e97a}", name, |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut self.topbar.filter)
                    .hint_text("Search components")
                    .desired_width(210.),
            );
            let needle = self.topbar.filter.to_lowercase();
            egui::ScrollArea::vertical()
                .max_height(290.)
                .show(ui, |ui| {
                    if let Some(c) = &self.catalog {
                        for file in c
                            .groups
                            .values()
                            .flatten()
                            .filter(|f| f.to_lowercase().contains(&needle))
                        {
                            if ui
                                .selectable_label(self.file.as_ref() == Some(file), file)
                                .clicked()
                            {
                                open = Some(file.clone());
                                ui.close();
                            }
                        }
                    }
                });
        });
        if let Some(file) = open {
            self.open(file);
        }
    }

    pub fn top_strip(&mut self, ui: &mut Ui) {
        let width = ui.available_width();
        let compact = width < 710.;
        let show_context = width >= 1050.;
        if let Some(current) =
            (0..MENUS.len()).find(|i| Popup::is_id_open(ui.ctx(), egui::Id::new(("strip menu", i))))
        {
            let offset = ui.input_mut(|input| {
                if input.consume_key(egui::Modifiers::NONE, egui::Key::ArrowLeft) {
                    -1
                } else if input.consume_key(egui::Modifiers::NONE, egui::Key::ArrowRight) {
                    1
                } else {
                    0
                }
            });
            if offset != 0 {
                let next = (current as isize + offset).rem_euclid(MENUS.len() as isize) as usize;
                Popup::open_id(ui.ctx(), egui::Id::new(("strip menu", next)));
            }
        }
        let sibling = if self.input_blocked(ui) || self.topbar.rename.is_some() {
            0
        } else {
            ui.input(|i| {
                if i.modifiers.ctrl && i.key_pressed(egui::Key::PageDown) {
                    1
                } else if i.modifiers.ctrl && i.key_pressed(egui::Key::PageUp) {
                    -1
                } else {
                    0
                }
            })
        };
        if sibling != 0 {
            let count = self.topbar.tabs.len() as isize;
            self.activate_tab((self.topbar.active as isize + sibling).rem_euclid(count) as usize);
        }
        egui::Panel::top("menus")
            .exact_size(33.)
            .frame(egui::Frame::new().fill(Color32::from_gray(26)))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.x = 1.;
                ui.spacing_mut().button_padding = egui::vec2(6., 2.);
                let bar = ui.available_rect_before_wrap();
                let region =
                    |start: f32, end: f32| Rect::from_x_y_ranges(start..=end, bar.y_range());
                let controls_start = bar.right() - 116.;
                let context_start = controls_start - if show_context { 286. } else { 0. };
                let mut controls = ui.new_child(
                    egui::UiBuilder::new()
                        .id_salt("window controls")
                        .max_rect(region(controls_start, bar.right()))
                        .layout(Layout::right_to_left(Align::Center)),
                );
                window_buttons(&mut controls);
                if show_context {
                    let rect = region(context_start, controls_start);
                    let mut selectors = ui.new_child(
                        egui::UiBuilder::new()
                            .id_salt("context selectors")
                            .max_rect(rect)
                            .layout(Layout::left_to_right(Align::Center)),
                    );
                    selectors.set_clip_rect(rect);
                    self.context_selectors(&mut selectors);
                }
                let mut menus = ui.new_child(
                    egui::UiBuilder::new()
                        .id_salt("application menus")
                        .max_rect(region(bar.left() + 5., context_start))
                        .layout(Layout::left_to_right(Align::Center)),
                );
                menus.spacing_mut().item_spacing.x = 10.;
                if compact {
                    menus.menu_button("u—i", |ui| {
                        for (i, name) in MENUS.iter().enumerate().skip(1) {
                            ui.menu_button(*name, |ui| self.menu_contents(ui, i));
                        }
                    });
                } else {
                    for i in 0..MENUS.len() {
                        self.strip_menu(&mut menus, i);
                    }
                }
                menus.separator();
                let start = menus.cursor().left();
                let ideal = self
                    .topbar
                    .tabs
                    .iter()
                    .map(|t| t.name.chars().count() as f32 * 7. + 19.)
                    .sum::<f32>()
                    + 28.;
                let end = (start + ideal).min(context_start - 54.).max(start + 10.);
                let mut tabs = ui.new_child(
                    egui::UiBuilder::new()
                        .id_salt("workspace tabs")
                        .max_rect(region(start, end))
                        .layout(Layout::left_to_right(Align::Center)),
                );
                tabs.set_clip_rect(region(start, end));
                let visible_end = egui::ScrollArea::horizontal()
                    .id_salt("workspace tabs")
                    .scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                    .auto_shrink([false, true])
                    .show(&mut tabs, |ui| {
                        ui.horizontal(|ui| self.workspace_tabs(ui)).inner
                    });
                self.topbar.caption = region(visible_end.inner.min(end), context_start);
                #[cfg(not(windows))]
                {
                    let drag = ui.interact(
                        self.topbar.caption,
                        ui.id().with("title drag"),
                        Sense::click_and_drag(),
                    );
                    if drag.double_clicked() {
                        maximize(ui);
                    } else if drag.drag_started_by(egui::PointerButton::Primary) {
                        ui.ctx().send_viewport_cmd(ViewportCommand::StartDrag);
                    }
                }
            });
    }
}

// Blender groups the data icon and name into one recessed selector.
fn selector(ui: &mut Ui, label: &str, icon: &str, name: &str, contents: impl FnOnce(&mut Ui)) {
    let (rect, response) = ui.allocate_exact_size(egui::vec2(137., 21.), Sense::click());
    response.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::ComboBox, true, label));
    let paint = ui.painter();
    paint.rect(
        rect,
        4.,
        Color32::from_gray(if response.hovered() { 47 } else { 29 }),
        (1., Color32::from_gray(60)),
        egui::StrokeKind::Inside,
    );
    let x = rect.left() + 28.;
    paint.line_segment(
        [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
        (1., Color32::from_gray(58)),
    );
    paint.text(
        rect.left_center() + egui::vec2(4., 0.),
        egui::Align2::LEFT_CENTER,
        format!("{icon}\u{e5c5}"),
        egui::FontId::proportional(12.),
        Color32::LIGHT_GRAY,
    );
    let text_rect = Rect::from_min_max(
        rect.min + egui::vec2(32., 0.),
        rect.max - egui::vec2(4., 0.),
    );
    paint.with_clip_rect(text_rect).text(
        text_rect.left_center(),
        egui::Align2::LEFT_CENTER,
        name,
        egui::FontId::proportional(12.),
        Color32::LIGHT_GRAY,
    );
    Popup::menu(&response).show(contents);
}
fn window_buttons(ui: &mut Ui) {
    let maximized = ui.input(|i| i.viewport().maximized.unwrap_or(false));
    for (index, label) in [
        "Close",
        if maximized { "Restore" } else { "Maximize" },
        "Minimize",
    ]
    .iter()
    .enumerate()
    {
        let (rect, r) = ui.allocate_exact_size(egui::vec2(38., 25.), Sense::click());
        r.widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, *label));
        if r.hovered() {
            ui.painter().rect_filled(
                rect,
                0.,
                if index == 0 {
                    Color32::from_rgb(188, 45, 52)
                } else {
                    Color32::from_gray(60)
                },
            );
        }
        let c = rect.center();
        let stroke = egui::Stroke::new(1., Color32::from_gray(220));
        let v = egui::vec2(4., 4.);
        match index {
            0 => {
                ui.painter().line_segment([c - v, c + v], stroke);
                ui.painter()
                    .line_segment([c - egui::vec2(-4., 4.), c + egui::vec2(-4., 4.)], stroke);
            }
            1 => {
                let box_rect = Rect::from_center_size(c, egui::vec2(8., 8.));
                if maximized {
                    ui.painter().rect_stroke(
                        box_rect.translate(egui::vec2(2., -2.)),
                        0.,
                        stroke,
                        egui::StrokeKind::Inside,
                    );
                }
                ui.painter().rect(
                    box_rect,
                    0.,
                    Color32::from_gray(if r.hovered() { 60 } else { 26 }),
                    stroke,
                    egui::StrokeKind::Inside,
                );
            }
            _ => {
                ui.painter()
                    .line_segment([c - egui::vec2(4., 0.), c + egui::vec2(4., 0.)], stroke);
            }
        }
        if r.clicked() {
            match index {
                0 => ui.ctx().send_viewport_cmd(ViewportCommand::Close),
                1 => maximize(ui),
                _ => ui.ctx().send_viewport_cmd(ViewportCommand::Minimized(true)),
            }
        }
        r.on_hover_text(*label);
    }
}

#[cfg(not(windows))]
pub fn frame_edges(ui: &mut Ui) {
    use egui::{CursorIcon, ResizeDirection::*};
    let bounds = ui.ctx().content_rect();
    if ui.input(|i| i.viewport().maximized == Some(true) || i.viewport().fullscreen == Some(true)) {
        return;
    }
    ui.painter().rect_stroke(
        bounds,
        0.,
        (1., Color32::from_gray(62)),
        egui::StrokeKind::Inside,
    );
    let Some(pos) = ui.input(|i| i.pointer.hover_pos()) else {
        return;
    };
    let x = (pos.x - bounds.left()).min(bounds.right() - pos.x);
    let y = (pos.y - bounds.top()).min(bounds.bottom() - pos.y);
    if x > 3. && y > 3. {
        return;
    }
    let left = pos.x < bounds.center().x;
    let top = pos.y < bounds.center().y;
    let (dir, cursor) = match (x < 10., y < 10., left, top) {
        (true, true, true, true) => (NorthWest, CursorIcon::ResizeNwSe),
        (true, true, false, false) => (SouthEast, CursorIcon::ResizeNwSe),
        (true, true, true, false) => (SouthWest, CursorIcon::ResizeNeSw),
        (true, true, false, true) => (NorthEast, CursorIcon::ResizeNeSw),
        (_, true, _, true) => (North, CursorIcon::ResizeVertical),
        (_, true, _, false) => (South, CursorIcon::ResizeVertical),
        (_, _, true, _) => (West, CursorIcon::ResizeHorizontal),
        _ => (East, CursorIcon::ResizeHorizontal),
    };
    ui.ctx().set_cursor_icon(cursor);
    if ui.input(|i| i.pointer.primary_pressed()) {
        ui.ctx()
            .send_viewport_cmd(ViewportCommand::BeginResize(dir));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_kittest::{Harness, kittest::Queryable};

    #[test]
    fn hover_preserves_bounds_and_modal_clicks_stay_in_the_dialog() {
        let mut h = Harness::builder()
            .with_size(egui::vec2(1200., 720.))
            .build_ui_state(
                |ui, app: &mut Option<Editor>| {
                    app.get_or_insert_with(|| Editor::new(ui.ctx())).render(ui)
                },
                None,
            );
        h.run();
        let labels = [
            "Style",
            "Workshop",
            "Component",
            "Maximize",
            "Minimize",
            "Close",
        ];
        let bounds = labels.map(|label| h.get_all_by_label(label).next().unwrap().rect());
        for rect in bounds {
            h.event(egui::Event::PointerMoved(rect.center()));
            h.run();
            assert_eq!(
                bounds,
                labels.map(|label| h.get_all_by_label(label).next().unwrap().rect())
            );
        }
        h.state_mut().as_mut().unwrap().prefs = true;
        h.run();
        let pos = bounds[0].center();
        for pressed in [true, false] {
            h.event(egui::Event::PointerMoved(pos));
            h.event(egui::Event::PointerButton {
                pos,
                button: egui::PointerButton::Primary,
                pressed,
                modifiers: Default::default(),
            });
            h.step();
        }
        h.key_press_modifiers(egui::Modifiers::CTRL, egui::Key::PageDown);
        h.run();
        let app = h.state().as_ref().unwrap();
        assert!(app.prefs);
        assert_eq!(app.workspace, 0);
        assert!(app.drag.is_none());
    }

    #[test]
    fn menus_tabs_and_frame_controls() {
        let mut h = Harness::builder()
            .with_size(egui::vec2(1200., 720.))
            .build_ui_state(
                |ui, state: &mut Option<Editor>| {
                    state
                        .get_or_insert_with(|| Editor::new(ui.ctx()))
                        .render(ui);
                },
                None,
            );
        h.run();
        h.get_all_by_label("File").next().unwrap().click();
        h.run();
        h.get_by_label("Quit");
        let edit = h.get_all_by_label("Edit").next().unwrap().rect().center();
        h.event(egui::Event::PointerMoved(edit));
        h.run();
        h.get_by_label("Preferences…");
        h.key_press(egui::Key::Escape);
        h.run();
        h.get_all_by_label("+").next().unwrap().click();
        h.run();
        h.get_all_by_label("Style").last().unwrap().click();
        h.run();
        let app = h.state().as_ref().unwrap();
        assert_eq!(app.topbar.tabs.len(), 5);
        assert_eq!(app.workspace, 1);
        assert_eq!(app.topbar.tabs[app.topbar.active].name, "Style.001");
        let state = serde_json::to_value(&app.topbar).unwrap();
        assert!(
            serde_json::from_value::<TopBar>(state)
                .unwrap()
                .valid(app.docks.len())
        );
        h.key_press_modifiers(egui::Modifiers::CTRL, egui::Key::PageDown);
        h.run();
        assert_ne!(h.state().as_ref().unwrap().topbar.active, 1);
        for (label, cmd) in [
            ("Maximize", ViewportCommand::Maximized(true)),
            ("Minimize", ViewportCommand::Minimized(true)),
            ("Close", ViewportCommand::Close),
        ] {
            let pos = h.get_by_label(label).rect().center();
            h.event(egui::Event::PointerMoved(pos));
            h.step();
            for pressed in [true, false] {
                h.event(egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed,
                    modifiers: Default::default(),
                });
                h.step();
            }
            assert!(
                h.output().viewport_output[&egui::ViewportId::ROOT]
                    .commands
                    .contains(&cmd),
                "{label} command"
            );
        }
        h.set_size(egui::vec2(480., 400.));
        h.run();
        assert!(h.get_by_label("Close").rect().right() <= 480.);
        h.get_by_label("u—i").click();
        h.run();
        h.get_by_label("Render ⏵");
    }
}
