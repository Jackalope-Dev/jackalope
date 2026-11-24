use super::*;
use crate::commands::agent_policy::{AgentPolicy, CustomAgent};
use crate::commands::agent_profiles::AccountBinding;

fn binding(adapter: &str) -> Option<AccountBinding> {
    Some(AccountBinding {
        adapter: adapter.into(),
        profile_id: None,
        directory: PathBuf::from("/accounts/default"),
        label: "Default".into(),
    })
}

fn checkpoint(id: &str) -> TurnCheckpoint {
    TurnCheckpoint {
        reference: format!("refs/jackalope/checkpoints/task/{id}"),
        commit: "c".repeat(40),
        head: "h".repeat(40),
        tree: "t".repeat(40),
    }
}

/// A finished turn of task `task`, `minute` minutes into it.
fn turn(adapter: &str, id: &str, minute: u32) -> TaskRun {
    let mut run = super::super::tests::sample(adapter);
    run.id = id.into();
    run.task_id = "task".into();
    run.status = RunStatus::Review;
    run.started_at = format!("2026-11-24T10:{minute:02}:00+00:00");
    run.workspace = "/work/tree".into();
    run.project_path = "/work/project".into();
    run.branch = "jackalope/task".into();
    run.account_binding = binding(adapter);
    run.session_id = Some("session".into());
    run.rewind.checkpoint = Some(checkpoint(id));
    run.rewind.mark = Some(ConversationMark {
        session: "session".into(),
        entry: format!("{id}-last"),
    });
    run
}

fn conversation(adapter: &str) -> Vec<TaskRun> {
    vec![
        turn(adapter, "turn-1", 1),
        turn(adapter, "turn-2", 2),
        turn(adapter, "turn-3", 3),
    ]
}

#[test]
fn only_checkpointed_claude_and_codex_turns_can_be_rewound() {
    let runs = conversation("claude");
    let (preview, prepared, _) = plan(&runs, "turn-2").unwrap();
    assert_eq!((preview.turn, preview.undone), (2, 2));
    assert_eq!(preview.latest_run_id, "turn-3");
    assert_eq!(prepared.rewound, ["turn-2", "turn-3"]);
    // The conversation returns to where the turn before ended.
    assert_eq!(
        prepared.resume,
        RewindResume::Claude {
            session: "session".into(),
            at: "turn-1-last".into()
        }
    );
    // The first turn starts the conversation over.
    let (first, prepared, _) = plan(&runs, "turn-1").unwrap();
    assert_eq!((first.turn, first.undone), (1, 3));
    assert_eq!(prepared.resume, RewindResume::New);
    assert_eq!(first.conversation, "new");

    let codex = conversation("codex");
    let (preview, prepared, previous) = plan(&codex, "turn-3").unwrap();
    assert_eq!((preview.turn, preview.undone), (3, 1));
    assert_eq!(previous.unwrap().id, "turn-2");
    assert!(matches!(prepared.resume, RewindResume::Codex { .. }));

    for adapter in ["opencode", "gemini", "kimi", "grok", "antigravity"] {
        let error = plan(&conversation(adapter), "turn-2").err().unwrap();
        assert!(error.contains("cannot return its conversation"), "{error}");
    }
}

#[test]
fn a_turn_without_a_checkpoint_or_a_conversation_mark_is_not_offered() {
    let mut runs = conversation("claude");
    runs[1].rewind.checkpoint = None;
    assert!(plan(&runs, "turn-2")
        .err()
        .unwrap()
        .contains("saved no copy of the files"));
    runs[1].rewind.checkpoint_error = Some("disk full".into());
    assert!(plan(&runs, "turn-2").err().unwrap().contains("disk full"));

    let mut runs = conversation("claude");
    runs[0].rewind.mark = None;
    assert!(plan(&runs, "turn-2")
        .err()
        .unwrap()
        .contains("did not record where the agent's conversation stood"));
    // A mark from a conversation the turn later replaced does not count either.
    runs[0].rewind.mark = Some(ConversationMark {
        session: "older".into(),
        entry: "x".into(),
    });
    assert!(plan(&runs, "turn-2").is_err());
    // The first turn needs no mark.
    assert!(plan(&runs, "turn-1").is_ok());
}

#[test]
fn rewinds_are_refused_while_a_turn_runs_and_for_work_they_cannot_restore() {
    let mut runs = conversation("claude");
    runs[2].status = RunStatus::Running;
    assert!(plan(&runs, "turn-1")
        .err()
        .unwrap()
        .contains("Stop the running turn"));
    runs[2].status = RunStatus::Review;
    runs[2].finishing = true;
    assert!(plan(&runs, "turn-1").is_err());

    let mut runs = conversation("claude");
    runs[2].remote = Some(Default::default());
    assert!(plan(&runs, "turn-1").err().unwrap().contains("computer"));

    let mut runs = conversation("claude");
    runs[2].workspace = "/elsewhere".into();
    assert!(plan(&runs, "turn-2")
        .err()
        .unwrap()
        .contains("another workspace"));
    // Turns before the one rewound to do not matter.
    assert!(plan(&runs, "turn-3").is_ok());

    let mut runs = conversation("claude");
    runs[1].retry_of = Some("turn-1".into());
    assert!(plan(&runs, "turn-2").err().unwrap().contains("retried"));

    let mut runs = conversation("claude");
    runs[0].continues = Some(crate::commands::tasks::ContinuedSession {
        adapter: "claude".into(),
        session_id: "outside".into(),
        workspace: "/work/tree".into(),
        home: "/accounts/default".into(),
    });
    assert!(plan(&runs, "turn-1")
        .err()
        .unwrap()
        .contains("outside Jackalope"));
    assert!(plan(&runs, "turn-2").is_ok());
}

#[test]
fn rewound_turns_are_skipped_when_counting_and_cannot_be_rewound_to_again() {
    let mut runs = conversation("claude");
    for run in &mut runs[1..] {
        run.rewind.rewound = Some(Rewound {
            rewind_id: "r".into(),
            at: "now".into(),
        });
    }
    let mut fourth = turn("claude", "turn-4", 4);
    fourth.rewind.mark = Some(ConversationMark {
        session: "session".into(),
        entry: "turn-4-last".into(),
    });
    runs.push(fourth);
    assert!(plan(&runs, "turn-3")
        .err()
        .unwrap()
        .contains("already undid"));
    // Turn 4 continued turn 1, so it is the second turn in effect and resumes after turn 1.
    let (preview, prepared, _) = plan(&runs, "turn-4").unwrap();
    assert_eq!((preview.turn, preview.undone), (2, 1));
    assert_eq!(
        prepared.resume,
        RewindResume::Claude {
            session: "session".into(),
            at: "turn-1-last".into()
        }
    );
}

#[test]
fn saved_attempts_without_rewind_fields_still_load() {
    let run = super::super::tests::sample("claude");
    let mut value = serde_json::to_value(&run).unwrap();
    assert!(value.get("rewind").is_none(), "empty state is not saved");
    value.as_object_mut().unwrap().remove("rewind");
    let loaded: TaskRun = serde_json::from_value(value).unwrap();
    assert!(loaded.rewind.is_empty());
}

fn git(path: &Path, args: &[&str]) -> String {
    super::super::git(path.to_str().unwrap(), args).unwrap()
}

/// A one-shot Claude Code stand-in. It logs its arguments, writes the file a prompt names
/// with `WRITE <name>` into its working folder, and reports a session: a new one, the one
/// it resumed, or a fork when asked to cut the resumed session at a message.
const FAKE_CLAUDE: &str = r#"
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'processes.jsonl'), JSON.stringify({ args }) + '\n');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const send = (value) => console.log(JSON.stringify(value));
  const resume = args.indexOf('--resume');
  const forked = args.includes('--fork-session');
  const session = resume >= 0 && !forked ? args[resume + 1] : `session-${Date.now()}-${process.pid}`;
  const write = input.match(/WRITE (\S+)/);
  if (write) fs.writeFileSync(write[1], `${write[1]}\n`);
  send({ type: 'system', subtype: 'init', session_id: session, uuid: crypto.randomUUID() });
  send({ type: 'assistant', session_id: session, parent_tool_use_id: null, uuid: crypto.randomUUID(), message: { id: `m-${process.pid}`, content: [{ type: 'text', text: 'Done' }] } });
  send({ type: 'result', subtype: 'success', is_error: false, session_id: session, result: 'Done', uuid: crypto.randomUUID() });
});
"#;

struct Fixture {
    root: PathBuf,
    repo: PathBuf,
    history: PathBuf,
    runtime: Option<TaskRuntime>,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jackalope-rewind-{}", uuid::Uuid::new_v4()));
        let repo = super::super::tests::trial_repository(&root);
        std::fs::write(repo.join(".gitignore"), "ignored.txt\n").unwrap();
        git(&repo, &["add", ".gitignore"]);
        git(&repo, &["commit", "-qm", "Ignore a file"]);
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("fake-claude.cjs"), FAKE_CLAUDE).unwrap();
        let executable = if cfg!(windows) {
            let path = bin.join("fake-claude.cmd");
            std::fs::write(&path, "@echo off\r\nnode \"%~dp0fake-claude.cjs\" %*\r\n").unwrap();
            path
        } else {
            let path = bin.join("fake-claude.sh");
            std::fs::write(
                &path,
                "#!/bin/sh\nexec node \"$(dirname \"$0\")/fake-claude.cjs\" \"$@\"\n",
            )
            .unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        };
        let history = root.join("history");
        let runtime = TaskRuntime::with_test_access(history.clone()).unwrap();
        let mut policy = AgentPolicy::default();
        policy.custom_agents.push(CustomAgent {
            id: "claude-rewind".into(),
            name: "Claude fixture".into(),
            command: executable.to_string_lossy().into(),
            adapter: Some("claude".into()),
            args: Vec::new(),
        });
        std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
        std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
        Self {
            root,
            repo,
            history,
            runtime: Some(runtime),
        }
    }

    fn runtime(&self) -> &TaskRuntime {
        self.runtime.as_ref().unwrap()
    }

    fn turn(&self, id: &str, file: &str, previous: Option<&str>) -> TaskRun {
        let mut request = super::super::tests::trial_request(
            &self.repo,
            "claude-rewind",
            None,
            &format!("WRITE {file}"),
        );
        request.project_id = "rewind-fixture".into();
        request.id = id.into();
        request.previous_run_id = previous.map(str::to_string);
        super::super::claude_session::set_test_settings(
            "rewind-fixture",
            super::super::claude_session::Settings::default(),
        );
        self.runtime().start(request).unwrap();
        let run = super::super::tests::trial_settled(self.runtime(), id, Duration::from_secs(60))
            .expect("the fixture turn finished");
        assert_eq!(
            run.status,
            RunStatus::Review,
            "{:?} {:?}",
            run.error,
            run.activity
        );
        run
    }

    fn arguments(&self) -> Vec<Vec<String>> {
        std::fs::read_to_string(self.root.join("bin/processes.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap()["args"].clone())
            .map(|args| serde_json::from_value(args).unwrap())
            .collect()
    }

    fn rewind(&self, run_id: &str, latest: &str) -> Result<RewindOutcome, String> {
        let prepared = self.runtime().prepare_rewind(run_id, latest)?;
        let guard = crate::commands::integration::execution_guard()?;
        self.runtime().apply_rewind(&guard, prepared)
    }

    fn undo(&self, run_id: &str) -> Result<(), String> {
        let guard = crate::commands::integration::execution_guard()?;
        self.runtime().undo_rewind(&guard, run_id)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.stop_all();
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn files(workspace: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(workspace)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name != ".git" && name != ".jackalope")
        .collect();
    names.sort();
    names
}

#[test]
fn a_rewind_restores_files_resumes_the_earlier_conversation_and_survives_a_restart() {
    let fixture = Fixture::new();
    let one = fixture.turn("rewind-turn-one", "one.txt", None);
    let two = fixture.turn("rewind-turn-two", "two.txt", Some(&one.id));
    let three = fixture.turn("rewind-turn-three", "three.txt", Some(&two.id));
    let workspace = PathBuf::from(&three.workspace);
    let branch_ref = format!("refs/heads/{}", three.branch);
    // Each turn saved the files it started from under a hidden ref no branch contains.
    for run in [&one, &two, &three] {
        let saved = run.rewind.checkpoint.as_ref().expect("a turn checkpoint");
        assert!(saved.reference.starts_with("refs/jackalope/checkpoints/"));
        assert_eq!(
            git(&workspace, &["rev-parse", &saved.reference]),
            saved.commit
        );
        assert!(git(&workspace, &["branch", "--contains", &saved.commit]).is_empty());
        assert!(run.rewind.mark.is_some());
    }
    // The person's own edits since the last turn: a changed, a new and an ignored file.
    std::fs::write(workspace.join("one.txt"), "edited by hand\n").unwrap();
    std::fs::write(workspace.join("notes.txt"), "my notes\n").unwrap();
    std::fs::write(workspace.join("ignored.txt"), "local\n").unwrap();
    let head_before = git(&workspace, &["rev-parse", &branch_ref]);

    let preview = fixture.runtime().rewind_preview(&two.id).unwrap();
    assert_eq!((preview.turn, preview.undone), (2, 2));
    assert_eq!(preview.prompt, "WRITE two.txt");
    // A preview names the newest turn; anything newer makes the rewind stale.
    assert!(fixture
        .rewind(&two.id, &two.id)
        .err()
        .unwrap()
        .contains("Newer work"));
    let outcome = fixture.rewind(&two.id, &three.id).unwrap();
    assert_eq!(outcome.prompt, "WRITE two.txt");
    assert_eq!(
        files(&workspace),
        [".gitignore", "README.md", "ignored.txt", "one.txt"]
    );
    assert_eq!(
        std::fs::read_to_string(workspace.join("one.txt")).unwrap(),
        "one.txt\n"
    );
    // Ignored files are left alone and the branch never moves back.
    assert_eq!(
        std::fs::read_to_string(workspace.join("ignored.txt")).unwrap(),
        "local\n"
    );
    assert_eq!(git(&workspace, &["rev-parse", &branch_ref]), head_before);
    // Everything the rewind replaced is in its safety snapshot.
    let safety = &outcome.rewind.safety;
    assert_eq!(
        git(
            &workspace,
            &["show", &format!("{}:notes.txt", safety.reference)]
        ),
        "my notes"
    );
    assert_eq!(
        git(
            &workspace,
            &["show", &format!("{}:one.txt", safety.reference)]
        ),
        "edited by hand"
    );
    assert!(git(
        &workspace,
        &["show", &format!("{}:three.txt", safety.reference)]
    )
    .contains("three"));
    let runs = fixture.runtime().integration_runs().unwrap();
    let get = |id: &str| runs.iter().find(|run| run.id == id).unwrap().clone();
    assert!(get(&one.id).rewind.rewound.is_none());
    assert!(get(&two.id).rewind.rewound.is_some());
    assert!(get(&three.id).rewind.rewound.is_some());
    assert_eq!(
        get(&three.id).rewind.pending().unwrap().resume,
        RewindResume::Claude {
            session: one.session_id.clone().unwrap(),
            at: one.rewind.mark.as_ref().unwrap().entry.clone(),
        }
    );
    // A rewound turn cannot be rewound to again, and nothing runs while one is pending
    // without the person sending the edited prompt.
    assert!(fixture.runtime().rewind_preview(&three.id).is_err());

    // Undo brings back the files, including the person's edits, and the turns.
    fixture.undo(&three.id).unwrap();
    assert_eq!(
        files(&workspace),
        [
            ".gitignore",
            "README.md",
            "ignored.txt",
            "notes.txt",
            "one.txt",
            "three.txt",
            "two.txt"
        ]
    );
    assert_eq!(
        std::fs::read_to_string(workspace.join("one.txt")).unwrap(),
        "edited by hand\n"
    );
    let undone = fixture.runtime().run_snapshot(&three.id).unwrap();
    assert!(undone.rewind.rewound.is_none());
    assert!(undone.rewind.pending().is_none());
    assert!(fixture.undo(&three.id).is_err());

    // Rewind again and send the edited turn: Claude Code resumes the first turn's session
    // up to its last message, as a new session.
    fixture.rewind(&two.id, &three.id).unwrap();
    let four = fixture.turn("rewind-turn-four", "four.txt", Some(&three.id));
    let args = fixture.arguments().pop().unwrap();
    let at = args.iter().position(|arg| arg == "--resume").unwrap();
    assert_eq!(args[at + 1], one.session_id.clone().unwrap());
    let cut = args
        .iter()
        .position(|arg| arg == "--resume-session-at")
        .unwrap();
    assert_eq!(args[cut + 1], one.rewind.mark.as_ref().unwrap().entry);
    assert!(args.iter().any(|arg| arg == "--fork-session"));
    assert_ne!(four.session_id, one.session_id);
    assert_eq!(
        files(&workspace),
        [
            ".gitignore",
            "README.md",
            "four.txt",
            "ignored.txt",
            "one.txt"
        ]
    );
    // A turn after the rewind ends the chance to undo it.
    assert!(fixture
        .undo(&three.id)
        .err()
        .unwrap()
        .contains("A turn ran after the rewind"));
    // The turn after it resumes its own session normally.
    let five = fixture.turn("rewind-turn-five", "five.txt", Some(&four.id));
    let args = fixture.arguments().pop().unwrap();
    assert!(!args.iter().any(|arg| arg == "--resume-session-at"));
    assert_eq!(five.session_id, four.session_id);

    // Rewound turns stay in history, marked, after a restart.
    let mut fixture = fixture;
    fixture.runtime.take().unwrap().stop_all();
    std::thread::sleep(Duration::from_millis(200));
    let restored = TaskRuntime::with_test_access(fixture.history.clone()).unwrap();
    let reloaded = restored.integration_runs().unwrap();
    let get = |id: &str| reloaded.iter().find(|run| run.id == id).unwrap().clone();
    assert!(get(&two.id).rewind.rewound.is_some());
    assert!(get(&three.id).rewind.rewound.is_some());
    assert!(get(&four.id).rewind.rewound.is_none());
    assert_eq!(get(&three.id).result, "Done");
    assert!(get(&three.id).rewind.applied.is_some());
    fixture.runtime = Some(restored);
}

#[test]
fn a_rewind_to_the_first_turn_starts_a_new_conversation_and_refuses_a_busy_workspace() {
    let fixture = Fixture::new();
    let one = fixture.turn("first-turn-one", "one.txt", None);
    let two = fixture.turn("first-turn-two", "two.txt", Some(&one.id));
    let workspace = PathBuf::from(&two.workspace);
    // Anything else working in the workspace keeps the files as they are.
    let lease = crate::commands::verification::reserve_workspace(&two.workspace).unwrap();
    let error = fixture.rewind(&one.id, &two.id).err().unwrap();
    assert!(error.contains("verification"), "{error}");
    assert_eq!(
        files(&workspace),
        [".gitignore", "README.md", "one.txt", "two.txt"]
    );
    drop(lease);

    let outcome = fixture.rewind(&one.id, &two.id).unwrap();
    assert_eq!(outcome.rewind.resume, RewindResume::New);
    assert_eq!(files(&workspace), [".gitignore", "README.md"]);
    let three = fixture.turn("first-turn-three", "three.txt", Some(&two.id));
    let args = fixture.arguments().pop().unwrap();
    assert!(!args.iter().any(|arg| arg == "--resume"));
    assert_ne!(three.session_id, one.session_id);
    assert!(three
        .activity
        .iter()
        .any(|line| line.contains("as a new conversation")));
}

/// One tiny real rewind through an installed, signed-in agent CLI in a throwaway repository:
/// two turns each write a file and give a code word, the second is rewound, and a third asks
/// for the code words. The agent must recall only the first, and only the first file stays.
fn real_rewind_trial(agent: &str, model: Option<String>) {
    let root = std::env::temp_dir().join(format!("jackalope-rewind-real-{}", uuid::Uuid::new_v4()));
    let repo = super::super::tests::trial_repository(&root);
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    // No managed account: the CLI's own sign-in.
    std::fs::create_dir_all(runtime.profiles_root()).unwrap();
    std::fs::write(
        runtime.profiles_root().join("manifest.json"),
        br#"{"agents":{}}"#,
    )
    .unwrap();
    let project = format!("rewind-real-{agent}");
    if agent == "codex" {
        super::super::codex_session::use_app_server(&project);
    }
    let start = |id: &str, prompt: &str, previous: Option<&str>| {
        let mut request = super::super::tests::trial_request(&repo, agent, model.clone(), prompt);
        request.id = format!("{id}-{}", uuid::Uuid::new_v4());
        request.project_id = project.clone();
        request.previous_run_id = previous.map(str::to_string);
        runtime.start(request.clone()).unwrap();
        let run =
            super::super::tests::trial_settled(&runtime, &request.id, Duration::from_secs(300))
                .expect("the turn finished");
        println!(
            "{id}: {:?} session={:?} mark={:?} result={:?} error={:?}",
            run.status, run.session_id, run.rewind.mark, run.result, run.error
        );
        assert_eq!(
            run.status,
            RunStatus::Review,
            "{:?} {:#?}",
            run.error,
            run.activity
        );
        run
    };
    let one = start(
        "one",
        "Create a file named one.txt containing exactly ONE. Remember the code word PELICAN for later. Reply with only OK.",
        None,
    );
    let two = start(
        "two",
        "Create a file named two.txt containing exactly TWO. Remember a second code word, WALRUS, for later. Reply with only OK.",
        Some(&one.id),
    );
    let workspace = PathBuf::from(&two.workspace);
    assert!(workspace.join("two.txt").exists());
    let prepared = runtime.prepare_rewind(&two.id, &two.id).unwrap();
    let guard = crate::commands::integration::execution_guard().unwrap();
    let outcome = runtime.apply_rewind(&guard, prepared).unwrap();
    drop(guard);
    println!("rewind: {:?}", outcome.rewind.resume);
    assert!(workspace.join("one.txt").exists());
    assert!(!workspace.join("two.txt").exists());
    let three = start(
        "three",
        "Without using tools or reading files, list every code word I asked you to remember in this conversation, comma separated, nothing else. If there are none, reply NONE.",
        Some(&two.id),
    );
    let answer = three.result.to_uppercase();
    assert!(answer.contains("PELICAN"), "{answer}");
    assert!(
        !answer.contains("WALRUS"),
        "the rewound turn was remembered: {answer}"
    );
    assert!(!workspace.join("two.txt").exists());
    println!("Verified a real {agent} rewind in {}", root.display());
    runtime.stop_all();
    drop(runtime);
    let _ = std::fs::remove_dir_all(&root);
}

/// `cargo test --no-default-features --lib real_claude_rewind -- --ignored --nocapture`
/// Uses the person's Claude Code sign-in; `JACKALOPE_REWIND_MODEL` picks the model (haiku).
#[test]
#[ignore = "runs the installed claude CLI against the person's account"]
fn real_claude_rewind() {
    real_rewind_trial(
        "claude",
        Some(std::env::var("JACKALOPE_REWIND_MODEL").unwrap_or_else(|_| "haiku".into())),
    );
}

/// `cargo test --no-default-features --lib real_codex_rewind -- --ignored --nocapture`
/// Uses the person's Codex sign-in through its app-server; `JACKALOPE_REWIND_MODEL` picks
/// the model (the CLI's default otherwise).
#[test]
#[ignore = "runs the installed codex CLI against the person's account"]
fn real_codex_rewind() {
    real_rewind_trial("codex", std::env::var("JACKALOPE_REWIND_MODEL").ok());
}

#[test]
fn removed_workspaces_lose_their_rewind_refs_unless_still_needed() {
    let root = std::env::temp_dir().join(format!("jackalope-rewind-refs-{}", uuid::Uuid::new_v4()));
    let repo = super::super::tests::trial_repository(&root);
    let head = git(&repo, &["rev-parse", "HEAD"]);
    let tasks = ["gone", "gone-1", "open", "pending"];
    for task in tasks {
        for kind in ["checkpoints", "rewinds"] {
            git(
                &repo,
                &[
                    "update-ref",
                    &format!("refs/jackalope/{kind}/{task}/ref"),
                    &head,
                ],
            );
        }
    }
    let mut runs = Vec::new();
    for task in tasks {
        let mut run = turn("claude", &format!("{task}-run"), 1);
        run.task_id = task.into();
        run.workspace = root.join(task).to_string_lossy().into_owned();
        runs.push(run);
    }
    std::fs::create_dir_all(root.join("open")).unwrap();
    runs[3].rewind.applied = Some(Rewind {
        id: "r".into(),
        at: "now".into(),
        turn_run_id: "pending-run".into(),
        turn: 1,
        rewound_run_ids: vec!["pending-run".into()],
        restored: checkpoint("pending-run"),
        safety: SafetySnapshot {
            reference: "refs/jackalope/rewinds/pending/ref".into(),
            commit: head.clone(),
            head: head.clone(),
            tree: head.clone(),
            index: None,
        },
        resume: RewindResume::New,
        undone_at: None,
        replaces: None,
    });
    let asked: Vec<String> = ["gone", "open", "pending", "bad/id"]
        .map(str::to_string)
        .to_vec();
    let notes = forget_refs(&repo, &asked, &runs, None);
    let left = git(
        &repo,
        &["for-each-ref", "--format=%(refname)", "refs/jackalope"],
    );
    let left: Vec<&str> = left.lines().collect();
    // Only the removed task's refs go, and a task whose name extends it is not touched.
    assert_eq!(
        left,
        [
            "refs/jackalope/checkpoints/gone-1/ref",
            "refs/jackalope/checkpoints/open/ref",
            "refs/jackalope/checkpoints/pending/ref",
            "refs/jackalope/rewinds/gone-1/ref",
            "refs/jackalope/rewinds/open/ref",
            "refs/jackalope/rewinds/pending/ref",
        ]
    );
    assert!(notes
        .iter()
        .any(|note| note.contains("Removed 2 rewind refs of task gone")));
    assert!(notes.iter().any(|note| note.contains("still exists")));
    assert!(notes.iter().any(|note| note.contains("can still undo")));
    assert!(notes.iter().any(|note| note.contains("cannot name a ref")));
    let _ = std::fs::remove_dir_all(&root);
}
