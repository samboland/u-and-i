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
    visible: bool,
    events: mpsc::Receiver<Value>,
    capture: Option<mpsc::Receiver<Option<egui::ColorImage>>>,
    snapshot: Option<egui::TextureHandle>,
    first_snapshot_frame: Option<u64>,
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
    fn create(
        frame: &impl raw_window_handle::HasWindowHandle,
        ctx: egui::Context,
    ) -> wry::Result<Self> {
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
            capture: None,
            snapshot: None,
            first_snapshot_frame: None,
            visible: false,
        })
    }
    // A WebView2 child window is composed above egui. During dock operations
    // paint its current frame inside egui so the sash and menus share one surface.
    fn capture_frame(&mut self, ctx: &egui::Context) -> windows_core::Result<()> {
        use base64::Engine;
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        use windows_core::w;
        use wry::WebViewExtWindows;
        let (tx, rx) = mpsc::channel();
        let repaint = ctx.clone();
        let done =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, result| {
                let image = status.ok().and_then(|_| {
                    let json: Value = serde_json::from_str(&result).ok()?;
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(json["data"].as_str()?)
                        .ok()?;
                    let image =
                        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                            .ok()?
                            .into_rgba8();
                    Some(egui::ColorImage::from_rgba_unmultiplied(
                        [image.width() as usize, image.height() as usize],
                        &image,
                    ))
                });
                let _ = tx.send(image);
                repaint.request_repaint();
                Ok(())
            }));
        unsafe {
            self.web
                .controller()
                .CoreWebView2()?
                .CallDevToolsProtocolMethod(
                    w!("Page.captureScreenshot"),
                    w!(r#"{"format":"png","captureBeyondViewport":false}"#),
                    &done,
                )?;
        }
        self.capture = Some(rx);
        Ok(())
    }

    pub fn paint_snapshot(&mut self, ui: &egui::Ui, rect: egui::Rect) {
        if let Some(image) = &self.snapshot {
            let uv = egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1., 1.));
            ui.painter().image(image.id(), rect, uv, Color32::WHITE);
            if self.first_snapshot_frame.is_none() {
                self.first_snapshot_frame = Some(ui.ctx().cumulative_frame_nr());
                ui.ctx().request_repaint();
            }
        }
    }

    fn update(
        &mut self,
        r: egui::Rect,
        scale: f32,
        state: &Value,
        reload: bool,
        interactive: bool,
        ctx: &egui::Context,
    ) -> wry::Result<Vec<Value>> {
        let bounds = [r.left(), r.top(), r.width(), r.height()].map(|v| (v * scale).round() as i32);
        let freeze = !interactive && self.visible && self.ready;
        if interactive {
            self.capture = None;
            self.snapshot = None;
            self.first_snapshot_frame = None;
        } else if let Some(result) = self.capture.as_ref().and_then(|rx| rx.try_recv().ok()) {
            self.capture = None;
            if let Some(image) = result {
                self.snapshot = Some(ctx.load_texture(
                    "canvas during dock interaction",
                    image,
                    egui::TextureOptions::LINEAR,
                ));
                self.first_snapshot_frame = None;
                ctx.request_repaint();
            }
        } else if freeze && self.snapshot.is_none() && self.capture.is_none() {
            self.capture_frame(ctx)?;
        }
        if interactive && bounds != self.bounds {
            self.web.set_bounds(wry::Rect {
                position: PhysicalPosition::new(bounds[0], bounds[1]).into(),
                size: PhysicalSize::new(bounds[2].max(1) as u32, bounds[3].max(1) as u32).into(),
            })?;
            self.bounds = bounds;
        }
        // Keep the HWND until egui has submitted a frame containing its replacement.
        let presented = self
            .first_snapshot_frame
            .is_some_and(|frame| frame < ctx.cumulative_frame_nr());
        let show = (interactive || (self.visible && !presented)) && bounds[2] > 0 && bounds[3] > 0;
        if self.visible != show {
            self.web.set_visible(show)?;
            self.visible = show;
        }
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
    pub fn update_canvases(
        &mut self,
        ui: &egui::Ui,
        frame: &impl raw_window_handle::HasWindowHandle,
    ) {
        self.web.retain(|id, _| self.canvas_views.contains_key(id));
        let Some(c) = &self.catalog else { return };
        let Some(url) = page_url(&c.live.origin, &self.path) else {
            return;
        };
        let mut state = json!({"url":url,"upstream":c.live.upstream,"harness":format!("{}/harness.html",project::origin()),"component":self.workspace==3,"file":self.file.as_ref().filter(|_|self.renderable).map(|f|format!("app:{f}")),"props":self.samples,"width":DEVICES[self.device].1,"height":([790,1112,844][self.device]),"zoom":self.zoom,"interact":self.interact,"selection":self.focus().map(|n|&n.id),"dark":self.studio.dark});
        let reload = std::mem::take(&mut self.reload);
        let visible = self.drag.is_none()
            && ui.ctx().dragged_id().is_none()
            && self.pending_split.is_none()
            && !egui::DragAndDrop::has_payload_of_type::<Value>(ui.ctx())
            && self.context.is_none()
            && !self.prefs
            && !self.help
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
                ui.ctx(),
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

#[cfg(test)]
mod regression {
    use super::*;
    use egui_kittest::Harness;
    use raw_window_handle::{RawWindowHandle, Win32WindowHandle, WindowHandle};
    use std::num::NonZeroIsize;
    use std::time::{Duration, Instant};
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows_core::w;

    #[test]
    #[ignore = "requires the fixture daemon and WebView2"]
    fn resize_beside_live_canvas() {
        // The parent never becomes visible. Pump its real WebView2 messages,
        // and render the editor into the same offscreen GPU target as the UI tests.
        let hwnd = unsafe {
            CreateWindowExW(
                Default::default(),
                w!("STATIC"),
                w!("Dock check"),
                WS_POPUP,
                0,
                0,
                1000,
                700,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        };
        let raw = Win32WindowHandle::new(NonZeroIsize::new(hwnd.0 as isize).unwrap());
        let parent = unsafe { WindowHandle::borrow_raw(RawWindowHandle::Win32(raw)) };
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000., 700.))
            .wgpu()
            .build_ui_state(
                |ui, state: &mut Option<Editor>| {
                    let editor = state.get_or_insert_with(|| Editor::new(ui.ctx()));
                    editor.render(ui);
                    editor.update_canvases(ui, &parent);
                },
                None,
            );
        let pump = || {
            unsafe {
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            std::thread::sleep(Duration::from_millis(8));
        };
        let deadline = Instant::now() + Duration::from_secs(30);
        while !h
            .state()
            .as_ref()
            .unwrap()
            .web
            .get(&1)
            .is_some_and(|v| v.ready && v.visible)
        {
            assert!(Instant::now() < deadline, "WebView2 did not load");
            pump();
            h.step();
        }
        // A distinct color in the child HWND makes a white or empty frame detectable.
        let view = &h.state().as_ref().unwrap().web[&1];
        view.web.evaluate_script("document.body.insertAdjacentHTML('beforeend','<div style=\"position:fixed;inset:0;z-index:999;background:#127f46\"></div>')").unwrap();
        for _ in 0..20 {
            pump();
            h.step();
        }
        let initial = h.state().as_ref().unwrap().canvas_views[&1];
        // The canvas body starts 14 points from the center of its left sash.
        let seam = egui::pos2(initial.left() - 14., initial.center().y);
        h.event(egui::Event::PointerMoved(seam));
        h.step();
        h.event(egui::Event::PointerButton {
            pos: seam,
            button: egui::PointerButton::Primary,
            pressed: true,
            modifiers: Default::default(),
        });
        h.step();
        let dragged = seam + egui::vec2(85., 0.);
        h.event(egui::Event::PointerMoved(dragged));
        h.step();
        while h.state().as_ref().unwrap().web[&1].visible {
            assert!(
                Instant::now() < deadline,
                "drag did not switch to the captured frame, seam {seam:?}, canvas {initial:?}"
            );
            pump();
            h.step();
        }
        let rect = h.state().as_ref().unwrap().canvas_views[&1];
        assert!(rect.left() > initial.left() + 40.);
        let image = h.render().unwrap();
        let pixel = image.get_pixel(rect.center().x as u32, rect.center().y as u32);
        assert_eq!(
            &pixel.0[..3],
            &[18, 127, 70],
            "canvas pixels during sash drag"
        );
        image.save("target/adjacent-pane-drag.png").unwrap();
        h.event(egui::Event::PointerButton {
            pos: dragged,
            button: egui::PointerButton::Primary,
            pressed: false,
            modifiers: Default::default(),
        });
        h.step();
        pump();
        h.step();
        assert!(h.state().as_ref().unwrap().web[&1].visible);
        use egui_kittest::kittest::Queryable;
        let label = format!("{}\u{e5c5}", Panel::Insert.glyph());
        let start = h.get_by_label(label.as_str()).rect().center();
        h.event(egui::Event::PointerMoved(start));
        h.step();
        h.event(egui::Event::PointerButton {
            pos: start,
            button: egui::PointerButton::Primary,
            pressed: true,
            modifiers: Default::default(),
        });
        h.step();
        h.event(egui::Event::PointerMoved(rect.center()));
        h.step();
        while h.state().as_ref().unwrap().web[&1].visible {
            assert!(
                Instant::now() < deadline,
                "header drag did not capture the live canvas"
            );
            pump();
            h.step();
        }
        assert_eq!(h.state().as_ref().unwrap().drag, Some(0));
        assert!(
            h.state()
                .as_ref()
                .unwrap()
                .dock_preview
                .unwrap()
                .contains(rect.center())
        );
        let image = h.render().unwrap();
        image.save("target/adjacent-header-drag.png").unwrap();
        // Sample away from the rendered pointer at the center of the drop target.
        for fraction in [0.2, 0.4, 0.75] {
            let p = rect.lerp_inside(egui::vec2(fraction, 0.6));
            let pixel = image.get_pixel(p.x as u32, p.y as u32);
            assert!(
                pixel[1] > pixel[0] && pixel[1] < 127 && pixel[0] > 18,
                "missing canvas or drop shading: {pixel:?}"
            );
        }
        h.key_press(egui::Key::Escape);
        h.run();
        assert!(h.state().as_ref().unwrap().web[&1].visible);
        drop(h);
        unsafe { DestroyWindow(hwnd).unwrap() };
    }
}
