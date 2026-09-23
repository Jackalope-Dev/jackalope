use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub device_name: String,
    pub git_available: bool,
    pub desktop_control: super::desktop_control::platform::Readiness,
}

pub(super) fn device_name() -> String {
    #[cfg(unix)]
    {
        let mut name = [0u8; 256];
        if unsafe { libc::gethostname(name.as_mut_ptr().cast(), name.len()) } == 0 {
            let length = name
                .iter()
                .position(|&byte| byte == 0)
                .unwrap_or(name.len());
            if length > 0 {
                return String::from_utf8_lossy(&name[..length]).into_owned();
            }
        }
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "localhost".into())
}

#[tauri::command]
pub async fn system_get_info() -> Result<SystemInfo, String> {
    let (git_available, desktop_control) = tauri::async_runtime::spawn_blocking(|| {
        let mut command = std::process::Command::new("git");
        command.arg("--version");
        let git = super::process_control::run(command, std::time::Duration::from_secs(5))
            .is_ok_and(|output| output.success);
        (git, super::desktop_control::platform::readiness())
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        device_name: device_name(),
        git_available,
        desktop_control,
    })
}
