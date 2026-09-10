use super::*;
use crate::commands::{
    agent_profiles::AccountBinding,
    process_control::{read_bounded, ProcessTree},
};
use std::sync::atomic::{AtomicBool, Ordering};

pub(in crate::commands) fn run(
    runtime: &TaskRuntime,
    agent: &str,
    binding: &AccountBinding,
    model: Option<&str>,
    prompt: &str,
    canceled: &AtomicBool,
) -> Result<TaskRun, String> {
    runtime.access.ensure()?;
    let policy = runtime.policy()?;
    let (adapter, executable) = policy.resolve(agent)?;
    let model = policy.model_for_account(agent, model, binding)?;
    if !policy.account_allowed("", agent, binding) {
        return Err("This account is disabled. Choose an enabled account in Agents.".into());
    }
    crate::commands::agent_profiles::validate_binding(&runtime.profiles_root(), binding)?;
    let directory = runtime.directory.join("helper-workspace");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let prompt_path = directory.join(format!("{}.txt", uuid::Uuid::new_v4()));
    let mut cmd = command(executable);
    let _configuration = routing::process::configure(&mut cmd, &adapter, &prompt_path, prompt)?;
    crate::commands::agent_profiles::apply_binding(&mut cmd, binding)?;
    if let Some(model) = model.as_deref() {
        cmd.args(["--model", model]);
    }
    if adapter == "grok" {
        std::fs::write(&prompt_path, prompt).map_err(|e| e.to_string())?;
    }
    cmd.current_dir(&directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if canceled.load(Ordering::SeqCst) {
        return Err("Stopped.".into());
    }
    let (mut child, _) = runtime::spawn_agent(&mut cmd, agent)?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut stdin = child.stdin.take().ok_or("Agent input unavailable")?;
    let stdout = child.stdout.take().ok_or("Agent output unavailable")?;
    let stderr = child.stderr.take().ok_or("Agent diagnostics unavailable")?;
    let input = prompt.as_bytes().to_vec();
    let file_input = matches!(adapter.as_str(), "grok" | "kimi");
    let writer = std::thread::spawn(move || {
        if file_input {
            Ok(())
        } else {
            stdin.write_all(&input)
        }
    });
    let reader = std::thread::spawn(move || read_bounded(stdout, 512_000));
    let diagnostics = std::thread::spawn(move || read_bounded(stderr, 16_000));
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(error) => break Err(error.to_string()),
            _ => {}
        }
        if canceled.load(Ordering::SeqCst) {
            break Err("Stopped.".into());
        }
        if started.elapsed() > Duration::from_secs(120) {
            break Err("The agent timed out. Check its account and try again.".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    tree.terminate();
    let _ = child.kill();
    let _ = child.wait();
    let written = writer.join();
    let read = reader.join();
    let _ = diagnostics.join();
    if file_input {
        let _ = std::fs::remove_file(&prompt_path);
    }
    let status = status?;
    written
        .map_err(|_| "Agent input stopped")?
        .map_err(|e| e.to_string())?;
    let (text, truncated) = read
        .map_err(|_| "Agent output stopped")?
        .map_err(|e| e.to_string())?;
    if truncated {
        return Err("The agent response exceeded the size limit.".into());
    }
    let mut output = TaskRun {
        agent: agent.into(),
        ..Default::default()
    };
    for line in text.lines() {
        consume_adapter_event(&mut output, line, &adapter);
    }
    if output.quota_failure.is_some() {
        return Err("The selected agent account has reached its usage limit. Wait for its quota to reset or choose another default agent/account in Agents.".into());
    }
    if !status.success() {
        return Err(
            "The agent could not answer. Check its sign-in, model and quota in Agents.".into(),
        );
    }
    if output.error.is_some() || output.result.trim().is_empty() {
        return Err("The agent returned no usable answer. Check its account and try again.".into());
    }
    Ok(output)
}
