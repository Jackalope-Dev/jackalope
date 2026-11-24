use super::*;
use crate::commands::external_sessions::read::{Role, ToolCall};
use std::{io::Write as _, process::Command};

const CLAUDE_SESSION: &str = "5f0e1d2c-3b4a-4958-a6b7-c8d9e0f1a2b3";
const CODEX_THREAD: &str = "01a1c7ae-226e-7643-b0e2-7533cacde529";
const CLAUDE_FIXTURE: &str = include_str!("../fixtures/claude-session.jsonl");
const CODEX_FIXTURE: &str = include_str!("../fixtures/codex-rollout.jsonl");

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jackalope-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Self {
            root: dunce::canonicalize(root).unwrap(),
        }
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    /// Writes a fixture file with its working directory replaced by `cwd`.
    fn session(&self, relative: &str, fixture: &str, cwd: &Path) -> PathBuf {
        let escaped = serde_json::to_string(cwd).unwrap();
        let text = fixture.replace("{{CWD}}", &escaped[1..escaped.len() - 1]);
        let path = self.path(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path
    }

    fn repository(&self, name: &str) -> PathBuf {
        let repo = self.path(name);
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git")
                .args(args)
                .current_dir(&repo)
                .env("GIT_AUTHOR_NAME", "Fixture")
                .env("GIT_AUTHOR_EMAIL", "fixture@example.com")
                .env("GIT_COMMITTER_NAME", "Fixture")
                .env("GIT_COMMITTER_EMAIL", "fixture@example.com")
                .output()
                .unwrap();
            assert!(output.status.success(), "{args:?}: {output:?}");
        };
        git(&["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("README.md"), "fixture\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "Initial"]);
        repo
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn shape(entries: &[TranscriptEntry]) -> Vec<(&'static str, String, Vec<String>, Vec<String>)> {
    entries
        .iter()
        .map(|entry| {
            (
                entry.role.as_str(),
                entry.text.clone(),
                entry
                    .tools
                    .iter()
                    .map(|tool| match &tool.summary {
                        Some(summary) => format!("{}: {summary}", tool.name),
                        None => tool.name.clone(),
                    })
                    .collect(),
                entry.attachments.clone(),
            )
        })
        .collect()
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

#[test]
fn claude_fixture_reads_messages_tools_and_attachments_past_damaged_lines() {
    let fixture = Fixture::new();
    let file = fixture.session(
        &format!("claude/projects/-repo/{CLAUDE_SESSION}.jsonl"),
        CLAUDE_FIXTURE,
        Path::new("/work/repo"),
    );
    let transcript = Source::Claude
        .read_transcript(&file, Transcript::keeping(ENTRIES), SOURCE_BYTES)
        .unwrap();
    assert_eq!(
        shape(&transcript.entries.iter().cloned().collect::<Vec<_>>()),
        vec![
            (
                "user",
                "Fix the off-by-one in the parser".into(),
                vec![],
                vec![]
            ),
            (
                "assistant",
                "I'll look at the parser.".into(),
                vec![],
                vec![]
            ),
            (
                "tools",
                String::new(),
                strings(&[
                    "Read: /repo/src/parser.rs",
                    "Bash: cargo test parser --quiet",
                    "TodoWrite"
                ]),
                vec![]
            ),
            ("user", "Also keep the error message".into(), vec![], vec![]),
            (
                "assistant",
                "Fixed the off-by-one.\n\nThe tests pass.".into(),
                vec![],
                vec![]
            ),
            (
                "user",
                "[Image #1] the spacing here is too tight".into(),
                vec![],
                strings(&["Image (image/png)"])
            ),
        ]
    );
    assert_eq!(transcript.messages, 5);
    assert_eq!(transcript.subagent_lines, 1);
    // `{broken` and a JSON array; unknown event types are not damage.
    assert_eq!(transcript.skipped_lines, 2);
    assert!(transcript.partial_tail);
    assert_eq!(
        transcript.last_at.as_deref(),
        Some("2026-11-11T09:01:00.000Z")
    );
    let summary = Source::Claude.summarize(&file).unwrap();
    assert_eq!(summary.session_id, CLAUDE_SESSION);
    assert_eq!(summary.cwd, "/work/repo");
    assert_eq!(
        summary.title.as_deref(),
        Some("Fix the off-by-one in the parser")
    );
}

#[test]
fn codex_fixture_reads_messages_tools_and_attachments_past_damaged_lines() {
    let fixture = Fixture::new();
    let file = fixture.session(
        &format!("codex/sessions/2026/11/10/rollout-2026-11-10T15-57-20-{CODEX_THREAD}.jsonl"),
        CODEX_FIXTURE,
        Path::new("/work/repo"),
    );
    let transcript = Source::Codex
        .read_transcript(&file, Transcript::keeping(ENTRIES), SOURCE_BYTES)
        .unwrap();
    assert_eq!(
        shape(&transcript.entries.iter().cloned().collect::<Vec<_>>()),
        vec![
            (
                "user",
                "Add pagination defaults to the list endpoint".into(),
                vec![],
                vec![]
            ),
            (
                "tools",
                String::new(),
                strings(&[
                    "exec_command: rg -n pagination src",
                    "apply_patch: src/list.rs, src/page.rs"
                ]),
                vec![]
            ),
            (
                "assistant",
                "Added the pagination defaults.".into(),
                vec![],
                vec![]
            ),
            (
                "user",
                "The page size looks wrong here".into(),
                vec![],
                strings(&["Image (/tmp/codex-clipboard-1.png)"])
            ),
            (
                "tools",
                String::new(),
                strings(&["shell: bash -lc cargo test"]),
                vec![]
            ),
            (
                "assistant",
                "Set the default page size to 50.".into(),
                vec![],
                vec![]
            ),
        ]
    );
    assert_eq!(transcript.messages, 4);
    assert_eq!(transcript.skipped_lines, 1);
    assert!(transcript.partial_tail);
    let summary = Source::Codex.summarize(&file).unwrap();
    assert_eq!(summary.session_id, CODEX_THREAD);
    assert_eq!(
        summary.title.as_deref(),
        Some("Add pagination defaults to the list endpoint")
    );
}

#[test]
fn transcript_entries_round_trip_and_older_saves_still_read() {
    let entry = TranscriptEntry {
        role: Role::Tools,
        text: String::new(),
        tools: vec![ToolCall {
            name: "Bash".into(),
            summary: Some("ls".into()),
        }],
        attachments: Vec::new(),
        at: None,
    };
    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"role": "tools", "text": "", "tools": [{"name": "Bash", "summary": "ls"}]})
    );
    let minimal: TranscriptEntry = serde_json::from_str(r#"{"role":"user"}"#).unwrap();
    assert_eq!(minimal.role, Role::User);
    assert!(minimal.text.is_empty() && minimal.tools.is_empty());
}

#[test]
fn long_transcripts_keep_their_newest_entries() {
    let mut entries: Vec<_> = (0..100)
        .map(|index| TranscriptEntry {
            role: Role::User,
            text: format!("{index}{}", "x".repeat(TRANSCRIPT_BYTES / 50)),
            tools: Vec::new(),
            attachments: Vec::new(),
            at: None,
        })
        .collect();
    let mut earlier = 3;
    fit(&mut entries, &mut earlier);
    assert!(entries.len() < 50);
    assert_eq!(earlier, 3 + 100 - entries.len());
    assert!(entries.last().unwrap().text.starts_with("99"));
}

struct World {
    fixture: Fixture,
    imports: Imports,
    homes: Vec<(Source, PathBuf)>,
    projects: Vec<ProjectFolder>,
    repo: PathBuf,
    claude_file: PathBuf,
    codex_file: PathBuf,
}

impl World {
    /// A project repository with a Claude Code and a Codex session, a second repository
    /// that is not a project, and a session whose folder is gone.
    fn new() -> Self {
        let fixture = Fixture::new();
        let repo = fixture.repository("repo");
        let other = fixture.repository("other");
        let claude_file = fixture.session(
            &format!("claude/projects/-repo/{CLAUDE_SESSION}.jsonl"),
            CLAUDE_FIXTURE,
            &repo,
        );
        let codex_file = fixture.session(
            &format!("codex/sessions/2026/11/10/rollout-2026-11-10T15-57-20-{CODEX_THREAD}.jsonl"),
            CODEX_FIXTURE,
            &repo,
        );
        fixture.session(
            "claude/projects/-other/6a1b2c3d-0000-4000-8000-000000000001.jsonl",
            &CLAUDE_FIXTURE.replace(CLAUDE_SESSION, "6a1b2c3d-0000-4000-8000-000000000001"),
            &other,
        );
        fixture.session(
            "claude/projects/-gone/7b2c3d4e-0000-4000-8000-000000000002.jsonl",
            &CLAUDE_FIXTURE.replace(CLAUDE_SESSION, "7b2c3d4e-0000-4000-8000-000000000002"),
            &fixture.path("gone"),
        );
        let imports = Imports::new(fixture.path("data/imported-conversations"));
        Self {
            homes: vec![
                (Source::Claude, fixture.path("claude")),
                (Source::Codex, fixture.path("codex")),
            ],
            projects: vec![ProjectFolder::new("project-1", repo.to_str().unwrap())],
            imports,
            repo,
            claude_file,
            codex_file,
            fixture,
        }
    }

    fn scan(&self) -> ImportScan {
        let recorded = Default::default();
        let data = self.fixture.path("data");
        self.imports
            .scan(
                &self.homes,
                &self.projects,
                &Scope {
                    projects: &self.projects,
                    recorded: &recorded,
                    data_directory: &data,
                },
            )
            .unwrap()
    }

    fn import(&self, keys: &[String]) -> ImportProgress {
        self.imports.begin(keys.len()).unwrap();
        self.imports.run(keys.to_vec(), &self.projects, &|| {})
    }
}

fn statuses(scan: &ImportScan) -> Vec<(String, &'static str)> {
    let mut statuses: Vec<_> = scan
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter())
        .map(|session| (session.key.clone(), session.status))
        .collect();
    statuses.sort();
    statuses
}

#[test]
fn scans_group_sessions_by_project_and_repository() {
    let world = World::new();
    let scan = world.scan();
    let groups: Vec<_> = scan
        .groups
        .iter()
        .map(|group| {
            (
                group.path.clone(),
                group.project_id.clone(),
                group.exists,
                group.sessions.len(),
            )
        })
        .collect();
    assert_eq!(
        groups,
        vec![
            (
                world.repo.to_string_lossy().into_owned(),
                Some("project-1".to_string()),
                true,
                2
            ),
            (
                world.fixture.path("other").to_string_lossy().into_owned(),
                None,
                true,
                1
            ),
            (
                world.fixture.path("gone").to_string_lossy().into_owned(),
                None,
                false,
                1
            ),
        ]
    );
    let project = &scan.groups[0];
    assert!(project.repository);
    let claude = project
        .sessions
        .iter()
        .find(|session| session.agent == "claude")
        .unwrap();
    assert_eq!(claude.key, format!("claude:{CLAUDE_SESSION}"));
    assert_eq!(claude.title, "Fix the off-by-one in the parser");
    assert_eq!(claude.messages, 5);
    assert_eq!(claude.last_at, "2026-11-11T09:01:00.000Z");
    assert_eq!(claude.status, "new");
    let codex = project
        .sessions
        .iter()
        .find(|session| session.agent == "codex")
        .unwrap();
    assert_eq!(codex.messages, 4);
    assert_eq!(codex.branch.as_deref(), Some("main"));
}

#[test]
fn imports_are_idempotent_follow_growth_and_never_touch_sources() {
    let world = World::new();
    let original = std::fs::read(&world.claude_file).unwrap();
    let scan = world.scan();
    let keys: Vec<String> = scan
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter().map(|session| session.key.clone()))
        .collect();
    let progress = world.import(&keys);
    assert!(!progress.running);
    assert_eq!(progress.done, 4);
    assert_eq!(progress.imported, 2);
    // Sessions outside any project are reported, not imported.
    assert_eq!(progress.problems.len(), 2);
    assert!(progress.problems[0]
        .reason
        .contains("not in a Jackalope project"));

    let records = world.imports.store.records().unwrap();
    assert_eq!(records.len(), 2);
    let claude = world
        .imports
        .store
        .record(&format!("claude:{CLAUDE_SESSION}"))
        .unwrap()
        .unwrap();
    assert_eq!(claude.project_id, "project-1");
    assert_eq!(claude.messages, 5);
    assert_eq!(claude.skipped_lines, 2);
    assert_eq!(claude.source_path, world.claude_file);
    let entries = world.imports.store.transcript(&claude.id).unwrap();
    assert_eq!(entries.len(), 6);
    assert_eq!(
        entries[5].attachments,
        vec!["Image (image/png)".to_string()]
    );

    // Importing again changes nothing.
    let again = world.import(&keys[..]);
    assert_eq!((again.imported, again.updated, again.unchanged), (0, 0, 2));
    assert_eq!(world.imports.store.records().unwrap(), records);
    assert!(statuses(&world.scan())
        .iter()
        .filter(|(key, _)| key.ends_with(CLAUDE_SESSION) || key.ends_with(CODEX_THREAD))
        .all(|(_, status)| *status == "imported"));

    // A session that grew is updated in place.
    let mut grown = original.clone();
    let partial = grown.iter().rposition(|byte| *byte == b'\n').unwrap() + 1;
    grown.truncate(partial);
    let escaped = serde_json::to_string(&world.repo).unwrap();
    grown.extend_from_slice(
        format!(
            r#"{{"type":"user","sessionId":"{CLAUDE_SESSION}","cwd":{escaped},"timestamp":"2026-11-11T10:00:00.000Z","message":{{"role":"user","content":"One more thing"}}}}"#
        )
        .as_bytes(),
    );
    grown.push(b'\n');
    std::fs::write(&world.claude_file, &grown).unwrap();
    let scan = world.scan();
    assert!(statuses(&scan).contains(&(format!("claude:{CLAUDE_SESSION}"), "changed")));
    let updated = world.import(&[format!("claude:{CLAUDE_SESSION}")]);
    assert_eq!((updated.imported, updated.updated), (0, 1));
    let claude = world
        .imports
        .store
        .record(&format!("claude:{CLAUDE_SESSION}"))
        .unwrap()
        .unwrap();
    assert_eq!(claude.messages, 6);
    assert_eq!(world.imports.store.records().unwrap().len(), 2);
    assert_eq!(
        world
            .imports
            .store
            .transcript(&claude.id)
            .unwrap()
            .last()
            .unwrap()
            .text,
        "One more thing"
    );

    // Once continued in Jackalope, its CLI session holds Jackalope's turns too.
    world
        .imports
        .store
        .mark_continued(&claude.id, "conversation-1")
        .unwrap();
    std::fs::write(&world.claude_file, &original).unwrap();
    assert!(statuses(&world.scan()).contains(&(claude.id.clone(), "continued")));
    let skipped = world.import(&[claude.id.clone()]);
    assert_eq!(skipped.updated, 0);
    assert!(skipped.problems[0]
        .reason
        .contains("continued in Jackalope"));

    // The CLI's files were only read.
    assert_eq!(std::fs::read(&world.claude_file).unwrap(), original);
    assert!(world.codex_file.is_file());
}

#[test]
fn a_canceled_import_keeps_what_it_finished() {
    let world = World::new();
    world.scan();
    let keys = vec![
        format!("claude:{CLAUDE_SESSION}"),
        format!("codex:{CODEX_THREAD}"),
    ];
    world.imports.begin(keys.len()).unwrap();
    assert!(world.imports.begin(1).is_err(), "one import at a time");
    let imports = &world.imports;
    let progress = imports.run(keys, &world.projects, &|| {
        if imports.progress().current.is_some() {
            imports.cancel();
        }
    });
    assert!(progress.canceled);
    assert_eq!(progress.done, 1);
    assert_eq!(progress.imported, 1);
    assert_eq!(world.imports.store.records().unwrap().len(), 1);
    // The next import starts fresh.
    world.imports.begin(1).unwrap();
    let next = world.imports.run(
        vec![format!("codex:{CODEX_THREAD}")],
        &world.projects,
        &|| {},
    );
    assert!(!next.canceled);
    assert_eq!(next.imported, 1);
}

#[test]
fn an_unreadable_index_is_reported_and_left_alone() {
    let fixture = Fixture::new();
    let directory = fixture.path("imported-conversations");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("index.json"), b"{not json").unwrap();
    let store = Store::new(directory.clone());
    assert!(store.records().unwrap_err().contains("could not be read"));
    assert!(
        store.commit(vec![]).is_ok(),
        "an empty batch writes nothing"
    );
    assert!(store.mark_continued("claude:x", "c").is_err());
    assert_eq!(
        std::fs::read(directory.join("index.json")).unwrap(),
        b"{not json"
    );
    std::fs::write(
        directory.join("index.json"),
        br#"{"version": 99, "conversations": {}}"#,
    )
    .unwrap();
    assert!(Store::new(directory)
        .records()
        .unwrap_err()
        .contains("newer version"));
}

#[test]
fn imported_conversations_say_why_they_cannot_continue() {
    let world = World::new();
    world.scan();
    world.import(&[
        format!("claude:{CLAUDE_SESSION}"),
        format!("codex:{CODEX_THREAD}"),
    ]);
    let records = world.imports.store.records().unwrap();
    let described = describe(records.clone(), &world.projects, &|_| None);
    assert!(described
        .iter()
        .all(|conversation| conversation.unavailable.is_none() && !conversation.changed));

    // The account check decides when the folder and project are fine.
    let described = describe(records.clone(), &world.projects, &|session| {
        Some(format!("{} is not installed.", session.agent_name))
    });
    assert!(
        described
            .iter()
            .any(|conversation| conversation.unavailable.as_deref()
                == Some("Codex is not installed."))
    );

    // Without its project it stays read-only and says why.
    let described = describe(records.clone(), &[], &|_| None);
    assert!(described.iter().all(|conversation| conversation
        .unavailable
        .as_deref()
        .is_some_and(|reason| reason.contains("Add it as a project"))));

    // A folder that is gone.
    let mut moved = records[0].clone();
    moved.cwd = world.fixture.path("gone").to_string_lossy().into_owned();
    let described = describe(vec![moved], &world.projects, &|_| None);
    assert!(described[0]
        .unavailable
        .as_deref()
        .unwrap()
        .ends_with("no longer exists."));

    // A source that grew since.
    std::fs::OpenOptions::new()
        .append(true)
        .open(&world.codex_file)
        .unwrap()
        .write_all(b"\n")
        .unwrap();
    let described = describe(records, &world.projects, &|_| None);
    assert!(described
        .iter()
        .any(|conversation| conversation.record.agent == "codex" && conversation.changed));
}

#[test]
fn repository_roots_name_the_main_checkout() {
    let fixture = Fixture::new();
    let repo = fixture.repository("repo");
    let output = Command::new("git")
        .args(["worktree", "add", "-q", "-b", "side", "../side"])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        repository_root(&Location::of(&fixture.path("side"))),
        Some(repo.clone())
    );
    assert_eq!(repository_root(&Location::of(&repo)), Some(repo));
    std::fs::create_dir_all(fixture.path("plain")).unwrap();
    assert_eq!(repository_root(&Location::of(&fixture.path("plain"))), None);
}

/// Reads this computer's own Claude Code and Codex stores and imports every session into a
/// temporary folder, never a profile. Prints what it found; source files must not change.
#[test]
#[ignore = "Reads the local ~/.claude and ~/.codex session stores; imports into a temporary folder"]
fn trial_against_local_session_stores() {
    let home = crate::commands::platform::home_dir().expect("a home directory");
    let homes: Vec<_> = Source::ALL
        .into_iter()
        .map(|source| {
            let directory = crate::commands::agents::find(source.adapter())
                .unwrap()
                .default_directory(&home);
            (source, directory)
        })
        .filter(|(_, directory)| directory.is_dir())
        .collect();
    let mut index = Index::default();
    index.refresh(&homes);
    let before: Vec<_> = index
        .files
        .keys()
        .map(|path| (path.clone(), file_state(path)))
        .collect();
    let unrecognized = index
        .files
        .values()
        .filter(|entry| entry.summary.is_none())
        .count();
    let untitled = index
        .files
        .values()
        .filter(|entry| entry.summary.as_ref().is_some_and(|s| s.title.is_none()))
        .count();
    let fixture = Fixture::new();
    let imports = Imports::new(fixture.path("imported-conversations"));
    let data = fixture.path("data");
    let recorded = Default::default();
    let started = std::time::Instant::now();
    let first = imports
        .scan(
            &homes,
            &[],
            &Scope {
                projects: &[],
                recorded: &recorded,
                data_directory: &data,
            },
        )
        .unwrap();
    let scanned = started.elapsed();
    // Every folder that still exists stands in for a project.
    let projects: Vec<_> = first
        .groups
        .iter()
        .filter(|group| group.exists)
        .enumerate()
        .map(|(index, group)| ProjectFolder::new(&format!("project-{index}"), &group.path))
        .collect();
    let scan = imports
        .scan(
            &homes,
            &projects,
            &Scope {
                projects: &projects,
                recorded: &recorded,
                data_directory: &data,
            },
        )
        .unwrap();
    let sessions: Vec<_> = scan
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter())
        .collect();
    let keys: Vec<_> = sessions.iter().map(|session| session.key.clone()).collect();
    let started = std::time::Instant::now();
    imports.begin(keys.len()).unwrap();
    let progress = imports.run(keys, &projects, &|| {});
    let imported = started.elapsed();
    let records = imports.store.records().unwrap();
    let mut transcripts = 0;
    for record in &records {
        transcripts += imports.store.transcript(&record.id).unwrap().len();
    }
    let after: Vec<_> = before
        .iter()
        .map(|(path, _)| (path.clone(), file_state(path)))
        .collect();
    let changed_sources = before
        .iter()
        .zip(&after)
        .filter(|(left, right)| left.1 != right.1)
        .count();
    println!("stores: {:?}", scan.stores);
    println!(
        "files indexed: {} (not recognized as sessions: {unrecognized}, no prompt yet: {untitled})",
        index.files.len()
    );
    for source in Source::ALL {
        let listed: Vec<_> = sessions
            .iter()
            .filter(|session| session.agent == source.adapter())
            .collect();
        let saved: Vec<_> = records
            .iter()
            .filter(|record| record.agent == source.adapter())
            .collect();
        println!(
            "{}: {} sessions, {} messages; imported {}, skipped lines {}, oldest entries left out {}, subagent lines {}",
            source.adapter(),
            listed.len(),
            listed.iter().map(|session| session.messages).sum::<usize>(),
            saved.len(),
            saved.iter().map(|record| record.skipped_lines).sum::<usize>(),
            saved.iter().map(|record| record.earlier).sum::<usize>(),
            saved.iter().map(|record| record.subagent_lines).sum::<usize>(),
        );
    }
    for record in records.iter().filter(|record| record.skipped_lines > 0) {
        println!(
            "  {} skipped {} lines ({})",
            record.id,
            record.skipped_lines,
            record.source_path.display()
        );
    }
    println!(
        "groups: {} ({} folders gone); first scan {scanned:?}; import {imported:?}; transcript entries {transcripts}",
        scan.groups.len(),
        scan.groups.iter().filter(|group| !group.exists).count(),
    );
    println!(
        "progress: done {} imported {} updated {} unchanged {} problems {} error {:?}",
        progress.done,
        progress.imported,
        progress.updated,
        progress.unchanged,
        progress.problems.len(),
        progress.error
    );
    let mut reasons: HashMap<String, usize> = HashMap::new();
    for problem in &progress.problems {
        let reason = problem
            .reason
            .split_once(" is not in")
            .map_or(problem.reason.clone(), |_| {
                "folder gone or not a project".into()
            });
        *reasons.entry(reason).or_default() += 1;
    }
    println!("problems by reason: {reasons:?}");
    println!("source files changed during the trial: {changed_sources}");
    for (left, right) in before
        .iter()
        .zip(&after)
        .filter(|(left, right)| left.1 != right.1)
    {
        let grew =
            matches!((left.1, right.1), (Some(left), Some(right)) if right.size >= left.size);
        println!("  {} (grew: {grew})", left.0.display());
    }
}

#[test]
fn transcripts_that_escape_heavily_still_fit_and_read_back() {
    let fixture = Fixture::new();
    let store = Store::new(fixture.path("imported-conversations"));
    // Each control character is saved as six bytes, so the text alone underestimates the
    // file by far more than the reader's margin.
    let mut entries: Vec<_> = (0..1_000)
        .map(|index| TranscriptEntry {
            role: Role::Assistant,
            text: format!("{index} {}", "\u{1}".repeat(12_000)),
            tools: Vec::new(),
            attachments: Vec::new(),
            at: None,
        })
        .collect();
    let mut earlier = 0;
    let size = fit(&mut entries, &mut earlier);
    assert!(size <= TRANSCRIPT_BYTES);
    assert!(earlier > 0 && entries.last().unwrap().text.starts_with("999 "));
    let id = format!("claude:{CLAUDE_SESSION}");
    let record = ImportedRecord {
        id: id.clone(),
        agent: "claude".into(),
        session_id: CLAUDE_SESSION.into(),
        project_id: "project-1".into(),
        title: "Escaped".into(),
        cwd: fixture.root.to_string_lossy().into_owned(),
        branch: None,
        started_at: None,
        last_at: None,
        imported_at: String::new(),
        messages: 1_000,
        earlier,
        skipped_lines: 0,
        subagent_lines: 0,
        source_path: PathBuf::new(),
        source_home: PathBuf::new(),
        source_size: 0,
        source_modified_ms: 0,
        continued_in: None,
    };
    let kept = entries.len();
    store.commit(vec![(record, entries)]).unwrap();
    assert_eq!(store.transcript(&id).unwrap().len(), kept);
}

#[test]
fn a_panicking_import_ends_with_its_message() {
    let world = World::new();
    world.scan();
    world.imports.begin(1).unwrap();
    world.imports.run_guarded(
        vec![format!("claude:{CLAUDE_SESSION}")],
        &|| {
            vec![ProjectFolder::new(
                "project-1",
                world.repo.to_str().unwrap(),
            )]
        },
        &|| panic!("fixture failure"),
    );
    let progress = world.imports.progress();
    assert!(!progress.running);
    assert!(progress
        .error
        .as_deref()
        .is_some_and(|error| error.contains("fixture failure")));
    // The next import can start.
    world.imports.begin(1).unwrap();
}

/// Project discovery with this computer's own session folders, read-only. Prints what it
/// found; no project or profile is changed.
#[test]
#[ignore = "Reads the local session stores, code folders and Git metadata"]
fn trial_project_discovery_with_local_sessions() {
    use crate::commands::project_discovery::{discover, Inputs};
    let home = crate::commands::platform::home_dir().expect("a home directory");
    let homes: Vec<_> = Source::ALL
        .into_iter()
        .map(|source| {
            let directory = crate::commands::agents::find(source.adapter())
                .unwrap()
                .default_directory(&home);
            (source, directory)
        })
        .filter(|(_, directory)| directory.is_dir())
        .collect();
    let fixture = Fixture::new();
    let imports = Imports::new(fixture.path("imported-conversations"));
    let started = std::time::Instant::now();
    let folders = imports.folders(&homes, &Default::default(), &fixture.path("data"));
    let read = started.elapsed();
    let mut inputs = Inputs::for_home(home);
    inputs.sessions = folders.clone();
    let scan = discover(&inputs, std::time::Instant::now() + Duration::from_secs(4));
    println!(
        "{} session folders read in {read:?}; {} candidates in {:?}, truncated {}",
        folders.len(),
        scan.candidates.len(),
        started.elapsed(),
        scan.truncated
    );
    for candidate in &scan.candidates {
        println!(
            "{} sessions {} {:?} last commit {:?} recommended {}",
            candidate.name,
            candidate.sessions,
            candidate.sources,
            candidate.last_commit_at,
            candidate.recommended
        );
    }
}

#[test]
fn protected_session_folders_are_grouped_and_described_without_being_opened() {
    let fixture = Fixture::new();
    let home = crate::commands::platform::home_dir().expect("a home directory");
    let guarded = home.join("Desktop/jackalope-import-fixture-never-created");
    fixture.session(
        &format!("claude/projects/-guarded/{CLAUDE_SESSION}.jsonl"),
        CLAUDE_FIXTURE,
        &guarded,
    );
    let imports = Imports::new(fixture.path("imported-conversations"));
    let homes = vec![(Source::Claude, fixture.path("claude"))];
    let recorded = Default::default();
    let data = fixture.path("data");
    let scan_with = |projects: &[ProjectFolder]| {
        imports
            .scan(
                &homes,
                projects,
                &Scope {
                    projects,
                    recorded: &recorded,
                    data_directory: &data,
                },
            )
            .unwrap()
    };
    // Outside a project it is listed by its path, not called gone.
    let scan = scan_with(&[]);
    assert_eq!(scan.groups.len(), 1);
    let group = &scan.groups[0];
    assert_eq!(group.path, guarded.to_string_lossy());
    assert!(group.exists && !group.checked && group.project_id.is_none());

    // A project registered there matches by path text, and the session imports.
    let projects = vec![ProjectFolder::new("guarded", guarded.to_str().unwrap())];
    let scan = scan_with(&projects);
    assert_eq!(scan.groups[0].project_id.as_deref(), Some("guarded"));
    imports.begin(1).unwrap();
    let progress = imports.run(vec![format!("claude:{CLAUDE_SESSION}")], &projects, &|| {});
    assert_eq!(progress.imported, 1, "{progress:?}");
    let described = describe(imports.store.records().unwrap(), &projects, &|_| None);
    assert!(described[0].protected_folder);
    assert_eq!(described[0].unavailable, None);
    let described = describe(imports.store.records().unwrap(), &[], &|_| None);
    assert!(described[0]
        .unavailable
        .as_deref()
        .is_some_and(|reason| reason.contains("Add it as a project")));
}
