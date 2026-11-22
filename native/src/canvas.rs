use eframe::egui;
use wry::{
    WebView, WebViewBuilder,
    dpi::{PhysicalPosition, PhysicalSize},
};

/// Only the page inside the canvas uses WebView2. The surrounding controls are egui.
pub struct Canvas {
    web: WebView,
    bounds: [i32; 4],
    location: String,
    size: (u32, u32, f32),
}

pub fn page_url(origin: &str, path: &str) -> Option<String> {
    let base = reqwest::Url::parse(origin).ok()?;
    let url = base.join(path).ok()?;
    (url.origin() == base.origin()).then(|| url.to_string())
}

impl Canvas {
    pub fn create(frame: &eframe::Frame, url: &str, size: (u32, u32, f32)) -> wry::Result<Self> {
        let (width, height, zoom) = size;
        // Keep the device layout width even when the apron clips the preview.
        let html = format!(
            r#"<!doctype html><meta name="color-scheme" content="dark"><style>
        *{{box-sizing:border-box}}html,body{{margin:0;height:100%;background:#101216}}
        body{{overflow:auto}}iframe{{display:block;margin:0 auto;border:0;width:{width}px;height:{height}px;zoom:{zoom}}}
        </style><iframe title="live app" src="{}"></iframe>"#,
            url.replace('&', "&amp;").replace('"', "&quot;")
        );
        let web = WebViewBuilder::new()
            .with_html(html)
            .with_incognito(true)
            .with_background_color((16, 18, 22, 255))
            .with_visible(false)
            .build_as_child(frame)?;
        Ok(Self {
            web,
            bounds: [0; 4],
            location: url.to_owned(),
            size,
        })
    }
    pub fn update(
        &mut self,
        rect: egui::Rect,
        scale: f32,
        url: &str,
        size: (u32, u32, f32),
        reload: bool,
    ) -> wry::Result<()> {
        let bounds = [rect.left(), rect.top(), rect.width(), rect.height()]
            .map(|n| (n * scale).round() as i32);
        if bounds != self.bounds {
            self.web.set_bounds(wry::Rect {
                position: PhysicalPosition::new(bounds[0], bounds[1]).into(),
                size: PhysicalSize::new(bounds[2].max(1) as u32, bounds[3].max(1) as u32).into(),
            })?;
            self.web.set_visible(bounds[2] > 0 && bounds[3] > 0)?;
            self.bounds = bounds;
        }
        if size != self.size {
            let (w, h, z) = size;
            self.web.evaluate_script(&format!("Object.assign(document.querySelector('iframe').style,{{width:'{w}px',height:'{h}px',zoom:{z}}})"))?;
            self.size = size;
        }
        if url != self.location || reload {
            // Url serialization percent-encodes double quotes. Escape it as a JS string too.
            self.web.evaluate_script(&format!(
                "document.querySelector('iframe').src={}",
                serde_json::to_string(url).expect("URL string")
            ))?;
            self.location = url.to_owned();
        }
        Ok(())
    }
}
