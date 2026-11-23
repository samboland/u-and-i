use super::*;
use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Default)]
pub struct Editing {
    history: Vec<History>,
    future: Vec<History>,
    pending: Option<Pending>,
    pub drafts: HashMap<String, String>,
    pub next_selection: Option<usize>,
}
struct History {
    file: String,
    before: String,
    after: String,
    start: Option<usize>,
    end: Option<usize>,
}
enum Pending {
    Change(Option<usize>),
    Restore(bool),
}
pub fn index(id: &str) -> Option<usize> {
    id.rsplit_once("::")?.1.parse().ok()
}

impl Editor {
    pub fn focus(&self) -> Option<&Element> {
        self.selected
            .and_then(|i| self.elements.iter().find_map(|e| e.find(i)))
    }
    pub fn edit(&mut self, v: Value) {
        if self.editing.pending.is_some() {
            return;
        }
        let Some(file) = &self.file else { return };
        let Some(i) = v
            .get("index")
            .or(v.get("parentIndex"))
            .and_then(Value::as_u64)
        else {
            return;
        };
        let Some(n) = self.elements.iter().find_map(|e| e.find(i as usize)) else {
            return;
        };
        let body = json!({"file":file,"expectTag":n.tag,"edit":v});
        if self
            .requests
            .send(Request::Write(file.clone(), body))
            .is_ok()
        {
            self.editing.pending = Some(Pending::Change(self.selected))
        }
    }
    pub fn insert(&mut self, jsx: &str, imports: Value) {
        let Some(root) = self.elements.first() else {
            return;
        };
        let (parent, pos) = match self.focus() {
            Some(n) if !n.self_closing && n.tag.starts_with(|c: char| c.is_ascii_lowercase()) => {
                (n.index, 9999)
            }
            Some(n) if n.can.structural && n.parent_id.is_some() => (
                index(n.parent_id.as_deref().unwrap()).unwrap_or(root.index),
                n.slot + 2,
            ),
            _ => (root.index, 9999),
        };
        self.edit(json!({"op":"insert-element","parentIndex":parent,"childPos":pos,"jsx":jsx,"imports":imports}));
    }
    pub fn structural(&mut self, label: &str) {
        let Some(n) = self.focus().filter(|n| n.can.structural) else {
            return;
        };
        let op = match label {
            "Duplicate" => json!({"op":"duplicate-element","index":n.index}),
            "Delete" => json!({"op":"delete-element","index":n.index}),
            _ => {
                let Some(parent) = n.parent_id.as_deref().and_then(index) else {
                    return;
                };
                json!({"op":"move-element","index":n.index,"newParentIndex":parent,"childPos":if label=="Move up"{(n.slot-2).max(0)}else{n.slot+2}})
            }
        };
        self.edit(op);
    }
    pub fn drop_at(&mut self, m: &Value) {
        let by_id = |id: &str| {
            self.elements
                .iter()
                .find_map(|n| n.find(index(id)?))
                .filter(|n| n.id == id)
        };
        let Some(target) = m["targetId"]
            .as_str()
            .and_then(by_id)
            .filter(|n| n.can.structural)
        else {
            return;
        };
        let Some(parent) = target.parent_id.as_deref().and_then(index) else {
            return;
        };
        let pos = target.slot + if m["position"] == "before" { 0 } else { 2 };
        if let Some(moved) = m["moveId"].as_str().and_then(by_id) {
            self.edit(json!({"op":"move-element","index":moved.index,"newParentIndex":parent,"childPos":pos}));
        } else if let Some(jsx) = m["insert"]["jsx"].as_str() {
            self.edit(json!({"op":"insert-element","parentIndex":parent,"childPos":pos,"jsx":jsx,"imports":m["insert"].get("imports").cloned().unwrap_or(json!([]))}));
        }
    }
    pub fn can_restore(&self, redo: bool) -> bool {
        self.editing.pending.is_none()
            && !(if redo {
                &self.editing.future
            } else {
                &self.editing.history
            })
            .is_empty()
    }
    pub fn restore(&mut self, redo: bool) {
        if !self.can_restore(redo) {
            return;
        }
        let h = (if redo {
            &self.editing.future
        } else {
            &self.editing.history
        })
        .last()
        .unwrap();
        let text = if redo { &h.after } else { &h.before };
        if self
            .requests
            .send(Request::Restore(h.file.clone(), text.clone()))
            .is_ok()
        {
            self.editing.pending = Some(Pending::Restore(redo))
        }
    }
    pub fn changed(&mut self, file: String, result: Result<project::Change, String>) {
        let Some(Pending::Change(start)) = self.editing.pending.take() else {
            return;
        };
        match result {
            Ok(change) => {
                let end = change.focus_id.as_deref().and_then(index);
                self.editing.history.push(History {
                    file: file.clone(),
                    start,
                    end,
                    before: change.before,
                    after: change.after,
                });
                self.editing.future.clear();
                if self.file.as_ref() == Some(&file) {
                    self.elements = change.model;
                    self.selected = end;
                    self.editing.drafts.clear();
                }
                self.reload = true;
            }
            Err(e) => {
                if e.contains("stale model") && self.file.as_ref() == Some(&file) {
                    self.open(file)
                }
                self.error = Some(e)
            }
        }
    }
    pub fn restored(&mut self, file: String, result: Result<(), String>) {
        let Some(Pending::Restore(redo)) = self.editing.pending.take() else {
            return;
        };
        if let Err(e) = result {
            self.error = Some(e);
            return;
        }
        let entry = if redo {
            self.editing.future.pop()
        } else {
            self.editing.history.pop()
        }
        .unwrap();
        if self.file.as_ref() == Some(&file) {
            self.editing.drafts.clear();
            let _ = self.requests.send(Request::Open(file));
            self.editing.next_selection = if redo { entry.end } else { entry.start };
        }
        (if redo {
            &mut self.editing.history
        } else {
            &mut self.editing.future
        })
        .push(entry);
        self.reload = true;
    }
}

pub fn inspector(
    ui: &mut egui::Ui,
    node: &Element,
    drafts: &mut HashMap<String, String>,
) -> Option<Value> {
    let mut edit = None;
    fn field(
        ui: &mut egui::Ui,
        drafts: &mut HashMap<String, String>,
        node: &Element,
        label: &str,
        old: &str,
        enabled: bool,
    ) -> Option<String> {
        ui.label(label);
        let key = format!("{}::{}", node.id, label);
        let draft = drafts.entry(key).or_insert_with(|| old.into());
        let response = ui.add_enabled(
            enabled,
            egui::TextEdit::singleline(draft).desired_width(f32::INFINITY),
        );
        if response.has_focus() && ui.input(|i| i.key_pressed(egui::Key::Escape)) {
            *draft = old.into();
            response.surrender_focus();
        }
        (response.lost_focus() && draft != old).then(|| draft.clone())
    }
    fn style_value(key: &str, value: &str) -> Value {
        let v = value.trim();
        if v.is_empty() {
            return Value::Null;
        }
        if [
            "width",
            "maxWidth",
            "minWidth",
            "height",
            "maxHeight",
            "minHeight",
            "top",
            "right",
            "bottom",
            "left",
            "padding",
            "gap",
        ]
        .contains(&key)
            && v != "0"
            && v.parse::<f64>().is_ok_and(f64::is_finite)
        {
            json!(format!("{v}px"))
        } else {
            json!(v)
        }
    }
    if !node.text_children.is_empty() {
        ui.strong("Content");
    }
    for t in &node.text_children {
        if let Some(v) = field(
            ui,
            drafts,
            node,
            &format!("Text {}", t.slot),
            &t.value,
            true,
        ) {
            edit = Some(json!({"op":"set-text","index":node.index,"slot":t.slot,"value":v}));
        }
    }
    ui.separator();
    ui.strong("Style");
    for p in node.style_props.iter().flatten() {
        if let Some(v) = field(
            ui,
            drafts,
            node,
            &p.name,
            p.value.as_deref().unwrap_or("(expression)"),
            node.can.style && p.value.is_some(),
        ) {
            edit = Some(
                json!({"op":"set-style-prop","index":node.index,"name":p.name,"value":style_value(&p.name,&v)}),
            );
        }
    }
    if node.can.style {
        let key = format!("{}:new-style", node.id);
        let value_key = format!("{key}:value");
        let mut name = drafts.remove(&key).unwrap_or_default();
        let mut value = drafts.remove(&value_key).unwrap_or_default();
        ui.horizontal_wrapped(|ui|{ui.add(egui::TextEdit::singleline(&mut name).hint_text("property").desired_width(84.));ui.add(egui::TextEdit::singleline(&mut value).hint_text("value").desired_width(70.));
            if ui.add_enabled(!name.trim().is_empty()&&!value.trim().is_empty(),egui::Button::new("+")).clicked(){edit=Some(json!({"op":"set-style-prop","index":node.index,"name":name.trim(),"value":style_value(name.trim(),&value)}));}
        });
        drafts.insert(key, name);
        drafts.insert(value_key, value);
    } else {
        ui.weak("Dynamic style expression");
    }
    ui.separator();
    ui.strong("Classes");
    for t in &node.class_chunks {
        if let Some(v) = field(
            ui,
            drafts,
            node,
            &format!("className {}", t.chunk),
            &t.value,
            node.can.classes,
        ) {
            edit =
                Some(json!({"op":"set-class-chunk","index":node.index,"chunk":t.chunk,"value":v}));
        }
    }
    if node.class_chunks.is_empty()
        && node.can.classes
        && let Some(v) = field(ui, drafts, node, "add className", "", true)
    {
        edit = Some(json!({"op":"set-class-string","index":node.index,"value":v}));
    }
    if !node.props.is_empty() {
        ui.separator();
        ui.strong("Props");
    }
    for p in &node.props {
        if p.kind == "boolean" {
            ui.horizontal(|ui|{ui.label(&p.name);for val in ["true","false"]{if ui.selectable_label(p.value==val,val).clicked(){edit=Some(json!({"op":"set-prop","index":node.index,"name":p.name,"value":{"kind":"expr","text":val}}));}}});
        } else if let Some(v) = field(
            ui,
            drafts,
            node,
            &p.name,
            &p.value,
            matches!(p.kind.as_str(), "string" | "number"),
        ) {
            let numeric = p.kind == "number" && v.trim().parse::<f64>().is_ok_and(f64::is_finite);
            edit = Some(
                json!({"op":"set-prop","index":node.index,"name":p.name,"value":{"kind":if numeric{"expr"}else{"string"},"text":v}}),
            );
        }
    }
    edit
}
