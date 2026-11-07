//! One launch through both runners: this device's, with a real agent process,
//! and a computer's, through a stand-in for the computer's runner.
// Tests that keep a saved sign-in are skipped on Linux CI, which leaves some helpers unused there.
#![cfg_attr(target_os = "linux", allow(dead_code, unused_imports))]

use super::*;
use crate::commands::computers::runner::{
    Access, Placement, Where, BROWSER, LOCAL_BRIDGE, POLICY_CALLBACKS, TOOLS, WORKSPACE_TOOLS,
};
use base64::Engine;
use serde_json::json;
use std::sync::atomic::AtomicBool;

const EVENTS: &[&str] = &[
    r#"{"type":"thread.started","thread_id":"fixture-session"}"#,
    r#"{"type":"item.completed","item":{"type":"agent_message","text":"Fixture complete"}}"#,
];
const CAPABILITIES: &[&str] = &[LOCAL_BRIDGE, WORKSPACE_TOOLS, BROWSER, POLICY_CALLBACKS];

/// Answers the run protocol like a protocol 4 runner whose agent prints
/// [`EVENTS`] and changes nothing.
struct StandIn {
    started: Arc<Mutex<Option<serde_json::Value>>>,
    read: bool,
}

impl computers::Transport for StandIn {
    fn call(
        &mut self,
        payload: &serde_json::Value,
        _: Duration,
        _: &AtomicBool,
    ) -> Result<serde_json::Value, computers::AgentError> {
        let engine = base64::engine::general_purpose::STANDARD;
        Ok(match payload["action"].as_str().unwrap() {
            "run_status" => json!({"exists": false, "runs": 4, "capabilities": CAPABILITIES}),
            "workspace_put" => json!({}),
            "run_start" => {
                *self.started.lock().unwrap() = Some(payload.clone());
                json!({"started": true, "local": {"tools": payload["local"]["tools"]}})
            }
            "run_read" if !self.read => {
                self.read = true;
                let stdout = format!("{}\n", EVENTS.join("\n"));
                json!({
                    "stdout": engine.encode(&stdout),
                    "stderr": "",
                    "out": stdout.len(),
                    "err": 0,
                    "exit": {"code": 0},
                })
            }
            "run_read" => json!({"stdout": "", "stderr": "", "exit": {"code": 0}}),
            "workspace_diff" => json!({
                "size": 0,
                "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            }),
            "run_remove" => json!({}),
            other => return Err(format!("Unsupported action {other}").into()),
        })
    }
}

fn request(id: &str, workspace: &Path) -> RunRequest {
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
        project_id: "fixture".into(),
        project_name: "Fixture".into(),
        project_path: workspace.to_string_lossy().into_owned(),
        agent: "codex".into(),
        agent_profile_id: None,
        verify_command: Some("pnpm test".into()),
        prepare_command: None,
        setup_files: Vec::new(),
        auto_verify: false,
        target_branch: None,
        account_binding: None,
        model: None,
        prompt: "Fixture only".into(),
        isolated: false,
        workspace_mode: None,
        previous_run_id: None,
        coordination: Some(CoordinationContext {
            managed: false,
            endpoint: "http://127.0.0.1:9".into(),
            token: "bridge-token".into(),
            instructions: String::new(),
        }),
        connection_ids: None,
    }
}

/// Runs `runner` through the shared path up to, not including, the
/// completion on this device, and returns how it ended and what it recorded.
fn drive(
    runtime: &TaskRuntime,
    runner: &mut dyn AttemptRunner,
    workspace: &Path,
    cmd: Command,
    input: &str,
) -> (Outcome, TaskRun) {
    let id = uuid::Uuid::new_v4().to_string();
    let mut run = super::super::tests::sample("codex");
    run.id = id.clone();
    run.status = RunStatus::Starting;
    run.workspace = workspace.to_string_lossy().into_owned();
    runtime.inner.lock().unwrap().runs.insert(id.clone(), run);
    let req = request(&id, workspace);
    let mut launch = Launch {
        id: &id,
        req: &req,
        adapter: "codex",
        cmd,
        input: input.into(),
        workspace: &workspace.to_string_lossy(),
    };
    assert_eq!(runner.prepare(runtime, &mut launch).unwrap(), Step::Ready);
    let outcome = runtime
        .run_prepared(runner, &mut launch)
        .unwrap()
        .expect("the agent ran");
    let recorded = runtime.inner.lock().unwrap().runs[&id].clone();
    (outcome, recorded)
}

#[test]
fn both_runners_place_tools_from_one_table() {
    let local = local::LocalRunner::new(false, None, None, None, Vec::new(), None, None);
    let remote = Access {
        runner: computers::runner::RunnerCapabilities::from_status(Some(
            &json!({"runs": 4, "capabilities": CAPABILITIES}),
        )),
        devtools: false,
        read_only: false,
    };
    for tool in TOOLS {
        let (here, there) = (local.access().tool(tool.name), remote.tool(tool.name));
        match tool.placement {
            // Only tools that need this device's own workspace or sign-ins differ.
            Placement::DeviceOnly => {
                assert_eq!(
                    (here, there),
                    (Where::Runner, Where::Unavailable),
                    "{}",
                    tool.name
                )
            }
            Placement::Workspace(_) => {
                assert_eq!(
                    (here, there),
                    (Where::Runner, Where::Runner),
                    "{}",
                    tool.name
                )
            }
            Placement::Control => {
                assert_eq!(
                    (here, there),
                    (Where::Device, Where::Device),
                    "{}",
                    tool.name
                )
            }
        }
    }
    let names = TOOLS.iter().map(|tool| tool.name);
    assert_eq!(
        computers::runner::offered(local.access(), names.clone()),
        names.clone().collect::<Vec<_>>()
    );
    assert_eq!(
        computers::runner::offered(&remote, names.clone()),
        names
            .filter(
                |name| !["browser_open_profile", "peer_adopt", "permission_prompt"].contains(name)
            )
            .collect::<Vec<_>>()
    );
    // An agent on this device is told nothing about where its tools act.
    assert!(local.access().instructions().is_empty());
}

// Linux CI has no Secret Service keyring to hold the saved sign-in.
#[cfg(not(target_os = "linux"))]
#[test]
fn one_launch_records_the_same_result_through_both_runners() {
    let folder = std::env::temp_dir().join(format!("jackalope-runners-{}", uuid::Uuid::new_v4()));
    let (here, there) = (folder.join("local"), folder.join("remote"));
    for workspace in [&here, &there] {
        std::fs::create_dir_all(workspace).unwrap();
        std::fs::write(workspace.join("README.md"), "fixture\n").unwrap();
    }
    let script = folder.join("agent.cjs");
    std::fs::write(
        &script,
        format!(
            "let input = '';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', chunk => input += chunk);\nprocess.stdin.on('end', () => {{\n  require('node:fs').writeFileSync('input.txt', input);\n  for (const line of {}) console.log(line);\n}});\n",
            serde_json::to_string(EVENTS).unwrap()
        ),
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    credentials::set(
        &runtime.computers_root(),
        "openai-key",
        Some("sk-fixture-0123456789abcdef"),
    )
    .unwrap();
    let input = "Task:\nFixture only\n";

    let mut local = local::LocalRunner::new(false, None, None, None, Vec::new(), None, None);
    // Like every agent launch, the fixture gets its own process group (unix) so its tree can be stopped.
    let mut agent = super::super::command("node");
    agent.arg(&script);
    let (local_outcome, local_run) = drive(&runtime, &mut local, &here, agent, input);

    let started = Arc::new(Mutex::new(None));
    let computer = Computer {
        id: "computer-1".into(),
        name: "Box".into(),
        owner_kind: "project".into(),
        owner_id: "fixture".into(),
        provider: "remote-machine".into(),
        machine_id: None,
        decisions: "fixture".into(),
        created_at: String::new(),
        last_used_at: None,
        settings: Default::default(),
    };
    let session = runs::Session::with_transport(
        Box::new(StandIn {
            started: started.clone(),
            read: false,
        }),
        runs::run_name(&there.to_string_lossy()),
    );
    let mut remote = remote::RemoteRunner::with_session(computer, false, session);
    let mut codex = Command::new("codex");
    codex.args(["exec", "--json", "-"]);
    let (remote_outcome, remote_run) = drive(&runtime, &mut remote, &there, codex, input);

    // The same turn, recorded the same way.
    for outcome in [&local_outcome, &remote_outcome] {
        assert!(outcome.success);
        assert_eq!(outcome.exit_code, Some(0));
        assert!(!outcome.quota_stopped);
    }
    assert_eq!(local_run.result, "Fixture complete");
    assert_eq!(local_run.result, remote_run.result);
    assert_eq!(local_run.session_id.as_deref(), Some("fixture-session"));
    assert_eq!(local_run.session_id, remote_run.session_id);
    assert_eq!(local_run.status, remote_run.status);
    assert_eq!(local_run.error, None);
    assert_eq!(remote_run.error, None);
    assert!(local_run.remote.is_none());
    assert_eq!(remote_run.remote.as_ref().unwrap().computer_name, "Box");

    // The agent received the same input; the computer's also says where its
    // tools act, from the same table.
    let delivered = std::fs::read_to_string(here.join("input.txt")).unwrap();
    assert_eq!(delivered, input);
    let start = started.lock().unwrap().clone().unwrap();
    assert_eq!(
        start["stdin"].as_str().unwrap(),
        format!("{input}{}", remote.access().instructions())
    );
    // The tools the computer's runner serves are those served in-process here.
    let served: Vec<&str> = start["local"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool.as_str().unwrap())
        .collect();
    assert!(served.contains(&"computer_verify") && served.contains(&"browser_navigate"));
    for tool in &served {
        assert_eq!(local.access().tool(tool), Where::Runner, "{tool}");
    }
    assert_eq!(start["local"]["check"], "pnpm test");
    assert_eq!(start["argv"][0], "codex");

    drop(runtime);
    let _ = std::fs::remove_dir_all(folder);
}

/// A computer that never answers.
struct Unreachable;

impl computers::Transport for Unreachable {
    fn call(
        &mut self,
        _: &serde_json::Value,
        _: Duration,
        _: &AtomicBool,
    ) -> Result<serde_json::Value, computers::AgentError> {
        Err("connection refused".into())
    }
}

fn insert_run(runtime: &TaskRuntime, workspace: &Path) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let mut run = super::super::tests::sample("codex");
    run.id = id.clone();
    run.project_id = "fixture".into();
    run.status = RunStatus::Starting;
    run.workspace = workspace.to_string_lossy().into_owned();
    runtime.inner.lock().unwrap().runs.insert(id.clone(), run);
    id
}

#[test]
fn placement_is_recorded_once_and_continuations_keep_their_host() {
    let folder = std::env::temp_dir().join(format!("jackalope-placed-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    let id = insert_run(&runtime, &folder);
    let req = request(&id, &folder);
    // A project without a computer runs here, as before, with nothing to
    // record.
    assert!(runtime
        .placed_target(&id, &req, "codex", None)
        .unwrap()
        .is_none());
    let run = runtime.run_snapshot(&id).unwrap();
    assert!(run.host.is_none());
    assert!(!run
        .activity
        .iter()
        .any(|line| line.starts_with("Placement:")));
    // A host the pool chose is said once, however often the launch repeats.
    let placed = insert_run(&runtime, &folder);
    let host = RunHost::device("Placed on this device (0 of 2 in use).".into());
    runtime.update(&placed, |run| {
        run.host = Some(host.clone());
        run.activity.push(host_activity(&host));
    });
    for _ in 0..2 {
        assert!(runtime
            .placed_target(&placed, &request(&placed, &folder), "codex", None)
            .unwrap()
            .is_none());
    }
    let lines: Vec<_> = runtime
        .run_snapshot(&placed)
        .unwrap()
        .activity
        .into_iter()
        .filter(|line| line.starts_with("Placement:"))
        .collect();
    assert_eq!(lines, ["Placement: Placed on this device (0 of 2 in use)."]);

    // A continuation goes back to its earlier attempt's host; one that is
    // gone fails the attempt as a lost host, which a retry can move.
    let mut earlier = run.clone();
    earlier.host = Some(RunHost {
        id: "gone".into(),
        name: "Lab".into(),
        reason: "Placed on Lab.".into(),
        ..Default::default()
    });
    let next = insert_run(&runtime, &folder);
    let error = runtime
        .placed_target(&next, &request(&next, &folder), "codex", Some(&earlier))
        .unwrap_err();
    assert_eq!(error, "Lab is no longer available to run agents.");
    let host = runtime.run_snapshot(&next).unwrap().host.unwrap();
    assert_eq!(host.id, "gone");
    assert_eq!(host.lost.as_deref(), Some(error.as_str()));
    assert!(host.reason.starts_with("Continues on Lab"));
    assert!(pool::health("gone").unavailable());
    drop(runtime);
    let _ = std::fs::remove_dir_all(folder);
}

fn fixture_computer(id: &str) -> Computer {
    Computer {
        id: id.into(),
        name: "Box".into(),
        owner_kind: "project".into(),
        owner_id: "fixture".into(),
        provider: "remote-machine".into(),
        machine_id: None,
        decisions: "fixture".into(),
        created_at: String::new(),
        last_used_at: None,
        settings: Default::default(),
    }
}

fn save_computer(runtime: &TaskRuntime, computer: &Computer) {
    let root = runtime.computers_root();
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("computers.json"),
        serde_json::to_vec(&json!({ "computers": [computer] })).unwrap(),
    )
    .unwrap();
}

/// An attempt the pool placed on `computer`.
fn placed_on(runtime: &TaskRuntime, workspace: &Path, computer: &Computer) -> String {
    let id = insert_run(runtime, workspace);
    let host = RunHost {
        id: computer.id.clone(),
        name: computer.name.clone(),
        reason: "Placed on Box, the project's computer (0 of 2 in use).".into(),
        ..Default::default()
    };
    runtime.update(&id, |run| {
        run.host = Some(host.clone());
        run.activity.push(host_activity(&host));
    });
    id
}

#[test]
fn computers_only_never_runs_a_placed_fork_on_this_device() {
    let folder = std::env::temp_dir().join(format!("jackalope-strict-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    let computer = fixture_computer(&format!("strict{}", uuid::Uuid::new_v4().simple()));
    save_computer(&runtime, &computer);
    let gemini = |id: &str| RunRequest {
        agent: "gemini".into(),
        ..request(id, &folder)
    };

    // Anywhere, the default: an agent that cannot run on the computer still
    // runs here, as before.
    let anywhere = placed_on(&runtime, &folder, &computer);
    assert!(runtime
        .computers_only_host(&anywhere, "fixture", None)
        .is_none());
    assert!(runtime
        .placed_target(&anywhere, &gemini(&anywhere), "gemini", None)
        .unwrap()
        .is_none());
    let host = runtime.run_snapshot(&anywhere).unwrap().host.unwrap();
    assert!(host.is_device(), "{host:?}");
    assert!(
        host.reason.contains("cannot run on Box yet"),
        "{}",
        host.reason
    );

    // Computers only: the fork fails with the reason and never runs here.
    pool::save(
        &runtime.computers_root(),
        "fixture",
        pool::ProjectHosts {
            swarm_hosts: Some(pool::SwarmHosts::Computers),
            computers: Vec::new(),
        },
    )
    .unwrap();
    let strict = placed_on(&runtime, &folder, &computer);
    let error = runtime
        .placed_target(&strict, &gemini(&strict), "gemini", None)
        .unwrap_err();
    assert!(
        error.contains("swarms run only on computers") && error.contains(COMPUTERS_ONLY_FIX),
        "{error}"
    );
    let run = runtime.run_snapshot(&strict).unwrap();
    assert_eq!(run.host.unwrap().id, computer.id);
    assert!(run
        .activity
        .iter()
        .any(|line| line == &format!("Placement: {error}")));

    // Routing for it offers only agents that run there; with none enabled it
    // fails with the same advice instead of choosing one for this device.
    assert_eq!(
        runtime
            .computers_only_host(&strict, "fixture", None)
            .map(|host| host.id),
        Some(computer.id.clone())
    );
    let mut policy = crate::commands::agent_policy::AgentPolicy::default();
    for agent in super::super::BUILTIN_AGENTS {
        policy
            .enabled_agents
            .insert((*agent).into(), *agent == "gemini");
    }
    let policy_path = runtime.policy_path();
    std::fs::create_dir_all(policy_path.parent().unwrap()).unwrap();
    std::fs::write(policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();
    let routed = placed_on(&runtime, &folder, &computer);
    let mut auto = RunRequest {
        agent: "auto".into(),
        ..request(&routed, &folder)
    };
    let error = runtime.route(&mut auto).unwrap_err();
    assert!(
        error.starts_with("No enabled agent that can run on Box")
            && error.contains(COMPUTERS_ONLY_FIX),
        "{error}"
    );
    assert_eq!(auto.agent, "auto");

    // An agent that runs on computers still goes there, and a fork placed
    // on this device is not restricted.
    let codex = placed_on(&runtime, &folder, &computer);
    assert_eq!(
        runtime
            .placed_target(&codex, &request(&codex, &folder), "codex", None)
            .unwrap()
            .map(|target| target.id),
        Some(computer.id.clone())
    );
    let here = insert_run(&runtime, &folder);
    runtime.update(&here, |run| {
        run.host = Some(RunHost::device("Placed on this device.".into()))
    });
    assert!(runtime
        .computers_only_host(&here, "fixture", None)
        .is_none());
    // A continuation follows the attempt it continues.
    let next = insert_run(&runtime, &folder);
    assert!(runtime
        .computers_only_host(&next, "fixture", Some(&codex))
        .is_some());
    drop(runtime);
    let _ = std::fs::remove_dir_all(folder);
}

// Linux CI has no Secret Service keyring to hold the saved sign-in.
#[cfg(not(target_os = "linux"))]
#[test]
fn a_computer_that_does_not_answer_is_a_lost_host() {
    let folder = std::env::temp_dir().join(format!("jackalope-lost-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("README.md"), "fixture\n").unwrap();
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    credentials::set(
        &runtime.computers_root(),
        "openai-key",
        Some("sk-fixture-0123456789abcdef"),
    )
    .unwrap();
    let computer = Computer {
        id: format!("lost{}", uuid::Uuid::new_v4().simple()),
        name: "Box".into(),
        owner_kind: "project".into(),
        owner_id: "fixture".into(),
        provider: "remote-machine".into(),
        machine_id: None,
        decisions: "fixture".into(),
        created_at: String::new(),
        last_used_at: None,
        settings: Default::default(),
    };
    let session = runs::Session::with_transport(
        Box::new(Unreachable),
        runs::run_name(&folder.to_string_lossy()),
    );
    let mut remote = remote::RemoteRunner::with_session(computer.clone(), false, session);
    let id = insert_run(&runtime, &folder);
    let req = request(&id, &folder);
    let mut codex = Command::new("codex");
    codex.args(["exec", "--json", "-"]);
    let workspace = folder.to_string_lossy().into_owned();
    let mut launch = Launch {
        id: &id,
        req: &req,
        adapter: "codex",
        cmd: codex,
        input: String::new(),
        workspace: &workspace,
    };
    let error = remote.prepare(&runtime, &mut launch).unwrap_err();
    assert!(error.starts_with("Box did not answer:"), "{error}");
    let host = runtime.run_snapshot(&id).unwrap().host.unwrap();
    assert_eq!(host.id, computer.id);
    assert_eq!(host.lost.as_deref(), Some(error.as_str()));
    assert!(pool::health(&computer.id).unavailable());
    drop(runtime);
    let _ = std::fs::remove_dir_all(folder);
}

const LEFT_PATCH: &str = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-fixture\n+changed on the computer\n";

/// A computer still holding the run a lost attempt left there, finished,
/// with [`LEFT_PATCH`] as its changes. Records the actions it was asked.
#[derive(Clone, Default)]
struct Leftover {
    calls: Arc<Mutex<Vec<String>>>,
    removed: Arc<AtomicBool>,
}

impl computers::Transport for Leftover {
    fn call(
        &mut self,
        payload: &serde_json::Value,
        _: Duration,
        _: &AtomicBool,
    ) -> Result<serde_json::Value, computers::AgentError> {
        use sha2::Digest;
        let action = payload["action"].as_str().unwrap().to_string();
        self.calls.lock().unwrap().push(action.clone());
        let removed = self.removed.load(std::sync::atomic::Ordering::SeqCst);
        Ok(match action.as_str() {
            "run_status" if removed => json!({"exists": false, "runs": 4}),
            "run_status" => json!({
                "exists": true, "runs": 4, "started": true, "exit": {"code": 0},
            }),
            "workspace_diff" => {
                let digest: String = sha2::Sha256::digest(LEFT_PATCH.as_bytes())
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect();
                json!({"size": LEFT_PATCH.len(), "sha256": digest})
            }
            "workspace_get" => json!({
                "data": base64::engine::general_purpose::STANDARD.encode(LEFT_PATCH),
            }),
            "run_remove" => {
                self.removed
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                json!({})
            }
            "workspace_put" => json!({}),
            other => return Err(format!("Unsupported action {other}").into()),
        })
    }
}

/// A failed attempt that lost `computer` mid-run, leaving its changes there.
fn lost_attempt(runtime: &TaskRuntime, workspace: &Path, computer: &Computer) -> String {
    let id = placed_on(runtime, workspace, computer);
    runtime.update(&id, |run| run.status = RunStatus::Failed);
    runtime.host_lost(&id, &computer.id, &computer.name, "Lost contact with Box");
    runtime.changes_left(&id);
    id
}

fn left_changes(runtime: &TaskRuntime, id: &str) -> pool::LeftChanges {
    runtime
        .run_snapshot(id)
        .unwrap()
        .host
        .unwrap()
        .left
        .unwrap()
}

#[test]
fn changes_left_on_a_lost_computer_are_saved_when_it_answers_never_applied() {
    let root = std::env::temp_dir().join(format!("jackalope-left-{}", uuid::Uuid::new_v4()));
    let folder = root.join("work");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("README.md"), "fixture\n").unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let computer = fixture_computer(&format!("left{}", uuid::Uuid::new_v4().simple()));
    let lost = lost_attempt(&runtime, &folder, &computer);
    let all = |runtime: &TaskRuntime| -> Vec<TaskRun> {
        runtime
            .inner
            .lock()
            .unwrap()
            .runs
            .values()
            .cloned()
            .collect()
    };

    // Recovery waits for another attempt to replace the lost one; until
    // then a continuation can still bring the changes back.
    assert!(recovery::waiting(&all(&runtime)).is_empty());
    let retry = insert_run(&runtime, &folder);
    runtime.update(&retry, |run| {
        run.retry_of = Some(lost.clone());
        run.status = RunStatus::Review;
    });
    let runs = all(&runtime);
    let due: Vec<&str> = recovery::waiting(&runs)
        .iter()
        .map(|run| run.id.as_str())
        .collect();
    assert_eq!(due, [lost.as_str()]);
    // Not while a run of the same workspace is active on that computer.
    let busy = placed_on(&runtime, &folder, &computer);
    runtime.update(&busy, |run| run.status = RunStatus::Running);
    assert!(recovery::waiting(&all(&runtime)).is_empty());
    runtime.update(&busy, |run| run.status = RunStatus::Review);

    let transport = Leftover::default();
    let mut session = runs::Session::with_transport(
        Box::new(transport.clone()),
        runs::run_name(&folder.to_string_lossy()),
    );
    let status = session.status().unwrap().unwrap();
    let saved = runtime.run_snapshot(&lost).unwrap();
    assert!(runtime.recover_left(&saved, &mut session, &status, &computer, false));

    // Saved beside the history as a failed apply would be, never applied,
    // and the run removed from the computer.
    let left = left_changes(&runtime, &lost);
    let patch = root.join("history").join(format!("{lost}.remote.patch"));
    assert_eq!(
        left.patch.as_deref(),
        Some(patch.to_string_lossy().as_ref())
    );
    assert_eq!(std::fs::read_to_string(&patch).unwrap(), LEFT_PATCH);
    assert_eq!((left.files, left.on_host), (1, false));
    assert!(left.recovered_at.is_some() && left.note.is_none());
    assert_eq!(
        std::fs::read_to_string(folder.join("README.md")).unwrap(),
        "fixture\n"
    );
    assert!(transport.removed.load(std::sync::atomic::Ordering::SeqCst));
    // Task details read it under these names.
    let shown = serde_json::to_value(runtime.run_snapshot(&lost).unwrap().host).unwrap();
    assert_eq!(shown["left"]["onHost"], false);
    assert_eq!(shown["left"]["files"], 1);
    assert!(shown["left"]["recoveredAt"].is_string() && shown["left"]["patch"].is_string());
    let activity = runtime.run_snapshot(&lost).unwrap().activity;
    assert!(
        activity.iter().any(
            |line| line.starts_with("Changes recovered from Box: 1 file saved at")
                && line.contains("not applied")
        ),
        "{activity:?}"
    );
    assert!(recovery::waiting(&all(&runtime)).is_empty());
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}

/// Prepares attempt `id` on `computer` through `transport`, as a launch would.
fn prepare_on(
    runtime: &TaskRuntime,
    computer: &Computer,
    transport: &Leftover,
    req: &RunRequest,
    workspace: &Path,
) {
    let session = runs::Session::with_transport(
        Box::new(transport.clone()),
        runs::run_name(&workspace.to_string_lossy()),
    );
    let mut remote = remote::RemoteRunner::with_session(computer.clone(), false, session);
    let mut codex = Command::new("codex");
    codex.args(["exec", "--json", "-"]);
    let text = workspace.to_string_lossy().into_owned();
    let mut launch = Launch {
        id: &req.id,
        req,
        adapter: "codex",
        cmd: codex,
        input: String::new(),
        workspace: &text,
    };
    assert_eq!(remote.prepare(runtime, &mut launch).unwrap(), Step::Ready);
}

// Linux CI has no Secret Service keyring to hold the saved sign-in.
#[cfg(not(target_os = "linux"))]
#[test]
fn a_later_attempt_on_that_computer_never_picks_up_a_lost_attempts_changes() {
    let root = std::env::temp_dir().join(format!("jackalope-stale-{}", uuid::Uuid::new_v4()));
    let folder = root.join("work");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("README.md"), "fixture\n").unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    credentials::set(
        &runtime.computers_root(),
        "openai-key",
        Some("sk-fixture-0123456789abcdef"),
    )
    .unwrap();
    let computer = fixture_computer(&format!("stale{}", uuid::Uuid::new_v4().simple()));

    // A retry of the same workspace placed back on the computer saves the
    // lost attempt's changes for it before its own upload replaces them.
    let lost = lost_attempt(&runtime, &folder, &computer);
    let retry = placed_on(&runtime, &folder, &computer);
    runtime.update(&retry, |run| run.retry_of = Some(lost.clone()));
    let transport = Leftover::default();
    prepare_on(
        &runtime,
        &computer,
        &transport,
        &request(&retry, &folder),
        &folder,
    );
    assert_eq!(
        std::fs::read_to_string(folder.join("README.md")).unwrap(),
        "fixture\n"
    );
    let left = left_changes(&runtime, &lost);
    assert!(left.patch.is_some() && !left.on_host, "{left:?}");
    let calls = transport.calls.lock().unwrap().clone();
    let removed = calls.iter().position(|call| call == "run_remove").unwrap();
    let uploaded = calls
        .iter()
        .position(|call| call == "workspace_put")
        .unwrap();
    assert!(removed < uploaded, "{calls:?}");
    assert!(runtime
        .run_snapshot(&retry)
        .unwrap()
        .activity
        .iter()
        .any(|line| line.contains(&format!("Changes attempt {lost} left on Box"))));

    // A continuation of the lost attempt still brings them back, as before.
    let other = root.join("continued");
    std::fs::create_dir_all(&other).unwrap();
    std::fs::write(other.join("README.md"), "fixture\n").unwrap();
    let lost = lost_attempt(&runtime, &other, &computer);
    let next = placed_on(&runtime, &other, &computer);
    let continued = RunRequest {
        previous_run_id: Some(lost.clone()),
        ..request(&next, &other)
    };
    prepare_on(
        &runtime,
        &computer,
        &Leftover::default(),
        &continued,
        &other,
    );
    // Applying the changes follows the machine's core.autocrlf, so Windows can write CRLF.
    assert_eq!(
        std::fs::read_to_string(other.join("README.md"))
            .unwrap()
            .replace("\r\n", "\n"),
        "changed on the computer\n"
    );
    let left = left_changes(&runtime, &lost);
    assert!(!left.on_host && left.patch.is_none(), "{left:?}");
    assert!(left.note.unwrap().contains(&next));
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}
