use super::*;
use std::{
    hash::{BuildHasher, RandomState},
    sync::mpsc,
};
use wry::{
    WebView, WebViewBuilder,
    dpi::{PhysicalPosition, PhysicalSize},
};

pub struct Canvas {
    web: WebView,
    bounds: [i32; 4],
    last: Option<Value>,
    ready: bool,
    events: mpsc::Receiver<Value>,
}
pub fn page_url(origin: &str, path: &str) -> Option<String> {
    let base = reqwest::Url::parse(origin).ok()?;
    let url = base.join(path).ok()?;
    (base.origin() == url.origin()).then(|| url.to_string())
}
impl Canvas {
    pub fn sign_in(&self) {
        let _ = self.web.evaluate_script("window.signIn()");
    }
    fn create(frame: &eframe::Frame, ctx: egui::Context) -> wry::Result<Self> {
        let token = format!(
            "{:016x}{:016x}",
            RandomState::new().hash_one(0),
            RandomState::new().hash_one(1)
        );
        let bootstrap = format!("window.uaiCanvasToken={};", json!(token));
        let wrapper = format!("{}/native-canvas.html", project::origin());
        let (tx, events) = mpsc::channel();
        let web = WebViewBuilder::new()
            .with_url(&wrapper)
            .with_initialization_script(bootstrap)
            .with_incognito(true)
            .with_background_color((16, 18, 22, 255))
            .with_visible(false)
            .with_ipc_handler(move |req| {
                if let Ok(v) = serde_json::from_str::<Value>(req.body())
                    && v["token"] == token
                    && let Some(msg) = v.get("message")
                {
                    let _ = tx.send(msg.clone());
                    ctx.request_repaint();
                }
            })
            .build_as_child(frame)?;
        Ok(Self {
            web,
            bounds: [0; 4],
            last: None,
            events,
            ready: false,
        })
    }
    fn update(
        &mut self,
        r: egui::Rect,
        scale: f32,
        state: &Value,
        reload: bool,
        visible: bool,
    ) -> wry::Result<Vec<Value>> {
        let bounds = [r.left(), r.top(), r.width(), r.height()].map(|v| (v * scale).round() as i32);
        if bounds != self.bounds {
            self.web.set_bounds(wry::Rect {
                position: PhysicalPosition::new(bounds[0], bounds[1]).into(),
                size: PhysicalSize::new(bounds[2].max(1) as u32, bounds[3].max(1) as u32).into(),
            })?;
            self.bounds = bounds;
        }
        self.web
            .set_visible(visible && bounds[2] > 0 && bounds[3] > 0)?;
        let mut messages = vec![];
        for msg in self.events.try_iter() {
            if msg["type"] == "wrapper-ready" {
                self.ready = true;
                self.last = None;
            } else {
                messages.push(msg)
            }
        }
        if self.ready && (reload || self.last.as_ref() != Some(state)) {
            self.web
                .evaluate_script(&format!("window.apply({state},{reload})"))?;
            self.last = Some(state.clone());
        }
        Ok(messages)
    }
}
impl Editor {
    pub fn begin_text(&self) {
        if let Some(n) = self
            .focus()
            .filter(|n| n.can.text && n.text_children.len() == 1 && n.children.is_empty())
        {
            let msg = json!({"type":"edit-text","id":n.id});
            for view in self.web.values() {
                let _ = view.web.evaluate_script(&format!("window.command({msg})"));
            }
        }
    }
    pub fn update_canvases(&mut self, ui: &egui::Ui, frame: &eframe::Frame) {
        self.web.retain(|id, _| self.canvas_views.contains_key(id));
        let Some(c) = &self.catalog else { return };
        let Some(url) = page_url(&c.live.origin, &self.path) else {
            return;
        };
        let mut state = json!({"url":url,"upstream":c.live.upstream,"harness":format!("{}/harness.html",project::origin()),"component":self.workspace==3,"file":self.file.as_ref().filter(|_|self.renderable).map(|f|format!("app:{f}")),"props":self.samples,"width":DEVICES[self.device].1,"height":([790,1112,844][self.device]),"zoom":self.zoom,"interact":self.interact,"selection":self.focus().map(|n|&n.id),"dark":self.studio.dark});
        let reload = std::mem::take(&mut self.reload);
        let visible = self.pending_split.is_none()
            && !egui::DragAndDrop::has_payload_of_type::<Value>(ui.ctx())
            && self.context.is_none()
            && !self.prefs
            && !self.help
            && self.drag.is_none()
            && !egui::Popup::is_any_open(ui.ctx());
        let mut msgs = vec![];
        for (&id, &rect) in &self.canvas_views {
            state["component"] = json!(self.workspace == 3 && id == 1);
            state["url"] = json!(
                self.extra_paths
                    .get(&id)
                    .and_then(|p| page_url(&c.live.origin, &p.0))
                    .unwrap_or_else(|| url.clone())
            );
            if let std::collections::hash_map::Entry::Vacant(entry) = self.web.entry(id) {
                if self.web_error.is_some() {
                    continue;
                }
                match Canvas::create(frame, ui.ctx().clone()) {
                    Ok(view) => {
                        entry.insert(view);
                    }
                    Err(e) => {
                        self.web_error = Some(e.to_string());
                        continue;
                    }
                }
            }
            if id == 1
                && self.workspace == 3
                && ui.input(|i| i.pointer.any_released())
                && let Some(pos) = ui
                    .input(|i| i.pointer.interact_pos())
                    .filter(|p| rect.contains(*p))
                && let Some(payload) = egui::DragAndDrop::take_payload::<Value>(ui.ctx())
            {
                let point = (pos - rect.min) * ui.ctx().zoom_factor();
                let _ = self.web[&id].web.evaluate_script(&format!(
                    "window.dropNative({},{},{})",
                    point.x,
                    point.y,
                    payload.as_ref()
                ));
            }
            match self.web.get_mut(&id).unwrap().update(
                rect,
                ui.ctx().pixels_per_point(),
                &state,
                reload,
                visible,
            ) {
                Ok(events) => msgs.extend(events.into_iter().map(|msg| (id, msg))),
                Err(e) => {
                    self.web_error = Some(e.to_string());
                }
            }
        }
        for (id, msg) in msgs {
            self.canvas_message(id, &msg);
        }
    }
    fn canvas_message(&mut self, pane: u64, m: &Value) {
        let id = studio::string(m, "id");
        let own = if let Some(file) = &self.file {
            id.strip_prefix(&format!("app:{file}::"))
                .and_then(|n| n.parse::<usize>().ok())
        } else {
            None
        };
        match studio::string(m, "type") {
            "live-ready" => {
                if let Some(url) = m["url"].as_str().and_then(|s| reqwest::Url::parse(s).ok()) {
                    self.landed.insert(pane, url.path().into());
                }
            }
            "live-click" => {
                let _ = self
                    .requests
                    .send(Request::Api("live-resolve", Some(m.clone())));
            }
            "live-zoom" | "zoom-wheel" => self.zoom_by(m["dir"] == 1),
            "toggle-interact" => self.interact = !self.interact,
            "stage-metrics" => {
                self.stage = egui::vec2(
                    m["x"].as_f64().unwrap_or_default() as f32,
                    m["y"].as_f64().unwrap_or_default() as f32,
                );
            }
            "file-drop" => {
                self.drop_at(m);
            }
            "escape" => {
                self.context = None;
                self.prefs = false;
            }
            "selected" | "context-menu" => {
                let found = own.or_else(|| {
                    m["chain"]
                        .as_array()?
                        .iter()
                        .filter_map(Value::as_str)
                        .find_map(|v| {
                            v.strip_prefix(&format!("app:{}::", self.file.as_deref()?))?
                                .parse()
                                .ok()
                        })
                });
                if let Some(i) = found {
                    self.selected = Some(i);
                }
                if m["type"] == "context-menu"
                    && let Some(r) = self.canvas_views.get(&pane)
                {
                    self.context = Some(
                        r.min
                            + egui::vec2(
                                m["x"].as_f64().unwrap_or_default() as f32,
                                m["y"].as_f64().unwrap_or_default() as f32,
                            ),
                    );
                }
            }
            "open-component" => {
                if let Some((f, _)) = id.strip_prefix("app:").and_then(|s| s.rsplit_once("::")) {
                    if self.file.as_deref() != Some(f) {
                        self.open(f.into())
                    } else if let Some(path) = self.focus().and_then(|n| n.component_source.clone())
                    {
                        self.open(path)
                    }
                }
            }
            "request-text-edit" => {
                if own.is_some() {
                    self.selected = own;
                    self.begin_text();
                }
            }
            "set-text" => {
                if let Some(n) = own
                    .and_then(|i| self.elements.iter().find_map(|n| n.find(i)))
                    .filter(|n| n.can.text && n.text_children.len() == 1)
                {
                    self.edit(json!({"op":"set-text","index":n.index,"slot":n.text_children[0].slot,"value":m["value"]}));
                }
            }
            "key" => match (studio::string(m, "key"), m["ctrl"] == true) {
                ("z", true) | ("Z", true) => self.restore(m["shift"] == true),
                ("d", true) => self.structural("Duplicate"),
                ("Delete", false) => self.structural("Delete"),
                ("F2", _) => self.begin_text(),
                _ => {}
            },
            "render-error" => self.error = m["message"].as_str().map(String::from),
            _ => {}
        }
    }
}
