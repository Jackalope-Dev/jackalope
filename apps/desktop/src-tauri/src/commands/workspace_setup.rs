use std::{
    io::Write,
    path::{Component, Path, PathBuf},
};

fn relative(value: &str) -> Result<PathBuf, String> {
    let normalized = value.replace('\\', "/");
    let path = PathBuf::from(&normalized);
    if normalized.is_empty()
        || normalized.len() > 500
        || normalized.contains(':')
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part.eq_ignore_ascii_case(".git") || part == "..")
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(
            "Setup files must be relative files inside the project, without parent paths or .git."
                .into(),
        );
    }
    Ok(path)
}

fn no_links(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut current = root.to_path_buf();
    for part in relative.components() {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("Setup paths cannot include linked folders or files.".into());
                    }
                }
                if metadata.file_type().is_symlink() {
                    return Err("Setup paths cannot include linked folders or files.".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(root.join(relative))
}

pub(super) fn copy_files(
    project: &str,
    workspace: &str,
    files: &[String],
) -> Result<usize, String> {
    if files.is_empty() {
        return Ok(0);
    }
    if files.len() > 32 {
        return Err("Choose at most 32 setup files.".into());
    }
    let root = dunce::canonicalize(project).map_err(|e| e.to_string())?;
    let destination = dunce::canonicalize(workspace).map_err(|e| e.to_string())?;
    if root == destination {
        return Ok(0);
    }
    let mut prepared = Vec::new();
    for value in files {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let file = relative(value)?;
        let source = no_links(&root, &file)?;
        let target = no_links(&destination, &file)?;
        let metadata = std::fs::metadata(&source)
            .map_err(|_| format!("Setup file {value} is unavailable."))?;
        if !metadata.is_file() || metadata.len() > 1024 * 1024 {
            return Err(format!(
                "Setup file {value} must be a file no larger than 1 MiB."
            ));
        }
        for checkout in [&root, &destination] {
            let mut command =
                super::worktree_cleanup::command(checkout, &["check-ignore", "--quiet", "--"]);
            command.arg(&file);
            let ignored = super::process_control::run(command, std::time::Duration::from_secs(5))?;
            if !ignored.success {
                return Err(format!(
                    "Setup file {value} must be ignored by Git in both the project and task workspace."
                ));
            }
        }
        let bytes = super::history::read_bounded(&source, 1024 * 1024)?;
        if target.exists() {
            if super::history::read_bounded(&target, 1024 * 1024)? != bytes {
                return Err(format!(
                    "Setup would overwrite {value}. Keep or remove that file before retrying."
                ));
            }
        } else if !prepared.iter().any(|(path, _)| path == &file) {
            prepared.push((file, bytes));
        }
    }
    let count = prepared.len();
    for (file, bytes) in prepared {
        let target = no_links(&destination, &file)?;
        std::fs::create_dir_all(target.parent().ok_or("Setup file has no parent")?)
            .map_err(|e| e.to_string())?;
        no_links(&destination, &file)?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(target)
            .and_then(|mut output| output.write_all(&bytes))
            .map_err(|e| e.to_string())?;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_accepts_contained_file_names() {
        for path in [
            "",
            "../.env",
            "/.env",
            "C:\\.env",
            "a//b",
            "a/../b",
            ".git/config",
            "a/.git/config",
        ] {
            assert!(relative(path).is_err(), "{path}");
        }
        assert_eq!(
            relative("config/local.env").unwrap(),
            PathBuf::from("config/local.env")
        );
    }
    #[test]
    fn copies_only_opted_in_ignored_files_and_never_overwrites() {
        let root = std::env::temp_dir().join(format!("jackalope-setup-{}", uuid::Uuid::new_v4()));
        let work = root.join("work");
        std::fs::create_dir_all(&work).unwrap();
        assert!(std::process::Command::new("git")
            .args(["init", "--quiet"])
            .arg(&root)
            .status()
            .unwrap()
            .success());
        std::fs::write(root.join(".gitignore"), ".env.local\n").unwrap();
        std::fs::write(root.join(".env.local"), "fixture-value").unwrap();
        std::fs::write(root.join("tracked.txt"), "source").unwrap();
        let project = root.to_str().unwrap();
        let workspace = work.to_str().unwrap();
        assert_eq!(copy_files(project, workspace, &[]).unwrap(), 0);
        assert!(!work.join(".env.local").exists());
        assert_eq!(
            copy_files(project, workspace, &[".env.local".into()]).unwrap(),
            1
        );
        assert_eq!(
            std::fs::read_to_string(work.join(".env.local")).unwrap(),
            "fixture-value"
        );
        assert_eq!(
            copy_files(project, workspace, &[".env.local".into()]).unwrap(),
            0
        );
        std::fs::write(work.join(".env.local"), "keep my edits").unwrap();
        assert!(copy_files(project, workspace, &[".env.local".into()])
            .unwrap_err()
            .contains("overwrite"));
        assert_eq!(
            std::fs::read_to_string(work.join(".env.local")).unwrap(),
            "keep my edits"
        );
        assert!(copy_files(project, workspace, &["tracked.txt".into()]).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
