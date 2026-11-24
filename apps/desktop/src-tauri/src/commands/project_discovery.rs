//! Repositories on this computer a person may want as projects, found locally from three
//! places: the folders their Claude Code and Codex sessions ran in, a shallow look through
//! common code folders in their home, and the folders VS Code, Cursor and Windsurf list as
//! recently open. Only directory entries and Git metadata are read, never file contents.
//!
//! On macOS, looking inside Desktop, Documents, Downloads, the media folders, `~/Library`
//! (which holds iCloud Drive) or a mounted volume asks the person for permission, so no path
//! there is ever opened, even when a session or an editor names one. Every source is bounded
//! by count and the whole scan by time; it runs only when the app asks for it.

use serde::Serialize;
use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

/// How long one scan may take before it returns what it has.
const BUDGET: Duration = Duration::from_secs(4);
/// Repositories a scan returns.
const CANDIDATES: usize = 40;
/// Repositories whose Git metadata a scan reads.
const INSPECTED: usize = 120;
/// Directory entries the code-folder scan looks at in all.
const ENTRIES: usize = 5_000;
/// Repositories a scan suggests adding.
const RECOMMENDED: usize = 3;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;

/// Folders in a home directory that hold code by convention, looked through two levels deep.
const CODE_FOLDERS: [&str; 15] = [
    "Code",
    "code",
    "Developer",
    "Projects",
    "projects",
    "src",
    "dev",
    "repos",
    "GitHub",
    "github",
    "git",
    "workspace",
    "Workspace",
    "source/repos",
    "Source/Repos",
];

/// Home folders macOS guards with a permission prompt, and that Jackalope never opens.
const PROTECTED: [&str; 8] = [
    "Desktop",
    "Documents",
    "Downloads",
    "Library",
    "Pictures",
    "Movies",
    "Music",
    "Public",
];

/// Editors whose recently opened folders are read from their `storage.json`.
const EDITORS: [&str; 5] = ["Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium"];

/// A repository the person might add as a project.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// The main checkout; worktrees are folded into it.
    pub path: String,
    pub name: String,
    pub has_commits: bool,
    pub last_commit_at: Option<String>,
    /// Where `origin` (or the default remote) is hosted, such as `github.com`.
    pub remote_host: Option<String>,
    /// Claude Code and Codex conversations that ran in it or its worktrees.
    pub sessions: usize,
    pub last_session_at: Option<String>,
    /// `sessions`, `folders` and/or `editor`.
    pub sources: Vec<&'static str>,
    /// One of the few the scan suggests adding.
    pub recommended: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryScan {
    pub candidates: Vec<Candidate>,
    /// Whether the scan stopped at a limit before looking everywhere.
    pub truncated: bool,
}

/// What a scan looks through.
pub struct Inputs {
    pub home: PathBuf,
    pub code_folders: Vec<PathBuf>,
    pub editor_files: Vec<PathBuf>,
    /// Each session's working directory and when it was last written.
    pub sessions: Vec<(String, u64)>,
    /// Folders that are already projects.
    pub projects: Vec<PathBuf>,
    /// Scratch folders: repositories there are throwaway, so they are not suggested.
    pub temporary: Vec<PathBuf>,
}

impl Inputs {
    /// The code folders and editor files that exist for `home` on this platform.
    pub fn for_home(home: PathBuf) -> Self {
        let code_folders = CODE_FOLDERS
            .iter()
            .map(|folder| home.join(folder))
            .collect();
        let config = if cfg!(target_os = "macos") {
            Some(home.join("Library/Application Support"))
        } else if cfg!(windows) {
            std::env::var_os("APPDATA").map(PathBuf::from)
        } else {
            Some(
                std::env::var_os("XDG_CONFIG_HOME")
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute())
                    .unwrap_or_else(|| home.join(".config")),
            )
        };
        let editor_files = config
            .into_iter()
            .flat_map(|config| {
                EDITORS
                    .iter()
                    .map(move |editor| config.join(editor).join("User/globalStorage/storage.json"))
            })
            .collect();
        Self {
            home,
            code_folders,
            editor_files,
            sessions: Vec::new(),
            projects: Vec::new(),
            temporary: [
                std::env::temp_dir(),
                PathBuf::from("/tmp"),
                PathBuf::from("/private/tmp"),
            ]
            .into_iter()
            .flat_map(|path| [dunce::canonicalize(&path).ok(), Some(path)])
            .flatten()
            .collect(),
        }
    }
}

/// Whether opening `path` could ask the person for permission, or reaches outside the
/// places a scan may look. Decided from the path alone.
fn protected(path: &Path, home: &Path) -> bool {
    if !path.is_absolute() || path.starts_with("/Volumes") || path.starts_with("/System") {
        return true;
    }
    let Ok(inside) = path.strip_prefix(home) else {
        return false;
    };
    let Some(first) = inside.components().next() else {
        return false;
    };
    let first = first.as_os_str().to_string_lossy();
    PROTECTED
        .iter()
        .any(|folder| first.eq_ignore_ascii_case(folder))
}

/// Folders an editor's `storage.json` lists as open or recently open.
fn editor_folders(file: &Path) -> Vec<PathBuf> {
    let Ok(bytes) = super::history::read_bounded(file, 4 * 1024 * 1024) else {
        return Vec::new();
    };
    let Ok(state) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Vec::new();
    };
    let windows = &state["windowsState"];
    let uris = std::iter::once(&windows["lastActiveWindow"]["folder"])
        .chain(
            windows["openedWindows"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|window| &window["folder"]),
        )
        .filter_map(|uri| uri.as_str().map(str::to_owned))
        .chain(
            state["backupWorkspaces"]["folders"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|folder| folder["folderUri"].as_str().map(str::to_owned)),
        )
        .chain(
            state["profileAssociations"]["workspaces"]
                .as_object()
                .into_iter()
                .flat_map(|workspaces| workspaces.keys().cloned()),
        );
    uris.filter_map(|uri| file_path(&uri)).take(200).collect()
}

/// The local path a `file://` URI names; remote and other URIs are None.
fn file_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let bytes = rest.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let path = String::from_utf8(decoded).ok()?;
    // Windows URIs are `file:///c%3A/Users/...`.
    let path = match path.strip_prefix('/') {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => path,
    };
    let path = PathBuf::from(path);
    path.is_absolute().then_some(path)
}

/// Repositories one or two levels below `root`, without following links or entering
/// hidden and dependency folders.
fn shallow_repositories(root: &Path, budget: &mut usize, found: &mut Vec<PathBuf>) {
    let mut queue = vec![(root.to_path_buf(), 0)];
    while let Some((folder, depth)) = queue.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let Some(left) = budget.checked_sub(1) else {
                return;
            };
            *budget = left;
            if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            let path = entry.path();
            if path.join(".git").exists() {
                found.push(path);
            } else if depth == 0 {
                queue.push((path, depth + 1));
            }
        }
    }
}

#[derive(Default)]
struct Seen {
    sessions: usize,
    last_session_ms: u64,
    sources: BTreeSet<&'static str>,
    /// When an editor or the folder scan last saw it, for ordering before Git is read.
    touched_ms: u64,
}

struct Metadata {
    has_commits: bool,
    last_commit_ms: Option<u64>,
    remote_host: Option<String>,
}

/// The current commit's time and the default remote's host, read from Git metadata.
fn metadata(checkout: &Path) -> Metadata {
    let Ok(repo) = gix::open_opts(
        checkout,
        gix::open::Options::isolated().bail_if_untrusted(true),
    ) else {
        return Metadata {
            has_commits: false,
            last_commit_ms: None,
            remote_host: None,
        };
    };
    let last_commit_ms = repo
        .head_commit()
        .ok()
        .and_then(|commit| commit.time().ok())
        .map(|time| u64::try_from(time.seconds).unwrap_or(0) * 1000);
    let remote_host = repo
        .find_default_remote(gix::remote::Direction::Fetch)
        .and_then(Result::ok)
        .and_then(|remote| {
            remote
                .url(gix::remote::Direction::Fetch)
                .and_then(|url| url.host().map(str::to_owned))
        });
    Metadata {
        has_commits: last_commit_ms.is_some(),
        last_commit_ms,
        remote_host,
    }
}

fn timestamp(ms: u64) -> String {
    chrono::DateTime::<chrono::Utc>::from(UNIX_EPOCH + Duration::from_millis(ms)).to_rfc3339()
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_millis() as u64)
}

/// How strongly a repository suggests itself: agent conversations count most, then how
/// recently anything happened in it.
fn score(sessions: usize, last_activity_ms: u64, now_ms: u64) -> u64 {
    let days = now_ms.saturating_sub(last_activity_ms) / DAY_MS;
    sessions.min(50) as u64 * 10 + 90u64.saturating_sub(days)
}

/// Finds repositories from `inputs`, stopping at `deadline`.
pub fn discover(inputs: &Inputs, deadline: Instant) -> DiscoveryScan {
    let home = &inputs.home;
    let mut truncated = false;
    let mut checkouts: HashMap<PathBuf, Option<PathBuf>> = HashMap::new();
    let mut checkout = |path: &Path| -> Option<PathBuf> {
        if protected(path, home) {
            return None;
        }
        checkouts
            .entry(path.to_path_buf())
            .or_insert_with(|| {
                let main = super::external_sessions::main_checkout(path)?;
                (!protected(&main, home)
                    && !inputs
                        .temporary
                        .iter()
                        .any(|folder| main.starts_with(folder)))
                .then_some(main)
            })
            .clone()
    };
    let mut seen: HashMap<PathBuf, Seen> = HashMap::new();

    let mut sessions = inputs.sessions.clone();
    sessions.sort_by(|left, right| right.1.cmp(&left.1));
    for (cwd, modified) in &sessions {
        if Instant::now() >= deadline {
            truncated = true;
            break;
        }
        let Some(main) = checkout(Path::new(cwd)) else {
            continue;
        };
        let entry = seen.entry(main).or_default();
        entry.sessions += 1;
        entry.last_session_ms = entry.last_session_ms.max(*modified);
        entry.touched_ms = entry.touched_ms.max(*modified);
        entry.sources.insert("sessions");
    }

    for file in &inputs.editor_files {
        for folder in editor_folders(file) {
            if Instant::now() >= deadline {
                truncated = true;
                break;
            }
            if let Some(main) = checkout(&folder) {
                let entry = seen.entry(main).or_default();
                entry.sources.insert("editor");
            }
        }
    }

    let mut budget = ENTRIES;
    let mut roots: Vec<PathBuf> = Vec::new();
    for root in &inputs.code_folders {
        if protected(root, home) || !root.is_dir() {
            continue;
        }
        // `~/Code` and `~/code` are one folder on a case-insensitive disk.
        let Ok(resolved) = dunce::canonicalize(root) else {
            continue;
        };
        if roots.contains(&resolved) {
            continue;
        }
        roots.push(resolved.clone());
        let mut found = Vec::new();
        shallow_repositories(&resolved, &mut budget, &mut found);
        for repository in found {
            if Instant::now() >= deadline {
                truncated = true;
                break;
            }
            if let Some(main) = checkout(&repository) {
                let touched = modified_ms(&main.join(".git"));
                let entry = seen.entry(main).or_default();
                entry.touched_ms = entry.touched_ms.max(touched);
                entry.sources.insert("folders");
            }
        }
    }
    truncated |= budget == 0;

    let projects: Vec<PathBuf> = inputs
        .projects
        .iter()
        .flat_map(|project| {
            [
                Some(project.clone()),
                dunce::canonicalize(project).ok(),
                checkout(project),
            ]
        })
        .flatten()
        .collect();
    let mut found: Vec<(PathBuf, Seen)> = seen
        .into_iter()
        .filter(|(path, _)| !projects.iter().any(|project| project == path))
        .collect();
    found.sort_by(|left, right| {
        (right.1.sessions, right.1.touched_ms).cmp(&(left.1.sessions, left.1.touched_ms))
    });
    if found.len() > INSPECTED {
        truncated = true;
        found.truncate(INSPECTED);
    }

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64);
    let mut candidates: Vec<(u64, Candidate)> = Vec::new();
    for (path, seen) in found {
        if Instant::now() >= deadline {
            truncated = true;
            break;
        }
        let git = metadata(&path);
        let last_activity = seen.last_session_ms.max(git.last_commit_ms.unwrap_or(0));
        candidates.push((
            score(seen.sessions, last_activity, now_ms),
            Candidate {
                name: path
                    .file_name()
                    .map_or_else(|| path.to_string_lossy(), |name| name.to_string_lossy())
                    .into_owned(),
                path: path.to_string_lossy().into_owned(),
                has_commits: git.has_commits,
                last_commit_at: git.last_commit_ms.map(timestamp),
                remote_host: git.remote_host,
                sessions: seen.sessions,
                last_session_at: (seen.last_session_ms > 0)
                    .then(|| timestamp(seen.last_session_ms)),
                sources: seen.sources.into_iter().collect(),
                recommended: false,
            },
        ));
    }
    candidates.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.name.cmp(&right.1.name))
    });
    if candidates.len() > CANDIDATES {
        truncated = true;
        candidates.truncate(CANDIDATES);
    }
    let recent = |candidate: &Candidate| {
        candidate.has_commits
            && (candidate.sessions > 0
                || candidate.last_commit_at.as_deref().is_some_and(|at| {
                    chrono::DateTime::parse_from_rfc3339(at).is_ok_and(|at| {
                        now_ms.saturating_sub(at.timestamp_millis().max(0) as u64) <= 30 * DAY_MS
                    })
                }))
    };
    let mut recommended = 0;
    for (_, candidate) in &mut candidates {
        if recommended < RECOMMENDED && recent(candidate) {
            candidate.recommended = true;
            recommended += 1;
        }
    }
    DiscoveryScan {
        candidates: candidates
            .into_iter()
            .map(|(_, candidate)| candidate)
            .collect(),
        truncated,
    }
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::project_discovery::project_discovery_scan,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// Repositories on this computer that are not projects yet, best first.
#[tauri::command]
pub async fn project_discovery_scan(
    sessions: State<'_, super::external_sessions::ExternalSessions>,
    runtime: State<'_, super::tasks::TaskRuntime>,
) -> Result<DiscoveryScan, String> {
    let sessions = sessions.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + BUDGET;
        let home = super::platform::home_dir()
            .filter(|home| home.is_absolute())
            .ok_or("Jackalope cannot find your home folder.")?;
        let mut inputs = Inputs::for_home(home);
        inputs.sessions = sessions.session_folders();
        inputs.projects = super::project_registry::list(&runtime)
            .into_iter()
            .map(|project| PathBuf::from(project.path))
            .collect();
        Ok(discover(&inputs, deadline))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
