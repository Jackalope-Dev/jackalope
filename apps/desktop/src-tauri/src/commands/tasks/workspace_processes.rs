//! Processes still running inside a workspace, so the person can see what an interrupted
//! attempt may have left behind (a dev server the agent started in its own process group
//! outlives the agent's guardian) before resuming it.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProcess {
    pub pid: u32,
    pub name: String,
    pub directory: String,
}

/// At most this many are listed; the person needs to know there are some, not every one.
const LIMIT: usize = 20;

/// Processes other than Jackalope whose working directory is `workspace` or inside it.
/// `None` when this system cannot tell.
pub fn workspace_processes(workspace: &Path) -> Option<Vec<WorkspaceProcess>> {
    let root = std::fs::canonicalize(workspace).unwrap_or_else(|_| workspace.to_path_buf());
    let own = std::process::id();
    let mut found: Vec<_> = running()?
        .into_iter()
        .filter(|(pid, _, directory)| *pid != own && directory.starts_with(&root))
        .map(|(pid, name, directory)| WorkspaceProcess {
            pid,
            name,
            directory: directory.to_string_lossy().into_owned(),
        })
        .collect();
    found.sort_by_key(|process| process.pid);
    found.truncate(LIMIT);
    Some(found)
}

#[cfg(target_os = "macos")]
fn running() -> Option<Vec<(u32, String, PathBuf)>> {
    let output = std::process::Command::new("/usr/sbin/lsof")
        .args(["-n", "-w", "-d", "cwd", "-F", "pcn"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    // lsof exits 1 when some processes could not be read; the rest are still listed.
    Some(parse_lsof(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(target_os = "linux")]
fn running() -> Option<Vec<(u32, String, PathBuf)>> {
    let entries = std::fs::read_dir("/proc").ok()?;
    Some(
        entries
            .flatten()
            .filter_map(|entry| {
                let pid = entry.file_name().to_str()?.parse::<u32>().ok()?;
                let directory = std::fs::read_link(entry.path().join("cwd")).ok()?;
                let name = std::fs::read_to_string(entry.path().join("comm")).unwrap_or_default();
                Some((pid, name.trim().to_string(), directory))
            })
            .collect(),
    )
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn running() -> Option<Vec<(u32, String, PathBuf)>> {
    None
}

/// Reads `lsof -F pcn` records: `p<pid>`, `c<command>`, then `f<fd>` and `n<path>`.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn parse_lsof(text: &str) -> Vec<(u32, String, PathBuf)> {
    let mut processes = Vec::new();
    let (mut pid, mut name) = (None, String::new());
    for line in text.lines() {
        let (field, value) = line.split_at(line.len().min(1));
        match field {
            "p" => {
                pid = value.parse().ok();
                name.clear();
            }
            "c" => name = value.to_string(),
            "n" => {
                if let Some(pid) = pid {
                    processes.push((pid, name.clone(), PathBuf::from(value)));
                }
            }
            _ => {}
        }
    }
    processes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lsof_records_keep_each_process_name_with_its_directory() {
        let text = "p402\ncRemoteManagementAgent\nfcwd\nn/\np17334\ncnode\nfcwd\nn/work/app\np9\nfcwd\nn/other\n";
        assert_eq!(
            parse_lsof(text),
            vec![
                (402, "RemoteManagementAgent".into(), PathBuf::from("/")),
                (17334, "node".into(), PathBuf::from("/work/app")),
                (9, String::new(), PathBuf::from("/other")),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_process_inside_the_workspace_is_listed_and_one_outside_is_not() {
        let root =
            std::env::temp_dir().join(format!("jackalope-processes-{}", uuid::Uuid::new_v4()));
        let (workspace, elsewhere) = (root.join("workspace"), root.join("elsewhere"));
        let inside = workspace.join("apps");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .current_dir(&inside)
            .spawn()
            .unwrap();
        let listed = workspace_processes(&workspace).unwrap();
        let outside = workspace_processes(&elsewhere).unwrap();
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&root);
        assert!(listed.iter().any(|process| process.pid == child.id()));
        assert!(outside.iter().all(|process| process.pid != child.id()));
    }
}
