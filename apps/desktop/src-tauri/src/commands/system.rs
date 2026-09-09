use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub device_name: String,
    pub git_available: bool,
}

pub(super) fn device_name() -> String {
    match std::env::var("COMPUTERNAME") {
        Ok(name) => name,
        Err(_) => std::env::var("HOSTNAME").unwrap_or_else(|_| "localhost".to_string()),
    }
}

#[tauri::command]
pub async fn system_get_info() -> Result<SystemInfo, String> {
    let git_available = std::process::Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        device_name: device_name(),
        git_available,
    })
}
