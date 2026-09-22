use crate::commands::{
    agent_profiles,
    process_control::ProcessTree,
    tasks::{self, TaskRun, TaskRuntime},
};
mod fixture_mcp;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub(super) fn run(
    runtime: &TaskRuntime,
    repo: &Path,
    spec: &Value,
) -> Result<(TaskRun, bool), String> {
    let agent = spec["agent"].as_str().ok_or("Missing agent")?;
    let model = spec["model"].as_str().ok_or("Missing model")?;
    let prompt = spec["prompt"].as_str().ok_or("Missing prompt")?;
    let policy = runtime.policy()?;
    let (adapter, executable) = policy.resolve(agent)?;
    let binding = agent_profiles::bind_account(
        &runtime.profiles_root(),
        &adapter,
        spec["agentProfileId"].as_str(),
    )?;
    if !policy.account_allowed("", agent, &binding) {
        return Err("Account is disabled".into());
    }
    let _runner_lease = crate::commands::managed_runtime::acquire(&executable)?;
    let mut cmd = Command::new(executable);
    let mut fixture_config = if adapter == "antigravity" && spec["fixtureMcp"].is_object() {
        Some(fixture_mcp::FixtureConfig::install(
            repo,
            &spec["fixtureMcp"],
        )?)
    } else {
        None
    };
    cmd.env_remove("JACKALOPE_QUALITY_SPEC");
    cmd.env_remove("JACKALOPE_JEV_TEST_KEY");
    agent_profiles::apply_binding(&mut cmd, &binding)?;
    let effort = serde_json::from_value(spec["effort"].clone()).map_err(|e| e.to_string())?;
    if adapter == "codex" {
        cmd.args([
            "exec",
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"workspace-write\"",
            "--json",
            "-",
        ]);
    } else if adapter == "claude" {
        cmd.args([
            "--print",
            "--verbose",
            "--output-format",
            "stream-json",
            "--permission-mode",
            "acceptEdits",
        ]);
    } else if adapter == "antigravity" {
        tasks::antigravity::configure(&mut cmd, &repo.to_string_lossy(), None);
    } else if adapter == "opencode" {
        cmd.args(["run", "--format", "json"]);
    } else {
        return Err("Direct trials support Codex, Claude, OpenCode and Antigravity tasks".into());
    }
    let reasoning_effort = tasks::effort::configure(&mut cmd, &adapter, effort);
    if let Some(servers) = spec["fixtureMcp"].as_object() {
        if adapter == "codex" {
            for value in crate::commands::mcp::codex_overrides(servers)? {
                cmd.args(["-c", &value]);
            }
        } else if adapter == "opencode" {
            let config = crate::commands::mcp::opencode_config(servers, &cmd)?;
            cmd.env("OPENCODE_CONFIG_CONTENT", config);
        } else if adapter == "claude" {
            cmd.args([
                "--mcp-config",
                &serde_json::json!({"mcpServers":servers}).to_string(),
            ]);
        }
    }
    if adapter == "claude" {
        let allowed = claude_allowed_tools(spec);
        if !allowed.is_empty() {
            cmd.arg("--allowedTools").args(allowed);
        }
    }
    let codex_speed =
        serde_json::from_value(spec["codexSpeed"].clone()).map_err(|e| e.to_string())?;
    let requested_service_tier = tasks::speed::configure(&mut cmd, &adapter, codex_speed);
    cmd.args(["--model", model])
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let run = Arc::new(Mutex::new(TaskRun {
        agent: agent.into(),
        model: Some(model.into()),
        effort,
        reasoning_effort,
        codex_speed,
        requested_service_tier,
        account: binding.label.clone(),
        account_binding: Some(binding),
        workspace: repo.to_string_lossy().into(),
        status: "running".into(),
        started_at: chrono::Utc::now().to_rfc3339(),
        ..Default::default()
    }));
    {
        let mut metrics = run.lock().unwrap();
        metrics.efficiency.launches = 1;
        metrics.efficiency.launch_prompt_bytes = prompt.len() as u64;
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut stdin = child.stdin.take().unwrap();
    let input = if adapter == "antigravity" {
        format!("{}\n", serde_json::json!({"event":"user","message":{"content":format!("Working directory: {}\n\n{prompt}", repo.display())}})).into_bytes()
    } else {
        prompt.as_bytes().to_vec()
    };
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let state = run.clone();
    let log_path = repo.parent().unwrap().join("direct.jsonl");
    let reader = std::thread::spawn(move || -> Result<(), String> {
        let mut log = std::fs::File::create(log_path).map_err(|e| e.to_string())?;
        let mut stream = tasks::antigravity::Stream::default();
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|e| e.to_string())?;
            writeln!(log, "{line}").map_err(|e| e.to_string())?;
            if adapter == "antigravity" {
                stream.consume(&mut state.lock().unwrap(), &line);
            } else {
                tasks::consume_adapter_event(&mut state.lock().unwrap(), &line, &adapter);
            }
        }
        if adapter == "antigravity" {
            stream.finish(&mut state.lock().unwrap());
        }
        Ok(())
    });
    let diagnostics =
        std::thread::spawn(move || crate::commands::process_control::read_bounded(stderr, 16_000));
    let began = Instant::now();
    let mut stopped = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(e) => break Err(e.to_string()),
            _ => {}
        }
        let observed = observed_tokens(&run.lock().unwrap());
        if began.elapsed().as_secs() >= spec["seconds"].as_u64().unwrap_or(180)
            || observed >= spec["tokens"].as_u64().unwrap_or(250000)
        {
            stopped = true;
            break Err("Observed benchmark budget reached".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    tree.terminate();
    let _ = child.kill();
    let _ = child.wait();
    let written = writer.join();
    let read = reader.join();
    let diagnostics = diagnostics.join();
    let mut result = run.lock().unwrap().clone();
    if let Some(config) = &mut fixture_config {
        if let Err(error) = config.finish() {
            result.error = Some(error);
        }
    }
    result.exit_code = status.as_ref().ok().and_then(|s| s.code());
    let io_ok = matches!(written, Ok(Ok(()))) && matches!(read, Ok(Ok(())));
    result.status = if stopped {
        "stopped"
    } else if status.as_ref().is_ok_and(|s| s.success()) && result.error.is_none() && io_ok {
        "review"
    } else {
        "failed"
    }
    .into();
    if let Err(error) = status {
        result.error = Some(error);
    }
    if !io_ok {
        result.error = Some("Could not capture complete direct CLI input/output".into());
    }
    if let Ok(Ok((text, _))) = diagnostics {
        result.diagnostics.push(text);
    }
    result.ended_at = Some(chrono::Utc::now().to_rfc3339());
    Ok((result, stopped))
}

fn claude_allowed_tools(spec: &Value) -> Vec<String> {
    let mut allowed = Vec::new();
    if let Some(check) = spec["check"]
        .as_str()
        .filter(|check| !check.trim().is_empty())
    {
        allowed.push(format!("Bash({check})"));
        if cfg!(windows) {
            allowed.push(format!("PowerShell({check})"));
        }
    }
    if let Some(servers) = spec["fixtureMcp"].as_object() {
        allowed.extend(
            servers
                .keys()
                .map(|name| format!("mcp__{name}__fixture_report")),
        );
    }
    allowed
}

pub(super) fn observed_tokens(run: &TaskRun) -> u64 {
    let messages = run.usage_observations.iter().fold(0u64, |total, message| {
        total
            .saturating_add(message.input)
            .saturating_add(message.output)
    });
    // Message observations precede some CLIs' final aggregate and already include cached input.
    messages.max(run.usage.input.saturating_add(run.usage.output))
}

#[test]
fn budgets_use_message_usage_before_final_totals_without_double_counting() {
    let mut run = TaskRun::default();
    assert_eq!(observed_tokens(&run), 0);
    for (id, output) in [("first", 2), ("first", 4), ("second", 3)] {
        tasks::consume_adapter_event(
            &mut run,
            &serde_json::json!({
                "type":"assistant", "message":{"id":id,"content":[],"usage":{
                    "input_tokens":10,"output_tokens":output,"cache_read_input_tokens":20,
                    "cache_creation_input_tokens":5}}
            })
            .to_string(),
            "claude",
        );
    }
    assert!(!run.usage.reported);
    assert_eq!(observed_tokens(&run), 77);
    run.usage.input = 70;
    run.usage.output = 7;
    assert_eq!(observed_tokens(&run), 77);
    run.usage.input = 100;
    assert_eq!(observed_tokens(&run), 107);
    run.usage.input = u64::MAX;
    assert_eq!(observed_tokens(&run), u64::MAX);
}

#[test]
fn claude_fixture_permissions_include_only_saved_checks_and_fixture_reads() {
    let allowed = claude_allowed_tools(&serde_json::json!({
        "check":"node check.mjs", "fixtureMcp":{"quality_fixture":{},"quality_fixture_1":{}}
    }));
    assert!(allowed.contains(&"Bash(node check.mjs)".into()));
    assert_eq!(
        allowed.contains(&"PowerShell(node check.mjs)".into()),
        cfg!(windows)
    );
    assert!(allowed.contains(&"mcp__quality_fixture__fixture_report".into()));
    assert!(allowed.contains(&"mcp__quality_fixture_1__fixture_report".into()));
    assert_eq!(allowed.len(), if cfg!(windows) { 4 } else { 3 });
    assert!(claude_allowed_tools(&serde_json::json!({"check":"  "})).is_empty());
}
