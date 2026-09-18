mod api;
mod client;
mod transport;
pub use client::*;
pub use transport::*;

use super::{
    account_storage,
    coordination::Coordinator,
    live_sessions::LiveSessions,
    tasks::{RunRequest, TaskRuntime},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    enabled: bool,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default)]
    public_origin: String,
    projects: Vec<RunRequest>,
    devices: Vec<Device>,
}
fn default_port() -> u16 {
    9472
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    name: String,
    token_hash: String,
    paired_at: String,
}
struct Pairing {
    hash: String,
    expires: Instant,
    attempts: u16,
}
struct Inner {
    config: Config,
    pairing: Option<Pairing>,
    error: Option<String>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    listener: Option<tauri::async_runtime::JoinHandle<()>>,
}
#[derive(Clone)]
pub struct RemoteAccess {
    inner: Arc<Mutex<Inner>>,
    gate: Arc<tokio::sync::Mutex<()>>,
    path: PathBuf,
    runtime: TaskRuntime,
    coordinator: Coordinator,
    sessions: LiveSessions,
    assets: Arc<dyn Fn(&str) -> Option<CompanionAsset> + Send + Sync>,
}
struct CompanionAsset {
    bytes: Vec<u8>,
    mime_type: String,
}
fn hash(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
fn origin(value: &str) -> Result<String, String> {
    if value.is_empty() {
        return Ok(String::new());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "Enter the HTTPS address for this host.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use an HTTPS origin without a path, credentials or query.".into());
    }
    Ok(url.origin().ascii_serialization())
}
impl RemoteAccess {
    pub fn new(
        path: PathBuf,
        runtime: TaskRuntime,
        coordinator: Coordinator,
        sessions: LiveSessions,
        app: AppHandle,
    ) -> Self {
        let loaded = account_storage::read(&path).and_then(|bytes| {
            bytes
                .map(|bytes| {
                    serde_json::from_slice(&bytes).map_err(|_| {
                        "Remote settings could not be read; the saved record is unchanged."
                            .to_string()
                    })
                })
                .unwrap_or(Ok(Config {
                    port: default_port(),
                    ..Default::default()
                }))
        });
        let (config, error) = match loaded {
            Ok(config) => (config, None),
            Err(error) => (Config::default(), Some(error)),
        };
        Self {
            inner: Arc::new(Mutex::new(Inner {
                config,
                error,
                pairing: None,
                stop: None,
                listener: None,
            })),
            gate: Arc::new(tokio::sync::Mutex::new(())),
            path,
            runtime,
            coordinator,
            sessions,
            assets: Arc::new(move |path| {
                app.asset_resolver()
                    .get(path.into())
                    .map(|asset| CompanionAsset {
                        bytes: asset.bytes,
                        mime_type: asset.mime_type,
                    })
            }),
        }
    }
    fn save(&self, config: &Config) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        account_storage::write(
            &self.path,
            &serde_json::to_vec(config).map_err(|e| e.to_string())?,
        )
    }
    pub fn launch(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let _gate = service.gate.lock().await;
            if let Err(error) = service.listen().await {
                service.inner.lock().unwrap().error = Some(error);
            }
        });
    }
    async fn listen(&self) -> Result<(), String> {
        let port = {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            if !inner.config.enabled || inner.stop.is_some() {
                return Ok(());
            }
            inner.config.port
        };
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|_| format!("Port {port} is unavailable. Choose another port and save."))?;
        let (stop, stopped) = tokio::sync::oneshot::channel();
        self.inner.lock().unwrap().stop = Some(stop);
        let router = api::router(self.clone());
        let service = self.clone();
        let listener = tauri::async_runtime::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await
            {
                let mut inner = service.inner.lock().unwrap();
                inner.error = Some(format!("Remote access stopped: {error}"));
                inner.stop = None;
            }
        });
        self.inner.lock().unwrap().listener = Some(listener);
        Ok(())
    }
    pub fn shutdown(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.pairing = None;
        if let Some(stop) = inner.stop.take() {
            let _ = stop.send(());
        }
        if let Some(listener) = inner.listener.take() {
            listener.abort();
        }
    }
    fn status(&self) -> Result<Value, String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(
            json!({"enabled": inner.config.enabled, "listening": inner.stop.is_some(), "port": inner.config.port, "publicOrigin": inner.config.public_origin, "projectIds": inner.config.projects.iter().map(|p| &p.project_id).collect::<Vec<_>>(), "devices": inner.config.devices.iter().map(|d| json!({"id":d.id,"name":d.name,"pairedAt":d.paired_at})).collect::<Vec<_>>(), "error":inner.error}),
        )
    }
}

#[tauri::command]
pub fn remote_status(service: State<'_, RemoteAccess>) -> Result<Value, String> {
    service.status()
}
#[tauri::command]
pub async fn remote_configure(
    enabled: bool,
    port: u16,
    public_origin: String,
    mut projects: Vec<RunRequest>,
    service: State<'_, RemoteAccess>,
) -> Result<Value, String> {
    let service = service.inner().clone();
    let _gate = service.gate.lock().await;
    if port < 1024 || projects.len() > 50 {
        return Err("Choose a port from 1024 to 65535 and up to 50 projects.".into());
    }
    let public_origin = origin(public_origin.trim())?;
    let mut ids = std::collections::HashSet::new();
    for request in &mut projects {
        if !ids.insert(request.project_id.clone()) {
            return Err("A project was selected twice.".into());
        }
        request.target_branch = Some(super::tasks::resolve_target_branch(
            &request.project_path,
            request.target_branch.as_deref(),
        )?);
        request.isolated = true;
        request.previous_run_id = None;
        request.retry_of = None;
    }
    let previous = {
        let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &inner.error {
            if !inner.config.enabled && inner.config.port == 0 {
                return Err(error.clone());
            }
        }
        let config = Config {
            enabled,
            port,
            public_origin,
            projects,
            devices: inner.config.devices.clone(),
        };
        service.save(&config)?;
        let previous = if !enabled || inner.config.port != port {
            if let Some(stop) = inner.stop.take() {
                let _ = stop.send(());
            }
            let previous = inner.listener.take();
            if let Some(listener) = &previous {
                listener.abort();
            }
            previous
        } else {
            None
        };
        inner.config = config;
        inner.error = None;
        inner.pairing = None;
        previous
    };
    if let Some(previous) = previous {
        let _ = previous.await;
    }
    if let Err(error) = service.listen().await {
        service.inner.lock().unwrap().error = Some(error);
    }
    service.status()
}
#[tauri::command]
pub fn remote_pairing(service: State<'_, RemoteAccess>) -> Result<Value, String> {
    let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
    if !inner.config.enabled || inner.stop.is_none() || inner.config.projects.is_empty() {
        return Err("Enable remote access and select a project first.".into());
    }
    let code = secret();
    inner.pairing = Some(Pairing {
        hash: hash(&code),
        expires: Instant::now() + Duration::from_secs(300),
        attempts: 0,
    });
    let link = (!inner.config.public_origin.is_empty())
        .then(|| format!("{}/#pair={code}", inner.config.public_origin));
    Ok(json!({"code":code,"link":link,"expiresIn":300}))
}
#[tauri::command]
pub fn remote_revoke(id: String, service: State<'_, RemoteAccess>) -> Result<(), String> {
    let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
    let mut config = inner.config.clone();
    config.devices.retain(|d| d.id != id);
    service.save(&config)?;
    inner.config = config;
    Ok(())
}
