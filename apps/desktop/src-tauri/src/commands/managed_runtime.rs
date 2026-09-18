use super::{file_lock::FileLock, history, local_ai::Progress};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{ipc::Channel, State};

mod install;
mod lifecycle;
pub(super) use lifecycle::acquire;

#[tauri::command]
pub async fn managed_runtime_cleanup(remove_active: bool) -> Result<lifecycle::Cleanup, String> {
    lifecycle::managed_runtime_cleanup(remove_active).await
}
pub(super) use lifecycle::UseGuard;
mod receipt;
#[cfg(test)]
mod tests;

const VERSION: &str = "1.18.31";
const MAX_ARCHIVE: u64 = 100_000_000;
const MAX_BINARY: u64 = 250_000_000;
const BINARY: &str = if cfg!(windows) {
    "opencode.exe"
} else {
    "opencode"
};
static ROOT: OnceLock<PathBuf> = OnceLock::new();

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn initialize(root: PathBuf) {
    let _ = ROOT.set(root);
}

pub(super) fn configure(command: &mut std::process::Command) {
    if ROOT
        .get()
        .is_some_and(|root| Path::new(command.get_program()).starts_with(root))
    {
        command.env("OPENCODE_DISABLE_AUTOUPDATE", "true");
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    platform: String,
    url: String,
    sha512: String,
    unpacked_bytes: u64,
}

fn platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("windows-x64-baseline"),
        ("windows", "aarch64") => Some("windows-arm64"),
        ("macos", "x86_64") => Some("darwin-x64-baseline"),
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("linux", "x86_64") if cfg!(target_env = "gnu") => Some("linux-x64-baseline"),
        ("linux", "aarch64") if cfg!(target_env = "gnu") => Some("linux-arm64"),
        _ => None,
    }
}

pub(super) fn supported() -> bool {
    platform().is_some()
}

fn asset() -> Result<Asset, String> {
    let platform = platform().ok_or("The private runner is unavailable for this platform. Configure an installed OpenCode executable in Agents.")?;
    serde_json::from_str::<Vec<Asset>>(include_str!("managed_runtime/assets.json"))
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|asset| asset.platform == platform)
        .ok_or_else(|| "No private runner download is configured for this platform.".into())
}

pub(super) fn executable() -> Result<Option<PathBuf>, String> {
    let Some(root) = ROOT.get() else {
        return Ok(None);
    };
    receipt::resolve(root).map_err(|_| "The private OpenCode runner needs repair. Reconnect an API provider or prepare it again in Local AI setup.".into())
}

#[derive(Default)]
pub struct ManagedRuntime {
    active: Arc<Mutex<Option<(String, Arc<AtomicBool>)>>>,
    canceled: Mutex<std::collections::HashSet<String>>,
}

struct Operation {
    active: Arc<Mutex<Option<(String, Arc<AtomicBool>)>>>,
    canceled: Arc<AtomicBool>,
}
impl Drop for Operation {
    fn drop(&mut self) {
        self.canceled.store(true, Ordering::SeqCst);
        if let Ok(mut active) = self.active.lock() {
            *active = None;
        }
    }
}
impl ManagedRuntime {
    fn begin(&self, id: &str) -> Result<Operation, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid runner setup operation.".to_string())?;
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        if self.canceled.lock().map_err(|e| e.to_string())?.remove(id) {
            return Err("Runner setup canceled. You can retry when ready.".into());
        }
        if active.is_some() {
            return Err(
                "Runner setup is already running. Wait for it to finish or cancel that setup."
                    .into(),
            );
        }
        let canceled = Arc::new(AtomicBool::new(false));
        *active = Some((id.to_owned(), canceled.clone()));
        Ok(Operation {
            active: self.active.clone(),
            canceled,
        })
    }
    fn cancel(&self, id: &str) {
        if uuid::Uuid::parse_str(id).is_err() {
            return;
        }
        if let Ok(active) = self.active.lock() {
            if let Some((_, canceled)) = active.as_ref().filter(|(owner, _)| owner == id) {
                canceled.store(true, Ordering::SeqCst);
            } else if let Ok(mut pending) = self.canceled.lock() {
                if pending.len() >= 64 {
                    pending.clear();
                }
                pending.insert(id.to_owned());
            }
        }
    }
}

fn check_cancel(canceled: &AtomicBool) -> Result<(), String> {
    if canceled.load(Ordering::SeqCst) {
        Err("Runner setup canceled. You can retry when ready.".into())
    } else {
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    supported: bool,
    installed: bool,
    version: &'static str,
    detail: Option<String>,
    disk_bytes: Option<u64>,
    source: &'static str,
    installed_version: Option<String>,
}

#[tauri::command]
pub async fn managed_runtime_status() -> Result<RuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let found = executable();
        RuntimeStatus {
            supported: supported(),
            installed: matches!(found, Ok(Some(_))),
            version: VERSION,
            detail: found.err(),
            disk_bytes: ROOT.get().and_then(|root| lifecycle::disk_bytes(root).ok()),
            source: "Jackalope private runner",
            installed_version: ROOT
                .get()
                .and_then(|root| history::read_bounded(&root.join("active.json"), 8192).ok())
                .and_then(|bytes| serde_json::from_slice::<receipt::Receipt>(&bytes).ok())
                .map(|receipt| receipt.version.chars().take(64).collect()),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn managed_runtime_cancel(operation_id: String, service: State<'_, ManagedRuntime>) {
    service.cancel(&operation_id);
}

#[tauri::command]
pub async fn managed_runtime_prepare(
    operation_id: String,
    use_configured: Option<bool>,
    progress: Channel<Progress>,
    service: State<'_, ManagedRuntime>,
    runtime: State<'_, super::tasks::TaskRuntime>,
) -> Result<(), String> {
    let mut policy = runtime.policy()?;
    if use_configured.unwrap_or(true)
        && policy
            .runner_options
            .get("opencode")
            .and_then(|o| o.command.as_deref())
            .is_some_and(|path| !path.trim().is_empty())
    {
        policy.enabled_agents.clear();
        policy.resolve("opencode")?;
        return Ok(());
    }
    let operation = service.begin(&operation_id)?;
    let root = ROOT
        .get()
        .ok_or("Private runner storage is unavailable.")?
        .clone();
    let canceled = operation.canceled.clone();
    prepare(
        &root,
        canceled.clone(),
        Arc::new(move |event| {
            if progress.send(event).is_err() {
                canceled.store(true, Ordering::SeqCst);
            }
        }),
    )
    .await
}

type Reporter = Arc<dyn Fn(Progress) + Send + Sync>;
fn report(reporter: &Reporter, phase: &str, message: &str, completed: u64, total: Option<u64>) {
    reporter(Progress {
        phase: phase.into(),
        message: message.into(),
        completed,
        total,
    });
}

async fn prepare(root: &Path, canceled: Arc<AtomicBool>, progress: Reporter) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("install.lock"))
        .map_err(|e| e.to_string())?;
    let _lock = FileLock::try_new(lock).map_err(|_| {
        "Another Jackalope window is preparing the runner. Retry after it finishes.".to_string()
    })?;
    check_cancel(&canceled)?;
    let existing_root = root.to_owned();
    let existing = tauri::async_runtime::spawn_blocking(move || receipt::resolve(&existing_root))
        .await
        .map_err(|e| e.to_string())?;
    if matches!(existing, Ok(Some(_))) {
        check_cancel(&canceled)?;
        report(&progress, "ready", "Private runner ready", 0, None);
        return Ok(());
    }
    let asset = asset()?;
    let directory = root.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&directory).map_err(|e| e.to_string())?;
    let result = async {
        install::download(&asset, &directory, &canceled, &progress).await?;
        let extraction_dir = directory.clone();
        let extraction_asset = asset.clone();
        let extraction_cancel = canceled.clone();
        report(
            &progress,
            "verify",
            "Verifying and unpacking the private runner",
            0,
            None,
        );
        let binary = tauri::async_runtime::spawn_blocking(move || {
            let binary = install::extract(&extraction_asset, &extraction_dir, &extraction_cancel)?;
            install::verify_launch(&extraction_dir, &extraction_cancel)?;
            Ok::<_, String>(binary)
        })
        .await
        .map_err(|e| e.to_string())??;
        check_cancel(&canceled)?;
        let receipt = receipt::Receipt {
            version: VERSION.into(),
            platform: asset.platform,
            archive_sha512: asset.sha512,
            installation: directory
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            binary_sha256: binary.0,
            binary_bytes: binary.1,
        };
        fs::write(
            directory.join("LICENSE"),
            include_bytes!("managed_runtime/LICENSE"),
        )
        .map_err(|e| e.to_string())?;
        fs::remove_file(directory.join("download.tgz")).map_err(|e| e.to_string())?;
        check_cancel(&canceled)?;
        history::write_atomic(
            &root.join("active.json"),
            &serde_json::to_vec(&receipt).map_err(|e| e.to_string())?,
        )?;
        report(&progress, "ready", "Private runner ready", 0, None);
        Ok(())
    }
    .await;
    if result.is_err() {
        // Only this operation's newly created directory is eligible for cleanup.
        let _ = fs::remove_dir_all(&directory);
    }
    result
}
