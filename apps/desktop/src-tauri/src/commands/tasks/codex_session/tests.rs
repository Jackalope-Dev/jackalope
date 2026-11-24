use super::*;
use crate::commands::agent_policy::{AgentPolicy, CustomAgent};

/// Notifications and requests recorded from `codex app-server` 0.156.1, one turn each,
/// with local paths replaced by `/workspace`.
const APPROVAL: &str = include_str!("fixtures/turn-approval.jsonl");
const PLAIN: &str = include_str!("fixtures/turn-plain.jsonl");
const STEERED: &str = include_str!("fixtures/turn-steered.jsonl");
const INTERRUPTED: &str = include_str!("fixtures/turn-interrupted.jsonl");
const FAILED: &str = include_str!("fixtures/turn-failed.jsonl");
const READ_ONLY: &str = include_str!("fixtures/turn-read-only.jsonl");
const FAKE: &str = include_str!("fake-app-server.cjs");

fn messages(recording: &str) -> Vec<Value> {
    recording
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

/// What mapping a recorded turn produced.
struct Mapped {
    run: TaskRun,
    deltas: String,
    effects: Vec<Effect>,
    requests: Vec<Value>,
}

/// Maps a recorded turn the way a session does, into a fresh Codex attempt record.
fn map(recording: &str) -> Mapped {
    let messages = messages(recording);
    let turn = messages
        .iter()
        .find(|message| message["method"] == "turn/started")
        .and_then(|message| message["params"]["turn"]["id"].as_str())
        .unwrap()
        .to_string();
    let mut mapper = Mapper::new(&turn);
    let mut run = crate::commands::tasks::tests::sample("codex");
    run.workspace = "/workspace".into();
    run.result.clear();
    run.activity.clear();
    run.usage = Usage::default();
    let mut mapped = Mapped {
        run,
        deltas: String::new(),
        effects: vec![],
        requests: vec![],
    };
    for message in messages {
        let Some(method) = message["method"].as_str() else {
            continue;
        };
        if message.get("id").is_some() {
            mapped.requests.push(message.clone());
            continue;
        }
        for effect in mapper.map(method, &message["params"]) {
            match &effect {
                Effect::Event(event) => {
                    consume_adapter_event(&mut mapped.run, &event.to_string(), "codex")
                }
                Effect::Activity(text) => activity(&mut mapped.run, text),
                Effect::Delta(text) => mapped.deltas.push_str(text),
                Effect::Context { used, window } => {
                    mapped.run.context = Some(ContextUsage {
                        used: *used,
                        window: *window,
                    })
                }
                _ => {}
            }
            mapped.effects.push(effect);
        }
    }
    mapped
}

#[test]
fn a_recorded_turn_maps_onto_the_codex_transcript() {
    let mapped = map(APPROVAL);
    let run = &mapped.run;
    assert_eq!(run.result, "DONE");
    assert_eq!(run.error, None);
    assert!(
        run.activity.iter().any(|line| line == "Changed hello.txt"),
        "{:?}",
        run.activity
    );
    assert!(
        run.activity
            .iter()
            .any(|line| line.starts_with("/bin/zsh -lc 'touch /tmp/outside-probe .'\nExit: 0")),
        "{:?}",
        run.activity
    );
    // Usage sums the turn's model calls, as `codex exec` reported it at the end.
    assert_eq!(
        (
            run.usage.input,
            run.usage.cache_read,
            run.usage.output,
            run.usage.reported
        ),
        (18539 + 18703, 18432, 106 + 5, true)
    );
    assert_eq!(run.efficiency.tool_calls.get("command_execution"), Some(&1));
    assert_eq!(run.efficiency.tool_calls.get("file_change"), Some(&1));
    // Streamed text is every agent message of the turn, which completed messages replace.
    assert_eq!(
        mapped.deltas,
        "I’ll create `hello.txt`, then request escalated permission for the exact command.\nDONE"
    );
    assert_eq!(
        mapped.effects.last(),
        Some(&Effect::Ended(TurnEnd::Completed))
    );
    assert_eq!(mapped.requests.len(), 1);
    // The context meter reads the latest call and the window Codex states.
    assert_eq!(
        run.context,
        Some(ContextUsage {
            used: 18703,
            window: Some(258400)
        })
    );
    assert_eq!(
        mapped.requests[0]["method"],
        "item/commandExecution/requestApproval"
    );
}

#[test]
fn steered_interrupted_failed_and_read_only_turns_end_as_codex_reported() {
    assert_eq!(map(PLAIN).run.result, "TWO");
    let steered = map(STEERED);
    assert_eq!(steered.run.result, "hello.txt\n\nSTEERED");
    assert_eq!(
        steered.effects.last(),
        Some(&Effect::Ended(TurnEnd::Completed))
    );

    let interrupted = map(INTERRUPTED);
    assert!(interrupted
        .effects
        .contains(&Effect::Ended(TurnEnd::Interrupted)));
    // exec never reported usage for a turn that did not complete; the session records it.
    assert!(interrupted.effects.iter().any(|effect| matches!(
        effect,
        Effect::Usage(usage) if usage.input == 23904 && usage.output == 54
    )));

    let failed = map(FAILED);
    let reason =
        "The 'no-such-model-jackalope' model is not supported when using Codex with a ChatGPT account.";
    assert_eq!(failed.run.error.as_deref(), Some(reason));
    assert_eq!(
        failed.effects.last(),
        Some(&Effect::Ended(TurnEnd::Failed(reason.into())))
    );
    assert!(failed.run.quota_failure.is_none());

    let read_only = map(READ_ONLY);
    assert_eq!(
        read_only.run.result,
        "Creation failed: read-only filesystem here."
    );
    // An empty reasoning summary adds no activity line.
    assert!(!read_only
        .run
        .activity
        .iter()
        .any(|line| line.starts_with("reasoning")));
}

#[test]
fn usage_limits_retries_reroutes_and_other_turns_map_as_exec_reported_them() {
    let mut mapper = Mapper::new("turn-1");
    let mut run = crate::commands::tasks::tests::sample("codex");
    run.error = None;
    let limit = json!({"threadId": "t", "turnId": "turn-1", "willRetry": false, "error": {
        "message": "You've hit your usage limit.", "codexErrorInfo": "usageLimitExceeded"}});
    for effect in mapper.map("error", &limit) {
        if let Effect::Event(event) = effect {
            assert_eq!(event["error"]["code"], "usage_limit_exceeded");
            consume_adapter_event(&mut run, &event.to_string(), "codex");
        }
    }
    assert!(run.quota_failure.is_some());
    assert_eq!(run.error.as_deref(), Some("You've hit your usage limit."));
    let retry = json!({"threadId": "t", "turnId": "turn-1", "willRetry": true,
        "error": {"message": "stream disconnected", "codexErrorInfo": {"responseStreamDisconnected": {"httpStatusCode": null}}}});
    assert_eq!(
        mapper.map("error", &retry),
        vec![Effect::Activity(
            "Codex is retrying: stream disconnected".into()
        )]
    );
    let rerouted = mapper.map(
        "model/rerouted",
        &json!({"threadId": "t", "turnId": "turn-1", "fromModel": "a", "toModel": "b", "reason": "highRiskCyberActivity"}),
    );
    assert_eq!(
        rerouted[0],
        Effect::Event(json!({"type": "model.rerouted", "model": "b"}))
    );
    // Another turn's notifications, such as usage replayed on resume, are not this turn's.
    let other = json!({"threadId": "t", "turnId": "turn-0", "delta": "x",
        "tokenUsage": {"last": {"inputTokens": 5, "outputTokens": 1}}});
    assert!(mapper.map("item/agentMessage/delta", &other).is_empty());
    assert!(mapper.map("thread/tokenUsage/updated", &other).is_empty());
    assert!(mapper
        .map(
            "turn/completed",
            &json!({"threadId": "t", "turn": {"id": "turn-0", "status": "completed"}})
        )
        .is_empty());
    assert_eq!(
        mapper.map("configWarning", &json!({"summary": "Ignoring a setting."})),
        vec![Effect::Diagnostic("Ignoring a setting.".into())]
    );
    assert_eq!(
        mapper.map(
            "mcpServer/startupStatus/updated",
            &json!({"name": "linear", "status": "failed", "error": "401"})
        ),
        vec![Effect::Activity(
            "Connection linear did not start in Codex: 401".into()
        )]
    );
}

#[test]
fn a_recorded_approval_request_is_assessed_as_the_command_it_runs() {
    let mapped = map(APPROVAL);
    let request = &mapped.requests[0];
    let subject =
        approval::subject(request["method"].as_str().unwrap(), &request["params"], &[]).unwrap();
    assert_eq!(subject.tool, "Bash");
    assert_eq!(
        subject.inputs,
        vec![json!({"command": "touch /tmp/outside-probe ."})]
    );
    assert_eq!(subject.label, "Bash: touch /tmp/outside-probe .");
    assert!(subject.assessable);
    assert!(subject.question.contains("outside its sandbox"));
    assert!(subject
        .question
        .contains("Codex says: May I run the requested touch command outside the sandbox?"));
    for (method, allowed, expected) in [
        (
            "item/commandExecution/requestApproval",
            true,
            json!({"decision": "accept"}),
        ),
        (
            "item/commandExecution/requestApproval",
            false,
            json!({"decision": "decline"}),
        ),
        (
            "item/fileChange/requestApproval",
            true,
            json!({"decision": "accept"}),
        ),
        (
            "mcpServer/elicitation/request",
            false,
            json!({"action": "decline", "content": null, "_meta": null}),
        ),
    ] {
        assert_eq!(
            approval::reply(method, &json!({}), allowed),
            expected,
            "{method}"
        );
    }
    let permissions = json!({"permissions": {"network": {"enabled": true}}});
    assert_eq!(
        approval::reply("item/permissions/requestApproval", &permissions, true),
        json!({"permissions": {"network": {"enabled": true}}, "scope": "turn"})
    );
    assert_eq!(
        approval::reply("item/permissions/requestApproval", &permissions, false),
        json!({"permissions": {}, "scope": "turn"})
    );
    // File changes are assessed by the paths their item reported when it started.
    let files = approval::subject(
        "item/fileChange/requestApproval",
        &json!({"itemId": "patch", "grantRoot": "/etc"}),
        &["/workspace/a.txt".to_string()],
    )
    .unwrap();
    assert_eq!(
        files.inputs,
        vec![
            json!({"file_path": "/workspace/a.txt"}),
            json!({"file_path": "/etc"})
        ]
    );
    assert!(approval::subject("item/tool/call", &json!({}), &[]).is_none());
}

#[test]
fn shell_wrappers_are_unwrapped_only_when_their_quoting_is_simple() {
    for (command, expected) in [
        ("/bin/zsh -lc 'git status'", Some("git status")),
        (
            "bash -c 'pnpm test && pnpm lint'",
            Some("pnpm test && pnpm lint"),
        ),
        ("/bin/sh -c ls", Some("ls")),
        ("git status", Some("git status")),
        (
            "/usr/bin/python3 -c 'print(1)'",
            Some("/usr/bin/python3 -c 'print(1)'"),
        ),
        ("/bin/zsh -lc 'echo '\"'\"'hi'\"'\"''", None),
        ("/bin/zsh -lc \"echo $HOME\"", None),
    ] {
        assert_eq!(approval::script(command).as_deref(), expected, "{command}");
    }
}

#[test]
fn the_app_server_command_keeps_configuration_and_moves_turn_settings_into_the_protocol() {
    let mut exec = Command::new("codex");
    exec.args([
        "exec",
        "-c",
        "approval_policy=\"never\"",
        "-c",
        "sandbox_mode=\"workspace-write\"",
        "resume",
        "thread-1",
        "--json",
        "-",
        "-c",
        "model_reasoning_effort=\"high\"",
        "-c",
        "service_tier=\"fast\"",
        "-c",
        "features.fast_mode=true",
        "--model",
        "gpt-6",
        "-c",
        "mcp_servers={jackalope={url=\"http://127.0.0.1/mcp\"}}",
        "-c",
        "developer_instructions=\"Be careful.\"",
    ])
    .env("CODEX_HOME", "/accounts/work")
    .env_remove("OPENAI_API_KEY");
    let cmd = app_server_command(&exec, "/workspace");
    let args: Vec<_> = cmd
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        args,
        [
            "app-server",
            "--listen",
            "stdio://",
            "-c",
            "features.fast_mode=true",
            "-c",
            "mcp_servers={jackalope={url=\"http://127.0.0.1/mcp\"}}",
            "-c",
            "developer_instructions=\"Be careful.\"",
        ]
    );
    assert_eq!(cmd.get_program(), "codex");
    assert_eq!(cmd.get_current_dir(), Some(Path::new("/workspace")));
    let envs: Vec<_> = cmd.get_envs().collect();
    assert!(envs.contains(&(
        std::ffi::OsStr::new("CODEX_HOME"),
        Some(std::ffi::OsStr::new("/accounts/work"))
    )));
    assert!(envs.contains(&(std::ffi::OsStr::new("OPENAI_API_KEY"), None)));
}

fn request(
    project: &str,
    root: &str,
    id: &str,
    prompt: &str,
    previous: Option<&str>,
) -> RunRequest {
    RunRequest {
        retry_of: None,
        handoff_focus: None,
        continues: None,
        live_session_id: None,
        effort: None,
        reasoning_effort: None,
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
        non_code: false,
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

/// A repository, a Codex agent backed by the fake app-server, and a Codex account in the
/// fixture's own profiles, so no real Codex home is read.
struct Fixture {
    folder: PathBuf,
    root: String,
    project: String,
    runtime: TaskRuntime,
}

impl Fixture {
    fn new(project: &str, auto_approve: bool) -> Self {
        use_app_server(project);
        let folder =
            std::env::temp_dir().join(format!("jackalope-codex-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let root = folder.to_str().unwrap().to_string();
        git(&root, &["init", "-b", "master"]).unwrap();
        std::fs::write(
            folder.join(".gitignore"),
            "*.jsonl\n*.json\n*.cjs\nfake-codex*\nhistory/\nno-thread-start\nexit-on-turn-start\n",
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
        std::fs::write(folder.join("fake-app-server.cjs"), FAKE).unwrap();
        for (name, recording) in [
            ("turn-approval.jsonl", APPROVAL),
            ("turn-failed.jsonl", FAILED),
        ] {
            std::fs::write(folder.join(name), recording).unwrap();
        }
        let executable = if cfg!(windows) {
            let path = folder.join("fake-codex.cmd");
            std::fs::write(
                &path,
                "@echo off\r\nnode \"%~dp0fake-app-server.cjs\" %*\r\n",
            )
            .unwrap();
            path
        } else {
            let path = folder.join("fake-codex.sh");
            std::fs::write(
                &path,
                "#!/bin/sh\nexec node \"$(dirname \"$0\")/fake-app-server.cjs\" \"$@\"\n",
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
        policy.default_meta_agent = "codex-fixture".into();
        policy.custom_agents.push(CustomAgent {
            id: "codex-fixture".into(),
            name: "Codex fixture".into(),
            command: executable.to_string_lossy().into(),
            adapter: Some("codex".into()),
            args: Vec::new(),
        });
        std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
        std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
        std::fs::create_dir_all(runtime.profiles_root()).unwrap();
        std::fs::write(
            runtime.profiles_root().join("manifest.json"),
            serde_json::to_vec(&json!({"agents": {"codex": {
                "profiles": [{"id": "fixture", "name": "Fixture"}], "active": "fixture"}}}))
            .unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(runtime.preferences_directory()).unwrap();
        crate::commands::project_registry::save(
            &runtime,
            vec![crate::commands::project_registry::ProjectRecord {
                id: project.into(),
                name: "Fixture".into(),
                path: root.clone(),
                settings: crate::commands::project_registry::ProjectSettingsPatch {
                    auto_approve: Some(auto_approve),
                    ..Default::default()
                },
                ..Default::default()
            }],
        )
        .unwrap();
        Self {
            folder,
            root,
            project: project.into(),
            runtime,
        }
    }

    fn request(&self, id: &str, prompt: &str, previous: Option<&str>) -> RunRequest {
        request(&self.project, &self.root, id, prompt, previous)
    }

    fn wait(&self, id: &str, done: impl Fn(&TaskRun) -> bool) -> TaskRun {
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        loop {
            let run = self.runtime.run_snapshot(id).unwrap();
            if done(&run) {
                return run;
            }
            if std::time::Instant::now() > deadline {
                self.runtime.stop_all();
                panic!(
                    "The fixture did not get there: {:?} {:?}",
                    run.activity, run.diagnostics
                );
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn finish(&self, request: RunRequest) -> TaskRun {
        let id = request.id.clone();
        self.runtime.start(request).unwrap();
        self.wait(&id, |run| !run.status.is_active() && !run.finishing)
    }

    fn lines(&self, file: &str) -> Vec<Value> {
        std::fs::read_to_string(self.folder.join(file))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn requests(&self, method: &str) -> Vec<Value> {
        self.lines("requests.jsonl")
            .into_iter()
            .filter(|request| request["method"] == method)
            .collect()
    }

    /// Answers the attempt's pending questions with `answer`, until `count` were asked.
    fn answer(&self, id: &str, count: usize, answer: &str) -> Vec<String> {
        let mut asked = Vec::new();
        while asked.len() < count {
            let run = self.wait(id, |run| {
                run.prompts
                    .iter()
                    .any(|prompt| prompt.status == "pending" && !asked.contains(&prompt.id))
            });
            for prompt in run
                .prompts
                .iter()
                .filter(|prompt| prompt.status == "pending")
            {
                if !asked.contains(&prompt.id) {
                    let choice = prompt
                        .options
                        .iter()
                        .find(|option| option.as_str() == answer)
                        .unwrap_or_else(|| panic!("{answer} not offered: {:?}", prompt.options));
                    self.runtime.respond_prompt(id, &prompt.id, choice).unwrap();
                    asked.push(prompt.id.clone());
                }
            }
        }
        let run = self.runtime.run_snapshot(id).unwrap();
        run.prompts
            .iter()
            .map(|prompt| prompt.question.clone())
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.runtime.stop_all();
        let _ = std::fs::remove_dir_all(&self.folder);
    }
}

#[test]
fn follow_ups_reuse_the_warm_app_server_and_resume_saved_threads_by_id() {
    let fixture = Fixture::new("codex-session-reuse", true);
    let first = fixture.finish(fixture.request("codex-turn-one", "First", None));
    assert_eq!(
        first.status,
        RunStatus::Review,
        "{:?} {:?}",
        first.error,
        first.diagnostics
    );
    let thread = first.session_id.clone().unwrap();
    assert!(thread.starts_with("thread-"), "{thread}");
    assert!(first.result.ends_with(" done"), "{}", first.result);
    assert_eq!(first.efficiency.codex_transport.as_deref(), Some("started"));
    assert!(first.efficiency.first_token_ms.is_some());
    assert!(first.streaming.is_empty());
    assert!(!first.steerable);
    assert_eq!(
        (
            first.usage.input,
            first.usage.cache_read,
            first.usage.output
        ),
        (10, 4, 2)
    );
    assert_eq!(
        first.context,
        Some(ContextUsage {
            used: 10,
            window: Some(1000)
        })
    );
    let start = &fixture.requests("thread/start")[0]["params"];
    assert_eq!(start["approvalPolicy"], "on-request");
    assert_eq!(start["sandbox"], "workspace-write");
    let turn = &fixture.requests("turn/start")[0]["params"];
    assert_eq!(turn["threadId"], thread.as_str());
    assert!(turn["input"][0]["text"].as_str().unwrap().contains("First"));
    assert!(turn.get("model").is_none() && turn.get("effort").is_none());
    assert_eq!(fixture.runtime.codex_sessions.warm(), 1);

    let mut second = fixture.request("codex-turn-two", "Second", Some("codex-turn-one"));
    second.codex_speed = Some(super::super::speed::CodexSpeed::Fast);
    let second = fixture.finish(second);
    assert_eq!(second.status, RunStatus::Review, "{:?}", second.error);
    assert_eq!(second.session_id.as_deref(), Some(thread.as_str()));
    // A turn that sets a tier Codex keeps for the thread needs a process of its own.
    assert_eq!(
        second.efficiency.codex_transport.as_deref(),
        Some("resumed")
    );
    let turn = &fixture.requests("turn/start")[1]["params"];
    assert_eq!(turn["serviceTier"], "fast");
    let resume = &fixture.requests("thread/resume")[0]["params"];
    assert_eq!(resume["threadId"], thread.as_str());
    assert_eq!(resume["excludeTurns"], true);
    assert_eq!(resume["approvalPolicy"], "on-request");

    let mut third = fixture.request("codex-turn-three", "Third", Some("codex-turn-two"));
    third.codex_speed = Some(super::super::speed::CodexSpeed::Fast);
    let third = fixture.finish(third);
    assert_eq!(third.status, RunStatus::Review, "{:?}", third.error);
    assert_eq!(third.efficiency.codex_transport.as_deref(), Some("reused"));
    assert_eq!(
        fixture.requests("turn/start")[2]["params"]["serviceTier"],
        "fast"
    );
    let processes = fixture.lines("processes.jsonl");
    assert_eq!(processes.len(), 2);
    let args: Vec<String> = serde_json::from_value(processes[1]["args"].clone()).unwrap();
    assert_eq!(&args[..3], ["app-server", "--listen", "stdio://"]);
    assert!(
        args.iter().any(|arg| arg == "features.fast_mode=true"),
        "{args:?}"
    );
    assert!(!args.iter().any(|arg| arg.starts_with("approval_policy")));
    assert!(fixture.lines("exec.jsonl").is_empty());

    // After a restart nothing is warm: the saved thread resumes in a new process.
    fixture.runtime.codex_sessions.clear();
    let mut fourth = fixture.request("codex-turn-four", "Fourth", Some("codex-turn-three"));
    fourth.codex_speed = Some(super::super::speed::CodexSpeed::Standard);
    let fourth = fixture.finish(fourth);
    assert_eq!(
        fourth.efficiency.codex_transport.as_deref(),
        Some("resumed")
    );
    assert_eq!(fourth.session_id.as_deref(), Some(thread.as_str()));
    assert_eq!(
        fixture.requests("turn/start")[3]["params"]["serviceTier"],
        "default"
    );
    let processes = fixture.lines("processes.jsonl");
    assert_eq!(processes.len(), 3);
    let args: Vec<String> = serde_json::from_value(processes[2]["args"].clone()).unwrap();
    assert!(
        !args.iter().any(|arg| arg.starts_with("features.fast_mode")),
        "{args:?}"
    );
}

#[test]
fn approval_requests_follow_the_project_permission_settings() {
    let fixture = Fixture::new("codex-session-approvals", true);
    let routine = fixture.finish(fixture.request("codex-routine", "ROUTINE", None));
    assert_eq!(routine.status, RunStatus::Review, "{:?}", routine.error);
    assert!(
        routine
            .activity
            .iter()
            .any(|line| line == "Auto-approved Bash: git status"),
        "{:?}",
        routine.activity
    );
    assert!(routine.prompts.is_empty());

    // Risky requests ask the person, whose answer Codex receives.
    fixture
        .runtime
        .start(fixture.request("codex-risky", "RISKY", None))
        .unwrap();
    let questions = fixture.answer("codex-risky", 2, "Deny");
    assert!(
        questions[0].contains("git push --force origin master"),
        "{questions:?}"
    );
    assert!(
        questions[0].contains("Jackalope is asking because"),
        "{questions:?}"
    );
    assert!(questions[1].contains("/etc/hosts"), "{questions:?}");
    let risky = fixture.wait("codex-risky", |run| {
        !run.status.is_active() && !run.finishing
    });
    assert!(risky
        .activity
        .iter()
        .any(|line| line.starts_with("Codex permission denied: Bash")));
    assert!(
        risky
            .activity
            .iter()
            .any(|line| line == "File change failed"),
        "{:?}",
        risky.activity
    );
    assert!(risky.activity.iter().any(|line| line
        == "/bin/zsh -lc 'git push --force origin master'\nDeclined. Codex asked because: Publishing needs the network."));
    assert!(!risky
        .activity
        .iter()
        .any(|line| line.contains("Exit: null")));

    // The recorded escalation is answered the same way.
    fixture
        .runtime
        .start(fixture.request("codex-recorded", "APPROVE", None))
        .unwrap();
    let recorded = fixture.wait("codex-recorded", |run| {
        !run.prompts.is_empty() || (!run.status.is_active() && !run.finishing)
    });
    if !recorded.prompts.is_empty() {
        fixture.answer("codex-recorded", 1, "Allow once");
    }
    let recorded = fixture.wait("codex-recorded", |run| {
        !run.status.is_active() && !run.finishing
    });
    assert_eq!(recorded.result, "DONE");

    let decisions: Vec<Value> = fixture
        .lines("approvals.jsonl")
        .into_iter()
        .map(|line| line["reply"].clone())
        .collect();
    assert_eq!(
        decisions,
        [
            json!({"decision": "accept"}),
            json!({"decision": "decline"}),
            json!({"decision": "decline"}),
            json!({"decision": "accept"}),
        ]
    );

    // Without auto-approval even a routine command asks; a plan session never escalates.
    let fixture = Fixture::new("codex-session-ask", false);
    fixture
        .runtime
        .start(fixture.request("codex-ask", "ROUTINE", None))
        .unwrap();
    fixture.answer("codex-ask", 1, "Allow once");
    let asked = fixture.wait("codex-ask", |run| !run.status.is_active() && !run.finishing);
    assert_eq!(asked.status, RunStatus::Review, "{:?}", asked.error);
    let params = json!({"command": "/bin/zsh -lc 'git status'"});
    assert_eq!(
        approval::answer(
            &fixture.runtime,
            "codex-ask",
            true,
            "item/commandExecution/requestApproval",
            &params,
            &[],
            &std::sync::atomic::AtomicBool::new(false),
        ),
        Some(json!({"decision": "decline"}))
    );
}

#[test]
fn a_running_turn_takes_steered_messages_and_a_stop_interrupts_it_cleanly() {
    let fixture = Fixture::new("codex-session-steer", true);
    assert!(fixture.runtime.steer("codex-steer", "Too early").is_err());
    fixture
        .runtime
        .start(fixture.request("codex-steer", "STEER", None))
        .unwrap();
    fixture.wait("codex-steer", |run| run.steerable);
    fixture
        .runtime
        .steer("codex-steer", "Also check the docs")
        .unwrap();
    let steered = fixture.wait("codex-steer", |run| {
        !run.status.is_active() && !run.finishing
    });
    assert_eq!(steered.result, "Steered: Also check the docs");
    assert!(!steered.steerable);
    let steer = &fixture.requests("turn/steer")[0]["params"];
    assert_eq!(steer["threadId"], steered.session_id.as_deref().unwrap());

    // A stop asks Codex to interrupt the turn; the process stays warm for the next message.
    fixture
        .runtime
        .start(fixture.request("codex-slow", "SLOW", Some("codex-steer")))
        .unwrap();
    fixture.wait("codex-slow", |run| run.steerable);
    fixture.runtime.stop("codex-slow").unwrap();
    let stopped = fixture.wait("codex-slow", |run| {
        !run.status.is_active() && !run.finishing
    });
    assert_eq!(stopped.status, RunStatus::Stopped);
    assert_eq!(fixture.requests("turn/interrupt").len(), 1);
    assert!(stopped
        .activity
        .iter()
        .any(|line| line == "Codex stopped the turn."));
    assert_eq!(fixture.runtime.codex_sessions.warm(), 1);
    let next = fixture.finish(fixture.request("codex-after-stop", "Next", Some("codex-slow")));
    assert_eq!(next.efficiency.codex_transport.as_deref(), Some("reused"));
    assert_eq!(fixture.lines("processes.jsonl").len(), 1);

    // Quitting ends the process at once, without waiting for the turn.
    fixture
        .runtime
        .start(fixture.request("codex-quit", "SLOW", Some("codex-after-stop")))
        .unwrap();
    fixture.wait("codex-quit", |run| run.steerable);
    let pid = fixture.lines("processes.jsonl")[0]["pid"].as_u64().unwrap();
    fixture.runtime.stop_all();
    let quit = fixture.wait("codex-quit", |run| {
        !run.status.is_active() && !run.finishing
    });
    assert_eq!(quit.status, RunStatus::Stopped);
    assert_eq!(fixture.requests("turn/interrupt").len(), 1);
    assert_eq!(fixture.runtime.codex_sessions.warm(), 0);
    #[cfg(unix)]
    {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let exists = || {
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .output()
                .is_ok_and(|output| output.status.success())
        };
        while exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(!exists(), "the app-server outlived the quit");
    }
    let _ = pid;
}

#[test]
fn an_app_server_without_the_needed_methods_falls_back_to_exec_and_says_why() {
    let fixture = Fixture::new("codex-session-fallback", true);
    std::fs::write(fixture.folder.join("no-thread-start"), "").unwrap();
    let run = fixture.finish(fixture.request("codex-fallback", "First", None));
    assert_eq!(
        run.status,
        RunStatus::Review,
        "{:?} {:?}",
        run.error,
        run.activity
    );
    assert_eq!(run.result, "Exec turn done");
    assert_eq!(run.efficiency.codex_transport.as_deref(), Some("exec"));
    assert!(
        run.activity.iter().any(|line| line
            == "This Codex version's app-server does not support thread/start (Invalid request: unknown variant `thread/start`). Running this turn with codex exec instead."),
        "{:?}",
        run.activity
    );
    let exec = fixture.lines("exec.jsonl");
    assert_eq!(exec.len(), 1);
    let args: Vec<String> = serde_json::from_value(exec[0]["args"].clone()).unwrap();
    assert!(
        args.iter().any(|arg| arg == "approval_policy=\"never\""),
        "{args:?}"
    );
    assert!(exec[0]["input"].as_str().unwrap().contains("First"));
    assert_eq!(fixture.runtime.codex_sessions.warm(), 0);

    // A turn Codex may have started is never run again with exec.
    std::fs::remove_file(fixture.folder.join("no-thread-start")).unwrap();
    std::fs::write(fixture.folder.join("exit-on-turn-start"), "").unwrap();
    let lost = fixture.finish(fixture.request("codex-unconfirmed", "Second", None));
    assert_eq!(lost.status, RunStatus::Failed, "{:?}", lost.activity);
    assert!(
        lost.error
            .as_deref()
            .is_some_and(|error| error.starts_with("Codex did not confirm the turn started")),
        "{:?}",
        lost.error
    );
    assert_eq!(fixture.lines("exec.jsonl").len(), 1);
}

#[test]
fn a_thread_codex_no_longer_has_starts_over_once_and_failed_turns_fail() {
    let fixture = Fixture::new("codex-session-refused", true);
    let first = fixture.finish(fixture.request("codex-kept", "First", None));
    assert_eq!(first.status, RunStatus::Review, "{:?}", first.error);
    fixture.runtime.codex_sessions.clear();
    std::fs::write(fixture.folder.join("threads.json"), "{}").unwrap();
    let second = fixture.finish(fixture.request("codex-lost", "Second", Some("codex-kept")));
    assert_eq!(
        second.status,
        RunStatus::Review,
        "{:?} {:?}",
        second.error,
        second.activity
    );
    assert_ne!(second.session_id, first.session_id);
    assert!(
        second
            .activity
            .iter()
            .any(|line| line.contains("no rollout found")),
        "{:?}",
        second.activity
    );
    assert!(second.handoff_context.is_some());

    let failed = fixture.finish(fixture.request("codex-failed", "FAIL", None));
    assert_eq!(failed.status, RunStatus::Failed);
    assert_eq!(
        failed.error.as_deref(),
        Some("The 'no-such-model-jackalope' model is not supported when using Codex with a ChatGPT account.")
    );

    // A crash ends the turn even while something Codex started keeps its output open.
    let started = std::time::Instant::now();
    let crashed = fixture.finish(fixture.request("codex-crashed", "ORPHAN", None));
    assert_eq!(crashed.status, RunStatus::Failed);
    assert!(
        crashed.error.as_deref().is_some_and(
            |error| error.starts_with("Codex's app-server exited before the turn finished.")
        ),
        "{:?}",
        crashed.error
    );
    assert!(started.elapsed() < Duration::from_secs(20));
}

#[test]
fn declined_commands_say_so_with_codex_reason() {
    let mut mapper = Mapper::new("turn-1");
    let item = |output: Value| {
        json!({"threadId": "t", "turnId": "turn-1", "item": {"type": "commandExecution", "id": "exec-1",
            "command": "/bin/zsh -lc 'git push'", "status": "declined", "exitCode": null, "aggregatedOutput": output}})
    };
    assert_eq!(
        mapper.map("item/completed", &item(Value::Null)),
        vec![Effect::Activity("/bin/zsh -lc 'git push'\nDeclined".into())]
    );
    mapper.asked("exec-1", "Publishing needs the network.");
    assert_eq!(
        mapper.map("item/completed", &item(Value::Null)),
        vec![Effect::Activity(
            "/bin/zsh -lc 'git push'\nDeclined. Codex asked because: Publishing needs the network."
                .into()
        )]
    );
    assert_eq!(
        mapper.map("item/completed", &item(json!("rejected by user"))),
        vec![Effect::Activity(
            "/bin/zsh -lc 'git push'\nDeclined: rejected by user".into()
        )]
    );
}

#[test]
fn a_request_codex_settles_itself_closes_its_question() {
    let fixture = Fixture::new("codex-session-settle", false);
    let run = fixture.finish(fixture.request("codex-settle", "SETTLE", None));
    assert_eq!(run.status, RunStatus::Review, "{:?}", run.error);
    let run = fixture.wait("codex-settle", |run| {
        run.prompts.len() == 1 && run.prompts[0].status == "answered"
    });
    assert_eq!(run.prompts[0].answer.as_deref(), Some(approval::SETTLED));
    assert!(run
        .activity
        .iter()
        .any(|line| line == "Codex settled a permission request before it was answered."));
    std::thread::sleep(Duration::from_millis(300));
    assert!(fixture.lines("late.jsonl").is_empty());
}

#[test]
fn an_attempt_stopped_while_the_app_server_starts_runs_nothing_else() {
    let fixture = Fixture::new("codex-session-setup-stop", true);
    std::fs::write(fixture.folder.join("slow-initialize"), "").unwrap();
    fixture
        .runtime
        .start(fixture.request("codex-setup-stop", "First", None))
        .unwrap();
    fixture.wait("codex-setup-stop", |_| {
        !fixture.lines("processes.jsonl").is_empty()
    });
    fixture.runtime.stop("codex-setup-stop").unwrap();
    let run = fixture.wait("codex-setup-stop", |run| {
        !run.status.is_active() && !run.finishing
    });
    assert_eq!(run.status, RunStatus::Stopped);
    assert!(
        !run.activity.iter().any(|line| line.contains("codex exec")),
        "{:?}",
        run.activity
    );
    assert!(fixture.lines("exec.jsonl").is_empty());
    assert_eq!(run.efficiency.codex_transport.as_deref(), Some("started"));
}

#[test]
fn codex_threads_roll_back_and_fork_by_turn() {
    let fixture = Fixture::new("codex-session-history", true);
    let mut previous = None;
    for id in ["codex-history-1", "codex-history-2", "codex-history-3"] {
        let run = fixture.finish(fixture.request(id, id, previous));
        assert_eq!(run.status, RunStatus::Review, "{:?}", run.error);
        previous = Some(id);
    }
    let thread = fixture
        .runtime
        .run_snapshot("codex-history-3")
        .unwrap()
        .session_id
        .unwrap();
    assert_eq!(fixture.requests("turn/start").len(), 3);

    let error = fixture
        .runtime
        .rollback_codex_thread("codex-history-3", 5)
        .unwrap_err();
    assert!(error.contains("fewer than the 5"), "{error}");
    let rolled = fixture
        .runtime
        .rollback_codex_thread("codex-history-3", 1)
        .unwrap();
    assert_eq!(rolled.thread_id, thread);
    assert_eq!(rolled.turns.len(), 2);
    let revert = &fixture.requests("thread/revert")[0]["params"];
    assert_eq!(revert["threadId"], thread.as_str());
    // The warm process did the change; it is still warm for the next turn.
    assert_eq!(fixture.lines("processes.jsonl").len(), 1);
    assert_eq!(fixture.runtime.codex_sessions.warm(), 1);

    // Without a warm process, a new one resumes the thread for the change.
    fixture.runtime.codex_sessions.clear();
    let forked = fixture
        .runtime
        .fork_codex_thread("codex-history-3", 1)
        .unwrap();
    assert_ne!(forked.thread_id, thread);
    assert_eq!(forked.turns, rolled.turns[..1]);
    let fork = &fixture.requests("thread/fork")[0]["params"];
    assert_eq!(fork["threadId"], thread.as_str());
    assert_eq!(fork["lastTurnId"], rolled.turns[0].as_str());
    assert_eq!(fixture.lines("processes.jsonl").len(), 2);
    assert_eq!(fixture.requests("thread/resume").len(), 1);
    let whole = fixture
        .runtime
        .fork_codex_thread("codex-history-3", 0)
        .unwrap();
    assert_eq!(whole.turns, rolled.turns);
    assert!(fixture
        .runtime
        .fork_codex_thread("codex-history-3", 2)
        .unwrap_err()
        .contains("nothing to fork"));

    // A rollback or fork in progress holds the conversation: a turn waits for it.
    let workspace = fixture
        .runtime
        .run_snapshot("codex-history-3")
        .unwrap()
        .workspace;
    let held = fixture
        .runtime
        .codex_sessions
        .reserve(&thread, &workspace)
        .unwrap();
    assert!(fixture
        .runtime
        .codex_sessions
        .reserve(&thread, &workspace)
        .is_err());
    // A new conversation in the same checkout waits too.
    let blocked = fixture.finish(fixture.request("codex-history-held", "Held", None));
    assert_eq!(blocked.status, RunStatus::Failed);
    assert_eq!(blocked.error.as_deref(), Some(RESERVED));
    assert_eq!(fixture.requests("turn/start").len(), 3);
    drop(held);

    // A running turn of the conversation blocks both.
    fixture
        .runtime
        .start(fixture.request("codex-history-4", "SLOW", Some("codex-history-3")))
        .unwrap();
    fixture.wait("codex-history-4", |run| run.steerable);
    assert!(fixture
        .runtime
        .rollback_codex_thread("codex-history-3", 1)
        .unwrap_err()
        .contains("Stop the running turn"));
}

/// Two tiny turns through the installed, signed-in `codex` (not the fake): a file is
/// created in the workspace, then a write outside it is asked about and denied, in the
/// same warm app-server. Uses the person's Codex sign-in and quota, so it runs only on
/// request: `cargo test --no-default-features --lib real_codex -- --ignored --nocapture`.
#[test]
#[ignore = "runs the installed codex CLI against the person's account"]
fn real_codex_runs_turns_in_one_warm_app_server() {
    let codex = std::env::var("JACKALOPE_REAL_CODEX").unwrap_or_else(|_| {
        let found = std::process::Command::new("which")
            .arg("codex")
            .output()
            .unwrap();
        String::from_utf8(found.stdout).unwrap().trim().to_string()
    });
    let fixture = Fixture::new("codex-session-real", false);
    let mut policy = AgentPolicy::default();
    policy.default_meta_agent = "codex-real".into();
    policy.custom_agents.push(CustomAgent {
        id: "codex-real".into(),
        name: "Codex".into(),
        command: codex,
        adapter: Some("codex".into()),
        args: Vec::new(),
    });
    std::fs::write(
        fixture.runtime.policy_path(),
        serde_json::to_vec(&policy).unwrap(),
    )
    .unwrap();
    // No managed account: the CLI's own sign-in.
    std::fs::write(
        fixture.runtime.profiles_root().join("manifest.json"),
        br#"{"agents":{}}"#,
    )
    .unwrap();
    let wait = |id: &str, done: &dyn Fn(&TaskRun) -> bool| {
        let deadline = std::time::Instant::now() + Duration::from_secs(300);
        loop {
            let run = fixture.runtime.run_snapshot(id).unwrap();
            if done(&run) {
                return run;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "{:?} {:?}",
                run.activity,
                run.diagnostics
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    };
    let settled = |run: &TaskRun| !run.status.is_active() && !run.finishing;

    fixture
        .runtime
        .start(fixture.request(
            "codex-real-one",
            "Create a file named hello.txt in the current directory containing exactly: hi\nDo nothing else.",
            None,
        ))
        .unwrap();
    let first = wait("codex-real-one", &settled);
    println!(
        "turn 1: {:?} transport={:?} error={:?}\nactivity={:#?}",
        first.status, first.efficiency.codex_transport, first.error, first.activity
    );
    assert_eq!(first.efficiency.codex_transport.as_deref(), Some("started"));
    assert!(first.status != RunStatus::Failed, "{:?}", first.error);
    let hello = std::fs::read_to_string(fixture.folder.join("hello.txt")).unwrap();
    assert_eq!(hello.trim(), "hi");
    assert_eq!(fixture.runtime.codex_sessions.warm(), 1);

    let outside = crate::commands::platform::home_dir()
        .unwrap()
        .join(format!(".jackalope-smoke-{}", uuid::Uuid::new_v4()));
    fixture
        .runtime
        .start(fixture.request(
            "codex-real-two",
            &format!(
                "Run this exact shell command: touch {}\nIf the sandbox blocks it, request approval to run it outside the sandbox. If that is denied, stop and reply DENIED.",
                outside.display()
            ),
            Some("codex-real-one"),
        ))
        .unwrap();
    let mut asked = Vec::new();
    let second = loop {
        let run = wait("codex-real-two", &|run| {
            settled(run) || run.prompts.iter().any(|p| p.status == "pending")
        });
        if settled(&run) {
            break run;
        }
        for prompt in run.prompts.iter().filter(|p| p.status == "pending") {
            asked.push(prompt.question.clone());
            fixture
                .runtime
                .respond_prompt("codex-real-two", &prompt.id, "Deny")
                .unwrap();
        }
    };
    let created = outside.exists();
    let _ = std::fs::remove_file(&outside);
    println!(
        "turn 2: {:?} transport={:?} error={:?} asked={asked:#?}\nresult={:?}\nactivity={:#?}",
        second.status,
        second.efficiency.codex_transport,
        second.error,
        second.result,
        second.activity
    );
    assert_eq!(second.efficiency.codex_transport.as_deref(), Some("reused"));
    assert_eq!(second.session_id, first.session_id);
    assert!(!created, "a write outside the workspace went through");
}
