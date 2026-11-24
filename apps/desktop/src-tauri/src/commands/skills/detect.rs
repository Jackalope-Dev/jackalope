//! Finds the agent skills on this computer: personal skill folders and the
//! project skill folders of registered projects. A skill is a folder holding a
//! `SKILL.md`. Reading is bounded (folder count, depth, files and characters)
//! and never follows symbolic links inside a skill; contents stay on the
//! computer unless the person chooses to sync that skill.

use super::*;
use crate::commands::repo::{self, Policy};

/// Text a synced skill may hold across its files, counted as the service
/// counts characters (UTF-16 code units).
pub const MAX_CHARACTERS: usize = 24_000;
pub const MAX_FILES: usize = 20;
/// The service accepts requests up to 32 KB; a skill's files, as sent, stay
/// below this so the rest of the request fits.
const MAX_WIRE_BYTES: usize = 30_000;
const MAX_SKILLS_PER_FOLDER: usize = 200;
/// Path parts below the skill folder, matching the service's file names.
const MAX_DEPTH: usize = 3;
/// Bytes read from one file before it counts as too large.
const MAX_FILE_BYTES: u64 = 96_000;
/// Folder entries looked at in one skill before giving up.
const MAX_VISITED: usize = 2_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Root {
    /// Claude Code: `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills`) and `<project>/.claude/skills`.
    Claude,
    /// Codex: `$CODEX_HOME/skills`, by default `~/.codex/skills`; `.system` holds Codex's own.
    Codex,
    /// The shared `.agents/skills` folders Codex reads, personal and per project.
    Agents,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    Personal,
    Project,
}

/// Where a skill belongs, the same on every computer: personal, or a project
/// matched by its root-commit key. Never a folder path.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Location {
    pub scope: Scope,
    pub root: Root,
    pub project: Option<String>,
    pub name: String,
}

impl Location {
    pub fn valid(&self) -> bool {
        valid_name(&self.name)
            && match (self.scope, &self.project) {
                (Scope::Personal, None) => true,
                (Scope::Project, Some(key)) => hex64(key) && self.root != Root::Codex,
                _ => false,
            }
    }
}

/// How a skill's files relate to the Git repository around them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tracking {
    /// Not inside a Git working tree.
    Outside,
    /// In a repository, not committed and not ignored: a commit could pick it up.
    Untracked,
    /// In a repository and ignored.
    Ignored,
    /// Committed; the repository already carries it.
    Tracked,
    /// Some files committed and some not.
    Mixed,
}

/// Why a skill cannot sync.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Blocked {
    Repository,
    PartlyTracked,
    TooLarge,
    TooManyFiles,
    Binary,
    FileName,
    Name,
    Sensitive,
    NoCommit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillFile {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug)]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    /// Root-commit key; `None` for a folder without a commit.
    pub key: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LocalSkill {
    pub scope: Scope,
    pub root: Root,
    pub name: String,
    pub project: Option<ProjectRef>,
    pub folder: PathBuf,
    pub description: String,
    pub tracking: Tracking,
    /// The files when the skill can sync, or why it cannot.
    pub files: Result<Vec<SkillFile>, Blocked>,
    pub file_count: usize,
    pub characters: usize,
    pub modified: Option<std::time::SystemTime>,
}

impl LocalSkill {
    /// The account-wide location, or `None` for a project without a commit.
    pub fn location(&self) -> Option<Location> {
        let project = match (&self.scope, &self.project) {
            (Scope::Personal, _) => None,
            (Scope::Project, Some(project)) => Some(project.key.clone()?),
            (Scope::Project, None) => return None,
        };
        Some(Location {
            scope: self.scope,
            root: self.root,
            project,
            name: self.name.clone(),
        })
    }

    /// A stable id for this computer's copy, independent of sync.
    pub fn key(&self) -> String {
        local_key(
            self.scope,
            self.root,
            self.project.as_ref().map(|project| project.id.as_str()),
            &self.name,
        )
    }

    pub fn hash(&self) -> Option<String> {
        self.files.as_ref().ok().map(|files| content_hash(files))
    }
}

pub fn local_key(scope: Scope, root: Root, project: Option<&str>, name: &str) -> String {
    let digest = Sha256::digest(format!(
        "skill\0{scope:?}\0{root:?}\0{}\0{name}",
        project.unwrap_or("")
    ));
    digest
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn hex64(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Skill folder names agents accept: lowercase letters, digits, dots, dashes
/// and underscores.
pub fn valid_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    (1..=64).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(byte))
}

fn valid_part(part: &str) -> bool {
    let bytes = part.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 100
        && (bytes[0].is_ascii_alphanumeric() || bytes[0] == b'_')
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(byte))
}

/// A relative file name the service accepts: up to three parts, none starting
/// with a dot, so it can never leave the skill folder.
pub fn valid_file_path(path: &str) -> bool {
    path.len() <= 120 && {
        let parts: Vec<&str> = path.split('/').collect();
        parts.len() <= MAX_DEPTH && parts.iter().all(|part| valid_part(part))
    }
}

/// The hash a skill's content is compared by: every file's name and text in
/// name order.
pub fn content_hash(files: &[SkillFile]) -> String {
    let mut sorted: Vec<&SkillFile> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    let mut hasher = Sha256::new();
    for file in sorted {
        hasher.update(file.path.as_bytes());
        hasher.update([0]);
        hasher.update(file.content.as_bytes());
        hasher.update([0]);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The personal skill folders agents read, by root, without duplicates.
pub fn personal_dirs() -> Vec<(Root, PathBuf)> {
    let home = crate::commands::platform::home_dir();
    let configured = |key: &str, fallback: &str| -> Option<PathBuf> {
        std::env::var_os(key)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|home| home.join(fallback)))
    };
    let mut dirs: Vec<(Root, PathBuf)> = vec![];
    for (root, base) in [
        (Root::Claude, configured("CLAUDE_CONFIG_DIR", ".claude")),
        (Root::Codex, configured("CODEX_HOME", ".codex")),
        (Root::Agents, home.as_ref().map(|home| home.join(".agents"))),
    ] {
        if let Some(base) = base {
            let dir = base.join("skills");
            let same = |other: &PathBuf| {
                dunce::canonicalize(other)
                    .ok()
                    .is_some_and(|other| dunce::canonicalize(&dir).is_ok_and(|dir| dir == other))
            };
            if !dirs.iter().any(|(_, other)| other == &dir || same(other)) {
                dirs.push((root, dir));
            }
        }
    }
    dirs
}

/// The project skill folders agents read inside a project.
pub fn project_dirs(project: &Path) -> [(Root, PathBuf); 2] {
    [
        (Root::Claude, project.join(".claude").join("skills")),
        (Root::Agents, project.join(".agents").join("skills")),
    ]
}

/// The folder a location's skill lives in on this computer, if it can.
pub fn folder_for(location: &Location, projects: &[ProjectRef]) -> Option<PathBuf> {
    if !location.valid() {
        return None;
    }
    let base = match location.scope {
        Scope::Personal => {
            personal_dirs()
                .into_iter()
                .find(|(root, _)| *root == location.root)?
                .1
        }
        Scope::Project => {
            let project = projects
                .iter()
                .find(|project| project.key.as_deref() == location.project.as_deref())?;
            project_dirs(&project.path)
                .into_iter()
                .find(|(root, _)| *root == location.root)?
                .1
        }
    };
    Some(base.join(&location.name))
}

/// Every skill in the personal folders and the given projects' folders.
pub fn detect(projects: &[ProjectRef]) -> Vec<LocalSkill> {
    let mut skills = vec![];
    for (root, dir) in personal_dirs() {
        scan(&dir, Scope::Personal, root, None, &mut skills);
    }
    for project in projects {
        skills.extend(scan_project(project));
    }
    skills
}

/// The skills in one project's skill folders.
pub fn scan_project(project: &ProjectRef) -> Vec<LocalSkill> {
    let mut skills = vec![];
    for (root, dir) in project_dirs(&project.path) {
        scan(&dir, Scope::Project, root, Some(project), &mut skills);
    }
    skills
}

/// Files under `dir`, relative to it, that Git tracks and that it ignores;
/// `None` when `dir` is not inside a Git working tree.
pub fn git_status_sets(dir: &Path) -> Option<(HashSet<String>, HashSet<String>)> {
    let list = |args: &[&str]| -> Option<HashSet<String>> {
        let text = repo::git_exact(dir, args, Policy::Inspection).ok()?;
        Some(
            text.split('\0')
                .filter(|name| !name.is_empty())
                .map(|name| name.replace('\\', "/"))
                .collect(),
        )
    };
    let tracked = list(&["ls-files", "-z", "--cached", "--", "."])?;
    let ignored = list(&[
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--",
        ".",
    ])?;
    Some((tracked, ignored))
}

pub fn classify(
    files: &[String],
    prefix: &str,
    sets: Option<&(HashSet<String>, HashSet<String>)>,
) -> Tracking {
    let Some((tracked, ignored)) = sets else {
        return Tracking::Outside;
    };
    let name = |file: &String| {
        if prefix.is_empty() {
            file.clone()
        } else {
            format!("{prefix}/{file}")
        }
    };
    let committed = files
        .iter()
        .filter(|file| tracked.contains(&name(file)))
        .count();
    if committed == files.len() && committed > 0 {
        Tracking::Tracked
    } else if committed > 0 {
        Tracking::Mixed
    } else if !files.is_empty() && files.iter().all(|file| ignored.contains(&name(file))) {
        Tracking::Ignored
    } else {
        Tracking::Untracked
    }
}

fn scan(
    dir: &Path,
    scope: Scope,
    root: Root,
    project: Option<&ProjectRef>,
    out: &mut Vec<LocalSkill>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))
        .collect();
    names.sort();
    names.truncate(MAX_SKILLS_PER_FOLDER);
    let canonical_dir = dunce::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let mut sets: Option<Option<(HashSet<String>, HashSet<String>)>> = None;
    for name in names {
        let folder = dir.join(&name);
        // A skill folder may be a link to a folder kept elsewhere; its files may not.
        if !folder.join("SKILL.md").is_file() || managed_by_jackalope(&folder) {
            continue;
        }
        let read = read_skill(&folder);
        let real = dunce::canonicalize(&folder).unwrap_or_else(|_| folder.clone());
        let tracking = if let Ok(inner) = real.strip_prefix(&canonical_dir) {
            let sets = sets.get_or_insert_with(|| git_status_sets(&canonical_dir));
            classify(
                &read.paths,
                &inner.to_string_lossy().replace('\\', "/"),
                sets.as_ref(),
            )
        } else {
            classify(&read.paths, "", git_status_sets(&real).as_ref())
        };
        let mut files = read.files;
        if files.is_ok() {
            if !valid_name(&name) {
                files = Err(Blocked::Name);
            } else if scope == Scope::Project
                && project.is_some_and(|project| project.key.is_none())
            {
                files = Err(Blocked::NoCommit);
            }
        }
        files = match (tracking, files) {
            (Tracking::Tracked, _) => Err(Blocked::Repository),
            (Tracking::Mixed, _) => Err(Blocked::PartlyTracked),
            (_, files) => files,
        };
        out.push(LocalSkill {
            scope,
            root,
            name,
            project: project.cloned(),
            folder,
            description: read.description,
            tracking,
            files,
            file_count: read.paths.len(),
            characters: read.characters,
            modified: read.modified,
        });
    }
}

/// The lessons skill Jackalope writes for a project; lesson sync owns it.
fn managed_by_jackalope(folder: &Path) -> bool {
    folder
        .file_name()
        .is_some_and(|name| name == "jackalope-lessons")
        && crate::commands::history::read_bounded(&folder.join("SKILL.md"), 200_000).is_ok_and(
            |bytes| String::from_utf8_lossy(&bytes).contains("<!-- jackalope:lessons:managed -->"),
        )
}

pub struct Read {
    pub files: Result<Vec<SkillFile>, Blocked>,
    /// Every file found, relative to the skill folder, up to the limit.
    pub paths: Vec<String>,
    pub description: String,
    pub characters: usize,
    pub modified: Option<std::time::SystemTime>,
}

const SKIPPED: [&str; 3] = ["node_modules", "__pycache__", "target"];

/// Reads a skill folder within the limits; the first problem found decides why
/// it cannot sync, while the description and counts are still reported.
pub fn read_skill(folder: &Path) -> Read {
    let mut paths = vec![];
    let mut files = vec![];
    let mut blocked = None;
    let mut characters = 0;
    let mut modified: Option<std::time::SystemTime> = None;
    let mut stack = vec![(folder.to_path_buf(), String::new(), 0usize)];
    let mut visited = 0usize;
    while let Some((dir, prefix, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            visited += 1;
            if visited > MAX_VISITED {
                blocked.get_or_insert(Blocked::TooManyFiles);
                break;
            }
            let Ok(name) = entry.file_name().into_string() else {
                blocked.get_or_insert(Blocked::FileName);
                continue;
            };
            if name.starts_with('.') || SKIPPED.contains(&name.as_str()) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if kind.is_dir() {
                if depth + 1 < MAX_DEPTH {
                    stack.push((entry.path(), relative, depth + 1));
                } else {
                    blocked.get_or_insert(Blocked::FileName);
                }
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            if paths.len() >= MAX_FILES {
                blocked.get_or_insert(Blocked::TooManyFiles);
                continue;
            }
            if !valid_file_path(&relative) {
                blocked.get_or_insert(Blocked::FileName);
            }
            paths.push(relative.clone());
            if let Ok(time) = entry.metadata().and_then(|meta| meta.modified()) {
                modified = Some(modified.map_or(time, |current| current.max(time)));
            }
            let Ok(bytes) = crate::commands::history::read_bounded(&entry.path(), MAX_FILE_BYTES)
            else {
                blocked.get_or_insert(Blocked::TooLarge);
                continue;
            };
            match String::from_utf8(bytes) {
                Ok(text) => {
                    characters += text.encode_utf16().count();
                    if credential(&text) {
                        blocked.get_or_insert(Blocked::Sensitive);
                    }
                    files.push(SkillFile {
                        path: relative,
                        content: text,
                    });
                }
                Err(_) => {
                    blocked.get_or_insert(Blocked::Binary);
                }
            }
        }
    }
    paths.sort();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let description = files
        .iter()
        .find(|file| file.path == "SKILL.md")
        .map(|file| frontmatter_description(&file.content))
        .unwrap_or_default();
    if blocked.is_none() && characters > MAX_CHARACTERS {
        blocked = Some(Blocked::TooLarge);
    }
    if blocked.is_none()
        && (credential(&description)
            || serde_json::to_vec(&files).map_or(true, |bytes| bytes.len() > MAX_WIRE_BYTES))
    {
        blocked = Some(if credential(&description) {
            Blocked::Sensitive
        } else {
            Blocked::TooLarge
        });
    }
    Read {
        files: blocked.map_or(Ok(files), Err),
        paths,
        description,
        characters,
        modified,
    }
}

/// The `description:` from a SKILL.md front matter block, on one line and
/// within the service's 1,024 characters.
pub fn frontmatter_description(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return String::new();
    };
    for line in rest.lines() {
        let line = line.trim_end();
        if line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("description:") {
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
            return value
                .chars()
                .filter(|c| !c.is_control())
                .take(1024)
                .collect();
        }
    }
    String::new()
}

fn word_start(bytes: &[u8], index: usize) -> bool {
    index == 0 || !(bytes[index - 1].is_ascii_alphanumeric() || bytes[index - 1] == b'_')
}

fn run_of(bytes: &[u8], start: usize, allowed: impl Fn(u8) -> bool) -> usize {
    bytes[start..]
        .iter()
        .take_while(|byte| allowed(**byte))
        .count()
}

/// The credentials the service refuses, so a skill holding one stays local
/// instead of failing on upload: private keys, AWS access key ids and GitHub,
/// OpenAI-style and Slack tokens.
pub fn credential(text: &str) -> bool {
    for (index, _) in text.match_indices("-----BEGIN ") {
        let label: String = text[index + 11..]
            .chars()
            .take_while(|c| c.is_ascii_uppercase() || *c == ' ')
            .collect();
        if label.contains("PRIVATE KEY") {
            return true;
        }
    }
    let bytes = text.as_bytes();
    let word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    for index in 0..bytes.len() {
        if !word_start(bytes, index) {
            continue;
        }
        let rest = &bytes[index..];
        let after = |prefix: usize| index + prefix;
        if (rest.starts_with(b"AKIA") || rest.starts_with(b"ASIA"))
            && run_of(bytes, after(4), |b| {
                b.is_ascii_digit() || b.is_ascii_uppercase()
            }) == 16
            && !bytes.get(after(20)).copied().is_some_and(word)
        {
            return true;
        }
        if rest.len() > 4
            && rest.starts_with(b"gh")
            && b"pousr".contains(&rest[2])
            && rest[3] == b'_'
            && run_of(bytes, after(4), |b| b.is_ascii_alphanumeric()) >= 20
        {
            return true;
        }
        if rest.starts_with(b"github_pat_") && run_of(bytes, after(11), word) >= 20 {
            return true;
        }
        if rest.starts_with(b"sk-")
            && run_of(bytes, after(3), |b| {
                b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
            }) >= 20
        {
            return true;
        }
        if rest.len() > 5
            && rest.starts_with(b"xox")
            && b"abps".contains(&rest[3])
            && rest[4] == b'-'
            && run_of(bytes, after(5), |b| b.is_ascii_alphanumeric() || b == b'-') >= 10
        {
            return true;
        }
    }
    false
}
