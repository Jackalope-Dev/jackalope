use super::*;

/// A stand-in for Claude Code's stream-json control protocol. Each process appends its
/// pid and arguments to processes.jsonl. Every user message is one turn: it streams two
/// text deltas, then sends any hook callbacks the message names and records Jackalope's
/// replies, then reports a result whose cost is cumulative for the process, as Claude's is.
const FAKE_CLAUDE: &str = r#"
const fs = require('node:fs');
const readline = require('node:readline');
const log = (file, value) => fs.appendFileSync(file, JSON.stringify(value) + '\n');
log('processes.jsonl', { pid: process.pid, args: process.argv.slice(2) });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const pending = new Map();
let next = 0;
let turns = 0;
const hook = (callback_id, input) => new Promise((resolve) => {
  const request_id = `hook-${++next}`;
  pending.set(request_id, resolve);
  send({ type: 'control_request', request_id, request: { subtype: 'hook_callback', callback_id, input, tool_use_id: 'tool-1' } });
});
async function turn(text) {
  turns += 1;
  log('turns.jsonl', { pid: process.pid, text });
  const session_id = 'fixture-session';
  send({ type: 'system', subtype: 'init', session_id });
  send({ type: 'stream_event', session_id, parent_tool_use_id: null, event: { type: 'message_start' } });
  send({ type: 'stream_event', session_id, parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } });
  send({ type: 'stream_event', session_id, parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (text.includes('HOOKS')) {
    const replies = {
      routine: await hook('permission', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } }),
      risky: await hook('permission', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force origin master' } }),
      timing: await hook('timing', { hook_event_name: 'PostToolUse', tool_name: 'Edit', duration_ms: 42 }),
      edit: await hook('edit_check', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: process.cwd() + '/notes.txt' } }),
      unknown: await hook('missing', {}),
    };
    fs.writeFileSync('hooks.json', JSON.stringify(replies));
  }
  if (text.includes('STOP')) {
    fs.writeFileSync('changed.txt', String(turns));
    const replies = [];
    for (let round = 0; round < 10; round += 1) {
      const reply = await hook('stop', { hook_event_name: 'Stop', stop_hook_active: round > 0 });
      replies.push(reply);
      if (reply.decision !== 'block') break;
    }
    fs.writeFileSync('stops.json', JSON.stringify(replies));
  }
  send({ type: 'assistant', session_id, parent_tool_use_id: null, message: { id: `message-${process.pid}-${turns}`, model: 'fixture-model', content: [{ type: 'text', text: 'Hello' }], usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 } } });
  send({ type: 'result', subtype: 'success', is_error: false, session_id, result: `Turn ${turns} done`, total_cost_usd: 0.5 * turns, usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 } });
}
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'control_request' && message.request.subtype === 'initialize') {
    log('initialize.jsonl', message.request.hooks);
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { commands: [] } } });
  } else if (message.type === 'control_response') {
    const resolve = pending.get(message.response.request_id);
    pending.delete(message.response.request_id);
    resolve(message.response.response ?? { error: message.response.error });
  } else if (message.type === 'user') {
    const text = message.message.content;
    queue = queue.then(() => turn(text));
  }
});
"#;

fn request(
    project: &str,
    root: &str,
    id: &str,
    prompt: &str,
    previous: Option<&str>,
) -> RunRequest {
    RunRequest {
        retry_of: None,
        live_session_id: None,
        effort: None,
        codex_speed: None,
        dependency_snapshot: Default::default(),
        monitor_change: None,
        context_selection: Default::default(),
        context_receipt: Default::default(),
        id: id.into(),
        project_id: project.into(),
        project_name: "Fixture".into(),
        project_path: root.into(),
        agent: "default".into(),
        agent_profile_id: None,
        verify_command: None,
        prepare_command: None,
        setup_files: Vec::new(),
        auto_verify: false,
        target_branch: None,
        account_binding: None,
        model: None,
        prompt: prompt.into(),
        isolated: false,
        workspace_mode: None,
        previous_run_id: previous.map(str::to_string),
        coordination: None,
        connection_ids: None,
    }
}

struct Fixture {
    folder: PathBuf,
    root: String,
    runtime: TaskRuntime,
}

impl Fixture {
    fn new(project: &str, settings: Settings) -> Self {
        use crate::commands::agent_policy::{AgentPolicy, CustomAgent};
        set_test_settings(project, settings);
        let folder =
            std::env::temp_dir().join(format!("jackalope-claude-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let root = folder.to_str().unwrap().to_string();
        git(&root, &["init", "-b", "master"]).unwrap();
        std::fs::write(
            folder.join(".gitignore"),
            "*.jsonl\n*.json\n*.cjs\nfake-claude.*\nhistory/\n",
        )
        .unwrap();
        git(&root, &["add", ".gitignore"]).unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "Fixture",
            ],
        )
        .unwrap();
        std::fs::write(folder.join("fake-claude.cjs"), FAKE_CLAUDE).unwrap();
        let executable = if cfg!(windows) {
            let path = folder.join("fake-claude.cmd");
            std::fs::write(&path, "@echo off\r\nnode \"%~dp0fake-claude.cjs\" %*\r\n").unwrap();
            path
        } else {
            let path = folder.join("fake-claude.sh");
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
        let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
        let mut policy = AgentPolicy::default();
        policy.default_meta_agent = "claude-fixture".into();
        policy.custom_agents.push(CustomAgent {
            id: "claude-fixture".into(),
            name: "Claude fixture".into(),
            command: executable.to_string_lossy().into(),
            adapter: Some("claude".into()),
            args: Vec::new(),
        });
        std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
        std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
        Self {
            folder,
            root,
            runtime,
        }
    }

    fn request(&self, project: &str, id: &str, prompt: &str, previous: Option<&str>) -> RunRequest {
        request(project, &self.root, id, prompt, previous)
    }

    fn finish(&self, request: RunRequest) -> TaskRun {
        let id = request.id.clone();
        self.runtime.start(request).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            let run = self.runtime.run_snapshot(&id).unwrap();
            if !["starting", "running", "stopping"].contains(&run.status.as_str()) && !run.finishing
            {
                return run;
            }
            if std::time::Instant::now() > deadline {
                self.runtime.stop_all();
                panic!("Fixture did not finish: {:?}", run.activity);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn lines(&self, file: &str) -> Vec<Value> {
        std::fs::read_to_string(self.folder.join(file))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn json(&self, file: &str) -> Value {
        serde_json::from_slice(&std::fs::read(self.folder.join(file)).unwrap()).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.runtime.stop_all();
        let _ = std::fs::remove_dir_all(&self.folder);
    }
}

fn persistent() -> Settings {
    Settings {
        persistent: true,
        partials: true,
        ..Settings::default()
    }
}

#[test]
fn follow_ups_reuse_the_warm_process_and_resume_when_it_is_gone() {
    let project = "claude-session-reuse";
    let fixture = Fixture::new(project, persistent());
    let first = fixture.finish(fixture.request(project, "claude-turn-one", "First", None));
    assert_eq!(
        first.status, "review",
        "{:?} {:?}",
        first.error, first.diagnostics
    );
    assert_eq!(first.result, "Turn 1 done");
    assert_eq!(
        first.efficiency.claude_transport.as_deref(),
        Some("started")
    );
    assert!(first.efficiency.first_token_ms.is_some());
    assert!(first.streaming.is_empty());
    assert_eq!(first.usage.estimated_cost_usd, Some(0.5));
    assert_eq!(fixture.runtime.claude_sessions.warm(), 1);

    let second = fixture.finish(fixture.request(
        project,
        "claude-turn-two",
        "Second",
        Some("claude-turn-one"),
    ));
    assert_eq!(second.status, "review", "{:?}", second.error);
    assert_eq!(second.result, "Turn 2 done");
    assert_eq!(
        second.efficiency.claude_transport.as_deref(),
        Some("reused")
    );
    // The process reports cumulative cost; the turn records only its own share.
    assert_eq!(second.usage.estimated_cost_usd, Some(0.5));
    let processes = fixture.lines("processes.jsonl");
    assert_eq!(processes.len(), 1);
    let args: Vec<String> = serde_json::from_value(processes[0]["args"].clone()).unwrap();
    for flag in [
        "--input-format",
        "--include-partial-messages",
        "--append-system-prompt",
    ] {
        assert!(
            args.iter().any(|arg| arg == flag),
            "{flag} missing from {args:?}"
        );
    }
    assert!(!args.iter().any(|arg| arg == "--resume"));
    let turns = fixture.lines("turns.jsonl");
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0]["pid"], turns[1]["pid"]);
    assert!(turns[1]["text"]
        .as_str()
        .unwrap()
        .trim_end()
        .ends_with("Second"));

    // A process that is gone falls back to resuming the saved session.
    fixture.runtime.claude_sessions.clear();
    let third = fixture.finish(fixture.request(
        project,
        "claude-turn-three",
        "Third",
        Some("claude-turn-two"),
    ));
    assert_eq!(third.status, "review", "{:?}", third.error);
    assert_eq!(
        third.efficiency.claude_transport.as_deref(),
        Some("resumed")
    );
    let processes = fixture.lines("processes.jsonl");
    assert_eq!(processes.len(), 2);
    let args: Vec<String> = serde_json::from_value(processes[1]["args"].clone()).unwrap();
    let resume = args
        .iter()
        .position(|arg| arg == "--resume")
        .expect("resume flag");
    assert_eq!(args[resume + 1], "fixture-session");

    // An idle process is not reused.
    fixture
        .runtime
        .claude_sessions
        .set_idle(Duration::from_millis(1));
    std::thread::sleep(Duration::from_millis(20));
    let fourth = fixture.finish(fixture.request(
        project,
        "claude-turn-four",
        "Fourth",
        Some("claude-turn-three"),
    ));
    assert_eq!(
        fourth.efficiency.claude_transport.as_deref(),
        Some("resumed")
    );
    assert_eq!(fixture.lines("processes.jsonl").len(), 3);

    fixture.runtime.stop_all();
    assert_eq!(fixture.runtime.claude_sessions.warm(), 0);
}

#[test]
fn a_changed_launch_does_not_reuse_the_warm_process() {
    let project = "claude-session-changed";
    let fixture = Fixture::new(project, persistent());
    fixture.finish(fixture.request(project, "claude-change-one", "First", None));
    let mut follow_up = fixture.request(
        project,
        "claude-change-two",
        "Second",
        Some("claude-change-one"),
    );
    follow_up.effort = Some(super::super::effort::TaskEffort::Thorough);
    let second = fixture.finish(follow_up);
    assert_eq!(second.status, "review", "{:?}", second.error);
    assert_eq!(
        second.efficiency.claude_transport.as_deref(),
        Some("resumed")
    );
    assert_eq!(fixture.lines("processes.jsonl").len(), 2);
}

#[test]
fn hook_callbacks_answer_through_the_control_protocol() {
    let project = "claude-session-hooks";
    let settings = Settings {
        hooks: Hooks {
            edit_check: true,
            permission: true,
            timing: true,
            ..Hooks::default()
        },
        ..persistent()
    };
    let fixture = Fixture::new(project, settings);
    std::fs::create_dir_all(fixture.runtime.preferences_directory()).unwrap();
    std::fs::write(
        fixture.folder.join("lint.cjs"),
        "console.error('lint failed for [' + process.argv[2] + ']'); process.exit(3);",
    )
    .unwrap();
    crate::commands::project_registry::save(
        &fixture.runtime,
        vec![crate::commands::project_registry::ProjectRecord {
            id: project.into(),
            name: "Fixture".into(),
            path: fixture.root.clone(),
            accent: None,
            auto_approve: None,
            workspace_mode: None,
            learn_automatically: None,
            learning_cadence: None,
            sync_lessons: None,
            agent_reflection: None,
            export_lessons: None,
            personal_claude_setup: None,
            edit_check: Some("node lint.cjs {file}".into()),
        }],
    )
    .unwrap();
    let run = fixture.finish(fixture.request(project, "claude-hooks-run", "HOOKS", None));
    assert_eq!(run.status, "review", "{:?}", run.error);
    let registered = &fixture.lines("initialize.jsonl")[0];
    assert_eq!(
        registered["PreToolUse"][0]["hookCallbackIds"][0],
        "permission"
    );
    assert_eq!(registered["PostToolUse"].as_array().unwrap().len(), 2);
    assert!(registered.get("Stop").is_none());
    let hooks = fixture.json("hooks.json");
    assert_eq!(
        hooks["routine"]["hookSpecificOutput"]["permissionDecision"],
        "allow"
    );
    // Without a bridge to ask through, a risky request is denied with its reason.
    assert_eq!(
        hooks["risky"]["hookSpecificOutput"]["permissionDecision"],
        "deny"
    );
    assert!(
        hooks["risky"]["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .contains("approve")
    );
    assert_eq!(hooks["timing"], json!({}));
    let context = hooks["edit"]["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(context.contains("lint failed for [notes.txt]"), "{context}");
    assert!(context.contains("exit 3"), "{context}");
    assert_eq!(hooks["unknown"], json!({}));
    assert_eq!(run.efficiency.timings["tool:Edit"].total_ms, 42);
    assert_eq!(
        (
            run.efficiency.edit_checks,
            run.efficiency.edit_check_failures
        ),
        (1, 1)
    );
    assert!(run
        .activity
        .iter()
        .any(|line| line == "Auto-approved Bash: git status"));
    assert!(run
        .activity
        .iter()
        .any(|line| line.starts_with("Edit check failed after editing notes.txt")));
}

#[test]
fn the_stop_hook_keeps_fixing_a_failing_check_for_a_bounded_number_of_rounds() {
    let project = "claude-session-stop";
    let settings = Settings {
        hooks: Hooks {
            stop_check: true,
            ..Hooks::default()
        },
        ..persistent()
    };
    let fixture = Fixture::new(project, settings);
    let mut request = fixture.request(project, "claude-stop-run", "STOP", None);
    std::fs::write(
        fixture.folder.join("check.cjs"),
        "console.log('check output'); process.exit(1);",
    )
    .unwrap();
    request.verify_command = Some("node check.cjs".into());
    request.auto_verify = true;
    let run = fixture.finish(request);
    let stops = fixture.json("stops.json");
    let stops = stops.as_array().unwrap();
    assert_eq!(stops.len(), STOP_ROUNDS as usize + 1);
    for (round, reply) in stops.iter().take(STOP_ROUNDS as usize).enumerate() {
        assert_eq!(reply["decision"], "block");
        let reason = reply["reason"].as_str().unwrap();
        assert!(
            reason.contains(&format!("round {} of {STOP_ROUNDS}", round + 1)),
            "{reason}"
        );
        assert!(reason.contains("check output"), "{reason}");
    }
    assert_eq!(stops[STOP_ROUNDS as usize], json!({}));
    assert_eq!(run.efficiency.stop_check_rounds, u64::from(STOP_ROUNDS));
    assert_eq!(run.efficiency.first_check_passed, Some(false));
    assert!(run
        .verification
        .as_ref()
        .is_some_and(|check| !check.result.success));
}

#[test]
fn a_passing_stop_check_is_reused_by_the_final_check() {
    let project = "claude-session-stop-pass";
    let settings = Settings {
        hooks: Hooks {
            stop_check: true,
            ..Hooks::default()
        },
        ..persistent()
    };
    let fixture = Fixture::new(project, settings);
    let mut request = fixture.request(project, "claude-stop-pass", "STOP", None);
    std::fs::write(fixture.folder.join("check.cjs"), "process.exit(0);").unwrap();
    request.verify_command = Some("node check.cjs".into());
    request.auto_verify = true;
    let run = fixture.finish(request);
    assert_eq!(fixture.json("stops.json"), json!([{}]));
    assert_eq!(run.status, "review", "{:?}", run.error);
    assert_eq!(run.efficiency.stop_check_rounds, 1);
    assert_eq!(run.efficiency.native_verification_calls, Some(1));
    assert_eq!(run.efficiency.verification_reuses, Some(1));
}

#[test]
fn one_shot_runs_stream_partial_text_without_a_session() {
    let project = "claude-session-oneshot";
    let fixture = Fixture::new(
        project,
        Settings {
            partials: true,
            ..Settings::default()
        },
    );
    std::fs::write(
        fixture.folder.join("fake-claude.cjs"),
        r#"
const fs = require('node:fs');
fs.appendFileSync('processes.jsonl', JSON.stringify({ args: process.argv.slice(2) }) + '\n');
process.stdin.resume();
process.stdin.on('end', () => {
  const send = (value) => console.log(JSON.stringify(value));
  send({ type: 'system', subtype: 'init', session_id: 'one-shot' });
  send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } });
  send({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'Hi' }] } });
  send({ type: 'result', result: 'Done', session_id: 'one-shot' });
});
"#,
    )
    .unwrap();
    let run = fixture.finish(fixture.request(project, "claude-one-shot", "Task", None));
    assert_eq!(run.status, "review", "{:?}", run.error);
    assert_eq!(run.result, "Done");
    assert_eq!(run.efficiency.claude_transport, None);
    assert!(run.efficiency.first_token_ms.is_some());
    assert!(run.streaming.is_empty());
    assert_eq!(fixture.runtime.claude_sessions.warm(), 0);
    let args: Vec<String> =
        serde_json::from_value(fixture.lines("processes.jsonl")[0]["args"].clone()).unwrap();
    assert!(args.iter().any(|arg| arg == "--include-partial-messages"));
    assert!(!args.iter().any(|arg| arg == "--input-format"));
}

#[test]
fn partial_text_accumulates_and_clears_when_the_message_completes() {
    let folder = std::env::temp_dir().join(format!("jackalope-partials-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let run = super::super::tests::sample("claude");
    let id = run.id.clone();
    runtime.inner.lock().unwrap().runs.insert(id.clone(), run);
    let mut partials = Partials::new(Instant::now());
    let delta = |text: &str| {
        json!({"type":"stream_event","parent_tool_use_id":null,"event":{"type":"content_block_delta","delta":{"type":"text_delta","text":text}}}).to_string()
    };
    assert!(partials.consume(&runtime, &id, &delta("Hel")));
    std::thread::sleep(STREAM_FLUSH);
    assert!(partials.consume(&runtime, &id, &delta("lo")));
    assert_eq!(runtime.run_snapshot(&id).unwrap().streaming, "Hello");
    let subagent = json!({"type":"stream_event","parent_tool_use_id":"tool","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}});
    assert!(partials.consume(&runtime, &id, &subagent.to_string()));
    assert_eq!(runtime.run_snapshot(&id).unwrap().streaming, "Hello");
    assert!(runtime
        .run_snapshot(&id)
        .unwrap()
        .efficiency
        .first_token_ms
        .is_some());
    let message =
        json!({"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}});
    assert!(!partials.consume(&runtime, &id, &message.to_string()));
    assert!(runtime.run_snapshot(&id).unwrap().streaming.is_empty());
    drop(runtime);
    let _ = std::fs::remove_dir_all(folder);
}

#[test]
fn launch_flags_follow_settings() {
    let args = |settings: Settings, model: Option<&str>| {
        let mut cmd = Command::new("claude");
        configure(&mut cmd, &settings, model);
        cmd.get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    };
    assert!(args(Settings::default(), Some("opus")).is_empty());
    assert_eq!(
        args(
            Settings {
                isolated: true,
                ..Settings::default()
            },
            None
        ),
        ["--strict-mcp-config", "--setting-sources", "project,local"]
    );
    assert_eq!(
        args(
            Settings {
                fallback: true,
                ..Settings::default()
            },
            Some("claude-opus-4-5")
        ),
        ["--fallback-model", "sonnet"]
    );
    assert!(args(
        Settings {
            fallback: true,
            ..Settings::default()
        },
        None
    )
    .is_empty());
    assert_eq!(fallback_model(Some("sonnet")), Some("opus"));
    assert_eq!(fallback_model(Some("haiku")), Some("sonnet"));
    assert_eq!(fallback_model(Some("local/qwen")), None);
    assert_eq!(
        args(
            Settings {
                partials: true,
                shared_cache: true,
                ..Settings::default()
            },
            None
        ),
        [
            "--include-partial-messages",
            "--exclude-dynamic-system-prompt-sections"
        ]
    );
}

#[test]
fn experiments_gate_sessions_hooks_and_isolation() {
    // The registry defaults: a persistent session with every hook, partial
    // messages and the fallback model; isolation and the shared cache off.
    let defaults = Settings::from_experiments(None);
    let all = Hooks {
        edit_check: true,
        stop_check: true,
        context: true,
        permission: true,
        timing: true,
    };
    assert_eq!(
        defaults,
        Settings {
            persistent: true,
            partials: true,
            fallback: true,
            hooks: all,
            ..Settings::default()
        }
    );
    // A project's explicit choice overrides the isolation default either way.
    assert!(Settings::from_experiments(Some(false)).isolated);
    assert!(!Settings::from_experiments(Some(true)).isolated);
    assert!(registrations(&Hooks::default())
        .as_object()
        .unwrap()
        .is_empty());
    let registered = registrations(&all);
    for event in ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"] {
        assert!(registered.get(event).is_some(), "{event}");
    }
    assert_eq!(
        registered["Stop"][0]["timeout"],
        crate::commands::verification::BRIDGE_TIMEOUT_SECS
    );
}

#[test]
fn edit_check_paths_are_quoted_or_skipped() {
    assert_eq!(
        edit_check_command("pnpm lint", None).as_deref(),
        Some("pnpm lint")
    );
    assert_eq!(
        edit_check_command("biome check {file}", Some("src/a b.ts")).as_deref(),
        Some("biome check \"src/a b.ts\"")
    );
    assert_eq!(edit_check_command("biome check {file}", None), None);
    assert_eq!(
        edit_check_command("biome check {file}", Some("a\"; rm x")),
        None
    );
    assert_eq!(
        edit_check_command("biome check {file}", Some("%PATH%")),
        None
    );
}

#[test]
fn a_warm_token_acts_for_the_current_turn_only() {
    let fixture_token = format!("warm-{}", uuid::Uuid::new_v4());
    assert_eq!(bridge_token(&fixture_token), fixture_token);
    aliases()
        .lock()
        .unwrap()
        .insert(fixture_token.clone(), "current".into());
    assert_eq!(bridge_token(&fixture_token), "current");
    aliases().lock().unwrap().remove(&fixture_token);
    assert_eq!(bridge_token(&fixture_token), fixture_token);
}

#[test]
fn the_context_hook_delivers_selected_context_once() {
    let folder =
        std::env::temp_dir().join(format!("jackalope-context-hook-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    let entry: crate::commands::knowledge::KnowledgeEntry = serde_json::from_value(json!({
        "id":"lesson-1","projectId":"context-project","projectPath":folder.to_string_lossy(),
        "kind":"memory","title":"Run the linter","content":"Use pnpm lint before finishing.",
        "keywords":[],"enabled":true,"sourceRunId":null,"sourceHead":null,"revision":1,
        "updatedAt":"2026-01-01T00:00:00Z"
    }))
    .unwrap();
    let mut request = request(
        "context-project",
        &folder.to_string_lossy(),
        "context-run",
        "Task",
        None,
    );
    request.context_receipt.entries.push(entry);
    let turn = Turn {
        runtime: runtime.clone(),
        id: "context-run".into(),
        project_id: "context-project".into(),
        workspace: folder.to_string_lossy().into_owned(),
        hooks: Hooks {
            context: true,
            ..Hooks::default()
        },
        bridge: false,
        final_check: false,
        edit_check: None,
        context: Some(request),
        delivered: AtomicBool::new(false),
        rounds: AtomicU32::new(0),
    };
    let first = turn.answer("context", &json!({"hook_event_name":"UserPromptSubmit"}));
    let context = first["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(context.contains("Use pnpm lint before finishing."));
    assert_eq!(turn.answer("context", &json!({})), json!({}));
    // Hooks that were not enabled answer with no decision.
    assert_eq!(turn.answer("stop", &json!({})), json!({}));
    assert_eq!(
        turn.answer("permission", &json!({"tool_name":"Bash"})),
        json!({})
    );
}
