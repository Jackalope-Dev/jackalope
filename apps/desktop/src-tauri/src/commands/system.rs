use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub device_name: String,
    pub git_available: bool,
    pub desktop_control: super::desktop_control::platform::Readiness,
}

/// This computer's name for pairing and system info, falling back to "localhost".
pub(super) fn device_name() -> String {
    computer_name().unwrap_or_else(|| "localhost".into())
}

/// The name people know this computer by: the Computer Name in macOS Sharing settings, the
/// Windows host name in its own case (not the upper-case NetBIOS name), or the Linux host
/// name. `None` when nothing better than "localhost" is set. A rename is picked up within a
/// few minutes.
pub(super) fn computer_name() -> Option<String> {
    const FRESH: std::time::Duration = std::time::Duration::from_secs(300);
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, Option<String>)>> =
        std::sync::Mutex::new(None);
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((at, name)) = cache.as_ref() {
        if at.elapsed() < FRESH {
            return name.clone();
        }
    }
    let name = platform_computer_name()
        .and_then(|name| clean_name(&name))
        .or_else(|| host_name().and_then(|name| clean_name(&name)));
    *cache = Some((std::time::Instant::now(), name.clone()));
    name
}

fn clean_name(name: &str) -> Option<String> {
    let name: String = name
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect();
    let lower = name.to_ascii_lowercase();
    let placeholder = lower == "localhost" || lower.starts_with("localhost.");
    (!name.is_empty() && !placeholder).then_some(name)
}

#[cfg(target_os = "macos")]
fn platform_computer_name() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(windows)]
fn platform_computer_name() -> Option<String> {
    use windows_sys::Win32::System::SystemInformation::{
        ComputerNamePhysicalDnsHostname, GetComputerNameExW,
    };
    let mut size: u32 = 0;
    // The first call reports the buffer size the name needs, including its terminator.
    unsafe {
        GetComputerNameExW(
            ComputerNamePhysicalDnsHostname,
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if size == 0 {
        return None;
    }
    let mut buffer = vec![0u16; size as usize];
    if unsafe {
        GetComputerNameExW(
            ComputerNamePhysicalDnsHostname,
            buffer.as_mut_ptr(),
            &mut size,
        )
    } == 0
    {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..size as usize]))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_computer_name() -> Option<String> {
    std::fs::read_to_string("/etc/hostname").ok()
}

fn host_name() -> Option<String> {
    #[cfg(unix)]
    {
        let mut name = [0u8; 256];
        if unsafe { libc::gethostname(name.as_mut_ptr().cast(), name.len()) } == 0 {
            let length = name
                .iter()
                .position(|&byte| byte == 0)
                .unwrap_or(name.len());
            if length > 0 {
                return Some(String::from_utf8_lossy(&name[..length]).into_owned());
            }
        }
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
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
    use super::{clean_name, first_name};

    #[test]
    fn computer_names_drop_placeholders_and_control_characters() {
        assert_eq!(
            clean_name("  Caden's MacBook Pro\n").unwrap(),
            "Caden's MacBook Pro"
        );
        assert_eq!(clean_name("localhost"), None);
        assert_eq!(clean_name("LocalHost.localdomain"), None);
        assert_eq!(clean_name("   "), None);
        assert_eq!(clean_name("desk\u{7}top").unwrap(), "desktop");
    }

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
