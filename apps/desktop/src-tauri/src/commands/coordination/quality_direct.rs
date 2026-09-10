use crate::commands::{
    agent_profiles,
    process_control::ProcessTree,
    tasks::{self, TaskRun, TaskRuntime},
};
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
    let mut cmd = Command::new(executable);
    cmd.env_remove("JACKALOPE_QUALITY_SPEC");
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
        if let Some(check) = spec["check"].as_str() {
            cmd.args(["--allowedTools", &format!("Bash({check})")]);
        }
    } else {
        return Err("Direct trials support Codex and Claude".into());
    }
    let reasoning_effort = tasks::effort::configure(&mut cmd, &adapter, effort);
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
        account: binding.label.clone(),
        account_binding: Some(binding),
        workspace: repo.to_string_lossy().into(),
        status: "running".into(),
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
    let input = prompt.as_bytes().to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let state = run.clone();
    let log_path = repo.parent().unwrap().join("direct.jsonl");
    let reader = std::thread::spawn(move || -> Result<(), String> {
        let mut log = std::fs::File::create(log_path).map_err(|e| e.to_string())?;
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|e| e.to_string())?;
            writeln!(log, "{line}").map_err(|e| e.to_string())?;
            tasks::consume_adapter_event(&mut state.lock().unwrap(), &line, &adapter);
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
        let usage = run.lock().unwrap().usage.clone();
        if began.elapsed().as_secs() >= spec["seconds"].as_u64().unwrap_or(180)
            || usage.input.saturating_add(usage.output) >= spec["tokens"].as_u64().unwrap_or(250000)
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
    Ok((result, stopped))
}
