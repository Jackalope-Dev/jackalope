//! Processes still running inside a workspace, so the person can see what an interrupted
//! attempt may have left behind (a dev server the agent started in its own process group
//! outlives the agent's guardian) before resuming it, and which processes an attempt
//! started, so its agent may stop them without asking.

use serde::Serialize;
use std::collections::HashSet;
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
    let mut found = inside(workspace)?;
    found.sort_by_key(|process| process.pid);
    found.truncate(LIMIT);
    Some(found)
}

fn inside(workspace: &Path) -> Option<Vec<WorkspaceProcess>> {
    let root = std::fs::canonicalize(workspace).unwrap_or_else(|_| workspace.to_path_buf());
    let own = std::process::id();
    Some(
        running()?
            .into_iter()
            .filter(|(pid, _, directory)| *pid != own && directory.starts_with(&root))
            .map(|(pid, name, directory)| WorkspaceProcess {
                pid,
                name,
                directory: directory.to_string_lossy().into_owned(),
            })
            .collect(),
    )
}

/// Whether attempt `run_id` started every target, so its agent may stop them without
/// asking. A negative target is a process group, which must hold only such processes.
///
/// A process is the attempt's when it descends from the attempt's agent or shares the
/// agent's process group, or, when the attempt has a worktree of its own, when it runs
/// inside that worktree: a dev server the agent detached into a new process group leaves
/// the agent's tree but stays there. The project checkout is never treated that way,
/// since the person's own shells, editors and servers run in it.
pub(in crate::commands) fn owns_processes(
    runtime: &super::TaskRuntime,
    run_id: &str,
    targets: &[i64],
) -> bool {
    let Some(run) = runtime.run_snapshot(run_id) else {
        return false;
    };
    let on_device = run.remote.is_none()
        && run
            .host
            .as_ref()
            .is_none_or(|host| host.id == crate::commands::computers::pool::DEVICE);
    if !on_device || !run.status.is_active() {
        return false;
    }
    let worktree = own_worktree(&run.workspace, &run.project_path);
    owned(targets, runtime.agent_pid(run_id), worktree.as_deref())
}

/// The attempt's workspace when it is a separate directory from the project checkout.
fn own_worktree(workspace: &str, project: &str) -> Option<PathBuf> {
    if workspace.is_empty() || project.is_empty() {
        return None;
    }
    let workspace = std::fs::canonicalize(workspace).ok()?;
    let project = std::fs::canonicalize(project).unwrap_or_else(|_| PathBuf::from(project));
    (!project.starts_with(&workspace)).then_some(workspace)
}

fn owned(targets: &[i64], agent: Option<u32>, worktree: Option<&Path>) -> bool {
    let own = i64::from(std::process::id());
    #[cfg(unix)]
    let own_group = i64::from(unsafe { libc::getpgrp() });
    #[cfg(not(unix))]
    let own_group = own;
    if targets.is_empty()
        || targets.iter().any(|target| {
            let id = target.saturating_abs();
            id <= 1 || id > i64::from(i32::MAX) || id == own || id == own_group
        })
    {
        return false;
    }
    let Some(table) = process_table() else {
        return false;
    };
    let agent = agent.map(i64::from);
    let mut in_worktree: Option<HashSet<i64>> = None;
    let mut owns = |pid: i64| -> bool {
        let Some(&(_, group)) = table.get(&pid) else {
            return false;
        };
        if agent.is_some_and(|agent| group == agent || descends(&table, pid, agent)) {
            return true;
        }
        let Some(worktree) = worktree else {
            return false;
        };
        in_worktree
            .get_or_insert_with(|| {
                inside(worktree)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|process| i64::from(process.pid))
                    .collect()
            })
            .contains(&pid)
    };
    targets.iter().all(|&target| {
        if target > 0 {
            return owns(target);
        }
        let group = -target;
        if agent == Some(group) {
            return true;
        }
        let members: Vec<i64> = table
            .iter()
            .filter(|(_, &(_, member_group))| member_group == group)
            .map(|(&pid, _)| pid)
            .collect();
        !members.is_empty() && members.into_iter().all(&mut owns)
    })
}

fn descends(table: &std::collections::HashMap<i64, (i64, i64)>, pid: i64, ancestor: i64) -> bool {
    let mut current = pid;
    for _ in 0..64 {
        if current == ancestor {
            return true;
        }
        match table.get(&current) {
            Some(&(parent, _)) if parent > 1 && parent != current => current = parent,
            _ => return false,
        }
    }
    false
}

/// Every process's parent and process group, by process ID.
#[cfg(unix)]
fn process_table() -> Option<std::collections::HashMap<i64, (i64, i64)>> {
    let output = ["/bin/ps", "/usr/bin/ps"]
        .iter()
        .find(|path| Path::new(path).exists())
        .and_then(|ps| {
            std::process::Command::new(ps)
                .args(["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid="])
                .stdin(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output()
                .ok()
        })
        .filter(|output| output.status.success())?;
    Some(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let mut fields = line
                    .split_whitespace()
                    .map(|field| field.parse::<i64>().ok());
                Some((fields.next()??, (fields.next()??, fields.next()??)))
            })
            .collect(),
    )
}

#[cfg(not(unix))]
fn process_table() -> Option<std::collections::HashMap<i64, (i64, i64)>> {
    None
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

    #[test]
    fn descent_follows_parents_and_stops_at_the_root() {
        let table = std::collections::HashMap::from([
            (10, (1, 10)),
            (20, (10, 20)),
            (30, (20, 30)),
            (40, (1, 40)),
        ]);
        assert!(descends(&table, 30, 10));
        assert!(descends(&table, 10, 10));
        assert!(!descends(&table, 40, 10));
        assert!(!descends(&table, 99, 10));
    }

    #[cfg(unix)]
    #[test]
    fn an_attempt_owns_processes_in_its_own_worktree_but_not_in_the_project_checkout() {
        use std::os::unix::process::CommandExt;
        let root = std::env::temp_dir().join(format!("jackalope-owned-{}", uuid::Uuid::new_v4()));
        let project = root.join("project");
        let worktree = project.join(".worktrees").join("task");
        std::fs::create_dir_all(&worktree).unwrap();
        // Each in a process group of its own, as a detached dev server would be.
        let spawn = |directory: &Path| {
            std::process::Command::new("sleep")
                .arg("30")
                .current_dir(directory)
                .process_group(0)
                .spawn()
                .unwrap()
        };
        let (mut server, mut person) = (spawn(&worktree), spawn(&project));
        let (server_id, person_id) = (i64::from(server.id()), i64::from(person.id()));

        let runtime = super::super::TaskRuntime::new(root.join("history")).unwrap();
        let insert = |workspace: &Path| {
            let mut run = super::super::tests::sample("claude");
            run.id = uuid::Uuid::new_v4().to_string();
            run.project_path = project.to_string_lossy().into_owned();
            run.workspace = workspace.to_string_lossy().into_owned();
            let id = run.id.clone();
            runtime.inner.lock().unwrap().runs.insert(id.clone(), run);
            id
        };
        let isolated = insert(&worktree);
        let in_place = insert(&project);
        let owns = |id: &str, targets: &[i64]| owns_processes(&runtime, id, targets);
        let isolated_owns = owns(&isolated, &[server_id]);
        let isolated_owns_group = owns(&isolated, &[-server_id]);
        let isolated_owns_person = owns(&isolated, &[person_id]);
        let isolated_owns_both = owns(&isolated, &[server_id, person_id]);
        let in_place_owns_person = owns(&in_place, &[person_id]);
        let in_place_owns_server = owns(&in_place, &[server_id]);
        let never = [1, -1, 0, i64::from(std::process::id())]
            .iter()
            .any(|&target| owns(&isolated, &[target]));
        runtime.update(&isolated, |run| {
            run.remote = Some(super::super::RemoteExecution::default())
        });
        let remote_owns = owns(&isolated, &[server_id]);
        // The agent's own process group is the attempt's wherever it runs.
        let agent_group = owned(&[person_id, -person_id], Some(person.id()), None);

        for child in [&mut server, &mut person] {
            let _ = child.kill();
            let _ = child.wait();
        }
        drop(runtime);
        let _ = std::fs::remove_dir_all(&root);
        assert!(isolated_owns && isolated_owns_group && agent_group);
        assert!(!isolated_owns_person && !isolated_owns_both);
        assert!(!in_place_owns_person && !in_place_owns_server);
        assert!(!never && !remote_owns);
    }
}
