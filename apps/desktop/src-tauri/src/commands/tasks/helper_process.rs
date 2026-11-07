//! One-shot helper turns: an agent CLI answers one prompt with its tools
//! turned off. Routing, task strategy, learning reflection and the in-app
//! helper all start their agent here.

use super::agent_process::AgentProcess;
use super::*;
use crate::commands::{agent_profiles::AccountBinding, process_control::read_bounded};
use std::sync::atomic::{AtomicBool, Ordering};

/// The longest any helper turn may run, whatever its caller asks for.
pub(in crate::commands) const TURN_LIMIT: Duration = Duration::from_secs(120);
const OUTPUT_LIMIT: usize = 512_000;
const DIAGNOSTICS_LIMIT: usize = 16_000;

/// Runs a helper turn for `agent` on `binding`, stopped by `canceled` and by
/// `timeout`, which is capped at [`TURN_LIMIT`].
pub(in crate::commands) fn run(
    runtime: &TaskRuntime,
    agent: &str,
    binding: &AccountBinding,
    model: Option<&str>,
    prompt: &str,
    canceled: &AtomicBool,
    timeout: Duration,
) -> Result<TaskRun, String> {
    runtime.access.ensure()?;
    let policy = runtime.policy()?;
    let (adapter, executable) = policy.resolve(agent)?;
    let model = policy.model_for_account(&runtime.profiles_root(), agent, model, binding)?;
    if !policy.account_allowed("", agent, binding) {
        return Err("This account is disabled. Choose an enabled account in Agents.".into());
    }
    crate::commands::agent_profiles::validate_binding(&runtime.profiles_root(), binding)?;
    let directory = runtime.directory.join("helper-workspace");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let answer = Turn {
        agent,
        adapter: &adapter,
        executable,
        binding,
        model: model.as_deref(),
        prompt,
        prompt_path: directory.join(format!("{}.txt", uuid::Uuid::new_v4())),
        directory,
        attempt: None,
        limit: timeout.min(TURN_LIMIT),
    }
    .run(
        runtime,
        |_| {},
        &|| canceled.load(Ordering::SeqCst),
        |_| Ok(()),
    )?;
    let status = answer.exit.map_err(|interrupted| match interrupted {
        Interrupted::Stopped => "Stopped.".to_string(),
        Interrupted::TimedOut => "The agent timed out. Check its account and try again.".into(),
        Interrupted::Failed(error) => error,
    })?;
    answer.written.map_err(|e| e.to_string())?;
    let (mut text, truncated) = answer.output;
    if truncated {
        return Err("The agent response exceeded the size limit.".into());
    }
    let mut warm = answer.warm;
    if let Some(lease) = &warm {
        text = lease.output(|| canceled.load(Ordering::SeqCst))?;
    }
    let mut output = TaskRun {
        agent: agent.into(),
        ..Default::default()
    };
    for line in text.lines() {
        consume_adapter_event(&mut output, line, &adapter);
    }
    output.diagnostics = answer.diagnostics.lines().map(str::to_string).collect();
    if output.quota_failure.is_some() {
        return Err("The selected agent account has reached its usage limit. Wait for its quota to reset or choose another default agent/account in Agents.".into());
    }
    if !status.success() {
        return Err(reported(
            "The agent could not answer. Check its sign-in, model and quota in Agents.",
            &answer.diagnostics,
        ));
    }
    if output.error.is_some() || output.result.trim().is_empty() {
        return Err("The agent returned no usable answer. Check its account and try again.".into());
    }
    if let Some(lease) = &mut warm {
        output.efficiency.warm_provider_hits += u64::from(lease.reused);
        lease.complete();
    }
    output
        .efficiency
        .timing("helperStartup", answer.warm_elapsed);
    Ok(output)
}

/// `message`, followed by the last line the agent wrote to stderr, which
/// usually says why it failed.
pub(super) fn reported(message: &str, diagnostics: &str) -> String {
    match diagnostics
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
    {
        Some(line) => format!(
            "{message} The agent reported: {}",
            line.chars().take(300).collect::<String>()
        ),
        None => message.into(),
    }
}

/// One helper turn's agent, account, prompt and limits.
pub(super) struct Turn<'a> {
    pub agent: &'a str,
    pub adapter: &'a str,
    pub executable: PathBuf,
    pub binding: &'a AccountBinding,
    pub model: Option<&'a str>,
    pub prompt: &'a str,
    pub directory: PathBuf,
    /// Where an agent that reads its prompt from a file finds it.
    pub prompt_path: PathBuf,
    /// The attempt the turn works for. Its process is registered there, so
    /// stopping the attempt ends the turn.
    pub attempt: Option<&'a str>,
    pub limit: Duration,
}

pub(super) enum Interrupted {
    Stopped,
    TimedOut,
    Failed(String),
}

/// What the agent did in a helper turn.
pub(super) struct Answer {
    pub exit: Result<std::process::ExitStatus, Interrupted>,
    pub written: std::io::Result<()>,
    /// The agent's output, and whether it was cut at the size limit.
    pub output: (String, bool),
    pub diagnostics: String,
    /// Whether the agent started; a turn stopped before then has no output.
    pub ran: bool,
    /// The warm OpenCode server that answered, whose saved messages replace
    /// the CLI's output.
    pub warm: Option<super::warm_opencode::Lease>,
    pub warm_elapsed: Duration,
}

impl Turn<'_> {
    /// Starts the agent, gives it the prompt and waits for it to answer, stop
    /// or run out of time. `arguments` adds the caller's own flags after the
    /// model, and `started` runs once the process is up.
    pub(super) fn run(
        self,
        runtime: &TaskRuntime,
        arguments: impl FnOnce(&mut Command),
        canceled: &dyn Fn() -> bool,
        started: impl FnOnce(&Answer) -> Result<(), String>,
    ) -> Result<Answer, String> {
        let mut cmd = command(&self.executable);
        let _configuration = configure(&mut cmd, self.adapter, &self.prompt_path, self.prompt)?;
        crate::commands::agent_profiles::apply_binding(&mut cmd, self.binding)?;
        if let Some(model) = self.model {
            cmd.args(["--model", model]);
        }
        arguments(&mut cmd);
        let file_input = self.adapter == "grok";
        if file_input {
            std::fs::write(&self.prompt_path, self.prompt).map_err(|e| e.to_string())?;
        }
        let answer = self.answer(runtime, cmd, canceled, started);
        if file_input {
            let _ = std::fs::remove_file(&self.prompt_path);
        }
        answer
    }

    fn answer(
        &self,
        runtime: &TaskRuntime,
        mut cmd: Command,
        canceled: &dyn Fn() -> bool,
        started: impl FnOnce(&Answer) -> Result<(), String>,
    ) -> Result<Answer, String> {
        cmd.current_dir(&self.directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut answer = Answer {
            exit: Err(Interrupted::Stopped),
            written: Ok(()),
            output: Default::default(),
            diagnostics: String::new(),
            ran: false,
            warm: None,
            warm_elapsed: Duration::ZERO,
        };
        if canceled() {
            return Ok(answer);
        }
        let warm_started = std::time::Instant::now();
        if self.adapter == "opencode" {
            answer.warm = runtime
                .warm_helpers
                .attach(&mut cmd, self.binding, canceled)?;
        }
        answer.warm_elapsed = warm_started.elapsed();
        let spawned = match self.attempt {
            Some(id) => runtime.register_process(id, None, || {
                let spawned = AgentProcess::spawn(&mut cmd, self.agent)?;
                Ok((Some(spawned.process.clone()), spawned))
            })?,
            None => Some(AgentProcess::spawn(&mut cmd, self.agent)?),
        };
        let Some(spawned) = spawned else {
            return Ok(answer);
        };
        let process = spawned.process;
        let (Some(mut stdin), Some(stdout), Some(stderr)) =
            (spawned.stdin, spawned.stdout, spawned.stderr)
        else {
            return Err("Agent streams unavailable".into());
        };
        answer.ran = true;
        started(&answer)?;
        let input = self.prompt.as_bytes().to_vec();
        let prompt_on_stdin = !matches!(self.adapter, "grok" | "kimi");
        let writer = std::thread::spawn(move || {
            if prompt_on_stdin {
                stdin.write_all(&input)
            } else {
                Ok(())
            }
        });
        let reader = std::thread::spawn(move || read_bounded(stdout, OUTPUT_LIMIT));
        let diagnostics = std::thread::spawn(move || read_bounded(stderr, DIAGNOSTICS_LIMIT));
        let begun = std::time::Instant::now();
        answer.exit = loop {
            match process.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {}
                Err(error) => break Err(Interrupted::Failed(error.to_string())),
            }
            if canceled() {
                break Err(Interrupted::Stopped);
            }
            if begun.elapsed() > self.limit {
                break Err(Interrupted::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let _ = process.finish();
        if let Some(id) = self.attempt {
            runtime.unregister_process(id);
        }
        answer.written = writer.join().map_err(|_| "Agent input stopped")?;
        answer.output = reader
            .join()
            .map_err(|_| "Agent output stopped")?
            .map_err(|e| e.to_string())?;
        answer.diagnostics = diagnostics
            .join()
            .ok()
            .and_then(Result::ok)
            .map(|(text, _)| text)
            .unwrap_or_default();
        Ok(answer)
    }
}

pub(in crate::commands::tasks) struct Configuration(Option<PathBuf>);

impl Drop for Configuration {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Each agent's flags for answering one prompt with no tools, no MCP servers
/// and no saved session.
pub(in crate::commands::tasks) fn configure(
    cmd: &mut Command,
    adapter: &str,
    prompt_path: &Path,
    prompt: &str,
) -> Result<Configuration, String> {
    let mut configuration = Configuration(None);
    match adapter {
        "codex" => { cmd.args(["exec", "--disable", "shell_tool", "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-c", "approval_policy=\"never\"", "-c", "mcp_servers={}", "-c", "web_search=\"disabled\"", "-"]); }
        "claude" => { cmd.args(["--print", "--verbose", "--output-format", "stream-json", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--max-turns", "1"]); }
        "grok" => { cmd.args(["--output-format", "streaming-messages-json", "--permission-mode", "dontAsk", "--tools", "", "--deny", "*", "--disable-web-search", "--max-turns", "1", "--prompt-file"]).arg(prompt_path); }
        "opencode" => {
            cmd.args(["run", "--format", "json"]);
            cmd.env("OPENCODE_CONFIG_CONTENT", "{\"permission\":\"deny\",\"agent\":{\"build\":{\"permission\":\"deny\"}}}");
        }
        "kimi" => {
            let path = prompt_path.with_extension("agent.md");
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&path).map_err(|_| "Could not create the Kimi helper configuration.")?;
            configuration.0 = Some(path.clone());
            file.write_all(format!("---\nname: jackalope-helper\ndescription: Answer the supplied Jackalope request without tools.\ntools: []\nsubagents: []\n---\n{prompt}\n").as_bytes()).map_err(|_| "Could not write the Kimi helper configuration.")?;
            cmd.args(["--agent-file"]).arg(path).args(["--output-format", "stream-json", "--prompt", "Answer the supplied Jackalope request. Follow its output format."]);
        }
        _ => return Err(format!("This default agent has no supported routing-only interface. Choose {} as the default orchestrator. Other agents remain available as workers.", crate::commands::agents::orchestrator_names())),
    }
    Ok(configuration)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kimi_helper_uses_a_private_tool_free_definition_and_cleans_it_up() {
        let path =
            std::env::temp_dir().join(format!("jackalope-helper-{}.txt", uuid::Uuid::new_v4()));
        let mut command = Command::new("fixture");
        let context = "Private task context with `commands` and \"quotes\"";
        let configuration = configure(&mut command, "kimi", &path, context).unwrap();
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(!args.join(" ").contains(context));
        let definition = std::fs::read_to_string(path.with_extension("agent.md")).unwrap();
        assert!(definition.contains("tools: []\nsubagents: []\n---\n"));
        assert!(definition.contains(context));
        drop(configuration);
        assert!(!path.with_extension("agent.md").exists());
    }

    #[test]
    fn failures_carry_the_agents_last_diagnostic() {
        assert_eq!(reported("Failed.", ""), "Failed.");
        assert_eq!(
            reported("Failed.", "starting\nError: not signed in\n\n"),
            "Failed. The agent reported: Error: not signed in"
        );
    }
}
