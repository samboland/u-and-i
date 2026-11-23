use super::*;
use std::collections::HashMap;
pub fn string<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn rows(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}
fn col(v: &str, fallback: Color32) -> Color32 {
    Color32::from_hex(v).unwrap_or(fallback)
}
pub struct Studio {
    surfaces: crate::surface::Surfaces,
    defs: Value,
    cats: Value,
    tokens: Value,
    cat: String,
    drafts: HashMap<String, String>,
    pub dark: bool,
    name: String,
    preset: String,
    mat: Value,
    pub written: bool,
    subject: String,
    state: String,
    slots: HashMap<String, String>,
    positions: HashMap<String, egui::Vec2>,
    zoom: f32,
    selected: String,
}
impl Default for Studio {
    fn default() -> Self {
        let defs: Value = serde_json::from_str(include_str!("../assets/workshop.json")).unwrap();
        Self {
            surfaces: Default::default(),
            mat: defs["MAT_DEFAULT"].clone(),
            defs,
            cats: serde_json::from_str(include_str!("../assets/style.json")).unwrap(),
            tokens: Value::Null,
            cat: "Colors".into(),
            drafts: HashMap::new(),
            dark: false,
            name: "surface-raised".into(),
            preset: "Raised".into(),
            written: false,
            subject: "Button".into(),
            state: "Default".into(),
            slots: HashMap::new(),
            positions: HashMap::new(),
            zoom: 1.,
            selected: "surface".into(),
        }
    }
}
impl Studio {
    pub fn tokens_received(&mut self, v: Value) {
        self.tokens = v;
        self.drafts.clear();
    }
    fn lookup(&self, key: &str, n: usize) -> Option<(&Value, &Value)> {
        rows(&self.tokens["tokens"])
            .iter()
            .flat_map(|f| rows(&f["decls"]).iter().map(move |d| (f, d)))
            .filter(|(_, d)| d["name"] == key)
            .nth(n)
    }
    pub fn toolbar(&mut self, ui: &mut egui::Ui, style: bool, tx: &Sender<Request>) {
        if style {
            ui.weak("THEME   PREVIEW");
            ui.selectable_value(&mut self.dark, false, "Parchment");
            ui.selectable_value(&mut self.dark, true, "Abyss");
            if ui.button("Reset preview").clicked() {
                let _ = tx.send(Request::Api("tokens", None));
            }
            return;
        }
        ui.weak("MATERIAL");
        ui.add(egui::TextEdit::singleline(&mut self.name).desired_width(164.));
        for p in ["Raised", "Inset", "Flat"] {
            if ui.selectable_label(self.preset == p, p).clicked() {
                self.set_preset(p);
            }
        }
        if ui.button("Write tokens").clicked() {
            self.name = self
                .name
                .trim()
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                        c
                    } else {
                        '-'
                    }
                })
                .collect();
            if self.name.is_empty() {
                self.name = "material".into();
            }
            let _ = tx.send(Request::Api(
                "material",
                Some(json!({"name":self.name,"lines":self.lines()})),
            ));
        }
        if ui.button("Revert").clicked() {
            self.set_preset("Raised");
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.weak(if self.written { "written" } else { "in sync" });
            if ui
                .small_button(format!("{:.0}%", self.zoom * 100.))
                .clicked()
            {
                self.zoom = 1.;
            }
        });
    }
    fn set_preset(&mut self, p: &str) {
        self.preset = p.into();
        self.mat = self.defs["MAT_PRESETS"][p].clone();
        self.name = format!("surface-{}", p.to_lowercase());
        self.written = false;
    }
    fn val(&self, k: &str) -> f64 {
        self.mat[k].as_f64().unwrap_or_default()
    }
    fn shadow(&self, state: &str) -> String {
        let rad = self.val("angle").to_radians();
        let dist = self.val("distance")
            * match state {
                "Hover" => 1.4,
                "Disabled" => 0.4,
                _ => 1.,
            };
        let dx = (rad.cos() * dist * 10.).round() / 10.;
        let dy = (rad.sin() * dist * 10.).round() / 10.;
        let blur = (self.val("blur")
            * match state {
                "Pressed" => 7.,
                "Disabled" => 6.,
                _ => 10.,
            })
        .round()
            / 10.;
        let spread = self.val("spread");
        let inner = self.val("innerMix").max(if state == "Pressed" {
            self.val("pressed")
        } else {
            0.
        }) / 100.;
        let outer = 1. - inner;
        let dim = if state == "Disabled" { 0.5 } else { 1. };
        let mut parts = vec![];
        for (amount, prefix, spread, highlight) in [
            (outer, "", format!(" {spread}px"), 0.6),
            (inner, "inset ", String::new(), 0.55),
        ] {
            if amount > 0.02 {
                parts.push(format!(
                    "{prefix}{dx}px {dy}px {blur}px{spread} rgba(44,34,30,{:.3})",
                    amount * dim * 0.34
                ));
                parts.push(format!(
                    "{prefix}{}px {}px {blur}px{spread} rgba(255,255,255,{:.3})",
                    -dx,
                    -dy,
                    amount * dim * highlight
                ));
            }
        }
        if self.val("rim") > 2. {
            parts.push(format!(
                "inset 0 1px 0 rgba(255,255,255,{:.2})",
                self.val("rim") / 100.
            ));
        }
        parts.join(", ")
    }
    fn lines(&self) -> Vec<String> {
        let p = format!("--material-{}", self.name);
        vec![
            format!("{p}-radius: {}px;", self.val("radius")),
            format!("{p}-surface: {};", string(&self.mat, "tint")),
            format!("{p}-shadow: {};", self.shadow("Default")),
            format!("{p}-shadow-pressed: {};", self.shadow("Pressed")),
        ]
    }
    pub fn style(&mut self, ui: &mut egui::Ui, tx: &Sender<Request>) {
        let h = ui.available_height();
        egui::Panel::top(ui.id().with("category"))
            .exact_size((h * 0.26).clamp(110., 224.))
            .show(ui, |ui| {
                for (cat, icon) in [
                    ("Colors", "◐"),
                    ("Type", "A"),
                    ("Surfaces", "▤"),
                    ("Spacing", "↕"),
                ] {
                    if ui
                        .add_sized(
                            [ui.available_width(), (h * 0.05).clamp(18., 40.)],
                            egui::Button::selectable(
                                self.cat == cat,
                                format!("{icon}\n{}", cat.to_uppercase()),
                            ),
                        )
                        .clicked()
                    {
                        self.cat = cat.into();
                    }
                }
                ui.vertical_centered(|ui| {
                    ui.small("theme.css");
                });
            });
        egui::Panel::top(ui.id().with("token list"))
            .exact_size((h * 0.39).max(65.))
            .show(ui, |ui| {
                let category = self.cats["CATS"][&self.cat].clone();
                ui.horizontal(|ui| {
                    ui.strong(self.cat.to_uppercase());
                    ui.weak(string(&category, "note"));
                });
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for group in rows(&category["groups"]) {
                        ui.separator();
                        ui.strong(string(group, "name"));
                        for row in rows(&group["rows"]) {
                            let name = string(row, "token");
                            let occurrence = row["occurrence"].as_u64().unwrap_or(0) as usize;
                            let declaration = self.lookup(string(row, "cssVar"), occurrence)
                                .map(|(f, d)| (f["file"].clone(), d.clone()));
                            let value = declaration.as_ref().map(|(_, d)| string(d, "value")).unwrap_or("");
                            let draft = self.drafts.entry(name.into()).or_insert_with(|| value.into());
                            let commit = ui.horizontal(|ui| {
                                let (rect, _) = ui.allocate_exact_size(egui::vec2(22., 22.), egui::Sense::hover());
                                ui.painter().rect_filled(rect, 4., col(value, chrome::CONTROL));
                                ui.vertical(|ui| {
                                    ui.monospace(name);
                                    ui.small(string(row, "usage"));
                                });
                                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                    ui.add_enabled(declaration.is_some(), egui::TextEdit::singleline(draft).desired_width(92.)).lost_focus()
                                }).inner
                            }).inner;
                            if commit && *draft != value && let Some((file, decl)) = declaration.as_ref() {
                                let edit = json!({
                                    "file": file, "value": draft,
                                    "decl": { "valueStart": decl["valueStart"], "valueEnd": decl["valueEnd"], "oldValue": value }
                                });
                                let _ = tx.send(Request::Api("token", Some(edit)));
                            }
                            ui.separator();
                        }
                    }
                });
            });
        ui.strong("LIVE PREVIEW");
        ui.separator();
        let n = usize::from(self.dark);
        let color = |k: &str, f: &str| {
            self.lookup(k, n)
                .map(|(_, d)| col(string(d, "value"), col(f, Color32::GRAY)))
                .unwrap_or_else(|| col(f, Color32::GRAY))
        };
        egui::ScrollArea::vertical()
            .id_salt("preview")
            .show(ui, |ui| {
                egui::Frame::new()
                    .inner_margin(18)
                    .corner_radius(6)
                    .fill(color(
                        "--background",
                        if self.dark { "#0b1d33" } else { "#f5eadd" },
                    ))
                    .show(ui, |ui| {
                        ui.set_min_width(ui.available_width());
                        let foreground = color(
                            "--foreground",
                            if self.dark { "#f4ebe1" } else { "#2c221e" },
                        );
                        ui.visuals_mut().override_text_color = Some(foreground);
                        ui.small("type scale");
                        ui.label(
                            egui::RichText::new("Not-missing")
                                .strong()
                                .size(24.)
                                .color(foreground),
                        );
                        ui.label(
                            egui::RichText::new("Source coverage")
                                .strong()
                                .size(20.)
                                .color(foreground),
                        );
                        ui.label(
                            egui::RichText::new("Booking window")
                                .strong()
                                .size(16.)
                                .color(foreground),
                        );
                        ui.label("Opens exactly 30 days ahead at midnight HST.");
                        ui.add_space(18.);
                        ui.small("tier 1 surface");
                        egui::Frame::new()
                            .fill(color(
                                "--ui-card-t1-start",
                                if self.dark { "#26394a" } else { "#f9f3eb" },
                            ))
                            .corner_radius(8)
                            .inner_margin(16)
                            .show(ui, |ui| {
                                ui.set_min_width(ui.available_width());
                                ui.label(
                                    egui::RichText::new("Not-missing")
                                        .strong()
                                        .size(24.)
                                        .color(foreground),
                                );
                                ui.label("Calm, prepared, present.");
                                egui::Frame::new()
                                    .corner_radius(14)
                                    .inner_margin(egui::Margin::symmetric(18, 7))
                                    .shadow(egui::epaint::Shadow {
                                        offset: [3, 3],
                                        blur: 8,
                                        spread: 0,
                                        color: Color32::from_black_alpha(46),
                                    })
                                    .fill(color(
                                        "--ui-card-t1-start",
                                        if self.dark { "#26394a" } else { "#f9f3eb" },
                                    ))
                                    .show(ui, |ui| {
                                        ui.label("Set alert");
                                    });
                            });
                        ui.small("ConfidenceBar");
                        ui.horizontal_wrapped(|ui| {
                            for s in ["community", "marketplace", "expert", "handson"] {
                                ui.colored_label(color(&format!("--source-{s}"), "#888888"), s);
                            }
                        });
                        ui.small("provenance ladder · six rungs");
                        ui.label(
                            "Community   Marketplace   Expert   Hands-on   Exclusive   Verified",
                        );
                        ui.small("states");
                        ui.label("No sources yet");
                        ui.label("Needs data hookup");
                    });
            });
    }
    pub fn workshop(&mut self, ui: &mut egui::Ui) {
        let h = ui.available_height();
        egui::Panel::top(ui.id().with("subjects"))
            .exact_size((h * 0.28).clamp(105., 235.))
            .show(ui, |ui| {
                ui.strong("BUILD");
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for group in rows(&self.defs["WS_SUBJECTS"]) {
                        ui.separator();
                        ui.strong(string(group, "name"));
                        let w = (ui.available_width() - 4.) / 2.;
                        for pair in rows(&group["items"]).chunks(2) {
                            ui.horizontal(|ui| {
                                for item in pair {
                                    let name = item[0].as_str().unwrap();
                                    if chrome::part_button(
                                        ui,
                                        [w, 28.],
                                        item[1].as_str().unwrap(),
                                        name,
                                        self.subject == name,
                                    )
                                    .clicked()
                                    {
                                        self.subject = name.into();
                                    }
                                }
                            });
                        }
                    }
                    ui.strong("Anatomy");
                    for part in rows(&self.defs["WS_PARTS"][&self.subject]) {
                        let part = part.as_str().unwrap();
                        let key = format!("{}·{part}", self.subject);
                        let slot = self
                            .slots
                            .entry(key.clone())
                            .or_insert_with(|| "raised".into());
                        ui.horizontal(|ui| {
                            ui.label(part);
                            egui::ComboBox::from_id_salt(key)
                                .selected_text(slot.as_str())
                                .show_ui(ui, |ui| {
                                    for s in ["raised", "inset", "flat"] {
                                        ui.selectable_value(slot, s.into(), s);
                                    }
                                });
                        });
                    }
                    ui.strong("States");
                    ui.horizontal_wrapped(|ui| {
                        for s in ["Default", "Hover", "Pressed", "Disabled"] {
                            ui.selectable_value(&mut self.state, s.into(), s);
                        }
                    });
                });
            });
        egui::Panel::bottom(ui.id().with("material preview"))
            .exact_size((h * 0.15).clamp(75., 122.))
            .show(ui, |ui| {
                let r = ui.available_rect_before_wrap();
                let top = r.top() + 19.;
                let bottom = (top + 86.).min(r.bottom());
                let x1 = r.left() + 122_f32.min(r.width() * 0.22);
                let x2 = x1 + (r.right() - x1) * 0.5;
                for (i, (left, right, title)) in [
                    (r.left(), x1, "MATERIAL".to_owned()),
                    (x1 + 10., x2, format!("{} · {}", self.subject, self.state)),
                    (
                        x2 + 10.,
                        r.right(),
                        "WRITES TO THE APP’S GLOBALS.CSS".into(),
                    ),
                ]
                .into_iter()
                .enumerate()
                {
                    if right <= left {
                        continue;
                    }
                    ui.painter().text(
                        egui::pos2(left, r.top()),
                        egui::Align2::LEFT_TOP,
                        title,
                        egui::FontId::proportional(10.),
                        chrome::FAINT,
                    );
                    let well =
                        egui::Rect::from_min_max(egui::pos2(left, top), egui::pos2(right, bottom));
                    if i == 2 {
                        let mut readout =
                            ui.new_child(egui::UiBuilder::new().id_salt("output").max_rect(well));
                        readout.set_clip_rect(well.intersect(ui.clip_rect()));
                        egui::ScrollArea::both().show(&mut readout, |ui| {
                            ui.monospace(self.lines().join("\n"));
                        });
                        continue;
                    }
                    ui.painter()
                        .rect_filled(well, 8., col("#f5eadd", Color32::LIGHT_GRAY));
                    let state = &self.state;
                    let radius = self.val("radius") as f32;
                    let distance = self.val("distance")
                        * match state.as_str() {
                            "Hover" => 1.4,
                            "Disabled" => 0.4,
                            _ => 1.,
                        };
                    let angle = self.val("angle").to_radians();
                    let label = if i == 0 {
                        ""
                    } else {
                        string(&self.defs["PREVIEW_LABEL"], &self.subject)
                    };
                    let wide = self.subject == "Card"
                        || self.subject == "Field"
                        || self.subject == "SearchBar";
                    let width = if i == 0 {
                        78.
                    } else if wide {
                        250.
                    } else {
                        label.len() as f32 * 6.5 + 42.
                    };
                    let height: f32 = if i == 0 || self.subject == "Card" {
                        52.
                    } else {
                        34.
                    };
                    let surface = crate::surface::Surface {
                        width: width.min((well.width() - 12.).max(4.)),
                        height: height.min((well.height() - 8.).max(3.)),
                        radius,
                        fill: col(string(&self.mat, "tint"), Color32::LIGHT_GRAY),
                        dx: (angle.cos() * distance) as f32,
                        dy: (angle.sin() * distance) as f32,
                        blur: (self.val("blur")
                            * match state.as_str() {
                                "Pressed" => 0.7,
                                "Disabled" => 0.6,
                                _ => 1.,
                            }) as f32,
                        spread: self.val("spread") as f32,
                        inner: (self.val("innerMix").max(if state == "Pressed" {
                            self.val("pressed")
                        } else {
                            0.
                        }) / 100.) as f32,
                        rim: (self.val("rim") / 100.) as f32,
                        dim: if state == "Disabled" { 0.5 } else { 1. },
                    };
                    let mut sample = ui.new_child(egui::UiBuilder::new().max_rect(well));
                    sample.set_clip_rect(ui.clip_rect().intersect(well));
                    self.surfaces
                        .paint(&sample, i as u8, well.center(), surface);
                    sample.painter().text(
                        well.center(),
                        egui::Align2::CENTER_CENTER,
                        label,
                        egui::FontId::proportional(13.),
                        Color32::from_rgb(44, 34, 30),
                    );
                }
            });
        let r = ui.available_rect_before_wrap();
        ui.painter().rect_filled(r, 0, VOID);
        let mut y = r.top();
        while y < r.bottom() {
            let mut x = r.left();
            while x < r.right() {
                ui.painter()
                    .circle_filled(egui::pos2(x, y), 0.8, chrome::BORDER);
                x += 16.;
            }
            y += 16.;
        }
        if ui.rect_contains_pointer(r) {
            self.zoom = (self.zoom * ui.input(|i| i.zoom_delta())).clamp(0.5, 2.);
        }
        egui::ScrollArea::both().show(ui, |ui| {
            let z = self.zoom;
            let origin = ui.cursor().min;
            ui.set_min_size(egui::vec2(760., 470.) * z);
            for (id, p) in self.defs["NODE_POS_DEFAULT"].as_object().unwrap() {
                self.positions.entry(id.clone()).or_insert(egui::vec2(
                    p["x"].as_f64().unwrap() as f32,
                    p["y"].as_f64().unwrap() as f32,
                ));
            }
            for (a, b, i) in [
                ("light", "shadow", 0),
                ("light", "rim", 0),
                ("surface", "out", 0),
                ("shadow", "out", 1),
                ("depth", "out", 2),
                ("rim", "out", 3),
            ] {
                let a = origin + (self.positions[a] + egui::vec2(196., 15.)) * z;
                let b = origin + (self.positions[b] + egui::vec2(0., 31. + 16. * i as f32)) * z;
                ui.painter()
                    .add(egui::epaint::CubicBezierShape::from_points_stroke(
                        [
                            a,
                            a + egui::vec2(32. * z, 0.),
                            b - egui::vec2(32. * z, 0.),
                            b,
                        ],
                        false,
                        Color32::TRANSPARENT,
                        (1., chrome::FAINT),
                    ));
            }
            for (id, title, controls) in [
                (
                    "light",
                    "Light",
                    &[
                        ("Angle", "angle", 0., 360.),
                        ("Distance", "distance", 0., 24.),
                    ][..],
                ),
                (
                    "surface",
                    "Surface",
                    &[("Corner radius", "radius", 0., 28.)][..],
                ),
                (
                    "shadow",
                    "Shadow",
                    &[("Blur", "blur", 0., 40.), ("Spread", "spread", -8., 8.)][..],
                ),
                (
                    "depth",
                    "Depth",
                    &[
                        ("Inner / outer", "innerMix", 0., 100.),
                        ("Pressed depth", "pressed", 0., 100.),
                    ][..],
                ),
                ("rim", "Rim highlight", &[("Strength", "rim", 0., 100.)][..]),
                ("out", "Material", &[][..]),
            ] {
                let r = egui::Rect::from_min_size(
                    origin + self.positions[id] * z,
                    egui::vec2(
                        if id == "out" { 244. } else { 196. },
                        if id == "out" { 162. } else { 124. },
                    ) * z,
                );
                let mut u = ui.new_child(egui::UiBuilder::new().id_salt(id).max_rect(r));
                u.set_clip_rect(ui.clip_rect().intersect(r));
                chrome::pane(PANEL).show(&mut u, |ui| {
                    ui.set_min_width((r.width() - 24.).max(1.));
                    let resp = ui.add(
                        egui::Label::new(
                            RichText::new(if id == "out" {
                                format!("MATERIAL · {}", self.name)
                            } else {
                                title.to_uppercase()
                            })
                            .color(if self.selected == id {
                                BLUE
                            } else {
                                chrome::FAINT
                            }),
                        )
                        .sense(egui::Sense::click_and_drag()),
                    );
                    if resp.clicked() || resp.dragged_by(egui::PointerButton::Primary) {
                        self.selected = id.into();
                    }
                    if resp.dragged_by(egui::PointerButton::Primary) {
                        *self.positions.get_mut(id).unwrap() += resp.drag_delta() / z;
                    }
                    ui.separator();
                    if id == "surface" {
                        ui.horizontal_wrapped(|ui| {
                            for tint in ["#f9f3eb", "#f3e8db", "#F0E5D9", "#F5EADD"] {
                                if ui
                                    .small_button(RichText::new("■").color(col(tint, BLUE)))
                                    .clicked()
                                {
                                    self.mat["tint"] = json!(tint);
                                    self.written = false;
                                }
                            }
                        });
                    }
                    for (label, key, lo, hi) in controls {
                        let mut v = self.val(key);
                        ui.small(*label);
                        if ui.add(egui::Slider::new(&mut v, *lo..=*hi)).changed() {
                            self.mat[*key] = json!(v);
                            self.written = false;
                        }
                    }
                    if id == "out" {
                        ui.small(self.shadow("Default"));
                    }
                });
            }
        });
    }
}
