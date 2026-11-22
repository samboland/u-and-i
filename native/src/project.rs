use eframe::egui;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::mpsc, time::Duration};

#[derive(Deserialize)]
pub struct Route {
    pub segment: String,
    #[serde(rename = "urlPath")]
    pub path: String,
    pub files: BTreeMap<String, String>,
    #[serde(rename = "layoutChain")]
    pub layouts: Vec<String>,
    pub children: Vec<Route>,
}
#[derive(Deserialize)]
pub struct Property {
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
    pub value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub index: usize,
    pub tag: String,
    pub children: Vec<Element>,
    pub props: Vec<Property>,
    pub style_props: Option<Vec<Style>>,
    pub text_children: Vec<Text>,
    pub class_chunks: Vec<Text>,
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
struct Info {
    project: Project,
}
#[derive(Deserialize)]
struct Routes {
    tree: Route,
}
#[derive(Deserialize)]
struct Components {
    files: Vec<String>,
}
#[derive(Deserialize)]
struct File {
    model: Vec<Element>,
}
pub struct Catalog {
    pub name: String,
    pub groups: BTreeMap<String, Vec<String>>,
    pub routes: Route,
}
pub enum Request {
    Reload,
    Open(String),
}
pub enum Reply {
    Catalog(Result<Catalog, String>),
    File(String, Result<Vec<Element>, String>),
}

fn get<T: serde::de::DeserializeOwned>(
    client: &Client,
    endpoint: &str,
    query: &[(&str, &str)],
) -> Result<T, String> {
    client
        .get(format!("http://localhost:4400/api/{endpoint}"))
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
            let reply = match request {
                Request::Reload => {
                    Reply::Catalog(client.as_ref().map_err(|e| e.to_string()).and_then(catalog))
                }
                Request::Open(path) => {
                    let result = client
                        .as_ref()
                        .map_err(|e| e.to_string())
                        .and_then(|c| get::<File>(c, "component", &[("file", &path)]))
                        .map(|f| f.model);
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
