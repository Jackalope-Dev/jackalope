//! What this computer remembers about synced skills, the decision for each one
//! when local and account copies differ, and the only place synced content is
//! written to disk. Writes never touch a file Git tracks.

use super::detect::{
    content_hash, valid_file_path, Location, SkillFile, MAX_CHARACTERS, MAX_FILES,
};
use super::*;
use crate::commands::repo::{self, Policy};

/// One skill as the account stores it: where it belongs and its text files.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncedSkill {
    pub location: Location,
    pub description: String,
    pub files: Vec<SkillFile>,
    pub hash: String,
}

impl SyncedSkill {
    pub fn validate(&self) -> bool {
        let mut paths = HashSet::new();
        self.location.valid()
            && self.description.encode_utf16().count() <= 1024
            && (1..=MAX_FILES).contains(&self.files.len())
            && self
                .files
                .iter()
                .all(|file| valid_file_path(&file.path) && paths.insert(file.path.as_str()))
            && paths.contains("SKILL.md")
            && self
                .files
                .iter()
                .map(|file| file.content.encode_utf16().count())
                .sum::<usize>()
                <= MAX_CHARACTERS
            && self.hash == content_hash(&self.files)
    }
}

/// A skill change from the account.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Remote {
    pub id: String,
    pub revision: u64,
    pub updated_at: u64,
    pub deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<SyncedSkill>,
}

impl Remote {
    pub fn validate(&self) -> bool {
        uuid::Uuid::parse_str(&self.id).is_ok()
            && self.revision > 0
            && self.deleted == self.skill.is_none()
            && self.skill.as_ref().is_none_or(SyncedSkill::validate)
    }
}

/// The person's answer to a conflict.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Keep {
    /// Upload this computer's copy over the account's.
    Local,
    /// Replace this computer's copy with the account's.
    Account,
}

/// A skill this computer syncs with the account.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub location: Location,
    /// The account revision last exchanged; 0 until the first upload.
    pub revision: u64,
    /// The content hash at that exchange.
    #[serde(default)]
    pub hash: Option<String>,
    /// A newer account copy not yet written here.
    #[serde(default)]
    pub incoming: Option<Remote>,
    #[serde(default)]
    pub resolve: Option<Keep>,
    /// Why the last write or upload of this skill failed.
    #[serde(default)]
    pub error: Option<String>,
}

impl Entry {
    pub fn new(location: Location) -> Self {
        Self {
            location,
            revision: 0,
            hash: None,
            incoming: None,
            resolve: None,
            error: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceView {
    pub id: String,
    pub name: Option<String>,
    pub platform: Option<String>,
    pub here: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Holding {
    pub skill: String,
    pub device: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountState {
    pub epoch: u64,
    pub cursor: u64,
    pub last_synced_at: Option<String>,
    /// Synced skills by account id.
    pub skills: BTreeMap<String, Entry>,
    /// The account's devices and what each held at the last sync.
    pub devices: Vec<DeviceView>,
    pub holdings: Vec<Holding>,
}

impl AccountState {
    pub fn entry_at(&self, location: &Location) -> Option<(&String, &Entry)> {
        self.skills
            .iter()
            .find(|(_, entry)| &entry.location == location)
    }
}

/// Kept in `task-runs-v1/skills/skill-sync.json`, per account (a hash of the
/// service and email).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SkillSyncState {
    /// The account this computer syncs skills with; off until chosen.
    pub enabled_for: Option<String>,
    pub accounts: BTreeMap<String, AccountState>,
}

pub fn state_path(runtime: &TaskRuntime) -> PathBuf {
    runtime
        .data_directory()
        .join("skills")
        .join("skill-sync.json")
}

pub fn load(path: &Path) -> SkillSyncState {
    crate::commands::history::read_bounded(path, 16_000_000)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, state: &SkillSyncState) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("Missing skills directory")?)
        .map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(state).map_err(|error| error.to_string())?;
    crate::commands::history::write_atomic(path, &bytes)
}

/// What a sync does with one synced skill.
#[derive(Debug, PartialEq, Eq)]
pub enum Plan {
    Nothing,
    /// The account copy already matches this computer's; record it.
    Adopt,
    /// Write the account copy here.
    Apply,
    /// Both changed since the last exchange; wait for the person's choice.
    Conflict,
    /// Upload this computer's copy on top of `base`.
    Push {
        base: u64,
    },
    /// The account stopped syncing it; keep the files and forget the entry.
    Forget,
}

/// `present`: a copy exists here; `local`: its hash when it can sync.
pub fn plan(entry: &Entry, present: bool, local: Option<&str>) -> Plan {
    match &entry.incoming {
        Some(remote) if remote.deleted => Plan::Forget,
        Some(remote) => {
            let Some(skill) = &remote.skill else {
                return Plan::Nothing;
            };
            match (present, local) {
                (false, _) => Plan::Apply,
                (true, Some(hash)) if hash == skill.hash => Plan::Adopt,
                (true, Some(hash)) if Some(hash) == entry.hash.as_deref() => Plan::Apply,
                (true, _) if entry.resolve == Some(Keep::Account) => Plan::Apply,
                (true, Some(_)) if entry.resolve == Some(Keep::Local) => Plan::Push {
                    base: remote.revision,
                },
                _ => Plan::Conflict,
            }
        }
        None => match local {
            Some(hash) if Some(hash) != entry.hash.as_deref() => Plan::Push {
                base: entry.revision,
            },
            _ => Plan::Nothing,
        },
    }
}

/// A skill's sync state as the Skills page shows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Only on this computer.
    Local,
    /// Cannot sync; the card says why.
    Blocked,
    Synced,
    /// Edited here; uploads on the next sync.
    Changed,
    /// A newer account copy writes here on the next sync.
    Update,
    Conflict,
    /// Synced from another device and not on this computer.
    Elsewhere,
}

/// `present`/`local` as for [`plan`]; `here`: the skill has a folder on this computer.
pub fn status(entry: &Entry, here: bool, present: bool, local: Option<&str>) -> Status {
    if !here || (!present && entry.incoming.is_none()) {
        return Status::Elsewhere;
    }
    match plan(entry, present, local) {
        Plan::Conflict => Status::Conflict,
        Plan::Apply => Status::Update,
        Plan::Push { .. } => Status::Changed,
        Plan::Forget => Status::Local,
        Plan::Adopt => Status::Synced,
        Plan::Nothing if present && local.is_none() => Status::Blocked,
        Plan::Nothing => Status::Synced,
    }
}

/// The nearest folder at or above `path` that exists.
fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|folder| folder.is_dir())
        .map(Path::to_path_buf)
}

/// Refuses when Git tracks any of `files` (relative to `folder`), so synced
/// content never lands in a committed file.
pub fn refuse_tracked(folder: &Path, files: &[String]) -> Result<(), String> {
    let Some(found) = existing_ancestor(folder) else {
        return Ok(());
    };
    let below = folder
        .strip_prefix(&found)
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let anchor = dunce::canonicalize(&found).unwrap_or(found);
    let mut args = vec![
        "ls-files".to_string(),
        "-z".into(),
        "--cached".into(),
        "--".into(),
    ];
    for file in files {
        args.push(below.join(file).to_string_lossy().replace('\\', "/"));
    }
    if files.is_empty() {
        let below = below.to_string_lossy().replace('\\', "/");
        args.push(if below.is_empty() { ".".into() } else { below });
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match repo::git_exact(&anchor, &args, Policy::Inspection) {
        Ok(text) if text.split('\0').any(|name| !name.is_empty()) => Err(format!(
            "{} is tracked in a Git repository, so Jackalope will not write synced changes into it. Stop syncing this skill or remove it from the repository.",
            folder.display()
        )),
        _ => Ok(()),
    }
}

/// Writes the account copy into `folder`: every file it holds, removing files
/// the account copy no longer has. Refused when any of them is tracked.
pub fn write_skill(folder: &Path, skill: &SyncedSkill) -> Result<(), String> {
    if !skill.validate() {
        return Err("The account copy of this skill is not valid.".into());
    }
    let existing = if folder.is_dir() {
        super::detect::read_skill(folder).paths
    } else {
        vec![]
    };
    let mut touched: Vec<String> = skill.files.iter().map(|file| file.path.clone()).collect();
    touched.extend(
        existing
            .iter()
            .filter(|path| !touched.contains(path))
            .cloned()
            .collect::<Vec<_>>(),
    );
    refuse_tracked(folder, &touched)?;
    for file in &skill.files {
        let target = folder.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        if std::fs::symlink_metadata(&target).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(format!(
                "{} is a link; Jackalope does not write through links.",
                target.display()
            ));
        }
        if std::fs::read(&target).is_ok_and(|bytes| bytes == file.content.as_bytes()) {
            continue;
        }
        crate::commands::history::write_atomic(&target, file.content.as_bytes())?;
    }
    for path in existing {
        if !skill.files.iter().any(|file| file.path == path) && valid_file_path(&path) {
            let _ = std::fs::remove_file(folder.join(&path));
        }
    }
    Ok(())
}

/// Adds the skill folder to the repository's own `info/exclude`, which Git
/// never commits, so a skill written into a project stays out of commits on
/// this computer. Returns whether a line was added.
pub fn keep_out_of_commits(folder: &Path) -> Result<bool, String> {
    let Ok(top) = repo::git(
        folder,
        &["rev-parse", "--show-toplevel"],
        Policy::Inspection,
    ) else {
        return Ok(false);
    };
    let top = dunce::canonicalize(PathBuf::from(top.trim())).map_err(|error| error.to_string())?;
    let real = dunce::canonicalize(folder).map_err(|error| error.to_string())?;
    let Ok(relative) = real.strip_prefix(&top) else {
        return Ok(false);
    };
    let relative = relative.to_string_lossy().replace('\\', "/");
    if relative.is_empty()
        || repo::succeeds(
            &top,
            &["check-ignore", "-q", "--", &format!("{relative}/SKILL.md")],
            Policy::Inspection,
        )
    {
        return Ok(false);
    }
    let exclude = repo::git(
        &top,
        &["rev-parse", "--git-path", "info/exclude"],
        Policy::Inspection,
    )?;
    let exclude = PathBuf::from(exclude.trim());
    let exclude = if exclude.is_absolute() {
        exclude
    } else {
        top.join(exclude)
    };
    if let Some(parent) = exclude.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut text = std::fs::read_to_string(&exclude).unwrap_or_default();
    let line = format!("/{relative}/");
    if text.lines().any(|existing| existing.trim() == line) {
        return Ok(false);
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&line);
    text.push('\n');
    crate::commands::history::write_atomic(&exclude, text.as_bytes())?;
    Ok(true)
}
