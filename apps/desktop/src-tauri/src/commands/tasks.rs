use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reported: bool,
    pub estimated_cost_usd: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub workspace: String,
    pub branch: String,
    pub base_head: String,
    pub agent: String,
    pub account: String,
    pub model: Option<String>,
    pub prompt: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub session_id: Option<String>,
    pub result: String,
    pub activity: Vec<String>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
    pub error: Option<String>,
    pub persistence_error: Option<String>,
    pub exit_code: Option<i32>,
    pub usage: Usage,
    #[serde(default)]
    pub prompts: Vec<super::harness::PendingUserPrompt>,
    #[serde(default)]
    pub validation_steps: Vec<super::harness::ValidationStep>,
    #[serde(default)]
    pub screenshots: Vec<super::harness::ScreenshotArtifact>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub model: Option<String>,
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub agent: String,
    pub prompt: String,
    pub isolated: bool,
    pub previous_run_id: Option<String>,
    #[serde(skip)]
    pub coordination: Option<CoordinationContext>,
}

#[derive(Clone)]
pub struct CoordinationContext {
    pub endpoint: String,
    pub token: String,
    pub instructions: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runner {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub signed_in: bool,
    pub account: String,
    pub detail: String,
}

#[derive(Default)]
struct Inner {
    runs: HashMap<String, TaskRun>,
    processes: HashMap<String, Arc<Mutex<std::process::Child>>>,
    canceled: std::collections::HashSet<String>,
}

#[derive(Clone)]
pub struct TaskRuntime {
    inner: Arc<Mutex<Inner>>,
    directory: PathBuf,
    _owner: Arc<std::fs::File>,
}

fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
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
    cmd
}

pub(super) fn executable(agent: &str) -> Result<PathBuf, String> {
    if !["codex", "claude", "grok"].contains(&agent) {
        return Err("Unsupported agent".into());
    }
    let name = if cfg!(windows) {
        format!("{agent}.exe")
    } else {
        agent.to_string()
    };
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        dirs.push(PathBuf::from(&home).join(".local/bin"));
        dirs.push(PathBuf::from(home).join(".grok/bin"));
    }
    if agent == "codex" {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            if let Ok(entries) = std::fs::read_dir(PathBuf::from(local).join("OpenAI/Codex/bin")) {
                let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                versions.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
                versions.reverse();
                dirs.extend(versions);
            }
        }
    }
    dirs.into_iter()
        .map(|p| p.join(&name))
        .find(|p| p.is_file())
        .ok_or_else(|| {
            format!("Install {agent} and make its executable available on PATH, then refresh.")
        })
}

fn git(path: &str, args: &[&str]) -> Result<String, String> {
    let out = command("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().into())
}

fn valid_id(id: &str) -> bool {
    (8..=80).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub(super) fn probe_auth(
    path: PathBuf,
    args: Vec<&str>,
) -> Result<std::process::Output, std::io::Error> {
    let mut child = command(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut data = Vec::new();
        let _ = stdout.take(64_000).read_to_end(&mut data);
        data
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(std::process::Output {
                status,
                stdout: reader.join().unwrap_or_default(),
                stderr: vec![],
            });
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Sign-in check timed out. Open the agent CLI to check its configuration, then refresh."));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

impl TaskRuntime {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let owner = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("runtime.lock"))
            .map_err(|e| e.to_string())?;
        owner.try_lock().map_err(|_| "Another Jackalope instance owns this task history. Close it before starting another instance.".to_string())?;
        let runtime = Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            directory,
            _owner: Arc::new(owner),
        };
        for entry in std::fs::read_dir(&runtime.directory)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                let parsed = std::fs::read(&path)
                    .map_err(|e| e.to_string())
                    .and_then(|data| {
                        serde_json::from_slice::<TaskRun>(&data).map_err(|e| e.to_string())
                    })
                    .and_then(|run| {
                        if valid_id(&run.id) {
                            Ok(run)
                        } else {
                            Err("invalid task identifier".to_string())
                        }
                    });
                match parsed {
                    // A single unreadable entry (crash mid-write outside the
                    // atomic tmp-then-rename `save()` path, disk error, a
                    // stray file) must not stop the whole app from launching
                    // — that would strand every other task's history behind
                    // one bad file with no way for a user to recover.
                    // Quarantine it (rename, don't delete, so it survives
                    // for inspection) and keep loading everything else.
                    Err(reason) => {
                        let quarantined = path.with_extension("json.corrupt");
                        let _ = std::fs::rename(&path, &quarantined);
                        eprintln!(
                            "Jackalope: quarantined unreadable task history {} ({reason}); see {}",
                            path.display(),
                            quarantined.display()
                        );
                    }
                    Ok(mut run) => {
                        if ["starting", "running", "stopping"].contains(&run.status.as_str()) {
                            run.status = "interrupted".into();
                            run.error = Some("Jackalope closed before this attempt finished. Review its workspace before continuing; work was not automatically rerun.".into());
                            run.ended_at = Some(Utc::now().to_rfc3339());
                            runtime.save(&run)?;
                        }
                        runtime
                            .inner
                            .lock()
                            .unwrap()
                            .runs
                            .insert(run.id.clone(), run);
                    }
                }
            }
        }
        Ok(runtime)
    }

    fn save(&self, run: &TaskRun) -> Result<(), String> {
        let temp = self.directory.join(format!("{}.tmp", run.id));
        let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(run).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(temp, self.directory.join(format!("{}.json", run.id)))
            .map_err(|e| e.to_string())
    }

    pub(super) fn update(&self, id: &str, update: impl FnOnce(&mut TaskRun)) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(run) = inner.runs.get_mut(id) {
            update(run);
            if let Err(error) = self.save(run) {
                run.persistence_error = Some(format!("History could not be saved: {error}"));
            }
        }
    }

    fn fail(&self, id: &str, error: String) {
        self.update(id, |run| {
            run.status = "failed".into();
            run.error = Some(error);
            run.ended_at = Some(Utc::now().to_rfc3339());
        });
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

    pub(super) fn stop(&self, id: &str) -> Result<(), String> {
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

    fn execute(&self, id: &str, req: &RunRequest, previous: Option<TaskRun>) -> Result<(), String> {
        let root = git(&req.project_path, &["rev-parse", "--show-toplevel"])?;
        let base_ref = if req.coordination.is_some() {
            "refs/heads/master"
        } else {
            "HEAD"
        };
        let base = git(&root, &["rev-parse", base_ref])?;
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
        self.update(id, |r| {
            r.workspace = workspace.clone();
            r.branch = branch;
            r.base_head = base_head;
        });
        let policy = self.policy()?;
        let (adapter, executable) = policy.resolve(&req.agent)?;
        let selected_model = policy.model(&req.agent, req.model.as_deref())?;
        let mut cmd = command(executable);
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
        let mut input = format!("{}\n\nJackalope task context: Work in the current workspace. Preserve the user's intent and follow repository instructions. Do not commit, merge, push, or delete the workspace. In your final response explain the outcome, changed files, verification actually performed, and anything unresolved. If you need clarification or a denied permission, explain what is needed and stop so the user can reply.\n", req.prompt);
        if let Some(context) = &req.coordination {
            cmd.env("JACKALOPE_BRIDGE_URL", &context.endpoint)
                .env("JACKALOPE_BRIDGE_TOKEN", &context.token);
            input.push_str(&context.instructions);
            if adapter == "claude" {
                let config = serde_json::json!({"mcpServers":{"jackalope":{"type":"http","url":format!("{}/mcp", context.endpoint),"headers":{"Authorization":"Bearer ${JACKALOPE_BRIDGE_TOKEN}"}}}});
                cmd.args([
                    "--mcp-config",
                    &config.to_string(),
                    "--allowedTools",
                    "mcp__jackalope__project,mcp__jackalope__message,mcp__jackalope__browser_navigate,mcp__jackalope__browser_screenshot,mcp__jackalope__browser_snapshot,mcp__jackalope__browser_interact,mcp__jackalope__ask_user,mcp__jackalope__record_validation_step,mcp__jackalope__computer_verify",
                ]);
                input.push_str("\nClaude harness tools: You have access to in-app browser automation, interactive user questions, and structured verification via provided mcp__jackalope__* tools (browser_navigate, browser_screenshot, browser_snapshot, browser_interact, ask_user, record_validation_step, computer_verify). If testing UI changes or onboarding flows, proactively use browser_screenshot and record_validation_step to provide verifiable evidence, and ask_user if you need test data or confirmation.\n");
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
        let mut stdin = child.stdin.take().ok_or("Missing agent input")?;
        let stdout = child.stdout.take().ok_or("Missing agent output")?;
        let stderr = child.stderr.take().ok_or("Missing agent diagnostics")?;
        let process = Arc::new(Mutex::new(child));
        inner.processes.insert(id.into(), process.clone());
        drop(inner);
        self.update(id, |r| {
            if r.status == "starting" {
                r.status = "running".into();
            }
        });
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
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => runtime.update(&event_id, |r| {
                        consume_adapter_event(r, &line, &output_adapter)
                    }),
                    Err(error) => {
                        runtime.update(&event_id, |r| {
                            r.error = Some(format!("Agent output could not be read: {error}"))
                        });
                        break;
                    }
                }
            }
        });
        let runtime = self.clone();
        let event_id = id.to_string();
        let diagnostics = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                runtime.update(&event_id, |r| {
                    r.diagnostics.push(line.chars().take(6000).collect());
                    if r.diagnostics.len() > 150 {
                        r.diagnostics.remove(0);
                    }
                });
            }
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

fn activity(run: &mut TaskRun, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    let bounded: String = text.chars().take(6000).collect();
    run.activity.push(bounded);
    if run.activity.len() > 150 {
        run.activity.remove(0);
    }
}

fn num(value: &Value, key: &str) -> u64 {
    value[key].as_u64().unwrap_or(0)
}

#[cfg(test)]
fn consume_event(run: &mut TaskRun, line: &str) {
    let adapter = run.agent.clone();
    consume_adapter_event(run, line, &adapter);
}

fn consume_adapter_event(run: &mut TaskRun, line: &str, adapter: &str) {
    let Ok(event) = serde_json::from_str::<Value>(line) else {
        activity(run, line);
        return;
    };
    let kind = event["type"].as_str().unwrap_or("");
    if let Some(id) = event["thread_id"].as_str().or(event["session_id"].as_str()) {
        run.session_id = Some(id.into());
    }
    if let Some(model) = event["model"]
        .as_str()
        .or(event["message"]["model"].as_str())
    {
        run.model = Some(model.into());
    }
    match (adapter, kind) {
        ("codex", "item.completed") => {
            let item = &event["item"];
            if item["type"] == "agent_message" {
                run.result = item["text"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(120_000)
                    .collect();
            } else if let Some(command) = item["command"].as_str() {
                activity(
                    run,
                    &format!(
                        "{}\nExit: {}\n{}",
                        command,
                        item["exit_code"],
                        item["aggregated_output"].as_str().unwrap_or("")
                    ),
                );
            } else {
                activity(
                    run,
                    &format!(
                        "{}: {}",
                        item["type"].as_str().unwrap_or("Activity"),
                        item["text"].as_str().unwrap_or("")
                    ),
                );
            }
        }
        ("codex", "turn.completed") => {
            let u = &event["usage"];
            if u["input_tokens"].is_u64() && u["output_tokens"].is_u64() {
                run.usage = Usage {
                    input: num(u, "input_tokens"),
                    output: num(u, "output_tokens"),
                    cache_read: num(u, "cached_input_tokens"),
                    reported: true,
                    ..Usage::default()
                };
            }
        }
        (_, "error" | "turn.failed") => {
            run.error = Some(
                event["message"]
                    .as_str()
                    .or(event["error"]["message"].as_str())
                    .unwrap_or("Agent reported an error")
                    .into(),
            );
        }
        ("claude" | "grok", "assistant") => {
            if let Some(content) = event["message"]["content"].as_array() {
                for block in content {
                    if let Some(text) = block["text"].as_str() {
                        activity(run, text);
                    }
                    if let Some(name) = block["name"].as_str() {
                        activity(run, &format!("Using {name}"));
                    }
                }
            }
        }
        ("claude" | "grok", "result") => {
            run.result = event["result"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(120_000)
                .collect();
            if event["is_error"] == true {
                run.error = Some(event["errors"].to_string());
            }
            let u = &event["usage"];
            if u["input_tokens"].is_u64() && u["output_tokens"].is_u64() {
                let read = num(u, "cache_read_input_tokens");
                let write = num(u, "cache_creation_input_tokens");
                run.usage = Usage {
                    input: num(u, "input_tokens") + read + write,
                    output: num(u, "output_tokens"),
                    cache_read: read,
                    cache_write: write,
                    reported: true,
                    estimated_cost_usd: event["total_cost_usd"].as_f64(),
                };
            }
            if let Some(denials) = event["permission_denials"]
                .as_array()
                .filter(|v| !v.is_empty())
            {
                activity(run, &format!("{} tool request(s) were denied by the agent's permission policy. Review the result before continuing.", denials.len()));
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn task_runners(runtime: State<'_, TaskRuntime>) -> Result<Vec<Runner>, String> {
    let policy = runtime.policy()?;
    let mut ids: Vec<String> = vec!["codex".into(), "claude".into(), "grok".into()];
    ids.extend(policy.custom_agents.iter().map(|a| a.id.clone()));
    tauri::async_runtime::spawn_blocking(move || ids.iter().map(|id| {
        let mut runner = Runner { id: id.to_string(), name: match id.as_str() { "codex" => "Codex", "claude" => "Claude Code", _ => "Grok" }.into(), available: false, signed_in: false, account: "Current CLI account".into(), detail: String::new() };
        match { let mut discovery = policy.clone(); discovery.enabled_agents.clear(); discovery.resolve(id) } {
            Err(error) => runner.detail = error,
            Ok((adapter, path)) => {
                runner.available = true;
                if adapter == "grok" { runner.detail = "Installed. Grok checks its existing sign-in on launch; this version exposes no separate login-status command.".into(); return runner; }
                let args = if adapter == "codex" { vec!["login", "status"] } else { vec!["auth", "status"] };
                match probe_auth(path, args) {
                    Ok(out) => {
                        if adapter == "claude" {
                            if let Ok(auth) = serde_json::from_slice::<Value>(&out.stdout) {
                                runner.signed_in = auth["loggedIn"] == true;
                                runner.account = auth["email"].as_str().unwrap_or("Current CLI account").into();
                            }
                        } else { runner.signed_in = out.status.success(); }
                        runner.detail = if runner.signed_in { "Uses your existing CLI sign-in. Model follows your agent configuration." } else { "Sign in using the agent's CLI, then refresh." }.into();
                    }
                    Err(error) => runner.detail = error.to_string(),
                }
            }
        }
        if let Some(custom) = policy.custom_agents.iter().find(|a| a.id == *id) { runner.name = custom.name.clone(); }
        runner
    }).collect()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn task_pick_project(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_read_context(
    project_path: String,
    relative_path: String,
) -> Result<Option<String>, String> {
    let allowed = [
        "package.json",
        "Cargo.toml",
        "AGENTS.md",
        "TODO.md",
        "STATUS.md",
        "docs/TODO.md",
        "docs/STATUS.md",
        "apps/desktop/package.json",
        "apps/desktop/src-tauri/Cargo.toml",
    ];
    if !allowed.contains(&relative_path.as_str()) {
        return Err("Unsupported context file.".into());
    }
    let root = std::fs::canonicalize(project_path).map_err(|e| e.to_string())?;
    let path = match std::fs::canonicalize(root.join(relative_path)) {
        Ok(path) => path,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !path.starts_with(&root) {
        return Err("Context file resolves outside the project.".into());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 262144 {
        return Err("Context file exceeds 256 KiB.".into());
    }
    let mut text = String::new();
    file.take(262145)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() > 262144 {
        return Err("Context file exceeds 256 KiB.".into());
    }
    Ok(Some(text))
}

#[derive(Serialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub branch: String,
}

#[tauri::command]
pub async fn task_validate_project(path: String) -> Result<ProjectInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = git(&path, &["rev-parse", "--show-toplevel"])?;
        let branch = git(&root, &["branch", "--show-current"])?;
        Ok(ProjectInfo {
            name: Path::new(&root)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: root,
            branch,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn task_runs(state: State<'_, TaskRuntime>) -> Vec<TaskRun> {
    let mut runs: Vec<_> = state.inner.lock().unwrap().runs.values().cloned().collect();
    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    runs
}

#[tauri::command]
pub async fn task_start(
    request: RunRequest,
    coordinator: State<'_, super::coordination::Coordinator>,
) -> Result<String, String> {
    let coordinator = coordinator.inner().clone();
    tauri::async_runtime::spawn_blocking(move || coordinator.start_manual(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_respond_prompt(
    run_id: String,
    prompt_id: String,
    answer: String,
    runtime: State<'_, TaskRuntime>,
) -> Result<bool, String> {
    let resolved = super::harness::resolve_user_prompt(&prompt_id, &answer);
    runtime.update(&run_id, |r| {
        if let Some(p) = r.prompts.iter_mut().find(|p| p.id == prompt_id) {
            p.status = "answered".into();
            p.answer = Some(answer.clone());
            p.answered_at = Some(chrono::Utc::now().to_rfc3339());
        }
        r.activity.push(format!("User answered prompt: {answer}"));
    });
    Ok(resolved)
}

impl TaskRuntime {
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
    pub(super) fn start(&self, request: RunRequest) -> Result<String, String> {
        let _integration_guard = super::integration::execution_guard()?;
        self.start_locked(request)
    }
    pub(super) fn start_locked(&self, mut request: RunRequest) -> Result<String, String> {
        if let Some(previous) = &request.previous_run_id {
            if super::integration::applied_run_ids(self)?.contains(previous) {
                return Err("This task has already been integrated. Add a new task to start from the updated master.".into());
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
                account: "Current CLI account (identity not tracked)".into(),
                model: request.model.clone(),
                prompt: request.prompt.clone(),
                status: "starting".into(),
                started_at: Utc::now().to_rfc3339(),
                ended_at: None,
                session_id: None,
                result: String::new(),
                activity: vec![],
                diagnostics: vec![],
                error: None,
                persistence_error: None,
                exit_code: None,
                usage: Usage::default(),
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
                runtime.fail(&request.id, error);
            }
        });
        Ok(id)
    }
}

#[tauri::command]
pub async fn task_stop(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.stop(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn task_mark_reviewed(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let mut inner = state.inner.lock().unwrap();
    let run = inner.runs.get_mut(&id).ok_or("Attempt not found")?;
    if run.status != "review" {
        return Err("Only a finished result can be marked reviewed.".into());
    }
    let mut updated = run.clone();
    updated.status = "reviewed".into();
    state.save(&updated)?;
    *run = updated;
    Ok(())
}

#[derive(Serialize)]
pub struct Review {
    pub files: Vec<String>,
    pub diff: String,
    pub note: String,
}

#[tauri::command]
pub async fn task_review(id: String, state: State<'_, TaskRuntime>) -> Result<Review, String> {
    let run = state
        .inner
        .lock()
        .unwrap()
        .runs
        .get(&id)
        .cloned()
        .ok_or("Attempt not found")?;
    tauri::async_runtime::spawn_blocking(move || {
        if run.workspace.is_empty() || run.base_head.is_empty() { return Err("Workspace is not available yet.".into()); }
        let changed = git(&run.workspace, &["diff", "--name-only", "-z", &run.base_head, "--"])?;
        let untracked = git(&run.workspace, &["ls-files", "--others", "--exclude-standard", "-z"])?;
        let mut files: Vec<String> = changed.split('\0').chain(untracked.split('\0')).filter(|p| !p.is_empty()).map(String::from).collect();
        files.sort(); files.dedup();
        let mut diff = git(&run.workspace, &["diff", "--no-ext-diff", "--no-textconv", &run.base_head, "--"])?;
        let root = std::fs::canonicalize(&run.workspace).map_err(|e| e.to_string())?;
        for name in untracked.split('\0').filter(|p| !p.is_empty()) {
            if diff.len() >= 120_000 { break; }
            let path = root.join(name);
            diff.push_str(&format!("\n\nNew file: {name}\n"));
            if !std::fs::canonicalize(&path).is_ok_and(|p| p.starts_with(&root)) { diff.push_str("Preview unavailable: file resolves outside the workspace.\n"); continue; }
            let mut data = Vec::new();
            match std::fs::File::open(path).and_then(|f| f.take(120_000).read_to_end(&mut data)) {
                Ok(_) => match String::from_utf8(data) { Ok(text) if !text.contains('\0') => diff.push_str(&text), _ => diff.push_str("Binary file; preview unavailable.") },
                Err(error) => diff.push_str(&format!("Preview unavailable: {error}")),
            }
        }
        Ok(Review { files, diff: diff.chars().take(120_000).collect(), note: "Current workspace compared with the task's starting commit, including new files. Existing working changes may be included when isolation is off. Preview is limited to 120,000 characters; binary files are listed only.".into() })
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(agent: &str) -> TaskRun {
        TaskRun {
            id: "test-attempt-123".into(),
            task_id: "task-123".into(),
            project_id: "project-123".into(),
            project_name: "Test".into(),
            project_path: String::new(),
            workspace: String::new(),
            branch: String::new(),
            base_head: String::new(),
            agent: agent.into(),
            account: "test".into(),
            model: None,
            prompt: "Example".into(),
            status: "running".into(),
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            session_id: None,
            result: String::new(),
            activity: vec![],
            diagnostics: vec![],
            error: None,
            persistence_error: None,
            exit_code: None,
            usage: Usage::default(),
            prompts: vec![],
            validation_steps: vec![],
            screenshots: vec![],
        }
    }

    #[test]
    fn final_usage_replaces_replayed_totals_and_cache_is_counted_once() {
        let mut codex = sample("codex");
        let event = r#"{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":80,"output_tokens":15}}"#;
        consume_event(&mut codex, event);
        consume_event(&mut codex, event);
        assert_eq!(codex.usage.input + codex.usage.output, 135);
        assert_eq!(codex.usage.cache_read, 80);
        for agent in ["claude", "grok"] {
            let mut run = sample(agent);
            let event = r#"{"type":"result","result":"Done","usage":{"input_tokens":20,"cache_read_input_tokens":80,"cache_creation_input_tokens":20,"output_tokens":15},"total_cost_usd":0.012}"#;
            consume_event(&mut run, event);
            consume_event(&mut run, event);
            assert_eq!(run.usage.input + run.usage.output, 135);
            assert_eq!(run.usage.estimated_cost_usd, Some(0.012));
        }
    }

    #[test]
    fn custom_adapter_decodes_events_without_losing_agent_identity() {
        let mut run = sample("custom-codex");
        consume_adapter_event(
            &mut run,
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"Completed"}}"#,
            "codex",
        );
        assert_eq!(run.result, "Completed");
        assert_eq!(run.agent, "custom-codex");
    }

    #[test]
    #[cfg(windows)]
    fn configured_default_agent_launches_with_allowed_model_and_records_output() {
        use super::super::agent_policy::{AgentPolicy, CustomAgent, RunnerOptions};
        let folder =
            std::env::temp_dir().join(format!("jackalope-policy-run-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let root = folder.to_str().unwrap();
        git(root, &["init", "-b", "master"]).unwrap();
        git(
            root,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Fixture",
            ],
        )
        .unwrap();
        let executable = folder.join("fixture.cmd");
        std::fs::write(&executable, "@echo off\r\nset /p TASK_INPUT=\r\necho %*>args.txt\r\necho {\"type\":\"thread.started\",\"thread_id\":\"fixture-session\"}\r\necho {\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Fixture complete\"}}\r\n").unwrap();
        let runtime = TaskRuntime::new(folder.join("history")).unwrap();
        let mut policy = AgentPolicy::default();
        policy.default_meta_agent = "custom-fixture".into();
        policy.custom_agents.push(CustomAgent {
            id: "custom-fixture".into(),
            name: "Fixture".into(),
            command: executable.to_string_lossy().into(),
            adapter: Some("codex".into()),
        });
        policy.runner_options.insert(
            "custom-fixture".into(),
            RunnerOptions {
                models: vec!["test-model".into()],
                restrict_models: true,
                ..Default::default()
            },
        );
        std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
        std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
        let request = RunRequest {
            id: "fixture-run-123".into(),
            project_id: "fixture".into(),
            project_name: "Fixture".into(),
            project_path: root.into(),
            agent: "default".into(),
            model: None,
            prompt: "Fixture only".into(),
            isolated: false,
            previous_run_id: None,
            coordination: None,
        };
        runtime.start(request.clone()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let run = runtime.integration_runs().unwrap().pop().unwrap();
            if !["starting", "running"].contains(&run.status.as_str()) {
                assert_eq!(run.status, "review", "{:?}", run.error);
                assert_eq!(run.agent, "custom-fixture");
                assert_eq!(run.model.as_deref(), Some("test-model"));
                assert_eq!(run.result, "Fixture complete");
                break;
            }
            if std::time::Instant::now() > deadline {
                runtime.stop_all();
                panic!("Fixture did not exit");
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(std::fs::read_to_string(folder.join("args.txt"))
            .unwrap()
            .contains("--model test-model"));
        policy.enabled_agents.insert("custom-fixture".into(), false);
        std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
        let mut blocked = request;
        blocked.id = "fixture-run-456".into();
        assert!(runtime.start(blocked).unwrap_err().contains("disabled"));
        drop(runtime);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn missing_measurements_remain_unknown_and_failures_remain_failures() {
        let mut run = sample("claude");
        consume_event(
            &mut run,
            r#"{"type":"result","is_error":true,"errors":["Not signed in"]}"#,
        );
        assert!(!run.usage.reported);
        assert!(run.error.unwrap().contains("Not signed in"));
        assert!(run.result.is_empty());
    }

    #[test]
    fn session_and_unicode_output_survive_journal_reload_without_rerunning() {
        let folder = std::env::temp_dir().join(format!(
            "jackalope-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let runtime = TaskRuntime::new(folder.clone()).unwrap();
        let mut run = sample("codex");
        consume_event(
            &mut run,
            r#"{"type":"thread.started","thread_id":"session-1"}"#,
        );
        consume_event(
            &mut run,
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"🐇 café"}}"#,
        );
        runtime.save(&run).unwrap();
        drop(runtime);
        let loaded = TaskRuntime::new(folder.clone()).unwrap();
        let inner = loaded.inner.lock().unwrap();
        let restored = &inner.runs[&run.id];
        assert_eq!(restored.status, "interrupted");
        assert_eq!(restored.result, "🐇 café");
        assert_eq!(restored.session_id.as_deref(), Some("session-1"));
        assert!(inner.processes.is_empty());
        drop(inner);
        assert!(folder.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn journal_identifiers_cannot_escape_the_storage_directory() {
        for id in ["../../other", "a/bbbbbbb", "C:\\test-file", "short"] {
            assert!(!valid_id(id));
        }
        assert!(valid_id("f22457f4-32ca-421c-9782-075f244004a9"));
    }

    #[test]
    fn corrupt_or_invalid_history_entries_are_quarantined_not_fatal() {
        let folder = std::env::temp_dir().join(format!(
            "jackalope-corrupt-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir_all(&folder).unwrap();

        let good = sample("codex");
        std::fs::write(
            folder.join(format!("{}.json", good.id)),
            serde_json::to_vec(&good).unwrap(),
        )
        .unwrap();
        std::fs::write(folder.join("garbled-not-json.json"), b"{not json").unwrap();
        let mut bad_id_run = sample("codex");
        bad_id_run.id = "bad".into();
        std::fs::write(
            folder.join("bad-id-file.json"),
            serde_json::to_vec(&bad_id_run).unwrap(),
        )
        .unwrap();

        let runtime = TaskRuntime::new(folder.clone())
            .expect("a corrupted or invalid history entry must not prevent app startup");
        let inner = runtime.inner.lock().unwrap();
        assert_eq!(inner.runs.len(), 1, "only the valid entry should load");
        assert!(inner.runs.contains_key(&good.id));
        drop(inner);
        drop(runtime);

        assert!(folder.join("garbled-not-json.json.corrupt").exists());
        assert!(!folder.join("garbled-not-json.json").exists());
        assert!(folder.join("bad-id-file.json.corrupt").exists());
        assert!(!folder.join("bad-id-file.json").exists());

        assert!(folder.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(folder).unwrap();
    }
}
