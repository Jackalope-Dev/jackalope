//! Agent skills on this computer and the person's choice to sync some of them
//! through their account (see `account/skill_sync.rs`). Commands here work on
//! local files only and find a skill by its id through fresh detection; the
//! webview never supplies a path.

use super::tasks::TaskRuntime;
use detect::{Blocked, LocalSkill, ProjectRef, Root, Scope, SkillFile, Tracking};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use store::{AccountState, Status};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub mod detect;
pub mod store;
#[cfg(test)]
mod tests;

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::skills::skills_read,
            commands::skills::skills_create,
            commands::skills::skills_import,
            commands::skills::skills_export,
            commands::skills::skills_open,
            commands::skills::skills_keep_out,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HolderView {
    pub device: String,
    /// Holds the newest revision the account has.
    pub current: bool,
}

/// One skill on the Skills page.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillCard {
    /// The local copy's id, or the account id for a skill not on this computer.
    pub id: String,
    pub synced_id: Option<String>,
    pub name: String,
    pub description: String,
    pub scope: Scope,
    pub root: Root,
    pub project: Option<ProjectView>,
    /// The folder, with the home folder shortened to `~`.
    pub path: Option<String>,
    pub tracking: Option<Tracking>,
    pub status: Status,
    pub blocked: Option<Blocked>,
    pub files: usize,
    pub characters: usize,
    pub modified_at: Option<String>,
    pub error: Option<String>,
    pub holders: Vec<HolderView>,
}

/// Root-commit keys by canonical folder. A repository's root commits never
/// change, so a key is worked out once per run; folders without a commit are
/// asked again next time.
fn cached_key(path: &Path) -> Option<String> {
    static KEYS: std::sync::OnceLock<std::sync::Mutex<BTreeMap<PathBuf, String>>> =
        std::sync::OnceLock::new();
    let keys = KEYS.get_or_init(Default::default);
    if let Some(key) = keys.lock().ok()?.get(path) {
        return Some(key.clone());
    }
    let key = super::knowledge::learning::sync::project_key(&path.to_string_lossy())?;
    if let Ok(mut keys) = keys.lock() {
        keys.insert(path.to_path_buf(), key.clone());
    }
    Some(key)
}

/// Registered projects with their canonical folder and root-commit key.
pub fn projects(runtime: &TaskRuntime) -> Vec<ProjectRef> {
    super::project_registry::list(runtime)
        .into_iter()
        .filter_map(|project| {
            let path = dunce::canonicalize(&project.path).ok()?;
            let key = cached_key(&path);
            Some(ProjectRef {
                id: project.id,
                name: project.name,
                path,
                key,
            })
        })
        .collect()
}

pub fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    match super::platform::home_dir() {
        Some(home) if path.starts_with(&home) => {
            let rest = path.strip_prefix(&home).unwrap_or(path);
            format!("~/{}", rest.to_string_lossy().replace('\\', "/"))
        }
        _ => text,
    }
}

fn holders(account: &AccountState, id: &str, latest: u64) -> Vec<HolderView> {
    let mut holders: Vec<HolderView> = account
        .holdings
        .iter()
        .filter(|holding| holding.skill == id)
        .filter(|holding| {
            account
                .devices
                .iter()
                .any(|device| device.id == holding.device)
        })
        .map(|holding| HolderView {
            device: holding.device.clone(),
            current: holding.revision >= latest,
        })
        .collect();
    holders.sort_by(|a, b| a.device.cmp(&b.device));
    holders
}

/// The page's cards: every local skill with its sync state, then synced skills
/// this computer does not have.
pub fn cards(
    skills: &[LocalSkill],
    account: Option<&AccountState>,
    projects: &[ProjectRef],
) -> Vec<SkillCard> {
    let mut seen = HashSet::new();
    let mut cards: Vec<SkillCard> = skills
        .iter()
        .map(|skill| {
            let hash = skill.hash();
            let synced = account
                .zip(skill.location())
                .and_then(|(account, location)| {
                    account
                        .entry_at(&location)
                        .map(|(id, entry)| (account, id, entry))
                });
            let (status, synced_id, error, holders) = match synced {
                Some((account, id, entry)) => {
                    seen.insert(id.clone());
                    let latest = entry
                        .incoming
                        .as_ref()
                        .map_or(entry.revision, |remote| remote.revision.max(entry.revision));
                    (
                        store::status(entry, true, true, hash.as_deref()),
                        Some(id.clone()),
                        entry.error.clone(),
                        self::holders(account, id, latest),
                    )
                }
                None if skill.files.is_err() => (Status::Blocked, None, None, vec![]),
                None => (Status::Local, None, None, vec![]),
            };
            SkillCard {
                id: skill.key(),
                synced_id,
                name: skill.name.clone(),
                description: skill.description.clone(),
                scope: skill.scope,
                root: skill.root,
                project: skill.project.as_ref().map(|project| ProjectView {
                    id: project.id.clone(),
                    name: project.name.clone(),
                }),
                path: Some(display_path(&skill.folder)),
                tracking: Some(skill.tracking),
                status,
                blocked: skill.files.as_ref().err().copied(),
                files: skill.file_count,
                characters: skill.characters,
                modified_at: skill
                    .modified
                    .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()),
                error,
                holders,
            }
        })
        .collect();
    if let Some(account) = account {
        for (id, entry) in &account.skills {
            if seen.contains(id) {
                continue;
            }
            let here = detect::folder_for(&entry.location, projects).is_some();
            let latest = entry
                .incoming
                .as_ref()
                .map_or(entry.revision, |remote| remote.revision.max(entry.revision));
            let skill = entry
                .incoming
                .as_ref()
                .and_then(|remote| remote.skill.as_ref());
            cards.push(SkillCard {
                id: id.clone(),
                synced_id: Some(id.clone()),
                name: entry.location.name.clone(),
                description: skill
                    .map(|skill| skill.description.clone())
                    .unwrap_or_default(),
                scope: entry.location.scope,
                root: entry.location.root,
                project: projects
                    .iter()
                    .find(|project| project.key.is_some() && project.key == entry.location.project)
                    .map(|project| ProjectView {
                        id: project.id.clone(),
                        name: project.name.clone(),
                    }),
                path: detect::folder_for(&entry.location, projects).map(|path| display_path(&path)),
                tracking: None,
                status: store::status(entry, here, false, None),
                blocked: None,
                files: skill.map_or(0, |skill| skill.files.len()),
                characters: skill.map_or(0, |skill| {
                    skill
                        .files
                        .iter()
                        .map(|file| file.content.encode_utf16().count())
                        .sum()
                }),
                modified_at: None,
                error: entry.error.clone(),
                holders: holders(account, id, latest),
            });
        }
    }
    cards
}

async fn detect_all(runtime: &TaskRuntime) -> Result<(Vec<LocalSkill>, Vec<ProjectRef>), String> {
    let projects = projects(runtime);
    tauri::async_runtime::spawn_blocking(move || (detect::detect(&projects), projects))
        .await
        .map_err(|error| error.to_string())
}

async fn find(runtime: &TaskRuntime, id: &str) -> Result<LocalSkill, String> {
    let (skills, _) = detect_all(runtime).await?;
    skills
        .into_iter()
        .find(|skill| skill.key() == id)
        .ok_or_else(|| "That skill is no longer on this computer.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContent {
    pub name: String,
    pub files: Vec<SkillFile>,
    /// The account's newer copy when it differs from this computer's.
    pub account: Option<Vec<SkillFile>>,
}

/// Files of a skill, up to the detection limits, read as text.
fn readable_files(skill: &LocalSkill) -> Vec<SkillFile> {
    if let Ok(files) = &skill.files {
        return files.clone();
    }
    detect::read_skill(&skill.folder)
        .paths
        .into_iter()
        .take(detect::MAX_FILES)
        .filter_map(|path| {
            let bytes = super::history::read_bounded(&skill.folder.join(&path), 96_000).ok()?;
            Some(SkillFile {
                path,
                content: String::from_utf8_lossy(&bytes).into_owned(),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn skills_read(
    runtime: State<'_, TaskRuntime>,
    id: String,
) -> Result<SkillContent, String> {
    let state = store::load(&store::state_path(&runtime));
    let account_copy = |location: Option<&detect::Location>, synced: Option<&str>| {
        state.accounts.values().find_map(|account| {
            account
                .skills
                .iter()
                .find(|(key, entry)| {
                    synced == Some(key.as_str()) || location == Some(&entry.location)
                })
                .and_then(|(_, entry)| entry.incoming.as_ref()?.skill.as_ref())
                .map(|skill| skill.files.clone())
        })
    };
    match find(&runtime, &id).await {
        Ok(skill) => Ok(SkillContent {
            name: skill.name.clone(),
            files: readable_files(&skill),
            account: account_copy(skill.location().as_ref(), None),
        }),
        Err(error) => {
            let files = account_copy(None, Some(&id)).ok_or(error)?;
            let name = state
                .accounts
                .values()
                .find_map(|account| account.skills.get(&id))
                .map(|entry| entry.location.name.clone())
                .unwrap_or_default();
            Ok(SkillContent {
                name,
                files: vec![],
                account: Some(files),
            })
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub scope: Scope,
    pub root: Root,
    pub project_id: Option<String>,
}

/// The skills folder a new skill goes into, and the project root for a project skill.
fn target_dir(runtime: &TaskRuntime, target: &Target) -> Result<(PathBuf, bool), String> {
    match target.scope {
        Scope::Personal => detect::personal_dirs()
            .into_iter()
            .find(|(root, _)| *root == target.root)
            .map(|(_, dir)| (dir, false))
            .ok_or_else(|| "That agent's personal skills folder is not available.".into()),
        Scope::Project => {
            let id = target.project_id.as_deref().ok_or("Choose a project.")?;
            let project = super::project_registry::record(runtime, id)
                .ok_or(super::project_registry::NOT_REGISTERED)?;
            detect::project_dirs(Path::new(&project.path))
                .into_iter()
                .find(|(root, _)| *root == target.root)
                .map(|(_, dir)| (dir, true))
                .ok_or_else(|| "Project skills go in .claude/skills or .agents/skills.".into())
        }
    }
}

fn template(name: &str, description: &str) -> String {
    let title = name
        .split(['-', '_', '.'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "---\nname: {name}\ndescription: {description}\n---\n\n# {title}\n\n## When to use\n\nDescribe the requests this skill helps with.\n\n## Steps\n\n1. \n"
    )
}

/// Creates `<folder>/SKILL.md`, refusing an existing folder or tracked path.
fn create_at(folder: &Path, text: &str, project: bool, keep_out: bool) -> Result<(), String> {
    if folder.exists() {
        return Err(format!("{} already exists.", display_path(folder)));
    }
    store::refuse_tracked(folder, &["SKILL.md".into()])?;
    std::fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    super::history::write_atomic(&folder.join("SKILL.md"), text.as_bytes())?;
    if project && keep_out {
        store::keep_out_of_commits(folder)?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewSkill {
    #[serde(flatten)]
    pub target: Target,
    pub name: String,
    pub description: String,
    pub keep_out_of_commits: bool,
}

fn created_key(target: &Target, name: &str) -> String {
    detect::local_key(
        target.scope,
        target.root,
        target
            .project_id
            .as_deref()
            .filter(|_| target.scope == Scope::Project),
        name,
    )
}

#[tauri::command]
pub async fn skills_create(
    runtime: State<'_, TaskRuntime>,
    skill: NewSkill,
) -> Result<String, String> {
    if !detect::valid_name(&skill.name) {
        return Err("Use lowercase letters, numbers and dashes for the name.".into());
    }
    let description = skill.description.trim();
    if description.is_empty()
        || description.chars().count() > 1024
        || description.contains(['\n', '\r'])
    {
        return Err("Describe when to use the skill in one line of up to 1,024 characters.".into());
    }
    if detect::credential(description) {
        return Err("The description looks like it holds a credential.".into());
    }
    let (dir, project) = target_dir(&runtime, &skill.target)?;
    create_at(
        &dir.join(&skill.name),
        &template(&skill.name, description),
        project,
        skill.keep_out_of_commits,
    )?;
    Ok(created_key(&skill.target, &skill.name))
}

/// A skill name from a file: its folder for a `SKILL.md`, otherwise its front
/// matter `name:` or the file name.
fn import_name(path: &Path, text: &str) -> Option<String> {
    let from_folder = (path.file_name()?.to_str()? == "SKILL.md")
        .then(|| path.parent()?.file_name()?.to_str().map(str::to_string))
        .flatten();
    let from_front = text
        .strip_prefix("---")
        .and_then(|rest| {
            rest.lines()
                .take_while(|line| line.trim_end() != "---")
                .find_map(|line| line.strip_prefix("name:"))
        })
        .map(|name| {
            name.trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .to_string()
        });
    let from_file = path.file_stem()?.to_str().map(str::to_string);
    [from_folder, from_front, from_file]
        .into_iter()
        .flatten()
        .map(|name| {
            name.to_lowercase()
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || "._-".contains(c) {
                        c
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
                .trim_matches('-')
                .to_string()
        })
        .find(|name| detect::valid_name(name))
}

#[tauri::command]
pub async fn skills_import(
    app: AppHandle,
    runtime: State<'_, TaskRuntime>,
    target: Target,
    keep_out_of_commits: bool,
) -> Result<Option<String>, String> {
    let (dir, project) = target_dir(&runtime, &target)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    let bytes = super::history::read_bounded(&path, 96_000)
        .map_err(|_| "Choose a Markdown file under 96 KB.".to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "Choose a text Markdown file.".to_string())?;
    let name = import_name(&path, &text).ok_or("Could not find a skill name in that file.")?;
    let text = if text.starts_with("---") {
        text
    } else {
        format!("---\nname: {name}\ndescription: Imported skill. Describe when to use it.\n---\n\n{text}")
    };
    create_at(&dir.join(&name), &text, project, keep_out_of_commits)?;
    Ok(Some(created_key(&target, &name)))
}

/// Copies a skill's files into a chosen folder to share it.
#[tauri::command]
pub async fn skills_export(
    app: AppHandle,
    runtime: State<'_, TaskRuntime>,
    id: String,
) -> Result<Option<String>, String> {
    let skill = find(&runtime, &id).await?;
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|error| error.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let destination = picked
        .into_path()
        .map_err(|error| error.to_string())?
        .join(&skill.name);
    if destination.exists() {
        return Err(format!("{} already exists.", display_path(&destination)));
    }
    for file in readable_files(&skill) {
        let target = destination.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::copy(skill.folder.join(&file.path), &target).map_err(|error| error.to_string())?;
    }
    Ok(Some(display_path(&destination)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenTarget {
    File,
    Folder,
}

#[tauri::command]
pub async fn skills_open(
    app: AppHandle,
    runtime: State<'_, TaskRuntime>,
    id: String,
    target: OpenTarget,
) -> Result<(), String> {
    let skill = find(&runtime, &id).await?;
    let file = skill.folder.join("SKILL.md");
    match target {
        OpenTarget::File => app
            .opener()
            .open_path(file.to_string_lossy(), None::<&str>)
            .map_err(|error| format!("Could not open SKILL.md: {error}")),
        OpenTarget::Folder => app
            .opener()
            .reveal_item_in_dir(&file)
            .map_err(|error| format!("Could not show the skill folder: {error}")),
    }
}

/// Keeps an untracked project skill out of commits on this computer.
#[tauri::command]
pub async fn skills_keep_out(runtime: State<'_, TaskRuntime>, id: String) -> Result<bool, String> {
    let skill = find(&runtime, &id).await?;
    if skill.scope != Scope::Project {
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || store::keep_out_of_commits(&skill.folder))
        .await
        .map_err(|error| error.to_string())?
}

/// Local skills, the projects they can belong to and the cards for the page.
pub async fn page(
    runtime: &TaskRuntime,
    account: Option<&AccountState>,
) -> Result<(Vec<LocalSkill>, Vec<ProjectRef>, Vec<SkillCard>), String> {
    let (skills, projects) = detect_all(runtime).await?;
    let cards = cards(&skills, account, &projects);
    Ok((skills, projects, cards))
}
