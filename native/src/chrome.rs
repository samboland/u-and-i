use eframe::egui::{self, Color32};

pub const BORDER: Color32 = Color32::from_rgb(42, 46, 55);
pub const CONTROL: Color32 = Color32::from_rgb(36, 41, 53);
pub const FAINT: Color32 = Color32::from_rgb(107, 114, 128);

pub fn pane(fill: Color32) -> egui::Frame {
    egui::Frame::new()
        .fill(fill)
        .stroke((1., BORDER))
        .corner_radius(7)
        .inner_margin(egui::Margin::symmetric(9, 4))
        .outer_margin(2)
}
pub fn part_button(
    ui: &mut egui::Ui,
    size: [f32; 2],
    icon: &str,
    label: &str,
    active: bool,
) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(size.into(), egui::Sense::click_and_drag());
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Button, ui.is_enabled(), label)
    });
    let fill = if active || response.hovered() {
        Color32::from_rgb(43, 51, 66)
    } else {
        CONTROL
    };
    ui.painter().rect(
        rect,
        5.,
        fill,
        (1., if active { super::BLUE } else { BORDER }),
        egui::StrokeKind::Inside,
    );
    ui.painter().text(
        rect.left_center() + egui::vec2(8., 0.),
        egui::Align2::LEFT_CENTER,
        icon,
        egui::FontId::proportional(13.),
        super::BLUE,
    );
    let text_rect = rect.shrink2(egui::vec2(6., 0.));
    ui.painter()
        .with_clip_rect(ui.clip_rect().intersect(text_rect))
        .text(
            rect.left_center() + egui::vec2(25., 0.),
            egui::Align2::LEFT_CENTER,
            label,
            egui::FontId::proportional(11.5),
            if ui.is_enabled() {
                ui.visuals().text_color()
            } else {
                FAINT
            },
        );
    response
}
pub fn fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    if let Some(path) = std::env::var_os("WINDIR").map(std::path::PathBuf::from)
        && let Ok(bytes) = std::fs::read(path.join("Fonts/segoeui.ttf"))
    {
        fonts
            .font_data
            .insert("system-ui".into(), egui::FontData::from_owned(bytes).into());
        fonts
            .families
            .get_mut(&egui::FontFamily::Proportional)
            .unwrap()
            .insert(0, "system-ui".into());
    }
    fonts.font_data.insert(
        "pane-icons".into(),
        egui::FontData::from_static(include_bytes!("../assets/pane-icons.ttf")).into(),
    );
    fonts
        .families
        .get_mut(&egui::FontFamily::Proportional)
        .unwrap()
        .insert(0, "pane-icons".into());
    ctx.set_fonts(fonts);
}
