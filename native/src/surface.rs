use eframe::egui::{Color32, ColorImage, Context, TextureHandle, TextureOptions, Vec2};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Surface {
    pub width: f32,
    pub height: f32,
    pub radius: f32,
    pub fill: Color32,
    pub dx: f32,
    pub dy: f32,
    pub blur: f32,
    pub spread: f32,
    pub inner: f32,
    pub rim: f32,
    pub dim: f32,
}
#[derive(Default)]
pub struct Surfaces(HashMap<u8, (Surface, f32, TextureHandle)>);
impl Surfaces {
    pub fn paint(&mut self, ui: &eframe::egui::Ui, id: u8, center: eframe::egui::Pos2, s: Surface) {
        let scale = ui.ctx().pixels_per_point().clamp(0.5, 3.);
        let texture = self
            .0
            .entry(id)
            .or_insert_with(|| (s, scale, texture(ui.ctx(), s, scale)));
        if texture.0 != s || texture.1 != scale {
            *texture = (s, scale, crate::surface::texture(ui.ctx(), s, scale));
        }
        let size = texture.2.size_vec2() / scale;
        ui.painter().image(
            texture.2.id(),
            eframe::egui::Rect::from_center_size(center, size),
            eframe::egui::Rect::from_min_max(eframe::egui::Pos2::ZERO, eframe::egui::pos2(1., 1.)),
            Color32::WHITE,
        );
    }
}
fn coverage(p: Vec2, half: Vec2, r: f32, scale: f32) -> f32 {
    let radius = r.max(0.).min(half.x.min(half.y).max(0.));
    let q = p.abs() - half + Vec2::splat(radius);
    let distance = q.max(Vec2::ZERO).length() + q.x.max(q.y).min(0.) - radius;
    (0.5 - distance * scale).clamp(0., 1.)
}
// Three box filters approximate the Gaussian kernel used for CSS shadows.
// A separable sliding window keeps work proportional to the texture area.
fn blur(mask: &mut Vec<f32>, w: usize, h: usize, sigma: f32) {
    let ideal = (4. * sigma * sigma + 1.).sqrt();
    let mut lower = ideal.floor() as i32;
    if lower % 2 == 0 {
        lower -= 1
    }
    let lower = lower.max(1);
    let n = ((12. * sigma * sigma - 3. * (lower * lower + 4 * lower + 3) as f32)
        / (-4 * lower - 4) as f32)
        .round() as i32;
    let mut scratch = vec![0.; w * h];
    for pass in 0..3 {
        let r = ((if pass < n { lower } else { lower + 2 }) / 2) as usize;
        if r == 0 {
            continue;
        }
        for (lines, len, line_stride, stride) in [(h, w, w, 1), (w, h, 1, w)] {
            for line in 0..lines {
                let start = line * line_stride;
                let mut sum: f32 = (0..=r.min(len - 1)).map(|j| mask[start + j * stride]).sum();
                for i in 0..len {
                    scratch[start + i * stride] = sum / (2 * r + 1) as f32;
                    if i >= r {
                        sum -= mask[start + (i - r) * stride]
                    }
                    if i + r + 1 < len {
                        sum += mask[start + (i + r + 1) * stride]
                    }
                }
            }
            std::mem::swap(mask, &mut scratch);
        }
    }
}
fn texture(ctx: &Context, s: Surface, scale: f32) -> TextureHandle {
    let pad = (s.blur * 1.7 + s.dx.abs().max(s.dy.abs()) + s.spread.abs() + 3.).ceil();
    let w = ((s.width + 2. * pad) * scale).ceil() as usize;
    let h = ((s.height + 2. * pad) * scale).ceil() as usize;
    let half = Vec2::new(s.width, s.height) * 0.5;
    let delta = Vec2::new(s.dx, s.dy);
    let point = |i: usize| {
        Vec2::new(
            (i % w) as f32 + 0.5 - w as f32 * 0.5,
            (i / w) as f32 + 0.5 - h as f32 * 0.5,
        ) / scale
    };
    let solid: Vec<f32> = (0..w * h)
        .map(|i| coverage(point(i), half, s.radius, scale))
        .collect();
    let mut pix = vec![[0.; 4]; w * h];
    fn layer(dst: &mut [f32; 4], rgb: [u8; 3], a: f32) {
        for k in 0..3 {
            dst[k] = f32::from(rgb[k]) * a + dst[k] * (1. - a);
        }
        dst[3] = a + dst[3] * (1. - a);
    }
    let light = [255, 255, 255];
    let dark = [44, 34, 30];
    for inset in [false, true] {
        if inset {
            for (i, p) in pix.iter_mut().enumerate() {
                layer(p, [s.fill.r(), s.fill.g(), s.fill.b()], solid[i]);
                let rim = (1. - coverage(point(i) - Vec2::Y, half, s.radius, scale)) * solid[i];
                layer(p, light, rim * s.rim);
            }
        }
        let mix = if inset { s.inner } else { 1. - s.inner };
        if mix <= 0.02 {
            continue;
        }
        for (off, rgb, alpha) in [
            (-delta, light, if inset { 0.55 } else { 0.60 }),
            (delta, dark, 0.34),
        ] {
            let spread = if inset { 0. } else { s.spread };
            let mut mask = (0..w * h)
                .map(|i| {
                    coverage(
                        point(i) - off,
                        half + Vec2::splat(spread),
                        s.radius + spread,
                        scale,
                    )
                })
                .collect();
            blur(&mut mask, w, h, s.blur * scale * 0.5);
            for (i, p) in pix.iter_mut().enumerate() {
                let a = if inset {
                    (1. - mask[i]) * solid[i]
                } else {
                    mask[i]
                };
                layer(p, rgb, (a * mix * alpha * s.dim).clamp(0., 1.));
            }
        }
    }
    let pixels = pix
        .into_iter()
        .map(|p| {
            Color32::from_rgba_premultiplied(
                p[0] as u8,
                p[1] as u8,
                p[2] as u8,
                (255. * p[3]) as u8,
            )
        })
        .collect();
    ctx.load_texture(
        "material preview",
        ColorImage::new([w, h], pixels),
        TextureOptions::LINEAR,
    )
}
