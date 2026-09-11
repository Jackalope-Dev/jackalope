//! Task-scoped repository map.
//!
//! Ranks statically analyzed files against the task text and the paths recent attempts
//! touched, then renders a bounded outline the worker reads instead of rediscovering the
//! tree with its own searches. The scan is deterministic and costs no model tokens, while
//! every byte rendered here is re-sent on each model call, so the budget stays small.

use super::{scan, CodebaseSnapshot};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// A repeated task on the same repository and commit reuses the scan, across worktrees.
const CACHE_TTL: Duration = Duration::from_secs(600);
const CACHE_ENTRIES: usize = 6;
const SEEDS: usize = 14;
const MAX_ENTRIES: usize = 40;
const EDGES_PER_ENTRY: usize = 5;
/// A neighbour imported by more files than this is shared infrastructure, not task context.
const SHARED_FANIN: usize = 8;
pub(crate) const DEFAULT_BUDGET: usize = 6_000;

/// Function words plus the task-template headings every Jackalope prompt carries, which
/// would otherwise rank unrelated files alike.
const STOPWORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "onto",
    "its",
    "use",
    "using",
    "add",
    "make",
    "should",
    "would",
    "could",
    "have",
    "has",
    "are",
    "was",
    "were",
    "been",
    "not",
    "but",
    "all",
    "any",
    "can",
    "you",
    "your",
    "our",
    "their",
    "them",
    "they",
    "when",
    "where",
    "which",
    "while",
    "then",
    "than",
    "also",
    "just",
    "like",
    "need",
    "needs",
    "want",
    "wants",
    "please",
    "objective",
    "guidelines",
    "quality",
    "constraints",
    "instead",
    "current",
    "existing",
    "ensure",
    "keep",
    "verify",
    "check",
    "update",
    "change",
    "changes",
    "work",
    "task",
    "jackalope",
];

struct Cached {
    at: Instant,
    snapshot: Arc<CodebaseSnapshot>,
}

static CACHE: OnceLock<Mutex<HashMap<String, Cached>>> = OnceLock::new();

/// Identifies the content a scan would see, so unrelated checkouts stay separate but every
/// worktree of one repository at one commit shares a single scan.
///
/// Isolated tasks get a fresh worktree each time, and keying on the directory made each one
/// pay for a full scan of a tree that was already analyzed. `--git-common-dir` is shared by a
/// repository and all of its worktrees, and `HEAD` distinguishes the commits they sit on;
/// together they identify the tracked content. Uncommitted edits are not in the key: the map
/// is file names and imports offered as a starting point, so a file added since the commit is
/// a miss the worker resolves by searching, not a wrong answer. A checkout that is not a
/// repository falls back to its own path.
fn fingerprint(root: &Path) -> String {
    let git = |args: &[&str]| -> Option<String> {
        let output = crate::commands::git_command::command(
            root,
            args,
            crate::commands::git_command::Policy::Inspection,
        )
        .output()
        .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
            .filter(|value| !value.is_empty())
    };
    match (
        git(&["rev-parse", "--path-format=absolute", "--git-common-dir"]),
        git(&["rev-parse", "HEAD"]),
    ) {
        (Some(repository), Some(head)) => format!("{repository}@{head}"),
        _ => root.to_string_lossy().into_owned(),
    }
}

/// Scans `root`, reusing a recent snapshot when one is cached. The scan runs inside the
/// cache lock so a second launch waits for the first result rather than repeating the work.
fn snapshot(root: &Path) -> Option<Arc<CodebaseSnapshot>> {
    let key = fingerprint(root);
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache.lock().ok()?;
    if let Some(entry) = guard.get(&key) {
        if entry.at.elapsed() < CACHE_TTL {
            return Some(entry.snapshot.clone());
        }
    }
    let fresh = Arc::new(scan(root).ok()?);
    guard.retain(|_, entry| entry.at.elapsed() < CACHE_TTL);
    if guard.len() >= CACHE_ENTRIES {
        if let Some(oldest) = guard
            .iter()
            .min_by_key(|(_, entry)| entry.at)
            .map(|(key, _)| key.clone())
        {
            guard.remove(&oldest);
        }
    }
    guard.insert(
        key,
        Cached {
            at: Instant::now(),
            snapshot: fresh.clone(),
        },
    );
    Some(fresh)
}

/// Splits an identifier into lowercase words across camelCase, kebab-case and snake_case.
/// A split run also keeps its joined form, so `ToDos` matches `todos` in a file name and not
/// only the fragments `to` and `dos`.
fn words(text: &str, output: &mut Vec<String>) {
    for run in text.split(|character: char| !character.is_alphanumeric()) {
        if run.is_empty() {
            continue;
        }
        let mut parts: Vec<String> = Vec::new();
        let mut current = String::new();
        let mut previous_lower = false;
        for character in run.chars() {
            if character.is_ascii_uppercase() && previous_lower && !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            current.extend(character.to_lowercase());
            previous_lower = character.is_ascii_lowercase() || character.is_ascii_digit();
        }
        if !current.is_empty() {
            parts.push(current);
        }
        if parts.len() > 1 {
            output.push(parts.concat());
        }
        output.append(&mut parts);
    }
}

fn keywords(task: &str) -> Vec<String> {
    let mut parsed = Vec::new();
    words(task, &mut parsed);
    let mut seen = BTreeSet::new();
    parsed
        .into_iter()
        .filter(|word| word.len() >= 3 && !STOPWORDS.contains(&word.as_str()))
        .filter(|word| seen.insert(word.clone()))
        .take(24)
        .collect()
}

/// Scores a path by keyword overlap. The file name carries more signal than the directories
/// above it, and a path a recent attempt actually touched outranks a name match alone.
fn score(path: &str, keys: &[String], recent: &BTreeSet<String>) -> u32 {
    let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
    let mut name_words = Vec::new();
    words(name, &mut name_words);
    let mut directory_words = Vec::new();
    words(directory, &mut directory_words);
    let mut total = 0;
    for key in keys {
        if name_words.iter().any(|word| word == key) {
            total += 6;
        } else if name_words.iter().any(|word| word.contains(key.as_str())) {
            total += 3;
        }
        if directory_words.iter().any(|word| word == key) {
            total += 2;
        }
    }
    if total > 0 && recent.contains(path) {
        total += 5;
    }
    total
}

fn shape(snapshot: &CodebaseSnapshot) -> String {
    let mut areas: BTreeMap<&str, usize> = BTreeMap::new();
    for file in &snapshot.files {
        let area = file.path.split('/').next().unwrap_or(".");
        *areas.entry(area).or_default() += 1;
    }
    let mut ordered: Vec<_> = areas.into_iter().collect();
    ordered.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    ordered
        .into_iter()
        .take(8)
        .map(|(area, count)| format!("{area} ({count})"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Builds the map text, or `None` when the scan fails or nothing in the tree matches.
pub(crate) fn task_map(
    root: &Path,
    task: &str,
    recent_paths: &[String],
    budget: usize,
) -> Option<String> {
    let keys = keywords(task);
    if keys.is_empty() {
        return None;
    }
    let snapshot = snapshot(root)?;
    let recent: BTreeSet<String> = recent_paths.iter().cloned().collect();

    let mut imports: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut used_by: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for reference in &snapshot.references {
        if let Some(target) = reference.target.as_deref() {
            imports.entry(&reference.source).or_default().push(target);
            used_by.entry(target).or_default().push(&reference.source);
        }
    }

    let mut ranked: Vec<(u32, &str)> = snapshot
        .files
        .iter()
        .map(|file| (score(&file.path, &keys, &recent), file.path.as_str()))
        .filter(|(total, _)| *total > 0)
        .collect();
    if ranked.is_empty() {
        return None;
    }
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));

    let mut selected: Vec<&str> = Vec::new();
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for (_, path) in ranked.iter().take(SEEDS) {
        if seen.insert(path) {
            selected.push(path);
        }
    }
    // One hop through the resolved import graph: the files a likely match reaches, and the
    // callers that would break if it changed. Widely shared infrastructure is skipped here --
    // a module half the tree imports says nothing about where this task belongs, and its own
    // edge list is long enough to crowd out the files that do.
    for seed in selected.clone() {
        for neighbour in imports
            .get(seed)
            .into_iter()
            .flatten()
            .chain(used_by.get(seed).into_iter().flatten())
        {
            if selected.len() >= MAX_ENTRIES {
                break;
            }
            let shared = used_by.get(neighbour).map_or(0, |callers| {
                let mut unique: Vec<&&str> = callers.iter().collect();
                unique.sort_unstable();
                unique.dedup();
                unique.len()
            });
            if shared > SHARED_FANIN {
                continue;
            }
            if seen.insert(neighbour) {
                selected.push(neighbour);
            }
        }
    }

    let lines: BTreeMap<&str, Option<usize>> = snapshot
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.lines))
        .collect();
    let languages: BTreeMap<&str, &str> = snapshot
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.language.as_str()))
        .collect();

    let mut text = format!(
        "\n\nJackalope repository map. Static analysis of this workspace, not a model summary: file names and resolved imports only. It is a starting point, not a complete or authoritative list. Read a file before changing it, and search normally for anything absent.\nProject areas by file count: {}.\nFiles related to this task:\n",
        shape(&snapshot)
    );
    let mut rendered = 0;
    for path in &selected {
        let mut entry = format!("\n{path}");
        if let Some(language) = languages.get(path) {
            match lines.get(path).copied().flatten() {
                Some(count) => entry.push_str(&format!(" ({language}, {count} lines)")),
                None => entry.push_str(&format!(" ({language})")),
            }
        }
        entry.push('\n');
        for (label, edges) in [
            ("imports", imports.get(path)),
            ("used by", used_by.get(path)),
        ] {
            let Some(edges) = edges else { continue };
            let mut unique: Vec<&str> = edges.clone();
            unique.sort_unstable();
            unique.dedup();
            if unique.is_empty() {
                continue;
            }
            let shown = unique.len().min(EDGES_PER_ENTRY);
            entry.push_str(&format!("  {label}: {}", unique[..shown].join(", ")));
            if unique.len() > shown {
                entry.push_str(&format!(" (+{} more)", unique.len() - shown));
            }
            entry.push('\n');
        }
        if text.len() + entry.len() > budget {
            break;
        }
        text.push_str(&entry);
        rendered += 1;
    }
    if rendered == 0 {
        return None;
    }
    if rendered < selected.len() {
        text.push_str(&format!(
            "\n{} further related files were omitted to keep this map small.\n",
            selected.len() - rendered
        ));
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn splits_identifiers_and_drops_template_headings() {
        let mut parsed = Vec::new();
        words("apps/desktop/src/TaskDetail.tsx", &mut parsed);
        assert!(parsed.contains(&"task".to_string()));
        assert!(parsed.contains(&"detail".to_string()));
        assert!(parsed.contains(&"tsx".to_string()));
        assert!(parsed.contains(&"taskdetail".to_string()));
        let keys = keywords("### Objective\nMove the ToDos page onto the Tasks tab");
        assert!(keys.contains(&"todos".to_string()));
        assert!(keys.contains(&"tasks".to_string()));
        assert!(!keys.contains(&"objective".to_string()));
        assert!(!keys.contains(&"the".to_string()));
    }

    #[test]
    fn file_names_outrank_directories_and_recent_paths_break_ties() {
        let keys = vec!["usage".to_string()];
        let recent = BTreeSet::from(["src/other/usage.ts".to_string()]);
        let name = score("src/a/usage.ts", &keys, &recent);
        let directory = score("src/usage/other.ts", &keys, &recent);
        assert!(name > directory, "{name} should beat {directory}");
        assert!(score("src/other/usage.ts", &keys, &recent) > name);
        assert_eq!(score("src/a/unrelated.ts", &keys, &recent), 0);
    }

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("jackalope-taskmap-{}", uuid::Uuid::new_v4())))
        }
        fn write(&self, name: &str, text: &str) {
            let path = self.0.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn names_the_matching_files_with_their_edges_and_never_exceeds_the_budget() {
        let f = Fixture::new();
        f.write(
            "src/RepoTodos.tsx",
            "import './todos.css';\nimport { parse } from './todos';",
        );
        f.write("src/todos.ts", "export const parse = () => [];");
        f.write("src/todos.css", ".a{}");
        f.write(
            "src/unrelated/billing.ts",
            "export const charge = () => {};",
        );
        let map = task_map(
            &f.0,
            "Move the ToDos page onto the Tasks tab",
            &[],
            DEFAULT_BUDGET,
        )
        .expect("a matching tree produces a map");
        assert!(map.contains("src/RepoTodos.tsx"), "{map}");
        assert!(map.contains("src/todos.ts"), "{map}");
        assert!(
            map.contains("imports: src/todos.css, src/todos.ts"),
            "{map}"
        );
        assert!(!map.contains("billing.ts"), "{map}");
        assert!(map.len() <= DEFAULT_BUDGET);

        // A budget too small for even one entry yields nothing rather than a misleading stub.
        assert!(task_map(&f.0, "Move the ToDos page", &[], 1).is_none());
        // A task about something absent from the tree adds nothing to the prompt.
        assert!(task_map(&f.0, "Rotate the signing certificate", &[], DEFAULT_BUDGET).is_none());
    }

    #[test]
    fn worktrees_of_one_repository_and_commit_share_a_scan_but_other_checkouts_do_not() {
        let f = Fixture::new();
        f.write("src/todos.ts", "export const parse = () => [];");
        let git = |root: &Path, args: &[&str]| {
            let ok = crate::commands::git_command::command(
                root,
                args,
                crate::commands::git_command::Policy::Inspection,
            )
            .output()
            .is_ok_and(|out| out.status.success());
            assert!(ok, "git {args:?} failed");
        };
        git(&f.0, &["init", "-q"]);
        git(&f.0, &["config", "user.email", "fixture@example.invalid"]);
        git(&f.0, &["config", "user.name", "Fixture"]);
        git(&f.0, &["add", "-A"]);
        git(&f.0, &["commit", "-qm", "fixture"]);
        let tree = f.0.join(".worktrees/task");
        git(
            &f.0,
            &["worktree", "add", "-q", "-d", tree.to_str().unwrap()],
        );

        // The worktree is a different directory, so a path-keyed cache would rescan it.
        assert_eq!(fingerprint(&f.0), fingerprint(&tree));
        let separate = Fixture::new();
        separate.write("src/todos.ts", "export const parse = () => [];");
        assert_ne!(fingerprint(&f.0), fingerprint(&separate.0));

        let first = snapshot(&f.0).expect("scan");
        let reused = snapshot(&tree).expect("scan");
        assert!(
            Arc::ptr_eq(&first, &reused),
            "the worktree reused the repository scan"
        );
        git(
            &f.0,
            &["worktree", "remove", "--force", tree.to_str().unwrap()],
        );
    }

    #[test]
    #[ignore = "Manual real-repository map; set JACKALOPE_MAP_ROOT and JACKALOPE_MAP_TASK"]
    fn print_repository_map() {
        let root = std::env::var("JACKALOPE_MAP_ROOT").unwrap();
        let task = std::env::var("JACKALOPE_MAP_TASK").unwrap();
        let map = task_map(Path::new(&root), &task, &[], DEFAULT_BUDGET).expect("map");
        println!("{map}");
        println!("--- {} bytes ---", map.len());
    }

    #[test]
    fn a_task_matching_nothing_produces_no_map() {
        let empty = BTreeSet::new();
        assert_eq!(score("src/a.ts", &[], &empty), 0);
        assert!(keywords("the and for with").is_empty());
    }
}
