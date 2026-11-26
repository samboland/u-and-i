use eframe::egui;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::cell::Cell;
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
    Graphics::Gdi::ScreenToClient,
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

// The map is updated and read on the window's UI thread. Never borrow the editor
// from a window procedure: Windows can send hit tests while a frame is being built.
#[derive(Clone, Copy)]
struct Regions {
    hwnd: HWND,
    caption: egui::Rect,
    scale: f32,
    resize: bool,
    blocked: bool,
}
thread_local! {static REGIONS: Cell<Option<Regions>> = const { Cell::new(None) };}

pub fn update(
    frame: &impl HasWindowHandle,
    ctx: &egui::Context,
    caption: egui::Rect,
    blocked: bool,
) {
    let Ok(handle) = frame.window_handle() else {
        return;
    };
    let RawWindowHandle::Win32(raw) = handle.as_raw() else {
        return;
    };
    let hwnd = HWND(raw.hwnd.get() as _);
    if REGIONS.get().is_none_or(|r| r.hwnd != hwnd) {
        // The static callback has process lifetime. No Rust pointer crosses FFI.
        if !unsafe { SetWindowSubclass(hwnd, Some(hit_test), 1, 0) }.as_bool() {
            return;
        }
    }
    let (maximized, fullscreen) = ctx.input(|i| {
        (
            i.viewport().maximized == Some(true),
            i.viewport().fullscreen == Some(true),
        )
    });
    REGIONS.set(Some(Regions {
        hwnd,
        caption,
        scale: ctx.pixels_per_point(),
        resize: !maximized && !fullscreen,
        blocked: blocked || fullscreen,
    }));
}

unsafe extern "system" fn hit_test(
    hwnd: HWND,
    msg: u32,
    w: WPARAM,
    l: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    if msg == WM_NCDESTROY {
        REGIONS.set(None);
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(hit_test), 1);
        }
    }
    if msg == WM_NCHITTEST
        && let Some(r) = REGIONS.get().filter(|r| r.hwnd == hwnd)
    {
        let bits = l.0 as u32;
        let mut p = POINT {
            x: (bits as i16) as i32,
            y: ((bits >> 16) as i16) as i32,
        };
        let mut bounds = RECT::default();
        if unsafe { ScreenToClient(hwnd, &mut p) }.as_bool()
            && unsafe { GetClientRect(hwnd, &mut bounds) }.is_ok()
        {
            let pos = egui::pos2(p.x as f32 / r.scale, p.y as f32 / r.scale);
            if p.x >= 0 && p.y >= 0 && p.x < bounds.right && p.y < bounds.bottom {
                let size = egui::vec2(bounds.right as f32, bounds.bottom as f32) / r.scale;
                let b = 5.; // Invisible resize area, in egui points.
                let edge = match (
                    pos.x < b,
                    pos.x >= size.x - b,
                    pos.y < b,
                    pos.y >= size.y - b,
                ) {
                    (true, _, true, _) => HTTOPLEFT,
                    (_, true, true, _) => HTTOPRIGHT,
                    (true, _, _, true) => HTBOTTOMLEFT,
                    (_, true, _, true) => HTBOTTOMRIGHT,
                    (true, _, _, _) => HTLEFT,
                    (_, true, _, _) => HTRIGHT,
                    (_, _, true, _) => HTTOP,
                    (_, _, _, true) => HTBOTTOM,
                    _ => HTCLIENT,
                };
                let hit = if r.blocked {
                    HTCLIENT
                } else if r.resize && edge != HTCLIENT {
                    edge
                } else if r.caption.contains(pos) {
                    HTCAPTION
                } else {
                    HTCLIENT
                };
                return LRESULT(hit as isize);
            }
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, w, l) }
}
