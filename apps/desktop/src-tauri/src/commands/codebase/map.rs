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

mod context;

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

type Entry = Arc<Mutex<Option<Cached>>>;
static CACHE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();

/// Identifies the content a scan would see, so unrelated checkouts stay separate but every
/// worktree of one repository at one commit shares a single scan.
///
/// Isolated tasks get a fresh worktree each time, and keying on the directory made each one
/// pay for a full scan of a tree that was already analyzed. `--git-common-dir` is shared by a
/// repository and all of its worktrees, and `HEAD` distinguishes the commits they sit on;
/// together they identify the tracked content. Dirty and non-Git checkouts bypass the cache.
/// The map remains advisory: files can change again after the scan.
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

#[cfg(test)]
fn snapshot(root: &Path) -> Option<Arc<CodebaseSnapshot>> {
    cached_snapshot(root).map(|(snapshot, _)| snapshot)
}

fn cache_entry(cache: &Mutex<HashMap<String, Entry>>, key: String) -> Option<Entry> {
    let mut guard = cache.lock().ok()?;
    if let Some(entry) = guard.get(&key) {
        return Some(entry.clone());
    }
    if guard.len() >= CACHE_ENTRIES {
        guard.retain(|_, entry| Arc::strong_count(entry) > 1);
    }
    let entry = Arc::new(Mutex::new(None));
    if guard.len() < CACHE_ENTRIES {
        guard.insert(key, entry.clone());
    }
    Some(entry)
}

fn cached_snapshot(root: &Path) -> Option<(Arc<CodebaseSnapshot>, bool)> {
    let clean = crate::commands::git_command::command(
        root,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
        crate::commands::git_command::Policy::Inspection,
    )
    .output()
    .is_ok_and(|output| output.status.success() && output.stdout.is_empty());
    if !clean {
        return Some((Arc::new(scan(root).ok()?), false));
    }
    let key = fingerprint(root);
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let entry = cache_entry(cache, key)?;
    let mut guard = entry.lock().ok()?;
    if let Some(entry) = guard.as_ref() {
        if entry.at.elapsed() < CACHE_TTL {
            return Some((entry.snapshot.clone(), true));
        }
    }
    let fresh = Arc::new(scan(root).ok()?);
    *guard = Some(Cached {
        at: Instant::now(),
        snapshot: fresh.clone(),
    });
    Some((fresh, false))
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
    prepare_task_map(root, task, recent_paths, budget).map(|(text, _)| text)
}

pub(crate) fn prepare_task_map(
    root: &Path,
    task: &str,
    recent_paths: &[String],
    budget: usize,
) -> Option<(String, bool)> {
    let keys = keywords(task);
    if keys.is_empty() {
        return None;
    }
    let (snapshot, cache_hit) = cached_snapshot(root)?;
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
        .map(|file| {
            let symbol_score = file
                .symbols
                .iter()
                .map(|symbol| score(&symbol.name, &keys, &BTreeSet::new()))
                .max()
                .unwrap_or(0);
            let explicit = task.contains(&file.path);
            (
                score(&file.path, &keys, &recent) + symbol_score * 2 + u32::from(explicit) * 100,
                file.path.as_str(),
            )
        })
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
    let stems: BTreeSet<_> = selected
        .iter()
        .filter_map(|path| {
            Path::new(path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_owned)
        })
        .collect();
    for file in &snapshot.files {
        let name = Path::new(&file.path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let test = name.contains(".test.") || name.contains(".spec.") || name.ends_with("_test.rs");
        if test
            && stems.iter().any(|stem| {
                name.starts_with(&format!("{stem}.")) || name == format!("{stem}_test.rs")
            })
            && selected.len() < MAX_ENTRIES
            && seen.insert(&file.path)
        {
            selected.push(&file.path);
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
        "\n\nJackalope repository map. Static file names, declarations, related tests and resolved imports. Cached line numbers may drift with local edits. This is a starting point, not a complete or authoritative list. Read a file before changing it, and search normally for anything absent.\nProject areas by file count: {}.\nFiles related to this task:\n",
        shape(&snapshot)
    );
    let mut rendered = 0;
    let context = context::related(root, &selected);
    if text.len() + context.len() < budget / 2 {
        text.push_str(&context);
    }
    for path in &selected {
        let mut entry = format!("\n{path}");
        if let Some(language) = languages.get(path) {
            match lines.get(path).copied().flatten() {
                Some(count) => entry.push_str(&format!(" ({language}, {count} lines)")),
                None => entry.push_str(&format!(" ({language})")),
            }
        }
        entry.push('\n');
        if let Some(file) = snapshot.files.iter().find(|file| &file.path == path) {
            let mut symbols: Vec<_> = file.symbols.iter().collect();
            symbols.sort_by_key(|symbol| {
                std::cmp::Reverse(score(&symbol.name, &keys, &BTreeSet::new()))
            });
            for symbol in symbols.into_iter().take(3) {
                entry.push_str(&format!(
                    "  {} {}:{}\n",
                    symbol.kind, symbol.name, symbol.line
                ));
            }
            let prefix = format!("{path}:");
            if let Some((_, rest)) = task.split_once(&prefix) {
                let number: String = rest
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .take(9)
                    .collect();
                if let Ok(line) = number.parse::<usize>() {
                    if line > 0 && file.lines.is_some_and(|count| line <= count) {
                        entry.push_str(&format!("  task references {path}:{line}\n"));
                    }
                }
            }
        }
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
        let omitted = format!(
            "\n{} further related files were omitted to keep this map small.\n",
            selected.len() - rendered
        );
        if text.len() + omitted.len() <= budget {
            text.push_str(&omitted);
        }
    }
    Some((text, cache_hit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn independent_repository_locks_do_not_block_each_other() {
        let cache = Mutex::new(HashMap::new());
        let a = cache_entry(&cache, "a".into()).unwrap();
        let held = a.lock().unwrap();
        let b = cache_entry(&cache, "b".into()).unwrap();
        assert!(b.try_lock().is_ok());
        assert!(Arc::ptr_eq(&a, &cache_entry(&cache, "a".into()).unwrap()));
        drop(held);
    }

    #[test]
    fn symbols_find_opaque_files_and_include_tests_and_error_locations() {
        let f = Fixture::new();
        f.write(
            "src/a.ts",
            "export function computeInvoice() {}\nexport const unrelated = 1;\n",
        );
        f.write("src/a.test.ts", "test('invoice', () => {});");
        let map = task_map(
            &f.0,
            "Fix computeInvoice at src/a.ts:2",
            &[],
            DEFAULT_BUDGET,
        )
        .unwrap();
        assert!(map.contains("function computeInvoice:1"), "{map}");
        assert!(map.contains("src/a.test.ts"), "{map}");
        assert!(map.contains("task references src/a.ts:2"), "{map}");
        for budget in [1, 350, 450, 500, 650, 800, 1000, DEFAULT_BUDGET] {
            assert!(
                task_map(&f.0, "computeInvoice", &[], budget).is_none_or(|map| map.len() <= budget)
            );
        }
    }

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
        f.write(".gitignore", ".worktrees/\n");
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
        f.write("src/todos.ts", "export function freshSymbol() {}\n");
        let changed = snapshot(&f.0).unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert!(changed.files.iter().any(|file| file
            .symbols
            .iter()
            .any(|symbol| symbol.name == "freshSymbol")));
        assert!(Arc::ptr_eq(&reused, &snapshot(&tree).unwrap()));
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
