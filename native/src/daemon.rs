use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    time::Duration,
};

pub struct Daemon(Child);
impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
pub fn start() -> Result<Option<Daemon>, String> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("Missing repository root")?;
    if std::env::var_os("UAI_EDITOR_ORIGIN").is_some() {
        return Ok(None);
    }
    let configured = std::env::var_os("UAI_TARGET")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            let v: serde_json::Value =
                serde_json::from_slice(&std::fs::read(root.join("uai.config.json")).ok()?).ok()?;
            Some(std::path::PathBuf::from(v["target"].as_str()?))
        })
        .and_then(|path| root.join(path).canonicalize().ok());
    let ready = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!("{}/api/project", super::project::origin()))
        .send()
        .ok()
        .and_then(|r| r.json::<serde_json::Value>().ok())
        .and_then(|j| {
            std::path::Path::new(j["project"]["root"].as_str()?)
                .canonicalize()
                .ok()
        })
        .is_some_and(|p| Some(p) == configured);
    if ready {
        return Ok(None);
    }
    let mut cmd = Command::new("node");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = Daemon(
        cmd.arg(root.join("electron/server.mjs"))
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start Node: {e}"))?,
    );
    let stdout = child.0.stdout.take().ok_or("Missing daemon output")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(port) = line
                .strip_prefix("UAI_PORT ")
                .and_then(|p| p.parse::<u16>().ok())
            {
                let _ = tx.send(port);
            }
        }
    });
    let port = rx
        .recv_timeout(Duration::from_secs(30))
        .map_err(|e| format!("The project daemon did not start: {e}"))?;
    super::project::set_origin(port);
    Ok(Some(child))
}
