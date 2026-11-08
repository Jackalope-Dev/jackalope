mod api;
mod client;
mod pairing;
mod transport;
pub mod wsl;
pub use client::*;
pub use transport::*;

use super::{
    account_storage,
    coordination::Coordinator,
    live_sessions::LiveSessions,
    tasks::{RunRequest, TaskRuntime},
};
use pairing::{pairing_code, SHORT_ALPHABET, SHORT_LENGTH};
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
/// One pending pairing: the long code in its link and QR, and the short code shown for
/// typing. Either pairs once; both share the expiry and the attempt limit.
struct Pairing {
    hash: String,
    short: String,
    expires: Instant,
    attempts: u16,
}
impl Pairing {
    /// Counts this attempt, then accepts a current code: the link's long code or the short
    /// one, before expiry and within [`PAIRING_ATTEMPTS`].
    fn admit(&mut self, code: &str, now: Instant) -> bool {
        self.attempts = self.attempts.saturating_add(1);
        let matches = pairing_code(code).is_some_and(|code| {
            let wanted = if code.len() == 64 {
                &self.hash
            } else {
                &self.short
            };
            &hash(&code) == wanted
        });
        now < self.expires && self.attempts <= PAIRING_ATTEMPTS && matches
    }
}
/// Every request to pair counts, so a short code gets at most this many guesses before
/// the person has to create a new one.
const PAIRING_ATTEMPTS: u16 = 10;
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
/// A 50-bit code for typing, grouped as `ABCDE-FGHJK`. With five minutes, one use and
/// [`PAIRING_ATTEMPTS`] guesses, a guess succeeds about once in 10^14 tries.
fn short_code() -> String {
    // Bytes 6 and 8 of a v4 UUID carry its version and variant; the rest are random.
    let random = Uuid::new_v4().into_bytes();
    let code: String = [0, 1, 2, 3, 4, 5, 7, 9, 10, 11]
        .iter()
        .map(|&index| SHORT_ALPHABET[usize::from(random[index] % 32)] as char)
        .collect();
    format!("{}-{}", &code[..5], &code[5..])
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
impl crate::services::Service for RemoteAccess {
    fn shutdown(&self) {
        RemoteAccess::shutdown(self)
    }
}

impl RemoteAccess {
    pub fn new(
        path: PathBuf,
        runtime: TaskRuntime,
        coordinator: Coordinator,
        sessions: LiveSessions,
        app: AppHandle,
    ) -> Self {
        let loaded = account_storage::read_json(
            &path,
            "Remote settings could not be read; the saved record is unchanged.",
        )
        .map(|saved| {
            saved.unwrap_or(Config {
                port: default_port(),
                ..Default::default()
            })
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
        account_storage::write_json(&self.path, config)
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

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::remote::wsl::wsl_distributions,
            commands::remote::remote_status,
            commands::remote::remote_configure,
            commands::remote::remote_pairing,
            commands::remote::remote_revoke,
            commands::remote::remote_private_https,
            commands::remote::remote_tailscale_status,
            commands::remote::remote_hosts,
            commands::remote::remote_host_pair,
            commands::remote::remote_host_request,
            commands::remote::remote_host_remove,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub fn remote_status(service: State<'_, RemoteAccess>) -> Result<Value, String> {
    service.status()
}
/// A project's branch is empty until it has been inspected, so blank means its current
/// branch. Errors name the project because several are configured at once.
fn project_branch(request: &RunRequest) -> Result<String, String> {
    let requested = request
        .target_branch
        .as_deref()
        .map(str::trim)
        .filter(|branch| !branch.is_empty());
    super::tasks::resolve_target_branch(&request.project_path, requested)
        .map_err(|error| format!("{}: {error}", request.project_name))
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
        request.target_branch = Some(project_branch(request)?);
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
/// The link as QR modules, one string per row with '1' for dark, for the phone to scan.
fn qr_rows(link: &str) -> Result<Vec<String>, String> {
    let code = qrcode::QrCode::new(link.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .to_colors()
        .chunks(code.width())
        .map(|row| {
            row.iter()
                .map(|color| {
                    if *color == qrcode::Color::Dark {
                        '1'
                    } else {
                        '0'
                    }
                })
                .collect()
        })
        .collect())
}
#[tauri::command]
pub fn remote_pairing(service: State<'_, RemoteAccess>) -> Result<Value, String> {
    let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
    if !inner.config.enabled || inner.stop.is_none() || inner.config.projects.is_empty() {
        return Err("Enable remote access and select a project first.".into());
    }
    let long = secret();
    let code = short_code();
    inner.pairing = Some(Pairing {
        hash: hash(&long),
        short: hash(&pairing_code(&code).unwrap_or_default()),
        expires: Instant::now() + Duration::from_secs(300),
        attempts: 0,
    });
    let link = (!inner.config.public_origin.is_empty())
        .then(|| format!("{}/#pair={long}", inner.config.public_origin));
    let qr = link.as_deref().map(qr_rows).transpose()?;
    Ok(json!({"code":code,"link":link,"qr":qr,"expiresIn":300}))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_project_branches_use_the_current_branch_and_errors_name_the_project() {
        let repo = std::env::temp_dir().join(format!("jackalope-remote-branch-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&repo).unwrap();
        for args in [
            vec!["init", "-b", "trunk"],
            vec![
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Fixture",
            ],
        ] {
            assert!(std::process::Command::new("git")
                .current_dir(&repo)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        let request = |branch: Option<&str>| -> RunRequest {
            serde_json::from_value(json!({"id":"r","projectId":"p","projectName":"Site","projectPath":repo.to_string_lossy(),"agent":"codex","prompt":"","isolated":true,"targetBranch":branch})).unwrap()
        };
        assert_eq!(project_branch(&request(None)).unwrap(), "trunk");
        assert_eq!(project_branch(&request(Some(""))).unwrap(), "trunk");
        assert_eq!(project_branch(&request(Some("  "))).unwrap(), "trunk");
        assert_eq!(project_branch(&request(Some(" trunk "))).unwrap(), "trunk");
        let missing = project_branch(&request(Some("absent"))).unwrap_err();
        assert!(
            missing.starts_with("Site: ") && missing.contains("absent"),
            "unexpected error: {missing}"
        );
        std::fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn short_codes_are_typable_and_read_forgivingly() {
        for _ in 0..50 {
            let code = short_code();
            assert_eq!(code.len(), SHORT_LENGTH + 1);
            assert_eq!(&code[5..6], "-");
            assert!(code
                .bytes()
                .filter(|b| *b != b'-')
                .all(|b| SHORT_ALPHABET.contains(&b)));
            assert_eq!(pairing_code(&code).unwrap(), code.replace('-', ""));
        }
        assert_eq!(pairing_code(" abcde fghjk ").unwrap(), "ABCDEFGHJK");
        assert_eq!(pairing_code("O1LI2-ABCDE").unwrap(), "01112ABCDE");
        let long = secret();
        assert_eq!(pairing_code(&long.to_uppercase()).unwrap(), long);
        for bad in [
            "",
            "ABCDE-FGHJ",
            "ABCDE-FGHJKM",
            "ABCDE-FGHJU",
            "ABCDE_FGHJK",
        ] {
            assert!(pairing_code(bad).is_none(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn pairing_accepts_either_code_once_before_expiry_within_the_attempt_limit() {
        let long = secret();
        let short = short_code();
        let now = Instant::now();
        let pending = || Pairing {
            hash: hash(&long),
            short: hash(&pairing_code(&short).unwrap()),
            expires: now + Duration::from_secs(300),
            attempts: 0,
        };
        assert!(pending().admit(&short.to_lowercase(), now));
        assert!(pending().admit(&long, now));
        assert!(!pending().admit("ABCDE-FGHJK", now));
        let mut expired = pending();
        assert!(!expired.admit(&short, now + Duration::from_secs(300)));
        let mut guessed = pending();
        for _ in 1..PAIRING_ATTEMPTS {
            assert!(!guessed.admit("00000-00000", now));
        }
        assert!(
            guessed.admit(&short, now),
            "the last allowed attempt still pairs"
        );
        let mut locked = pending();
        for _ in 0..PAIRING_ATTEMPTS {
            assert!(!locked.admit("00000-00000", now));
        }
        assert!(
            !locked.admit(&short, now),
            "after the limit even the right code is refused"
        );
    }
}
