use super::*;
use crate::commands::process_control::{read_bounded, ProcessTree};

fn configure(cmd: &mut Command, adapter: &str, prompt_path: &Path) -> Result<(), String> {
    match adapter {
        "codex" => { cmd.args(["exec", "--disable", "shell_tool", "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-c", "approval_policy=\"never\"", "-c", "mcp_servers={}", "-c", "web_search=\"disabled\"", "-"]); }
        "claude" => { cmd.args(["--print", "--verbose", "--output-format", "stream-json", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--max-turns", "1"]); }
        "grok" => { cmd.args(["--output-format", "streaming-messages-json", "--permission-mode", "dontAsk", "--tools", "", "--deny", "*", "--disable-web-search", "--max-turns", "1", "--prompt-file"]).arg(prompt_path); }
        "opencode" => {
            cmd.args(["run", "--format", "json"]);
            cmd.env("OPENCODE_CONFIG_CONTENT", "{\"permission\":\"deny\",\"agent\":{\"build\":{\"permission\":\"deny\"}}}");
        }
        _ => return Err("This default agent has no supported routing-only interface. Choose Codex, Claude, Grok or OpenCode as the default orchestrator. Antigravity remains available as a worker.".into()),
    }
    Ok(())
}

impl TaskRuntime {
    pub(super) fn routing_process(
        &self,
        req: &RunRequest,
        router: &Candidate,
        prompt: &str,
    ) -> Result<TaskRun, String> {
        let directory =
            self.directory
                .join("routing")
                .join(format!("{}-{}", req.id, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let prompt_path = directory.join("request.txt");
        let (_, executable) = self.policy()?.resolve(&router.agent)?;
        let mut cmd = command(executable);
        configure(&mut cmd, &router.adapter, &prompt_path)?;
        agent_profiles::validate_binding(&self.profiles_root(), &router.binding)?;
        agent_profiles::apply_binding(&mut cmd, &router.binding)?;
        if let Some(model) = &router.model {
            cmd.args(["--model", model]);
        }
        if router.adapter == "grok" {
            std::fs::write(&prompt_path, prompt).map_err(|e| e.to_string())?;
        }
        cmd.current_dir(&directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut inner = self.inner.lock().unwrap();
        if inner.canceled.contains(&req.id) {
            return Err("Routing was stopped.".into());
        }
        let mut output = inner
            .runs
            .get(&req.id)
            .cloned()
            .ok_or("Attempt not found")?;
        let (mut child, _) = super::super::runtime::spawn_agent(&mut cmd, &router.agent)?;
        let tree = match ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let stdin = child.stdin.take().ok_or("Routing input unavailable")?;
        let stdout = child.stdout.take().ok_or("Routing output unavailable")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Routing diagnostics unavailable")?;
        let process = Arc::new(Mutex::new(child));
        inner.processes.insert(req.id.clone(), process.clone());
        drop(inner);
        self.update_checked(&req.id, |run| {
            run.process_contained = cfg!(windows);
            activity(run, &format!("{} is choosing an agent, model and account using task context and available quota.", router.agent));
        })?;
        let input = prompt.as_bytes().to_vec();
        let file_input = router.adapter == "grok";
        let writer = std::thread::spawn(move || {
            let mut stdin = stdin;
            if file_input {
                Ok(())
            } else {
                stdin.write_all(&input)
            }
        });
        let reader = std::thread::spawn(move || read_bounded(stdout, 512_000));
        let diagnostics = std::thread::spawn(move || read_bounded(stderr, 16_000));
        let started = std::time::Instant::now();
        let mut failure = None;
        let exit = loop {
            match process.lock().unwrap().try_wait() {
                Ok(Some(exit)) => break Some(exit),
                Ok(None) => {}
                Err(error) => {
                    failure = Some(error.to_string());
                    break None;
                }
            }
            if !self.is_running(&req.id) {
                failure = Some("Routing was stopped.".into());
                break None;
            }
            if started.elapsed() > Duration::from_secs(120) {
                failure =
                    Some("The default agent's routing request timed out. Retry the task.".into());
                break None;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        tree.terminate();
        let _ = process.lock().unwrap().kill();
        let _ = process.lock().unwrap().wait();
        self.inner.lock().unwrap().processes.remove(&req.id);
        let written = writer.join().map_err(|_| "Routing input writer stopped")?;
        let read = reader
            .join()
            .map_err(|_| "Routing output reader stopped")?
            .map_err(|e| e.to_string())?;
        let _ = diagnostics.join();
        if router.adapter == "grok" {
            let _ = std::fs::remove_file(prompt_path);
        }
        output.model = router.model.clone();
        output.result.clear();
        output.error = None;
        output.session_id = None;
        output.usage = Usage::default();
        output.usage_observations.clear();
        output.activity.clear();
        output.quota_failure = None;
        for line in read.0.lines() {
            consume_adapter_event(&mut output, line, &router.adapter);
        }
        if let Some(error) = &failure {
            output.error = Some(error.clone());
        }
        if written.is_err() {
            output.error = Some("The default agent did not accept the routing context.".into());
        }
        if read.1 {
            output.error = Some("The routing response exceeded its size limit.".into());
        }
        if !exit.is_some_and(|status| status.success()) && output.error.is_none() {
            output.error = Some("The default agent could not complete routing.".into());
        }
        self.update_checked(&req.id, |run| {
            run.routing
                .get_or_insert_with(Default::default)
                .attempts
                .push(RoutingAttempt {
                    agent: router.agent.clone(),
                    model: output.model.clone().or_else(|| router.model.clone()),
                    binding: router.binding.clone(),
                    usage: output.usage.clone(),
                    error: output.error.clone(),
                    recorded_at: Utc::now().to_rfc3339(),
                });
        })?;
        if output.quota_failure.is_none()
            && (!exit.is_some_and(|status| status.success()) || output.error.is_some())
        {
            return Err("The default agent could not complete routing. Check its account, model and quota, then retry. No worker was launched.".into());
        }
        Ok(output)
    }
}
