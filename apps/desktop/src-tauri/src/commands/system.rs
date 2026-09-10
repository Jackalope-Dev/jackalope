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
    let git_available = tauri::async_runtime::spawn_blocking(|| {
        let mut command = std::process::Command::new("git");
        command.arg("--version");
        super::process_control::run(command, std::time::Duration::from_secs(5))
            .is_ok_and(|output| output.success)
    }).await.map_err(|e| e.to_string())?;

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        device_name: device_name(),
        git_available,
    })
}
