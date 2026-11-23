use eframe::egui::{self, Rect, Ui};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Debug)]
pub enum Panel {
    Insert,
    Canvas,
    Outliner,
    Properties,
    Style,
    Workshop,
}
pub const PANELS: [Panel; 6] = [
    Panel::Insert,
    Panel::Canvas,
    Panel::Outliner,
    Panel::Properties,
    Panel::Style,
    Panel::Workshop,
];
impl Panel {
    pub fn glyph(self) -> char {
        match self {
            Self::Insert => '\u{e1bd}',
            Self::Canvas => '\u{e30c}',
            Self::Outliner => '\u{e97a}',
            Self::Properties => '\u{e429}',
            Self::Style => '\u{e40a}',
            Self::Workshop => '\u{f10b}',
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub enum Dock {
    Pane {
        tabs: Vec<(u64, Panel)>,
        active: usize,
    },
    Split {
        horizontal: bool,
        fraction: f32,
        a: Box<Dock>,
        b: Box<Dock>,
    },
}
#[derive(Clone, Copy)]
pub enum Action {
    Change(Panel),
    Split(bool),
    Close,
    Tab(Panel),
    Select(usize),
}
pub const DROP_SHARE: f32 = 0.32;

pub fn drop_edge(rect: Rect, pos: egui::Pos2) -> Option<(bool, bool)> {
    let x = (pos.x - rect.left()) / rect.width();
    let y = (pos.y - rect.top()) / rect.height();
    if (0.3..=0.7).contains(&x) && (0.3..=0.7).contains(&y) {
        return None;
    }
    [
        (x, true, true),
        (1. - x, true, false),
        (y, false, true),
        (1. - y, false, false),
    ]
    .into_iter()
    .min_by(|a, b| a.0.total_cmp(&b.0))
    .map(|(_, axis, first)| (axis, first))
}

pub fn preview_rect(mut rect: Rect, edge: Option<(bool, bool)>) -> Rect {
    match edge {
        Some((true, true)) => rect.max.x = rect.left() + rect.width() * DROP_SHARE,
        Some((true, false)) => rect.min.x = rect.right() - rect.width() * DROP_SHARE,
        Some((false, true)) => rect.max.y = rect.top() + rect.height() * DROP_SHARE,
        Some((false, false)) => rect.min.y = rect.bottom() - rect.height() * DROP_SHARE,
        None => {}
    }
    rect
}

impl Dock {
    fn leaf(id: u64, p: Panel) -> Self {
        Self::Pane {
            tabs: vec![(id, p)],
            active: 0,
        }
    }
    fn pair(horizontal: bool, fraction: f32, a: Self, b: Self) -> Self {
        Self::Split {
            horizontal,
            fraction,
            a: Box::new(a),
            b: Box::new(b),
        }
    }
    pub fn preset(group: usize) -> Self {
        let side = Self::pair(
            false,
            0.44,
            Self::leaf(2, Panel::Outliner),
            Self::leaf(3, Panel::Properties),
        );
        if group == 0 {
            Self::pair(
                true,
                0.15,
                Self::leaf(0, Panel::Insert),
                Self::pair(true, 0.66 / 0.85, Self::leaf(1, Panel::Canvas), side),
            )
        } else {
            Self::pair(
                true,
                0.81,
                Self::leaf(
                    4,
                    if group == 1 {
                        Panel::Style
                    } else {
                        Panel::Workshop
                    },
                ),
                side,
            )
        }
    }
    pub fn panes(
        &mut self,
        ui: &Ui,
        r: Rect,
        pending: &mut Option<bool>,
        out: &mut Vec<(Rect, Vec<(u64, Panel)>, usize)>,
    ) {
        match self {
            Self::Pane { tabs, active } => out.push((r, tabs.clone(), *active)),
            Self::Split {
                horizontal,
                fraction,
                a,
                b,
            } => {
                let (mut ra, mut rb) = (r, r);
                let len = if *horizontal { r.width() } else { r.height() }.max(1.);
                let split = len * *fraction;
                let line = if *horizontal {
                    let x = r.left() + split;
                    ra.max.x = x - 2.;
                    rb.min.x = x + 2.;
                    Rect::from_x_y_ranges(x - 2.0..=x + 2.0, r.y_range())
                } else {
                    let y = r.top() + split;
                    ra.max.y = y - 2.;
                    rb.min.y = y + 2.;
                    Rect::from_x_y_ranges(r.x_range(), y - 2.0..=y + 2.0)
                };
                let resp = ui
                    .interact(line, ui.id().with(self_id(a)), egui::Sense::drag())
                    .on_hover_cursor(if *horizontal {
                        egui::CursorIcon::ResizeHorizontal
                    } else {
                        egui::CursorIcon::ResizeVertical
                    });
                if resp.dragged() {
                    let d = resp.drag_delta();
                    *fraction =
                        (*fraction + (if *horizontal { d.x } else { d.y }) / len).clamp(0.08, 0.92);
                }
                let mut join = None;
                resp.context_menu(|ui| {
                    for (name, h) in [("Vertical Split", true), ("Horizontal Split", false)] {
                        if ui.button(name).clicked() {
                            *pending = Some(h);
                            ui.close();
                        }
                    }
                    if ui.button("Swap Areas").clicked() {
                        std::mem::swap(a, b);
                        ui.close();
                    }
                    if ui
                        .button(if *horizontal { "Join Left" } else { "Join Up" })
                        .clicked()
                    {
                        join = Some((**b).clone());
                        ui.close();
                    }
                    if ui
                        .button(if *horizontal {
                            "Join Right"
                        } else {
                            "Join Down"
                        })
                        .clicked()
                    {
                        join = Some((**a).clone());
                        ui.close();
                    }
                });
                a.panes(ui, ra, pending, out);
                b.panes(ui, rb, pending, out);
                if let Some(kept) = join {
                    *self = kept;
                }
            }
        }
    }
    fn find(&mut self, id: u64) -> Option<&mut Self> {
        match self {
            Self::Pane { tabs, .. } => {
                if tabs.iter().any(|t| t.0 == id) {
                    Some(self)
                } else {
                    None
                }
            }
            Self::Split { a, b, .. } => a.find(id).or_else(|| b.find(id)),
        }
    }
    fn prune(&mut self) -> bool {
        match self {
            Self::Pane { tabs, .. } => tabs.is_empty(),
            Self::Split { a, b, .. } => {
                if a.prune() {
                    *self = (**b).clone()
                } else if b.prune() {
                    *self = (**a).clone()
                }
                false
            }
        }
    }
    pub fn apply(&mut self, id: u64, act: Action, next: &mut u64) {
        let single = matches!(self,Self::Pane{tabs,..} if tabs.len()==1);
        let Some(node) = self.find(id) else { return };
        let Self::Pane { tabs, active } = node else {
            return;
        };
        match act {
            Action::Change(p) => tabs[*active].1 = p,
            Action::Select(i) => *active = i,
            Action::Tab(p) => {
                tabs.push((*next, p));
                *next += 1;
                *active = tabs.len() - 1;
            }
            Action::Split(h) => {
                let p = tabs[*active].1;
                *node = Self::pair(h, 0.5, node.clone(), Self::leaf(*next, p));
                *next += 1
            }
            Action::Close if !single => {
                tabs.remove(*active);
                *active = active.saturating_sub(1);
                self.prune();
            }
            _ => {}
        }
    }
    pub fn move_to(&mut self, source: u64, target: u64, edge: Option<(bool, bool)>) {
        if source == target {
            return;
        }
        let Some(Self::Pane { tabs, active }) = self.find(source) else {
            return;
        };
        if edge.is_none() && tabs.iter().any(|t| t.0 == target) {
            return;
        }
        let Some(i) = tabs.iter().position(|t| t.0 == source) else {
            return;
        };
        let item = tabs.remove(i);
        *active = active.saturating_sub(1);
        self.prune();
        let Some(node) = self.find(target) else {
            return;
        };
        if let Some((horizontal, before)) = edge {
            let src = Self::leaf(source, item.1);
            let dest = node.clone();
            *node = if before {
                Self::pair(horizontal, DROP_SHARE, src, dest)
            } else {
                Self::pair(horizontal, 1. - DROP_SHARE, dest, src)
            };
        } else if let Self::Pane { tabs, active } = node {
            tabs.push(item);
            *active = tabs.len() - 1;
        }
    }
}
fn self_id(node: &Dock) -> (u64, usize) {
    match node {
        Dock::Pane { tabs, .. } => (tabs[0].0, 0),
        Dock::Split { a, .. } => {
            let (id, depth) = self_id(a);
            (id, depth + 1)
        }
    }
}
impl Dock {
    pub fn first(&self) -> u64 {
        match self {
            Self::Pane { tabs, active } => tabs[*active].0,
            Self::Split { a, .. } => a.first(),
        }
    }
    pub fn valid(&self) -> bool {
        match self {
            Self::Pane { tabs, active } => *active < tabs.len(),
            Self::Split { fraction, a, b, .. } => {
                (0.0..1.0).contains(fraction) && a.valid() && b.valid()
            }
        }
    }
}

impl Dock {
    pub fn split_at(&mut self, id: u64, horizontal: bool, fraction: f32, next: &mut u64) {
        self.apply(id, Action::Split(horizontal), next);
        fn set(node: &mut Dock, id: u64, amount: f32) -> bool {
            match node {
                Dock::Split { fraction, a, b, .. } => {
                    if matches!(b.as_ref(),Dock::Pane{tabs,..} if tabs.len()==1 && tabs[0].0==id) {
                        *fraction = amount;
                        true
                    } else {
                        set(a, id, amount) || set(b, id, amount)
                    }
                }
                _ => false,
            }
        }
        set(self, *next - 1, fraction.clamp(0.05, 0.95));
    }
    pub fn panel_id(&self, kind: Panel) -> Option<u64> {
        match self {
            Self::Pane { tabs, .. } => tabs.iter().find(|t| t.1 == kind).map(|t| t.0),
            Self::Split { a, b, .. } => a.panel_id(kind).or_else(|| b.panel_id(kind)),
        }
    }

    pub fn place_tab(&mut self, source: u64, target: u64) {
        if source == target {
            return;
        }
        let same_pane = matches!(self.find(target), Some(Self::Pane { tabs, .. }) if tabs.iter().any(|t| t.0 == source));
        if !same_pane {
            self.move_to(source, target, None);
        }
        if let Some(Self::Pane { tabs, active }) = self.find(target)
            && let Some(from) = tabs.iter().position(|t| t.0 == source)
            && let Some(to) = tabs.iter().position(|t| t.0 == target)
        {
            let tab = tabs.remove(from);
            tabs.insert(to, tab);
            *active = to;
        }
    }
    pub fn toggle(&mut self, kind: Panel, next: &mut u64) {
        if let Some(id) = self.panel_id(kind) {
            if let Some(Dock::Pane { tabs, active }) = self.find(id) {
                *active = tabs.iter().position(|t| t.0 == id).unwrap();
            }
            self.apply(id, Action::Close, next);
        } else {
            self.apply(self.first(), Action::Tab(kind), next);
        }
    }
    pub fn move_outer(&mut self, id: u64, horizontal: bool, before: bool) {
        if matches!(self,Dock::Pane{tabs,..} if tabs.len()==1) {
            return;
        }
        let Some(Dock::Pane { tabs, active }) = self.find(id) else {
            return;
        };
        let Some(i) = tabs.iter().position(|t| t.0 == id) else {
            return;
        };
        let item = tabs.remove(i);
        *active = active.saturating_sub(1);
        self.prune();
        let panel = Dock::leaf(item.0, item.1);
        let rest = self.clone();
        *self = if before {
            Dock::pair(horizontal, 0.25, panel, rest)
        } else {
            Dock::pair(horizontal, 0.75, rest, panel)
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drop_preview_matches_committed_edge() {
        let rect = Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1000., 500.));
        let edge = drop_edge(rect, egui::pos2(140., 20.));
        assert_eq!(edge, Some((false, true)));
        assert_eq!(preview_rect(rect, edge).height(), 160.);
        assert_eq!(drop_edge(rect, rect.center()), None);
        let mut dock = Dock::leaf(10, Panel::Canvas);
        dock.apply(10, Action::Tab(Panel::Insert), &mut 11);
        dock.move_to(11, 10, edge);
        let Dock::Split {
            fraction,
            horizontal,
            a,
            ..
        } = dock
        else {
            panic!("tab did not split")
        };
        assert!(!horizontal);
        assert_eq!(fraction, DROP_SHARE);
        assert_eq!(a.first(), 11);
    }

    #[test]
    fn rearrange_tabs_across_splits() {
        let mut dock = Dock::preset(0);
        let mut next = 5;
        dock.apply(1, Action::Tab(Panel::Canvas), &mut next);
        dock.place_tab(5, 1);
        dock.place_tab(0, 5);
        let Some(Dock::Pane { tabs, active }) = dock.find(1) else {
            panic!("lost canvas");
        };
        assert_eq!(
            *tabs,
            [(0, Panel::Insert), (5, Panel::Canvas), (1, Panel::Canvas)]
        );
        assert_eq!(*active, 0);
        assert!(dock.valid());
    }
}
