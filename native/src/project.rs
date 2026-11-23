use eframe::egui;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::mpsc, time::Duration};

#[derive(Deserialize)]
pub struct Route {
    pub segment: String,
    #[serde(rename = "isGroup")]
    pub group: bool,
    #[serde(rename = "isDynamic")]
    pub dynamic: bool,
    pub ownership: Option<String>,
    #[serde(rename = "urlPath")]
    pub path: String,
    pub files: BTreeMap<String, String>,
    #[serde(rename = "layoutChain")]
    pub layouts: Vec<String>,
    pub children: Vec<Route>,
}
#[derive(Deserialize)]
pub struct Property {
    pub kind: String,
    pub name: String,
    #[serde(rename = "valueText")]
    pub value: String,
}
#[derive(Deserialize)]
pub struct Style {
    pub name: String,
    pub value: Option<String>,
}
#[derive(Deserialize)]
pub struct Text {
    #[serde(default)]
    pub slot: usize,
    #[serde(default)]
    pub chunk: usize,
    pub value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id: String,
    pub parent_id: Option<String>,
    pub slot: isize,
    pub self_closing: bool,
    pub can: Permissions,
    pub component_source: Option<String>,
    pub index: usize,
    pub tag: String,
    pub children: Vec<Element>,
    pub props: Vec<Property>,
    pub style_props: Option<Vec<Style>>,
    pub text_children: Vec<Text>,
    pub class_chunks: Vec<Text>,
}
#[derive(Deserialize)]
pub struct Permissions {
    pub structural: bool,
    pub style: bool,
    pub classes: bool,
    pub text: bool,
}
impl Element {
    pub fn find(&self, index: usize) -> Option<&Self> {
        if self.index == index {
            Some(self)
        } else {
            self.children.iter().find_map(|n| n.find(index))
        }
    }
}
#[derive(Deserialize)]
struct Project {
    label: String,
    #[serde(rename = "srcDir")]
    src_dir: String,
}
#[derive(Deserialize)]
pub struct Live {
    pub origin: String,
    pub upstream: String,
}
#[derive(Deserialize)]
struct Info {
    live: Live,
    project: Project,
}
#[derive(Deserialize)]
struct Routes {
    tree: Route,
}
#[derive(Deserialize)]
struct Components {
    meta: BTreeMap<String, Meta>,
    files: Vec<String>,
}
#[derive(Deserialize)]
pub struct File {
    pub props: Vec<serde_json::Value>,
    pub renderable: bool,
    pub model: Vec<Element>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub server_only: bool,
    pub export_name: Option<String>,
}
pub struct Catalog {
    pub meta: BTreeMap<String, Meta>,
    pub live: Live,
    pub name: String,
    pub groups: BTreeMap<String, Vec<String>>,
    pub routes: Route,
}
pub enum Request {
    Reload,
    Shell(String),
    Open(String),
    Write(String, serde_json::Value),
    Restore(String, String),
    Api(&'static str, Option<serde_json::Value>),
}
pub enum Reply {
    Shell(String, Result<serde_json::Value, String>),
    Write(String, Result<Change, String>),
    Restored(String, Result<(), String>),
    Api(&'static str, Result<serde_json::Value, String>),
    Catalog(Result<Catalog, String>),
    File(String, Result<File, String>),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub model: Vec<Element>,
    pub focus_id: Option<String>,
    pub before: String,
    pub after: String,
}

static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
pub fn set_origin(port: u16) {
    let _ = PORT.set(port);
}
pub fn origin() -> String {
    if let Some(port) = PORT.get() {
        return format!("http://localhost:{port}");
    }
    std::env::var("UAI_EDITOR_ORIGIN").unwrap_or_else(|_| "http://localhost:4400".into())
}
fn api(
    client: &Client,
    endpoint: &str,
    body: Option<&serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/{endpoint}", origin());
    let response = match body {
        Some(v) => client.post(url).json(v),
        None => client.get(url),
    }
    .send()
    .map_err(|e| e.to_string())?;
    let status = response.status();
    let body = response
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(body)
    } else {
        Err(body["error"].as_str().unwrap_or(status.as_str()).to_owned())
    }
}

fn get<T: serde::de::DeserializeOwned>(
    client: &Client,
    endpoint: &str,
    query: &[(&str, &str)],
) -> Result<T, String> {
    client
        .get(format!("{}/api/{endpoint}", origin()))
        .query(query)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| e.to_string())
}
fn catalog(client: &Client) -> Result<Catalog, String> {
    let info: Info = get(client, "project", &[])?;
    let routes: Routes = get(client, "routes", &[])?;
    let components: Components = get(client, "components", &[])?;
    let prefix = if info.project.src_dir == "." {
        "components/".into()
    } else {
        format!("{}/components/", info.project.src_dir)
    };
    let mut groups = BTreeMap::<String, Vec<String>>::new();
    for file in components.files {
        let short = file.strip_prefix(&prefix).unwrap_or(&file);
        let group = short
            .split_once('/')
            .map_or("root", |(dir, _)| dir)
            .to_owned();
        groups.entry(group).or_default().push(file);
    }
    Ok(Catalog {
        meta: components.meta,
        live: info.live,
        name: info.project.label,
        groups,
        routes: routes.tree,
    })
}
pub fn connect(ctx: egui::Context) -> (mpsc::Sender<Request>, mpsc::Receiver<Reply>) {
    let (tx, requests) = mpsc::channel();
    let (out, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(12))
            .build();
        for request in requests {
            let client_ref = client.as_ref().map_err(|e| e.to_string());
            let reply = match request {
                Request::Shell(path) => {
                    let r = client_ref.and_then(|c| get(c, "page-shell", &[("file", &path)]));
                    Reply::Shell(path, r)
                }
                Request::Api(endpoint, body) => Reply::Api(
                    endpoint,
                    client_ref.and_then(|c| api(c, endpoint, body.as_ref())),
                ),
                Request::Write(path, body) => Reply::Write(
                    path,
                    client_ref
                        .and_then(|c| api(c, "edit", Some(&body)))
                        .and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string())),
                ),
                Request::Restore(path, text) => {
                    let result = client_ref.and_then(|c| {
                        api(
                            c,
                            "restore",
                            Some(&serde_json::json!({"file":path,"text":text})),
                        )
                    });
                    Reply::Restored(path, result.map(|_| ()))
                }

                Request::Reload => {
                    Reply::Catalog(client.as_ref().map_err(|e| e.to_string()).and_then(catalog))
                }
                Request::Open(path) => {
                    let result = client
                        .as_ref()
                        .map_err(|e| e.to_string())
                        .and_then(|c| get::<File>(c, "component", &[("file", &path)]));
                    Reply::File(path, result)
                }
            };
            if out.send(reply).is_err() {
                break;
            }
            ctx.request_repaint();
        }
    });
    (tx, rx)
}
