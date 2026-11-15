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

/// The first name of the person using this computer, for naming the devices they pair: the
/// account's full name when the system records one, else the login name capitalized.
pub(super) fn owner_first_name() -> Option<String> {
    let login = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok();
    first_name(account_full_name().as_deref(), login.as_deref())
}

fn first_name(full: Option<&str>, login: Option<&str>) -> Option<String> {
    let from_full = full
        .and_then(|full| full.split(',').next())
        .and_then(|full| full.split_whitespace().next());
    if let Some(first) = from_full {
        return Some(first.chars().take(40).collect());
    }
    let mut login = login?.trim().chars();
    let initial = login.next()?;
    Some(initial.to_uppercase().chain(login).take(40).collect())
}

#[cfg(unix)]
fn account_full_name() -> Option<String> {
    let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
    let mut found: *mut libc::passwd = std::ptr::null_mut();
    let mut buffer = vec![0 as libc::c_char; 4096];
    let status = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            &mut entry,
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut found,
        )
    };
    if status != 0 || found.is_null() || entry.pw_gecos.is_null() {
        return None;
    }
    let gecos = unsafe { std::ffi::CStr::from_ptr(entry.pw_gecos) };
    Some(gecos.to_string_lossy().into_owned()).filter(|name| !name.trim().is_empty())
}

#[cfg(not(unix))]
fn account_full_name() -> Option<String> {
    None
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::system::system_get_info,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

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

#[cfg(test)]
mod tests {
    use super::first_name;

    #[test]
    fn owner_names_use_the_first_word_of_the_full_name_else_the_login() {
        assert_eq!(
            first_name(Some("Caden Sumner"), Some("caden")).unwrap(),
            "Caden"
        );
        assert_eq!(first_name(Some("Ada Lovelace,,,"), None).unwrap(), "Ada");
        assert_eq!(first_name(Some("  "), Some("caden")).unwrap(), "Caden");
        assert_eq!(first_name(None, Some("ada")).unwrap(), "Ada");
        assert_eq!(first_name(None, None), None);
        assert_eq!(first_name(Some(""), Some("")), None);
    }
}
