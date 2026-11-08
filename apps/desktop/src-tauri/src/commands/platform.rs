use std::path::{Path, PathBuf};

pub use crate::cli_protocol::profile::home_dir;

/// Reads `path` when it holds at most `limit` bytes, without reading further.
/// `None` when it does not exist; an `InvalidData` error when it is larger.
pub(crate) fn read_capped(path: &Path, limit: u64) -> std::io::Result<Option<Vec<u8>>> {
    use std::io::Read;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("The file exceeds its {limit}-byte limit."),
        ));
    }
    Ok(Some(bytes))
}

/// The contents of `path`, which must exist and hold at most `limit` bytes.
pub(crate) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    match read_capped(path, limit) {
        Ok(Some(bytes)) => Ok(bytes),
        Ok(None) => Err(std::io::Error::from(std::io::ErrorKind::NotFound).to_string()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn find_on_path(name: &str) -> Option<PathBuf> {
    find_executable(name, &[])
}

/// The first executable named `name` in a PATH directory, then in `extra`.
/// On Windows a name without an extension matches `name.exe`, `name.cmd` or
/// `name.bat`; a file without one cannot be started there.
pub fn find_executable(name: &str, extra: &[PathBuf]) -> Option<PathBuf> {
    find_in(
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .chain(extra.iter().cloned()),
        name,
    )
}

/// The first executable named `name` (see [`find_executable`]) in `directories`.
pub fn find_in(directories: impl IntoIterator<Item = PathBuf>, name: &str) -> Option<PathBuf> {
    let names: Vec<String> = if cfg!(windows) && Path::new(name).extension().is_none() {
        [".exe", ".cmd", ".bat"]
            .iter()
            .map(|suffix| format!("{name}{suffix}"))
            .collect()
    } else {
        vec![name.to_string()]
    };
    directories
        .into_iter()
        .filter(|directory| directory.is_absolute())
        .flat_map(|directory| {
            names
                .iter()
                .map(move |name| directory.join(name))
                .collect::<Vec<_>>()
        })
        .find(|path| is_executable(path))
}

/// The directories the user's login shell searches, as recovered at startup.
/// The process PATH is widened with common tool directories, so it cannot
/// answer whether a command will be found when the user types it.
#[cfg(unix)]
static LOGIN_PATH: std::sync::OnceLock<Vec<PathBuf>> = std::sync::OnceLock::new();

/// Whether `directory` is on the user's login-shell PATH. `None` when that
/// PATH could not be recovered.
#[cfg(unix)]
pub fn on_login_path(directory: &Path) -> Option<bool> {
    Some(LOGIN_PATH.get()?.iter().any(|entry| entry == directory))
}

#[cfg(unix)]
fn path_from_shell(output: &str) -> Option<&str> {
    output
        .split_once("\0JACKALOPE_PATH\0")?
        .1
        .split_once('\0')
        .map(|(path, _)| path)
}

#[cfg(unix)]
pub fn initialize_environment() {
    use std::{process::Command, time::Duration};
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let home = home_dir();
    let shell = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .or_else(|| {
            Some(PathBuf::from(if cfg!(target_os = "macos") {
                "/bin/zsh"
            } else {
                "/bin/bash"
            }))
        })
        .filter(|p| p.is_absolute() && is_executable(p));
    let mut directories = Vec::new();
    if let Some(shell) = shell {
        let mut command = Command::new(shell);
        command.args([
            "-ilc",
            "/bin/sh -c 'printf \"\\0JACKALOPE_PATH\\0%s\\0\" \"$PATH\"'",
        ]);
        if let Some(home) = &home {
            command.current_dir(home);
        }
        if let Ok(result) = super::process_control::run(command, Duration::from_secs(3)) {
            if result.success && !result.truncated {
                if let Some(path) = path_from_shell(&result.stdout) {
                    let _ = LOGIN_PATH.set(std::env::split_paths(path).collect());
                    directories.extend(std::env::split_paths(path));
                }
            }
        }
    }
    directories.extend(std::env::split_paths(&inherited));
    if let Some(home) = home {
        for relative in [
            ".local/bin",
            ".cargo/bin",
            ".bun/bin",
            ".volta/bin",
            ".npm-global/bin",
            ".local/share/pnpm",
            ".grok/bin",
            ".opencode/bin",
        ] {
            directories.push(home.join(relative));
        }
    }
    directories.extend(
        [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            "/snap/bin",
        ]
        .map(PathBuf::from),
    );
    let mut seen = std::collections::HashSet::new();
    directories.retain(|path| path.is_absolute() && seen.insert(path.clone()));
    if let Ok(path) = std::env::join_paths(directories) {
        // Called before Tauri starts threads; children must inherit the same PATH as discovery.
        std::env::set_var("PATH", path);
    }
}

#[cfg(not(unix))]
pub fn initialize_environment() {}

/// Calls `attempt` every `interval` until it returns `Some`, it fails, or
/// `deadline` passes. The last attempt runs at or after the deadline, so a slow
/// condition still gets a final check; `Ok(None)` means it never held.
pub fn poll_until<T, E>(
    deadline: std::time::Instant,
    interval: std::time::Duration,
    mut attempt: impl FnMut() -> Result<Option<T>, E>,
) -> Result<Option<T>, E> {
    loop {
        if let Some(value) = attempt()? {
            return Ok(Some(value));
        }
        let now = std::time::Instant::now();
        if now >= deadline {
            return Ok(None);
        }
        std::thread::sleep(interval.min(deadline - now));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executables_are_found_only_in_absolute_directories() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-npm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        assert_eq!(find_in([directory.clone()], "npm"), None);
        let npm = directory.join(if cfg!(windows) { "npm.cmd" } else { "npm" });
        std::fs::write(&npm, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&npm, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(find_in([directory.clone()], "npm"), Some(npm));
        assert_eq!(find_in([PathBuf::from("relative")], "npm"), None);
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn polling_stops_when_the_condition_holds_or_the_deadline_passes() {
        use std::time::{Duration, Instant};
        let mut calls = 0;
        let found = poll_until(
            Instant::now() + Duration::from_secs(5),
            Duration::from_millis(1),
            || -> Result<_, ()> {
                calls += 1;
                Ok((calls == 3).then_some(calls))
            },
        );
        assert_eq!(found, Ok(Some(3)));
        let mut calls = 0;
        let never = poll_until(
            Instant::now(),
            Duration::from_secs(60),
            || -> Result<Option<()>, ()> {
                calls += 1;
                Ok(None)
            },
        );
        assert_eq!((never, calls), (Ok(None), 1));
        assert_eq!(
            poll_until(Instant::now(), Duration::ZERO, || Err::<Option<()>, _>(
                "stop"
            )),
            Err("stop")
        );
    }

    #[test]
    fn directories_are_not_executables() {
        assert!(!is_executable(&std::env::temp_dir()));
    }

    #[cfg(unix)]
    #[test]
    fn executable_detection_checks_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("jl-executable-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!is_executable(&path));
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(is_executable(&path));
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn shell_path_ignores_startup_output_and_requires_complete_marker() {
        assert_eq!(
            path_from_shell("welcome\n\0JACKALOPE_PATH\0/a path/bin:/usr/bin\0bye"),
            Some("/a path/bin:/usr/bin")
        );
        assert_eq!(path_from_shell("/usr/bin"), None);
        assert_eq!(path_from_shell("\0JACKALOPE_PATH\0partial"), None);
    }
}
