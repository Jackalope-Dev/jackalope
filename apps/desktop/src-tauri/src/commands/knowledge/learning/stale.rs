//! The stale-lesson check: finds lessons that name a project path, a
//! package.json script or a make target the project folder no longer has.
//! Read-only and bounded; no commands run and no model calls. Lessons
//! Jackalope wrote are archived; every other lesson is only flagged.

use super::*;
use std::path::Path;

/// File extensions that make a slash-separated word a file path even when
/// its top folder is gone.
const EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "toml", "yaml", "yml", "py",
    "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "rb", "php", "css", "scss", "html",
    "sh", "ps1", "sql", "lock", "txt", "vue", "svelte",
];

/// pnpm and yarn commands that are not package scripts.
const BUILTINS: &[&str] = &[
    "add",
    "approve-builds",
    "audit",
    "bin",
    "ci",
    "config",
    "create",
    "dedupe",
    "deploy",
    "dlx",
    "doctor",
    "env",
    "exec",
    "fetch",
    "help",
    "i",
    "import",
    "info",
    "init",
    "install",
    "it",
    "licenses",
    "link",
    "list",
    "ln",
    "ls",
    "outdated",
    "pack",
    "patch",
    "patch-commit",
    "prune",
    "publish",
    "rb",
    "rebuild",
    "recursive",
    "remove",
    "rm",
    "root",
    "run",
    "self-update",
    "setup",
    "start",
    "store",
    "t",
    "test",
    "un",
    "uninstall",
    "unlink",
    "up",
    "update",
    "upgrade",
    "version",
    "why",
    "workspace",
    "workspaces",
];

const MANIFEST_BYTES: u64 = 256_000;

#[derive(Clone, Debug, PartialEq)]
enum Reference {
    Path(String),
    /// `bare` is `pnpm X` or `yarn X`, which may also run an installed binary.
    Script {
        name: String,
        bare: bool,
    },
    Make(String),
}

impl Reference {
    fn describe(&self) -> String {
        match self {
            Reference::Path(path) => path.clone(),
            Reference::Script { name, .. } => format!("the package.json script \"{name}\""),
            Reference::Make(target) => format!("the make target \"{target}\""),
        }
    }
}

fn clean(token: &str) -> &str {
    token
        .trim_matches(|c: char| "`'\"()[]{}<>,;!?".contains(c))
        .trim_end_matches([':', '.'])
}

/// A project-relative path the word names, if it looks like one.
fn path_reference(root: &Path, word: &str) -> Option<String> {
    let path = word.replace('\\', "/");
    let path = path.strip_prefix("./").unwrap_or(&path);
    if path.len() > 200
        || !path.contains('/')
        || path.contains("://")
        || path.starts_with(['/', '@', '~', '$', '-'])
        || path.get(1..2) == Some(":")
    {
        return None;
    }
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if segments.len() < 2
        || segments.iter().any(|part| {
            *part == ".."
                || !part
                    .chars()
                    .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
        })
    {
        return None;
    }
    let extension = segments
        .last()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, extension)| extension.to_lowercase());
    let file = extension.is_some_and(|extension| EXTENSIONS.contains(&extension.as_str()));
    // Without a file extension, only a word under an existing top folder is a
    // path; `feature/short-topic` or `and/or` is not.
    (file || root.join(segments[0]).is_dir()).then(|| segments.join("/"))
}

/// Spans written as commands: backtick-quoted text and, for a verified check
/// lesson, its command.
fn command_spans(text: &str, check: bool) -> Vec<String> {
    let mut spans: Vec<String> = text
        .split('`')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect();
    if check {
        if let Some(command) = text
            .strip_prefix("The check command ")
            .and_then(|rest| rest.strip_suffix(" passed for this project."))
        {
            spans.push(command.to_string());
        }
    }
    spans
}

fn script_name(word: Option<&&str>) -> Option<String> {
    let name = clean(word?);
    (!name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ':' | '-' | '_' | '.')))
    .then(|| name.to_string())
}

/// Scripts and make targets named in `words`. Outside command spans only the
/// explicit `pnpm|npm|yarn run X` form counts, since prose such as "pnpm only"
/// or "make sure" is not a command.
fn commands(words: &[&str], command: bool, found: &mut Vec<Reference>) {
    for (index, word) in words.iter().enumerate() {
        let tool = clean(word);
        let next = words.get(index + 1).map(|next| clean(next));
        match (tool, next) {
            ("pnpm" | "npm" | "yarn", Some("run" | "run-script")) => {
                if let Some(name) = script_name(words.get(index + 2)) {
                    found.push(Reference::Script { name, bare: false });
                }
            }
            ("pnpm" | "yarn", Some(next)) if command && !BUILTINS.contains(&next) => {
                if let Some(name) = script_name(words.get(index + 1)) {
                    found.push(Reference::Script { name, bare: true });
                }
            }
            ("make", Some(_)) if command => {
                if let Some(name) = script_name(words.get(index + 1)) {
                    found.push(Reference::Make(name));
                }
            }
            _ => {}
        }
    }
}

fn references(root: &Path, text: &str, check: bool, limit: usize) -> Vec<Reference> {
    let mut found = vec![];
    let words: Vec<&str> = text.split_whitespace().collect();
    for word in &words {
        if let Some(path) = path_reference(root, clean(word)) {
            found.push(Reference::Path(path));
        }
    }
    commands(&words, false, &mut found);
    for span in command_spans(text, check) {
        let words: Vec<&str> = span.split_whitespace().collect();
        commands(&words, true, &mut found);
    }
    let mut unique = vec![];
    for reference in found {
        if !unique.contains(&reference) {
            unique.push(reference);
        }
    }
    unique.truncate(limit);
    unique
}

/// What the check reads from the project once per pass.
struct Project<'a> {
    root: &'a Path,
    /// `None` when there is no readable root package.json.
    scripts: Option<Vec<String>>,
    /// `None` when there is no makefile, or it includes others or uses
    /// pattern rules, so a missing target cannot be told apart.
    targets: Option<Vec<String>>,
}

impl<'a> Project<'a> {
    fn read(root: &'a Path) -> Self {
        let scripts =
            crate::commands::history::read_bounded(&root.join("package.json"), MANIFEST_BYTES)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .map(|manifest| {
                    manifest
                        .get("scripts")
                        .and_then(serde_json::Value::as_object)
                        .map(|scripts| scripts.keys().cloned().collect())
                        .unwrap_or_default()
                });
        let targets = ["GNUmakefile", "makefile", "Makefile"]
            .iter()
            .find_map(|name| {
                crate::commands::history::read_bounded(&root.join(name), MANIFEST_BYTES).ok()
            })
            .and_then(|bytes| {
                let text = String::from_utf8_lossy(&bytes);
                let mut targets = vec![];
                for line in text.lines() {
                    if line.starts_with("include") || line.starts_with("-include") {
                        return None;
                    }
                    if line.starts_with(['\t', ' ', '#']) {
                        continue;
                    }
                    let Some((names, _)) = line.split_once(':') else {
                        continue;
                    };
                    if names.contains('%') {
                        return None;
                    }
                    if !names.contains('=') {
                        targets.extend(names.split_whitespace().map(str::to_string));
                    }
                }
                Some(targets)
            });
        Self {
            root,
            scripts,
            targets,
        }
    }

    /// Whether the project definitely no longer has it. Anything the check
    /// cannot tell counts as present.
    fn missing(&self, reference: &Reference) -> bool {
        match reference {
            Reference::Path(path) => !self.root.join(path).exists(),
            Reference::Script { name, bare } => {
                let Some(scripts) = &self.scripts else {
                    return false;
                };
                if scripts.contains(name) {
                    return false;
                }
                if !*bare {
                    return true;
                }
                // `pnpm X` also runs an installed binary; judge only when the
                // dependencies are installed.
                let bin = self.root.join("node_modules").join(".bin");
                bin.is_dir()
                    && !bin.join(name).exists()
                    && !bin.join(format!("{name}.cmd")).exists()
            }
            Reference::Make(target) => self
                .targets
                .as_ref()
                .is_some_and(|targets| !targets.contains(target)),
        }
    }
}

/// The first thing the entry names that the project no longer has.
fn missing_reference(
    project: &Project,
    entry: &KnowledgeEntry,
    thresholds: &Thresholds,
) -> Option<String> {
    let check = entry.automatic.as_ref().map(|source| source.kind.as_str()) == Some("verification");
    // A lesson Jackalope wrote is judged by what the person said, not its
    // framing; any other lesson by its current text.
    let text = lifecycle(entry)
        .filter(|_| owned(entry))
        .map(|state| state.statement.as_str())
        .filter(|statement| !statement.is_empty())
        .unwrap_or(&entry.content);
    references(
        project.root,
        text,
        check,
        thresholds.stale_references_per_lesson,
    )
    .into_iter()
    .find(|reference| project.missing(reference))
    .map(|reference| reference.describe())
}

impl KnowledgeStore {
    /// One stale-lesson pass over a project's available lessons. Returns one
    /// line per lesson archived or newly flagged.
    pub fn check_stale(
        &self,
        project_id: &str,
        project_path: &str,
        thresholds: &Thresholds,
    ) -> Result<Vec<String>, String> {
        let mut candidates: Vec<KnowledgeEntry> = self
            .list(project_id, project_path)?
            .into_iter()
            .filter(|entry| entry.enabled && entry.kind == KnowledgeKind::Memory)
            .collect();
        candidates.sort_by(|a, b| a.id.cmp(&b.id));
        candidates.truncate(thresholds.stale_lessons_per_check);
        // The project is read without holding the store lock.
        let root = PathBuf::from(canonical(project_path)?);
        let project = Project::read(&root);
        let findings: Vec<(String, u64, Option<String>)> = candidates
            .iter()
            .map(|entry| {
                (
                    entry.id.clone(),
                    entry.revision,
                    missing_reference(&project, entry, thresholds),
                )
            })
            .filter(|(id, _, missing)| {
                missing.is_some()
                    || candidates
                        .iter()
                        .any(|entry| &entry.id == id && entry.stale.is_some())
            })
            .collect();
        if findings.is_empty() {
            return Ok(vec![]);
        }
        let path = canonical(project_path)?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let mut records = vec![];
        let mut applied = vec![];
        let mut changed = false;
        for (id, revision, missing) in findings {
            // A lesson that changed since it was checked waits for the next pass.
            let Some(entry) = entries.iter_mut().find(|entry| {
                entry.id == id
                    && entry.revision == revision
                    && in_project(entry, project_id, &path)
                    && entry.enabled
                    && !entry.dismissed
            }) else {
                continue;
            };
            let Some(thing) = missing else {
                entry.stale = None;
                changed = true;
                continue;
            };
            if owned(entry) && live(entry) {
                entry.stale = Some(thing.clone());
                archive(entry, STALE);
                records.push(record(
                    entry,
                    "stale",
                    format!("References something that no longer exists: {thing}."),
                    "lifecycle",
                ));
                applied.push(format!("Archived: {}", entry.title));
                changed = true;
            } else if entry.stale.as_deref() != Some(thing.as_str()) {
                entry.stale = Some(thing.clone());
                records.push(record(
                    entry,
                    "stale",
                    format!("Names something that no longer exists: {thing}. Flagged only; Jackalope does not change this lesson."),
                    "lifecycle",
                ));
                applied.push(format!("Flagged: {}", entry.title));
                changed = true;
            }
        }
        if changed {
            self.write(&entries)?;
            self.append_ledger(&records);
        }
        Ok(applied)
    }
}

#[cfg(test)]
mod tests;
