use super::*;

impl TaskRuntime {
    pub(super) fn fail(&self, id: &str, error: String) {
        self.update(id, |run| {
            run.status = "failed".into();
            run.error = Some(error);
            run.ended_at = Some(Utc::now().to_rfc3339());
        });
    }

    pub(in crate::commands) fn request_reset(&self) -> Result<(), String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        if inner
            .runs
            .values()
            .any(|run| ["starting", "running", "stopping"].contains(&run.status.as_str()))
        {
            return Err("Stop active tasks before resetting Jackalope.".into());
        }
        crate::commands::reset::reject_links(&self.directory)?;
        std::fs::write(
            self.directory.join(crate::commands::reset::RESET_MARKER),
            uuid::Uuid::new_v4().to_string(),
        )
        .map_err(|e| e.to_string())
    }

    pub(in crate::commands) fn is_running(&self, id: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .runs
            .get(id)
            .is_some_and(|run| ["starting", "running"].contains(&run.status.as_str()))
    }

    pub fn stop_all(&self) {
        let ids: Vec<_> = self
            .inner
            .lock()
            .unwrap()
            .runs
            .values()
            .filter(|r| ["starting", "running", "stopping"].contains(&r.status.as_str()))
            .map(|r| r.id.clone())
            .collect();
        for id in ids {
            let _ = self.stop(&id);
        }
    }

    pub(in crate::commands) fn stop(&self, id: &str) -> Result<(), String> {
        let process = {
            let mut inner = self.inner.lock().unwrap();
            let run = inner.runs.get(id).ok_or("Attempt not found")?;
            if !["starting", "running", "stopping"].contains(&run.status.as_str()) {
                return Ok(());
            }
            inner.canceled.insert(id.into());
            inner.processes.get(id).cloned()
        };
        self.update(id, |r| r.status = "stopping".into());
        if let Some(process) = process {
            let mut child = process.lock().unwrap();
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                #[cfg(windows)]
                {
                    command("taskkill.exe")
                        .args(["/PID", &child.id().to_string(), "/T", "/F"])
                        .output()
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(unix)]
                {
                    let _ = command("kill")
                        .args(["-TERM", "--", &format!("-{}", child.id())])
                        .output();
                }
                let _ = child.kill();
            }
        }
        Ok(())
    }

    pub(super) fn execute(
        &self,
        id: &str,
        req: &RunRequest,
        previous: Option<TaskRun>,
    ) -> Result<(), String> {
        let root = git(&req.project_path, &["rev-parse", "--show-toplevel"])?;
        let base_ref = format!(
            "refs/heads/{}",
            req.target_branch
                .as_deref()
                .ok_or("Choose a target branch before running work.")?
        );
        let base = git(&root, &["rev-parse", &base_ref])?;
        if previous.is_none()
            && !req.isolated
            && git(&root, &["symbolic-ref", "--quiet", "HEAD"])? != base_ref
        {
            return Err("The checkout is on a different branch. Switch to the target branch or enable an isolated worktree.".into());
        }
        let (workspace, branch, base_head) = if let Some(ref old) = previous {
            if old.session_id.is_none() {
                return Err("This attempt has no resumable agent session. Start a new task with the relevant context.".into());
            }
            (
                old.workspace.clone(),
                old.branch.clone(),
                old.base_head.clone(),
            )
        } else if req.isolated {
            let parent = PathBuf::from(&root).join(".worktrees");
            std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
            let canonical_root = std::fs::canonicalize(&root).map_err(|e| e.to_string())?;
            if !std::fs::canonicalize(&parent)
                .map_err(|e| e.to_string())?
                .starts_with(&canonical_root)
            {
                return Err("The .worktrees directory resolves outside this project.".into());
            }
            let path = parent.join(format!("jackalope-{id}"));
            let branch = format!("jackalope/{id}");
            let exclude_path = git(
                &root,
                &[
                    "rev-parse",
                    "--path-format=absolute",
                    "--git-path",
                    "info/exclude",
                ],
            )?;
            let mut exclude = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(exclude_path)
                .map_err(|e| e.to_string())?;
            writeln!(exclude, "\n/.worktrees/jackalope-{id}/").map_err(|e| e.to_string())?;
            git(
                &root,
                &[
                    "worktree",
                    "add",
                    "-b",
                    &branch,
                    path.to_str().ok_or("Invalid workspace path")?,
                    &base,
                ],
            )?;
            (path.to_string_lossy().into_owned(), branch, base)
        } else {
            (
                root.clone(),
                git(&root, &["branch", "--show-current"])?,
                base,
            )
        };
        self.update_checked(id, |r| {
            r.workspace = workspace.clone();
            r.branch = branch;
            r.base_head = base_head;
        })?;
        let policy = self.policy()?;
        let (adapter, executable) = policy.resolve(&req.agent)?;
        let selected_model = policy.model(&req.agent, req.model.as_deref())?;
        let mut cmd = command(executable);
        if let Some(env_name) = crate::commands::agent_profiles::env_var_for(&adapter) {
            let binding = req
                .account_binding
                .as_ref()
                .ok_or("Account selection is missing. Start a new task.")?;
            crate::commands::agent_profiles::validate_binding(&self.profiles_root(), binding)?;
            cmd.env(env_name, &binding.directory);
        }
        if adapter == "codex" {
            cmd.args([
                "exec",
                "-c",
                "approval_policy=\"never\"",
                "-c",
                "sandbox_mode=\"workspace-write\"",
            ]);
            if let Some(ref old) = previous {
                cmd.args(["resume", old.session_id.as_deref().unwrap()]);
            }
            cmd.args(["--json", "-"]);
        } else if adapter == "claude" {
            cmd.args([
                "--print",
                "--verbose",
                "--output-format",
                "stream-json",
                "--permission-mode",
                "acceptEdits",
            ]);
            if let Some(ref old) = previous {
                cmd.args(["--resume", old.session_id.as_deref().unwrap()]);
            }
        } else {
            cmd.args([
                "--output-format",
                "streaming-messages-json",
                "--permission-mode",
                "acceptEdits",
            ]);
            cmd.arg("--prompt-file")
                .arg(self.directory.join(format!("{id}.prompt")));
            if let Some(ref old) = previous {
                cmd.args(["--resume", old.session_id.as_deref().unwrap()]);
            }
        }
        if let Some(model) = &selected_model {
            cmd.args(["--model", model]);
        }
        let mut project_mcp = crate::commands::mcp::project_servers(
            &req.project_id,
            req.connection_ids.as_deref(),
            &adapter,
        )?;
        if adapter == "codex" {
            for value in crate::commands::mcp::codex_overrides(&project_mcp)? {
                cmd.args(["-c", &value]);
            }
        }
        if adapter == "claude" && req.coordination.is_none() && !project_mcp.is_empty() {
            cmd.args([
                "--mcp-config",
                &serde_json::json!({"mcpServers":project_mcp}).to_string(),
            ]);
        }
        let mut input = format!("{}\n\nJackalope task context: Work in the current workspace. Preserve the user's intent and follow repository instructions. Do not commit, merge, push, or delete the workspace. In your final response explain the outcome, changed files, verification actually performed, and anything unresolved. If you need clarification or a denied permission, explain what is needed and stop so the user can reply.\n", req.prompt);
        if let Some(context) = &req.coordination {
            cmd.env("JACKALOPE_BRIDGE_URL", &context.endpoint)
                .env("JACKALOPE_BRIDGE_TOKEN", &context.token);
            input.push_str(&context.instructions);
            if adapter == "claude" {
                project_mcp.insert("jackalope".into(), serde_json::json!({"type":"http","url":format!("{}/mcp", context.endpoint),"headers":{"Authorization":"Bearer ${JACKALOPE_BRIDGE_TOKEN}"}}));
                let config = serde_json::json!({"mcpServers":project_mcp});
                cmd.args([
                    "--mcp-config",
                    &config.to_string(),
                    "--allowedTools",
                    "mcp__jackalope__project,mcp__jackalope__message,mcp__jackalope__browser_navigate,mcp__jackalope__browser_screenshot,mcp__jackalope__browser_snapshot,mcp__jackalope__browser_interact,mcp__jackalope__ask_user,mcp__jackalope__user_response,mcp__jackalope__record_validation_step,mcp__jackalope__computer_verify",
                ]);
                input.push_str("\nClaude harness tools: You have access to in-app browser automation, interactive user questions, and structured verification via provided mcp__jackalope__* tools (browser_navigate, browser_screenshot, browser_snapshot, browser_interact, ask_user, record_validation_step, computer_verify). If testing UI changes or onboarding flows, proactively use browser_screenshot and record_validation_step to provide verifiable evidence, and ask_user if you need test data or confirmation. If a question returns pending, use user_response with its ID to read the saved answer.\n");
            }
        }
        if adapter == "grok" {
            std::fs::write(self.directory.join(format!("{id}.prompt")), &input)
                .map_err(|e| e.to_string())?;
        }
        cmd.current_dir(&workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut inner = self.inner.lock().unwrap();
        if inner.canceled.contains(id) {
            drop(inner);
            self.update(id, |r| {
                r.status = "stopped".into();
                r.ended_at = Some(Utc::now().to_rfc3339());
            });
            return Ok(());
        }
        if inner.runs.values().any(|r| {
            r.id != id
                && r.workspace == workspace
                && ["starting", "running", "stopping"].contains(&r.status.as_str())
        }) {
            return Err(
                "Another attempt is using this workspace. Stop it or wait before continuing."
                    .into(),
            );
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not launch {}: {e}", req.agent))?;
        let tree = match crate::commands::process_control::ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let mut stdin = child.stdin.take().ok_or("Missing agent input")?;
        let stdout = child.stdout.take().ok_or("Missing agent output")?;
        let stderr = child.stderr.take().ok_or("Missing agent diagnostics")?;
        let process = Arc::new(Mutex::new(child));
        inner.processes.insert(id.into(), process.clone());
        drop(inner);
        self.update_checked(id, |r| {
            r.process_contained = cfg!(windows);
            if r.status == "starting" {
                r.status = "running".into();
            }
        })?;
        let input_result = if adapter == "grok" {
            Ok(())
        } else {
            stdin.write_all(input.as_bytes())
        };
        drop(stdin);
        if let Err(error) = input_result {
            let _ = self.stop(id);
            return Err(format!("Could not deliver task: {error}"));
        }
        let runtime = self.clone();
        let event_id = id.to_string();
        let output_adapter = adapter.clone();
        let reader = std::thread::spawn(move || {
            if let Err(error) = crate::commands::process_control::bounded_lines(
                BufReader::new(stdout),
                1_000_000,
                |line, truncated| {
                    runtime.update(&event_id, |r| {
                    if truncated { activity(r, "An oversized agent event was omitted. Inspect the agent session for full output."); }
                    else { consume_adapter_event(r, &line, &output_adapter); }
                });
                },
            ) {
                runtime.update(&event_id, |r| {
                    r.error = Some(format!("Agent output could not be read: {error}"))
                });
            }
        });
        let runtime = self.clone();
        let event_id = id.to_string();
        let diagnostics = std::thread::spawn(move || {
            let _ = crate::commands::process_control::bounded_lines(
                BufReader::new(stderr),
                6000,
                |mut line, truncated| {
                    if truncated {
                        line.push_str(" [truncated]");
                    }
                    runtime.update(&event_id, |r| r.diagnostics.push(line));
                },
            );
        });
        let exit = loop {
            if let Some(exit) = process
                .lock()
                .unwrap()
                .try_wait()
                .map_err(|e| e.to_string())?
            {
                break exit;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        tree.terminate();
        let _ = reader.join();
        let _ = diagnostics.join();
        if adapter == "grok" {
            let _ = std::fs::remove_file(self.directory.join(format!("{id}.prompt")));
        }
        let canceled = {
            let mut inner = self.inner.lock().unwrap();
            inner.processes.remove(id);
            inner.canceled.remove(id)
        };
        self.update(id, |r| {
            r.exit_code = exit.code(); r.ended_at = Some(Utc::now().to_rfc3339());
            r.status = if canceled { "stopped" } else if exit.success() && r.error.is_none() && !r.result.is_empty() { "review" } else { "failed" }.into();
            if r.status == "failed" && r.error.is_none() { r.error = Some(format!("Agent exited with {}. Inspect activity for details; no successful result was reported.", exit.code().map_or("no exit code".into(), |c| c.to_string()))); }
        });
        Ok(())
    }
}

impl TaskRuntime {}

impl TaskRuntime {
    pub(in crate::commands) fn record_prompt(
        &self,
        prompt: &crate::commands::harness::PendingUserPrompt,
    ) {
        self.update(&prompt.run_id, |run| {
            if let Some(existing) = run.prompts.iter_mut().find(|p| p.id == prompt.id) {
                if existing.status != "answered" {
                    *existing = prompt.clone();
                }
            } else {
                run.prompts.push(prompt.clone());
            }
        });
    }

    pub(in crate::commands) fn respond_prompt(
        &self,
        run_id: &str,
        prompt_id: &str,
        answer: &str,
    ) -> Result<bool, String> {
        if answer.trim().is_empty() || answer.len() > 4000 {
            return Err("Reply with 1–4,000 characters.".into());
        }
        {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            let run = inner.runs.get_mut(run_id).ok_or("Attempt not found")?;
            if !["starting", "running"].contains(&run.status.as_str()) {
                return Err(
                    "This attempt has ended. Continue the task to provide more input.".into(),
                );
            }
            let mut updated = run.clone();
            let prompt = updated
                .prompts
                .iter_mut()
                .find(|p| p.id == prompt_id && p.run_id == run_id)
                .ok_or("This question does not belong to the selected task.")?;
            if prompt.status == "answered" {
                return Err("This question has already been answered.".into());
            }
            prompt.status = "answered".into();
            prompt.answer = Some(answer.trim().into());
            prompt.answered_at = Some(Utc::now().to_rfc3339());
            activity(&mut updated, "A response was saved for the agent.");
            self.save(&updated)?;
            updated.persistence_error = None;
            *run = updated;
        }
        crate::commands::harness::resolve_user_prompt(prompt_id, answer.trim());
        Ok(true)
    }

    pub fn integration_runs(&self) -> Result<Vec<TaskRun>, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|e| e.to_string())?
            .runs
            .values()
            .cloned()
            .collect())
    }
    pub fn integration_directory(&self) -> PathBuf {
        self.directory.join("integrations")
    }
    pub fn profiles_root(&self) -> PathBuf {
        self.directory.join("agent-profiles")
    }
    pub(in crate::commands) fn start(&self, request: RunRequest) -> Result<String, String> {
        let _integration_guard = crate::commands::integration::execution_guard()?;
        self.start_locked(request)
    }
    /// Caller holds the execution guard; acquire runtime state only after it.
    /// Coordinator callers must acquire coordinator state before that guard.
    pub(in crate::commands) fn start_locked(
        &self,
        mut request: RunRequest,
    ) -> Result<String, String> {
        self.ensure_history_saved()?;
        if crate::commands::release::installing() {
            return Err(
                "An app update is being installed. Start new work after reopening Jackalope."
                    .into(),
            );
        }
        if self
            .directory
            .join(crate::commands::reset::RESET_MARKER)
            .exists()
        {
            return Err("Jackalope is resetting.".into());
        }
        if let Some(previous) = &request.previous_run_id {
            if crate::commands::integration::applied_run_ids(self)?.contains(previous) {
                return Err("This task has already been integrated. Add a new task to start from the updated target branch.".into());
            }
        }
        if !valid_id(&request.id)
            || request.prompt.trim().is_empty()
            || request.prompt.len() > 100_000
        {
            return Err("Provide a task between 1 and 100,000 bytes.".into());
        }
        self.apply_policy(&mut request)?;
        let previous;
        let (adapter, _) = self.policy()?.resolve(&request.agent)?;
        {
            let mut inner = self.inner.lock().unwrap();
            if let Some(existing) = inner.runs.get(&request.id) {
                if existing.prompt == request.prompt
                    && existing.project_id == request.project_id
                    && existing.agent == request.agent
                {
                    return Ok(request.id);
                }
                return Err("This attempt ID is already associated with a different task.".into());
            }
            previous = request
                .previous_run_id
                .as_ref()
                .map(|id| {
                    inner
                        .runs
                        .get(id)
                        .cloned()
                        .ok_or("Previous attempt not found")
                })
                .transpose()?;
            if let Some(ref old) = previous {
                if old.status == "interrupted" {
                    return Err("This attempt was interrupted. Inspect the agent's CLI session and workspace before starting new work; automatic resume is unavailable because process ownership is unknown.".into());
                }
                if inner.runs.values().any(|r| {
                    r.task_id == old.task_id
                        && ["starting", "running", "stopping"].contains(&r.status.as_str())
                }) {
                    return Err("This task already has an active attempt.".into());
                }
                if old.agent != request.agent
                    || old.project_id != request.project_id
                    || old.project_path != request.project_path
                {
                    return Err("A continuation must use its original project and agent.".into());
                }
                if ["starting", "running", "stopping"].contains(&old.status.as_str()) {
                    return Err("Stop or finish this attempt before continuing.".into());
                }
            }
            let binding = if let Some(old) = &previous {
                let binding = old.account_binding.clone().ok_or("This older attempt has no saved account profile. Start a new task to choose an account safely.")?;
                if binding.adapter != adapter
                    || request
                        .agent_profile_id
                        .as_ref()
                        .is_some_and(|id| Some(id) != binding.profile_id.as_ref())
                {
                    return Err("Continue with the original agent account, or start a new task with another account.".into());
                }
                crate::commands::agent_profiles::validate_binding(&self.profiles_root(), &binding)?;
                binding
            } else {
                crate::commands::agent_profiles::bind_account(
                    &self.profiles_root(),
                    &adapter,
                    request.agent_profile_id.as_deref(),
                )?
            };
            request.target_branch = Some(if let Some(old) = &previous {
                old.target_branch.clone().unwrap_or_else(|| "master".into())
            } else {
                resolve_target_branch(&request.project_path, request.target_branch.as_deref())?
            });
            request.account_binding = Some(binding.clone());
            if let Some(old) = &previous {
                request.verify_command = old.verify_command.clone();
                request.connection_ids = old.connection_ids.clone();
            }
            let run = TaskRun {
                id: request.id.clone(),
                task_id: previous
                    .as_ref()
                    .map_or(request.id.clone(), |r| r.task_id.clone()),
                project_id: request.project_id.clone(),
                project_name: request.project_name.clone(),
                project_path: request.project_path.clone(),
                workspace: String::new(),
                branch: String::new(),
                base_head: String::new(),
                agent: request.agent.clone(),
                account: binding.label.clone(),
                connection_ids: request.connection_ids.clone(),
                account_binding: Some(binding),
                target_branch: request.target_branch.clone(),
                process_contained: false,
                verify_command: request.verify_command.clone(),
                verification: None,
                model: request.model.clone(),
                prompt: request.prompt.clone(),
                status: "starting".into(),
                started_at: Utc::now().to_rfc3339(),
                ended_at: None,
                session_id: None,
                result: String::new(),
                details_omitted: false,
                activity: vec![],
                diagnostics: vec![],
                error: None,
                persistence_error: None,
                exit_code: None,
                usage: Usage::default(),
                usage_observations: vec![],
                prompts: vec![],
                validation_steps: vec![],
                screenshots: vec![],
            };
            self.save(&run)?;
            inner.runs.insert(run.id.clone(), run);
        }
        let runtime = self.clone();
        let id = request.id.clone();
        std::thread::spawn(move || {
            if let Err(error) = runtime.execute(&request.id, &request, previous) {
                {
                    let mut inner = runtime.inner.lock().unwrap();
                    inner.processes.remove(&request.id);
                    inner.canceled.remove(&request.id);
                }
                runtime.fail(&request.id, error);
            }
            crate::commands::browser::close(&request.id);
        });
        Ok(id)
    }
}
