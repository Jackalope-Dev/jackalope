use std::path::{Path, PathBuf};

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
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(name))
        .find(|path| is_executable(path))
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
    let home = std::env::var_os("HOME").map(PathBuf::from);
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

#[cfg(test)]
mod tests {
    use super::*;

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
