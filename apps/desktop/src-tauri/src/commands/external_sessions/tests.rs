use super::*;
use serde_json::json;
use std::process::Command;

const CODEX_THREAD: &str = "01a1c7ae-226e-7643-b0e2-7533cacde529";
const CODEX_ARCHIVED: &str = "01a189aa-0c7c-7d52-adee-4f5d81ad61a5";
const CLAUDE_SESSION: &str = "5f0e1d2c-3b4a-4958-a6b7-c8d9e0f1a2b3";

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("jackalope-external-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Self {
            root: dunce::canonicalize(root).unwrap(),
        }
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    fn write(&self, relative: &str, lines: &[serde_json::Value]) -> PathBuf {
        let text: String = lines.iter().map(|line| format!("{line}\n")).collect();
        self.write_raw(relative, text.as_bytes())
    }

    fn write_raw(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let path = self.path(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, bytes).unwrap();
        path
    }

    /// A repository at `repo` with one commit, a worktree inside it and one beside it.
    fn repository(&self) -> PathBuf {
        let repo = self.path("repo");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        let git = |args: &[&str]| {
            let status = Command::new("git")
                .args(args)
                .current_dir(&repo)
                .env("GIT_AUTHOR_NAME", "Fixture")
                .env("GIT_AUTHOR_EMAIL", "fixture@example.com")
                .env("GIT_COMMITTER_NAME", "Fixture")
                .env("GIT_COMMITTER_EMAIL", "fixture@example.com")
                .output()
                .unwrap();
            assert!(status.status.success(), "{args:?}: {status:?}");
        };
        git(&["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("src/lib.rs"), "fn main() {}\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "Initial"]);
        git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "feature",
            ".worktrees/feature",
        ]);
        git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "jackalope/fix-a1b2",
            ".worktrees/fix-a1b2",
        ]);
        let beside = self.path("repo-beside");
        git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "beside",
            beside.to_str().unwrap(),
        ]);
        repo
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn codex_meta(id: &str, cwd: &Path, branch: &str, source: serde_json::Value) -> serde_json::Value {
    json!({
        "timestamp": "2026-11-10T15:57:20.000Z",
        "type": "session_meta",
        "payload": {
            "id": id,
            "session_id": id,
            "cwd": cwd,
            "git": {"branch": branch, "commit_hash": "abc"},
            "timestamp": "2026-11-10T15:57:20.000Z",
            "cli_version": "0.156.0",
            "originator": "codex_cli_rs",
            "source": source,
            "base_instructions": {"text": "You are Codex."}
        }
    })
}

fn codex_user(text: &str) -> serde_json::Value {
    json!({
        "timestamp": "2026-11-10T15:57:21.000Z",
        "type": "response_item",
        "payload": {"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "<environment_context>\n  <cwd>/somewhere</cwd>\n</environment_context>"},
            {"type": "input_text", "text": text}
        ]}
    })
}

fn codex_lines(id: &str, cwd: &Path, prompt: &str) -> Vec<serde_json::Value> {
    vec![
        codex_meta(id, cwd, "main", json!("cli")),
        json!({"type": "event_msg", "payload": {"type": "task_started"}}),
        json!({"type": "response_item", "payload": {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "<permissions instructions>\nwrite\n</permissions instructions>"}]}}),
        json!({"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "# AGENTS.md instructions for /repo\n\nUse pnpm."}]}}),
        codex_user(prompt),
        json!({"type": "response_item", "payload": {"type": "reasoning", "summary": []}}),
        json!({"type": "response_item", "payload": {"type": "function_call", "name": "exec_command", "arguments": "{}", "call_id": "c1"}}),
        json!({"type": "response_item", "payload": {"type": "function_call_output", "call_id": "c1", "output": "ok"}}),
        json!({"type": "response_item", "payload": {"type": "custom_tool_call", "name": "apply_patch", "input": "*** Begin Patch", "call_id": "c2"}}),
        json!({"type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Added the pagination defaults."}]}}),
    ]
}

fn claude_line(
    kind: &str,
    cwd: &Path,
    branch: &str,
    extra: serde_json::Value,
) -> serde_json::Value {
    let mut line = json!({
        "type": kind,
        "sessionId": CLAUDE_SESSION,
        "cwd": cwd,
        "gitBranch": branch,
        "isSidechain": false,
        "timestamp": "2026-11-11T09:00:00.000Z",
        "userType": "external",
        "entrypoint": "cli",
    });
    for (key, value) in extra.as_object().unwrap() {
        line[key] = value.clone();
    }
    line
}

fn claude_lines(session: &str, cwd: &Path, branch: &str, prompt: &str) -> Vec<serde_json::Value> {
    let mut lines = vec![
        json!({"type": "permission-mode", "permissionMode": "default", "sessionId": session}),
        claude_line(
            "user",
            cwd,
            branch,
            json!({"isMeta": true, "message": {"role": "user", "content": "Caveat: The messages below were generated by the user while running local commands."}}),
        ),
        claude_line(
            "user",
            cwd,
            branch,
            json!({"message": {"role": "user", "content": "<command-name>/model</command-name>\n<command-message>model</command-message>"}}),
        ),
        claude_line(
            "user",
            cwd,
            branch,
            json!({"message": {"role": "user", "content": prompt}, "promptSource": "typed"}),
        ),
        claude_line(
            "assistant",
            cwd,
            branch,
            json!({"message": {"role": "assistant", "content": [{"type": "text", "text": "I'll look at the parser."}]}}),
        ),
        claude_line(
            "assistant",
            cwd,
            branch,
            json!({"message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Read", "input": {}}]}}),
        ),
        claude_line(
            "user",
            cwd,
            branch,
            json!({"message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "fn main() {}"}]}}),
        ),
        claude_line(
            "assistant",
            cwd,
            branch,
            json!({"isSidechain": true, "message": {"role": "assistant", "content": [{"type": "text", "text": "Subagent notes"}]}}),
        ),
        claude_line(
            "user",
            cwd,
            branch,
            json!({"isSidechain": true, "message": {"role": "user", "content": "Subagent task"}}),
        ),
        claude_line(
            "assistant",
            cwd,
            branch,
            json!({"message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t2", "name": "Edit", "input": {}}, {"type": "tool_use", "id": "t3", "name": "Bash", "input": {}}]}}),
        ),
        claude_line(
            "assistant",
            cwd,
            branch,
            json!({"message": {"role": "assistant", "content": [{"type": "text", "text": "Fixed the off-by-one."}]}}),
        ),
        json!({"type": "ai-title", "aiTitle": "Parser fix", "sessionId": session}),
    ];
    for line in &mut lines {
        if line.get("sessionId").is_some() {
            line["sessionId"] = json!(session);
        }
    }
    lines
}

fn project(repo: &Path) -> Vec<ProjectFolder> {
    vec![ProjectFolder::new("project-1", repo.to_str().unwrap())]
}

fn listed(
    index: &Index,
    projects: &[ProjectFolder],
    recorded: &[&str],
    data: &Path,
) -> Vec<ExternalSession> {
    let recorded = recorded.iter().map(|id| id.to_string()).collect();
    list(
        index,
        &Scope {
            projects,
            recorded: &recorded,
            data_directory: data,
        },
        &|_| None,
    )
}

#[test]
fn codex_rollouts_are_listed_by_thread_including_compressed_ones() {
    let fixture = Fixture::new();
    let repo = fixture.repository();
    let home = fixture.path("codex");
    fixture.write(
        &format!("codex/sessions/2026/11/10/rollout-2026-11-10T15-57-20-{CODEX_THREAD}.jsonl"),
        &codex_lines(
            CODEX_THREAD,
            &repo,
            "Add pagination defaults to the list endpoint",
        ),
    );
    let archived: String = codex_lines(
        CODEX_ARCHIVED,
        &repo.join(".worktrees/feature"),
        "Rename the config loader",
    )
    .iter()
    .map(|line| format!("{line}\n"))
    .collect();
    fixture.write_raw(
        &format!("codex/archived_sessions/rollout-2026-10-29T15-56-25-{CODEX_ARCHIVED}.jsonl.zst"),
        &ruzstd::encoding::compress_to_vec(
            archived.as_bytes(),
            ruzstd::encoding::CompressionLevel::Fastest,
        ),
    );
    // A subagent thread Codex spawned, a file that is not JSON and one that is not a rollout.
    fixture.write(
        "codex/sessions/2026/11/10/rollout-2026-11-10T16-00-00-01a1c7ae-0000-7000-8000-000000000009.jsonl",
        &[codex_meta("01a1c7ae-0000-7000-8000-000000000009", &repo, "main", json!({"subagent": {"thread_spawn": {}}}))],
    );
    fixture.write_raw(
        "codex/sessions/2026/11/10/rollout-2026-11-10T16-01-00-01a1c7ae-0000-7000-8000-00000000000a.jsonl",
        b"not json\n\x00\xff\n",
    );
    fixture.write_raw("codex/sessions/2026/11/10/notes.txt", b"{}\n");

    let mut index = Index::default();
    assert!(index.refresh(&[(Source::Codex, home.clone())]));
    assert_eq!(index.files.len(), 4, "{:?}", index.files.keys());
    let sessions = listed(&index, &project(&repo), &[], &fixture.path("data"));
    let titles: Vec<_> = sessions
        .iter()
        .map(|s| (s.session_id.as_str(), s.title.as_str()))
        .collect();
    assert_eq!(
        titles.iter().copied().collect::<HashMap<_, _>>(),
        HashMap::from([
            (CODEX_THREAD, "Add pagination defaults to the list endpoint"),
            (CODEX_ARCHIVED, "Rename the config loader"),
        ])
    );
    let current = sessions
        .iter()
        .find(|s| s.session_id == CODEX_THREAD)
        .unwrap();
    assert_eq!(current.key, format!("codex:{CODEX_THREAD}"));
    assert_eq!(current.agent_name, "Codex");
    assert_eq!(current.branch.as_deref(), Some("main"));
    assert_eq!(current.project_id, "project-1");
    assert_eq!(current.unavailable, None);

    let transcript = Source::Codex
        .transcript(
            &sessions
                .iter()
                .find(|s| s.session_id == CODEX_ARCHIVED)
                .unwrap()
                .path,
        )
        .unwrap();
    let entries: Vec<_> = transcript
        .entries
        .iter()
        .map(|e| (e.role, e.text.as_str(), e.tools.clone()))
        .collect();
    assert_eq!(
        entries,
        vec![
            ("user", "Rename the config loader", vec![]),
            (
                "tools",
                "",
                vec!["exec_command".to_string(), "apply_patch".to_string()]
            ),
            ("assistant", "Added the pagination defaults.", vec![]),
        ]
    );
}

#[test]
fn claude_sessions_skip_generated_turns_and_subagent_lines() {
    let fixture = Fixture::new();
    let repo = fixture.repository();
    let home = fixture.path("claude");
    let file = fixture.write(
        &format!("claude/projects/-repo/{CLAUDE_SESSION}.jsonl"),
        &claude_lines(
            CLAUDE_SESSION,
            &repo,
            "main",
            "Fix the off-by-one in the parser",
        ),
    );
    // A subagent's own file sits deeper and is not a session of its own.
    fixture.write(
        &format!("claude/projects/-repo/{CLAUDE_SESSION}/subagents/agent-a1.jsonl"),
        &claude_lines(
            "6a1b2c3d-0000-4000-8000-000000000001",
            &repo,
            "main",
            "Subagent prompt",
        ),
    );
    let mut index = Index::default();
    index.refresh(&[(Source::Claude, home)]);
    assert_eq!(index.files.len(), 1);
    let sessions = listed(&index, &project(&repo), &[], &fixture.path("data"));
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].title, "Fix the off-by-one in the parser");
    assert_eq!(sessions[0].agent, "claude");
    assert_eq!(
        sessions[0].started_at.as_deref(),
        Some("2026-11-11T09:00:00.000Z")
    );

    let transcript = Source::Claude.transcript(&file).unwrap();
    assert_eq!(transcript.subagent_lines, 2);
    let entries: Vec<_> = transcript
        .entries
        .iter()
        .map(|e| (e.role, e.text.as_str(), e.tools.clone()))
        .collect();
    assert_eq!(
        entries,
        vec![
            ("user", "Fix the off-by-one in the parser", vec![]),
            ("assistant", "I'll look at the parser.", vec![]),
            (
                "tools",
                "",
                vec!["Read".to_string(), "Edit".to_string(), "Bash".to_string()]
            ),
            ("assistant", "Fixed the off-by-one.", vec![]),
        ]
    );

    // A session the person never typed into falls back to the CLI's own title, and one
    // with no title at all is not listed.
    fixture.write(
        "claude/projects/-repo/7b2c3d4e-0000-4000-8000-000000000002.jsonl",
        &[
            claude_line("user", &repo, "main", json!({"sessionId": "7b2c3d4e-0000-4000-8000-000000000002", "isMeta": true, "message": {"content": "Caveat"}})),
            json!({"type": "ai-title", "aiTitle": "Resumed review", "sessionId": "7b2c3d4e-0000-4000-8000-000000000002"}),
        ],
    );
    fixture.write(
        "claude/projects/-repo/8c3d4e5f-0000-4000-8000-000000000003.jsonl",
        &[claude_line(
            "system",
            &repo,
            "main",
            json!({"sessionId": "8c3d4e5f-0000-4000-8000-000000000003"}),
        )],
    );
    index.refresh(&[(Source::Claude, fixture.path("claude"))]);
    let titles: Vec<_> = listed(&index, &project(&repo), &[], &fixture.path("data"))
        .into_iter()
        .map(|session| session.title)
        .collect();
    assert!(titles.contains(&"Resumed review".to_string()), "{titles:?}");
    assert_eq!(titles.len(), 2, "{titles:?}");
}

#[test]
fn sessions_in_worktrees_group_under_their_project_and_jackalope_runs_are_left_out() {
    let fixture = Fixture::new();
    let repo = fixture.repository();
    let data = fixture.path("data/task-runs-v1");
    std::fs::create_dir_all(data.join("routing/attempt")).unwrap();
    let session = |n: u32| format!("9d4e5f60-0000-4000-8000-{n:012}");
    let cases = [
        (1, repo.clone(), "main"),
        (2, repo.join(".worktrees/feature"), "feature"),
        (3, fixture.path("repo-beside"), "beside"),
        // Jackalope's own worktree, its data folder and an attempt it recorded.
        (4, repo.join(".worktrees/fix-a1b2"), "jackalope/fix-a1b2"),
        (5, data.join("routing/attempt"), "main"),
        (6, repo.clone(), "main"),
        // Another repository, a subfolder and a worktree that was removed.
        (7, fixture.path("elsewhere"), "main"),
        (8, repo.join("src"), "main"),
        (9, repo.join(".worktrees/removed"), "removed"),
    ];
    std::fs::create_dir_all(fixture.path("elsewhere")).unwrap();
    for (n, cwd, branch) in &cases {
        let id = session(*n);
        fixture.write(
            &format!("claude/projects/-p{n}/{id}.jsonl"),
            &claude_lines(&id, cwd, branch, &format!("Prompt {n}")),
        );
    }
    let mut index = Index::default();
    index.refresh(&[(Source::Claude, fixture.path("claude"))]);
    let sessions = listed(&index, &project(&repo), &[&session(6)], &data);
    let mut found: Vec<_> = sessions
        .iter()
        .map(|s| (s.title.as_str(), s.unavailable.is_some()))
        .collect();
    found.sort();
    assert_eq!(
        found,
        vec![
            ("Prompt 1", false),
            ("Prompt 2", false),
            ("Prompt 3", false),
            ("Prompt 8", true),
            ("Prompt 9", true),
        ]
    );
    assert!(sessions.iter().all(|s| s.project_id == "project-1"));
    let subfolder = sessions.iter().find(|s| s.title == "Prompt 8").unwrap();
    assert_eq!(subfolder.unavailable.as_deref(), Some(SUBFOLDER));
    let removed = sessions.iter().find(|s| s.title == "Prompt 9").unwrap();
    assert!(removed
        .unavailable
        .as_deref()
        .unwrap()
        .ends_with("no longer exists."));

    // The account check decides the rest.
    let recorded = HashSet::new();
    let refused = list(
        &index,
        &Scope {
            projects: &project(&repo),
            recorded: &recorded,
            data_directory: &data,
        },
        &|session| (session.title == "Prompt 2").then(|| "Not an account".to_string()),
    );
    assert_eq!(
        refused
            .iter()
            .find(|s| s.title == "Prompt 2")
            .unwrap()
            .unavailable
            .as_deref(),
        Some("Not an account")
    );
}

#[test]
fn the_index_rereads_only_new_changed_or_rewritten_files() {
    let fixture = Fixture::new();
    let repo = fixture.repository();
    let home = fixture.path("claude");
    let homes = [(Source::Claude, home.clone())];
    let file = fixture.write(
        &format!("claude/projects/-repo/{CLAUDE_SESSION}.jsonl"),
        &claude_lines(CLAUDE_SESSION, &repo, "main", "First prompt"),
    );
    let mut index = Index::default();
    assert!(index.refresh(&homes));
    assert!(
        !index.refresh(&homes),
        "an unchanged store is not read again"
    );

    // Appending keeps the summary of a file whose start was already understood.
    let mut appended = std::fs::read_to_string(&file).unwrap();
    appended.push_str(&format!(
        "{}\n",
        claude_line(
            "user",
            &repo,
            "main",
            json!({"message": {"content": "Later prompt"}})
        )
    ));
    std::fs::write(&file, &appended).unwrap();
    assert!(index.refresh(&homes));
    let entry = &index.files[&file];
    assert_eq!(entry.size, appended.len() as u64);
    assert_eq!(
        entry.summary.as_ref().unwrap().title.as_deref(),
        Some("First prompt")
    );

    // A rewritten (shorter) file is read again.
    fixture.write(
        &format!("claude/projects/-repo/{CLAUDE_SESSION}.jsonl"),
        &claude_lines(CLAUDE_SESSION, &repo, "main", "Rewritten"),
    );
    assert!(index.refresh(&homes));
    assert_eq!(
        index.files[&file]
            .summary
            .as_ref()
            .unwrap()
            .title
            .as_deref(),
        Some("Rewritten")
    );

    // A file with no prompt yet is read again as it grows.
    let early = fixture.write(
        "claude/projects/-repo/7b2c3d4e-0000-4000-8000-000000000002.jsonl",
        &[claude_line(
            "system",
            &repo,
            "main",
            json!({"sessionId": "7b2c3d4e-0000-4000-8000-000000000002"}),
        )],
    );
    index.refresh(&homes);
    assert_eq!(index.files[&early].summary.as_ref().unwrap().title, None);
    let mut grown = std::fs::read_to_string(&early).unwrap();
    grown.push_str(&format!(
        "{}\n",
        claude_line("user", &repo, "main", json!({"sessionId": "7b2c3d4e-0000-4000-8000-000000000002", "message": {"content": "Now typed"}}))
    ));
    std::fs::write(&early, grown).unwrap();
    assert!(index.refresh(&homes));
    assert_eq!(
        index.files[&early]
            .summary
            .as_ref()
            .unwrap()
            .title
            .as_deref(),
        Some("Now typed")
    );

    // It survives a restart, and an unreadable or older index starts over.
    let saved = fixture.path("data/index.json");
    index.save(&saved).unwrap();
    let mut reloaded = Index::load(&saved);
    assert_eq!(reloaded.files, index.files);
    assert!(!reloaded.refresh(&homes));
    std::fs::write(&saved, b"{\"version\":0,\"files\":{}}").unwrap();
    assert!(Index::load(&saved).files.is_empty());
    std::fs::write(&saved, b"\x00 not json").unwrap();
    assert!(Index::load(&saved).files.is_empty());

    // Removed files, and stores no longer read, leave the index.
    std::fs::remove_file(&early).unwrap();
    assert!(index.refresh(&homes));
    assert!(!index.files.contains_key(&early));
    assert!(index.refresh(&[]));
    assert!(index.files.is_empty());
}

#[test]
fn malformed_and_oversized_lines_are_skipped() {
    let fixture = Fixture::new();
    let repo = fixture.repository();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"[1,2,3]\n\"text\"\n{broken\n");
    bytes.extend(std::iter::repeat_n(b'x', 5 * 1024 * 1024));
    bytes.push(b'\n');
    for line in claude_lines(CLAUDE_SESSION, &repo, "main", "Survives noise") {
        bytes.extend_from_slice(format!("{line}\n").as_bytes());
    }
    let file = fixture.write_raw(
        &format!("claude/projects/-repo/{CLAUDE_SESSION}.jsonl"),
        &bytes,
    );
    assert_eq!(
        Source::Claude
            .summarize(&file)
            .and_then(|summary| summary.title),
        None,
        "the prompt is past the bytes a summary reads"
    );
    let transcript = Source::Claude.transcript(&file).unwrap();
    assert_eq!(transcript.entries[0].text, "Survives noise");

    // Unsafe session IDs and relative folders are not sessions.
    for (id, cwd) in [
        ("../../etc/passwd", "/tmp"),
        ("short", "/tmp"),
        (CLAUDE_SESSION, "relative/path"),
    ] {
        let lines = vec![
            json!({"type": "user", "sessionId": id, "cwd": cwd, "message": {"content": "Hi"}}),
        ];
        assert_eq!(claude::summarize(lines.into_iter()), None, "{id} {cwd}");
    }
    assert_eq!(codex::summarize(std::iter::empty()), None);
    assert_eq!(
        codex::summarize([json!({"type": "event_msg", "payload": {}})].into_iter()),
        None
    );
    // A truncated compressed rollout reads as far as it goes or not at all.
    let compressed = ruzstd::encoding::compress_to_vec(
        format!(
            "{}\n",
            codex_meta(CODEX_THREAD, &repo, "main", json!("cli"))
        )
        .as_bytes(),
        ruzstd::encoding::CompressionLevel::Fastest,
    );
    let cut = fixture.write_raw("rollout-cut.jsonl.zst", &compressed[..compressed.len() / 2]);
    let _ = Source::Codex.summarize(&cut);
    let garbage = fixture.write_raw("rollout-garbage.jsonl.zst", b"not zstd");
    assert_eq!(Source::Codex.summarize(&garbage), None);
}

#[test]
fn titles_are_one_trimmed_line() {
    assert_eq!(
        read::title("  Fix\n  the   parser \n"),
        Some("Fix the parser".into())
    );
    assert_eq!(read::title(" \n "), None);
    let long = read::title(&"word ".repeat(100)).unwrap();
    assert_eq!(long.chars().count(), 121);
    assert!(long.ends_with('…'));
    assert!(read::generated(
        "<environment_context>\n<cwd>/x</cwd>\n</environment_context>"
    ));
    assert!(read::generated("<command-name>/clear</command-name>"));
    assert!(!read::generated("<div> is misaligned, fix it"));
}
