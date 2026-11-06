//! Task agents that run on a computer instead of this device.
//!
//! A project's computer (`owner_kind` `project`) runs the agent CLI of its
//! tasks. The task still gets its local workspace, and everything after the
//! agent ends (checks, checkpoint, review and integration) happens there as
//! usual: the workspace's files are uploaded, the agent runs inside the
//! computer, and its changes come back as a binary Git patch applied to the
//! local workspace. Runs talk to the in-sandbox agent over their own
//! [`Transport`](super::Transport), so a long run never holds the connection
//! desktop actions share. See `resources/computer/agent.py` for the protocol.

use super::{credentials, Computer, Transport, AGENT37, LOCAL_DOCKER, PROJECT, REMOTE_MACHINE};
use crate::commands::git_command;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Seek, Write},
    path::Path,
    process::Command,
    sync::atomic::AtomicBool,
    time::Duration,
};

/// Raw bytes per upload chunk; base64 keeps each request under the agent's 1 MB body limit.
const CHUNK: usize = 512 * 1024;
const UPLOAD_LIMIT: u64 = 512 * 1024 * 1024;
const PATCH_LIMIT: usize = 256 * 1024 * 1024;
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
/// How long a run's agent waits for new output before answering a read.
pub(crate) const READ_WAIT_MS: u64 = 1000;

/// Providers whose machines run the computer image's agent and so accept runs.
pub(crate) fn supports_runs(computer: &Computer) -> bool {
    [LOCAL_DOCKER, REMOTE_MACHINE, AGENT37].contains(&computer.provider.as_str())
}

/// The computer a project's task agents run on, when it has one.
pub(crate) fn project_computer(root: &Path, project_id: &str) -> Option<Computer> {
    super::find(root, PROJECT, project_id).filter(supports_runs)
}

/// Projects whose agents run on a computer, for scheduling.
pub(crate) fn run_projects(root: &Path) -> HashSet<String> {
    super::list(root)
        .unwrap_or_default()
        .into_iter()
        .filter(|computer| computer.owner_kind == PROJECT && supports_runs(computer))
        .map(|computer| computer.owner_id)
        .collect()
}

/// The run's name inside the computer. It follows the local workspace, so a
/// continuation of the same task reuses the same folder and agent sessions
/// resume there.
pub(crate) fn run_name(workspace: &str) -> String {
    let digest = Sha256::digest(workspace.as_bytes());
    let hex: String = digest[..10].iter().map(|b| format!("{b:02x}")).collect();
    format!("w{hex}")
}

/// A read-only (planning) attempt's run name. It never shares a folder with a
/// writing attempt of the same workspace, whose unrecovered changes stay put.
pub(crate) fn read_only_run_name(workspace: &str) -> String {
    format!("r{}", &run_name(workspace)[1..])
}

/// Environment variables for a run, as name and value.
pub(crate) type Environment = Vec<(String, String)>;

/// Stand-ins the in-sandbox agent replaces with its bridge relay's address and
/// secret when a run starts with `relay`.
pub(crate) const RELAY_URL: &str = "@@JACKALOPE_RELAY_URL@@";
pub(crate) const RELAY_TOKEN: &str = "@@JACKALOPE_RELAY_TOKEN@@";

/// The agent CLI command for a computer, translated from the local command:
/// the program becomes the CLI on the computer's PATH, local paths are dropped,
/// and the computer itself is the sandbox, so the agent runs without its own
/// permission prompts or sandbox. With `bridge`, this device's bridge address
/// becomes the computer's relay and its credential the relay's own secret;
/// without it the Jackalope bridge is dropped.
pub(crate) fn translate(
    adapter: &str,
    command: &Command,
    root: &Path,
    bridge: Option<&str>,
) -> Result<(Vec<String>, Environment), String> {
    if !credentials::REMOTE_ADAPTERS.contains(&adapter) {
        return Err(format!("{adapter} cannot run on a computer yet."));
    }
    let args: Vec<String> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let mut argv = vec![adapter.to_string()];
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let value = args.get(index + 1);
        let relayed = value.and_then(|value| {
            bridge
                .filter(|endpoint| value.contains(endpoint))
                .map(|endpoint| value.replace(endpoint, RELAY_URL))
        });
        match (adapter, arg.as_str()) {
            ("claude", "--mcp-config") | ("codex", "-c") if relayed.is_some() => {
                argv.extend([arg.clone(), bridge_only(adapter, &relayed.unwrap())?]);
                index += 2;
                continue;
            }
            ("claude", "--allowedTools") if bridge.is_some() && value.is_some() => {
                argv.extend([arg.clone(), value.unwrap().clone()]);
                index += 2;
                continue;
            }
            ("claude", "--mcp-config" | "--permission-prompt-tool" | "--allowedTools") => {
                index += 2;
                continue;
            }
            ("claude", "--permission-mode") if value.is_some_and(|v| v == "acceptEdits") => {
                argv.extend(["--permission-mode".into(), "bypassPermissions".into()]);
                index += 2;
                continue;
            }
            ("codex", "-c") if value.is_some_and(|v| v.starts_with("mcp_servers")) => {
                index += 2;
                continue;
            }
            ("codex", "-c") if value.is_some_and(|v| v == "sandbox_mode=\"workspace-write\"") => {
                argv.extend(["-c".into(), "sandbox_mode=\"danger-full-access\"".into()]);
                index += 2;
                continue;
            }
            _ => {}
        }
        if looks_local(arg) {
            return Err(format!(
                "This task's {adapter} command refers to a file on this device, so it cannot run on a computer."
            ));
        }
        argv.push(arg.clone());
        index += 1;
    }
    let profile = crate::commands::agent_profiles::env_var_for(adapter);
    let mut env: Vec<(String, String)> = command
        .get_envs()
        .filter_map(|(name, value)| {
            let name = name.to_string_lossy().into_owned();
            let value = value?.to_string_lossy().into_owned();
            let dropped = Some(name.as_str()) == profile
                || name.starts_with("JACKALOPE_")
                || looks_local(&value);
            (!dropped).then_some((name, value))
        })
        .collect();
    if bridge.is_some() {
        env.push(("JACKALOPE_BRIDGE_URL".into(), RELAY_URL.into()));
        env.push(("JACKALOPE_BRIDGE_TOKEN".into(), RELAY_TOKEN.into()));
    }
    env.extend(credentials::environment(root, adapter)?);
    Ok((argv, env))
}

/// Adds project secrets to a run's environment. They replace a variable of the
/// same name from the local command and are kept whatever they look like (the
/// local-path check applies only to the translated command), but never replace
/// an agent sign-in or one of Jackalope's own variables.
pub(crate) fn add_secrets(env: &mut Environment, secrets: Environment) {
    let owned = |name: &str| {
        name.starts_with("JACKALOPE_")
            || credentials::KINDS
                .iter()
                .any(|kind| kind.variables.contains(&name))
    };
    for (name, value) in secrets {
        if owned(&name) {
            continue;
        }
        env.retain(|(existing, _)| existing != &name);
        env.push((name, value));
    }
}

/// Keeps only the Jackalope bridge from an MCP configuration argument. Other
/// entries name this device's programs, environment references and sign-ins,
/// which never go to a computer; selected on-demand connections reach the
/// agent through the bridge instead.
fn bridge_only(adapter: &str, value: &str) -> Result<String, String> {
    let unreadable = || {
        format!("This task's {adapter} MCP configuration could not be read, so it cannot run on a computer.")
    };
    if adapter == "claude" {
        let mut config: Value = serde_json::from_str(value).map_err(|_| unreadable())?;
        let bridge = config["mcpServers"]["jackalope"].take();
        if !bridge.is_object() {
            return Err(unreadable());
        }
        return Ok(json!({"mcpServers":{"jackalope":bridge}}).to_string());
    }
    let parsed: toml::Table = toml::from_str(value).map_err(|_| unreadable())?;
    let bridge = parsed
        .get("mcp_servers")
        .and_then(|servers| servers.get("jackalope"))
        .cloned()
        .ok_or_else(unreadable)?;
    let mut servers = toml::Table::new();
    servers.insert("jackalope".into(), bridge);
    Ok(format!("mcp_servers={}", toml::Value::Table(servers)))
}

/// Whether a value names a file on this device: a Windows drive or network
/// path, or an absolute path that exists here.
pub(crate) fn looks_local(value: &str) -> bool {
    let bytes = value.as_bytes();
    let windows = bytes.len() > 2 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/');
    windows || value.starts_with("\\\\") || (value.starts_with('/') && Path::new(value).exists())
}

/// The runs protocol from which a computer's agent runs selected stdio
/// connections and reports it in `run_status`.
const CONNECTIONS_PROTOCOL: u64 = 3;

/// Whether the computer's agent, by its run status, runs stdio connections.
pub(crate) fn runs_connections(status: Option<&Value>) -> bool {
    status
        .and_then(|status| status["runs"].as_u64())
        .is_some_and(|protocol| protocol >= CONNECTIONS_PROTOCOL)
}

/// The `mcp` part of `run_start`: each connection's command, arguments and
/// resolved environment. The computer's agent keeps them out of the command
/// line and the CLI's configuration: it writes each to a private file beside
/// the workspace and adds an entry that starts the server from it. With
/// `approve`, Claude Code asks Jackalope before each of their tools runs.
pub(crate) fn connections_request(
    adapter: &str,
    connections: &[crate::commands::mcp::ComputerConnection],
) -> Value {
    json!({
        "config": adapter,
        "approve": adapter == "claude",
        "servers": connections.iter().map(|connection| json!({
            "key": connection.key,
            "name": connection.name,
            "command": connection.command,
            "args": connection.args,
            "env": connection.env.iter().cloned().collect::<HashMap<_, _>>(),
        })).collect::<Vec<_>>(),
    })
}

/// A started run.
pub(crate) struct Started {
    /// The exit, when it ended at once.
    pub exit: Option<Value>,
    /// Connections the computer could not start, as name and reason.
    pub unavailable: Vec<(String, String)>,
}

/// One run's conversation with a computer's agent.
pub(crate) struct Session {
    transport: Box<dyn Transport>,
    pub name: String,
    canceled: AtomicBool,
}

/// Output since the previous read.
pub(crate) struct Page {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// Set once the run has ended and all its output has been read.
    pub exit: Option<Value>,
    /// Bridge requests from the run's agent, for [`super::relay::Relay`].
    pub bridge: Vec<Value>,
}

impl Session {
    pub fn open(root: &Path, computer: &Computer, workspace: &str) -> Result<Self, String> {
        let transport = super::provider(&computer.provider)?.transport(root, computer)?;
        Ok(Self::with_transport(transport, run_name(workspace)))
    }

    /// Replaces a connection that stopped answering, starting the computer
    /// again if it stopped.
    pub fn reconnect(&mut self, root: &Path, computer: &Computer) -> Result<(), String> {
        self.transport.shutdown();
        super::ready_within(root, computer, Duration::from_secs(90))?;
        self.transport = super::provider(&computer.provider)?.transport(root, computer)?;
        Ok(())
    }

    pub fn with_transport(transport: Box<dyn Transport>, name: String) -> Self {
        Self {
            transport,
            name,
            canceled: AtomicBool::new(false),
        }
    }

    fn call(&mut self, mut payload: Value, timeout: Duration) -> Result<Value, String> {
        payload["run"] = json!(self.name);
        self.transport.call(&payload, timeout, &self.canceled)
    }

    /// Whether this run exists on the computer and how far it got, or `None`
    /// when the computer's agent predates the bridge relay and recovery.
    pub fn status(&mut self) -> Result<Option<Value>, String> {
        match self.call(json!({"action":"run_status"}), CALL_TIMEOUT) {
            Ok(status) => Ok(Some(status)),
            Err(error) if error.contains("Unsupported action") => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Uploads the workspace's files: tracked and untracked ones Git does not
    /// ignore, or for a folder that is not a repository, those its ignore files
    /// allow, plus the copied `setup` files the local workspace was given.
    pub fn upload(
        &mut self,
        workspace: &Path,
        setup: &[String],
        progress: &dyn Fn(u64, u64),
    ) -> Result<(), String> {
        let mut file = archive(workspace, setup)?;
        let size = file
            .seek(std::io::SeekFrom::End(0))
            .map_err(|e| e.to_string())?;
        file.seek(std::io::SeekFrom::Start(0))
            .map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        let mut buffer = vec![0u8; CHUNK];
        let mut offset = 0u64;
        loop {
            let mut filled = 0;
            while filled < CHUNK {
                let read = file
                    .read(&mut buffer[filled..])
                    .map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                filled += read;
            }
            digest.update(&buffer[..filled]);
            let last = offset + filled as u64 >= size;
            let mut request = json!({
                "action": "workspace_put",
                "offset": offset,
                "data": base64::engine::general_purpose::STANDARD.encode(&buffer[..filled]),
                "final": last,
            });
            if last {
                let hex: String = digest
                    .clone()
                    .finalize()
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect();
                request["sha256"] = json!(hex);
            }
            self.call(request, CALL_TIMEOUT)?;
            offset += filled as u64;
            progress(offset, size);
            if last {
                return Ok(());
            }
        }
    }

    /// Starts the agent, with the bridge relay when `relay` is set and the
    /// selected stdio connections in `connections` (see [`connections_request`]).
    pub fn start(
        &mut self,
        argv: &[String],
        env: &[(String, String)],
        stdin: &str,
        relay: bool,
        connections: Option<&Value>,
    ) -> Result<Started, String> {
        let env: HashMap<&str, &str> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let mut request = json!({"action":"run_start","argv":argv,"env":env,"stdin":stdin,"timeout_s":6 * 3600,"relay":relay});
        if let Some(connections) = connections {
            request["mcp"] = connections.clone();
        }
        // Installing a connection's runtime can add a minute or two.
        let timeout = if connections.is_some() {
            CALL_TIMEOUT * 3
        } else {
            CALL_TIMEOUT
        };
        let result = self.call(request, timeout)?;
        Ok(Started {
            exit: (result["started"] != true).then(|| result["exit"].clone()),
            unavailable: result["mcp"]["unavailable"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    Some((
                        item["name"].as_str()?.to_string(),
                        item["reason"].as_str()?.to_string(),
                    ))
                })
                .collect(),
        })
    }

    /// Output after the cursors and new bridge requests. `reclaim` also returns
    /// requests handed over earlier and still unanswered, after a read whose
    /// answer may have been lost.
    pub fn read(&mut self, out: &mut u64, err: &mut u64, reclaim: bool) -> Result<Page, String> {
        let result = self.call(
            json!({"action":"run_read","out":*out,"err":*err,"wait_ms":READ_WAIT_MS,"reclaim":reclaim}),
            Duration::from_millis(READ_WAIT_MS) + Duration::from_secs(30),
        )?;
        let decode = |key: &str| {
            base64::engine::general_purpose::STANDARD
                .decode(result[key].as_str().unwrap_or_default())
                .map_err(|_| "The computer returned unreadable output.".to_string())
        };
        let page = Page {
            stdout: decode("stdout")?,
            stderr: decode("stderr")?,
            exit: Some(result["exit"].clone()).filter(|exit| !exit.is_null()),
            bridge: result["bridge"].as_array().cloned().unwrap_or_default(),
        };
        *out = result["out"].as_u64().unwrap_or(*out);
        *err = result["err"].as_u64().unwrap_or(*err);
        Ok(page)
    }

    /// Sends one bridge answer to the waiting agent.
    pub fn answer(&mut self, answer: &super::relay::Answer) -> Result<(), String> {
        self.call(
            json!({
                "action": "run_answer",
                "call": answer.call,
                "status": answer.status,
                "contentType": answer.content_type,
                "body": base64::engine::general_purpose::STANDARD.encode(&answer.body),
            }),
            CALL_TIMEOUT,
        )
        .map(|_| ())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        self.call(json!({"action":"run_stop"}), CALL_TIMEOUT)
            .map(|_| ())
    }

    /// The run's changes since the upload, as a binary Git patch.
    pub fn collect(&mut self) -> Result<Vec<u8>, String> {
        let summary = self.call(json!({"action":"workspace_diff"}), Duration::from_secs(660))?;
        let size = summary["size"].as_u64().unwrap_or(0) as usize;
        if size > PATCH_LIMIT {
            return Err("The agent changed more than 256 MB of files.".into());
        }
        let mut patch = Vec::with_capacity(size);
        while patch.len() < size {
            let page = self.call(
                json!({"action":"workspace_get","offset":patch.len()}),
                CALL_TIMEOUT,
            )?;
            let data = base64::engine::general_purpose::STANDARD
                .decode(page["data"].as_str().unwrap_or_default())
                .map_err(|_| "The computer returned an unreadable change set.".to_string())?;
            if data.is_empty() {
                return Err("The computer's change set ended early.".into());
            }
            patch.extend_from_slice(&data);
        }
        let hex: String = Sha256::digest(&patch)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if summary["sha256"].as_str() != Some(hex.as_str()) {
            return Err("The computer's change set was corrupted in transfer.".into());
        }
        Ok(patch)
    }

    /// Removes the run's files from the computer. The workspace is uploaded
    /// again for a continuation; the agent's own session history stays.
    pub fn remove(&mut self) {
        let _ = self.call(json!({"action":"run_remove"}), CALL_TIMEOUT);
    }

    pub fn shutdown(&mut self) {
        self.transport.shutdown();
    }
}

fn listed(workspace: &Path) -> Option<Vec<(String, bool)>> {
    let run = |args: &[&str]| {
        let output = git_command::command(workspace, args, git_command::Policy::Inspection)
            .output()
            .ok()?;
        output.status.success().then_some(output.stdout)
    };
    let staged = run(&["ls-files", "-z", "--stage"])?;
    let executable: HashSet<String> = staged
        .split(|byte| *byte == 0)
        .filter_map(|entry| {
            let entry = String::from_utf8_lossy(entry);
            let (meta, path) = entry.split_once('\t')?;
            meta.starts_with("100755").then(|| path.to_string())
        })
        .collect();
    let files = run(&[
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
    ])?;
    let mut seen = HashSet::new();
    Some(
        files
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
            .map(|entry| String::from_utf8_lossy(entry).into_owned())
            .filter(|path| seen.insert(path.clone()))
            .map(|path| {
                let exec = executable.contains(&path);
                (path, exec)
            })
            .collect(),
    )
}

fn walked(workspace: &Path) -> Vec<(String, bool)> {
    ignore::WalkBuilder::new(workspace)
        .hidden(false)
        .filter_entry(|entry| entry.file_name() != ".git")
        .build()
        .filter_map(Result::ok)
        .filter(|entry| entry.depth() > 0 && !entry.file_type().is_some_and(|t| t.is_dir()))
        .filter_map(|entry| {
            let relative = entry.path().strip_prefix(workspace).ok()?;
            Some((relative.to_string_lossy().replace('\\', "/"), false))
        })
        .collect()
}

/// Copied setup files sent with a workspace, in total; each is at most 1 MiB.
const SETUP_LIMIT: u64 = 8 * 1024 * 1024;

/// Copied setup files present in the workspace that the listing left out
/// because Git ignores them: relative regular files without links or `.git`.
fn setup_files(
    workspace: &Path,
    setup: &[String],
    listed: &HashSet<String>,
) -> Result<Vec<(String, bool)>, String> {
    let mut files: Vec<(String, bool)> = Vec::new();
    let mut total = 0u64;
    for value in setup.iter().take(32) {
        let relative = value.trim().replace('\\', "/");
        if relative.is_empty()
            || relative.starts_with('/')
            || relative.contains(':')
            || relative
                .split('/')
                .any(|part| part.is_empty() || part == ".." || part.eq_ignore_ascii_case(".git"))
            || listed.contains(&relative)
            || files.iter().any(|(path, _)| path == &relative)
        {
            continue;
        }
        let mut current = workspace.to_path_buf();
        let mut linked = false;
        for part in relative.split('/') {
            current.push(part);
            linked |= std::fs::symlink_metadata(&current)
                .map_or(true, |metadata| metadata.file_type().is_symlink());
        }
        let Ok(metadata) = std::fs::metadata(&current) else {
            continue;
        };
        if linked || !metadata.is_file() || metadata.len() > 1024 * 1024 {
            continue;
        }
        total += metadata.len();
        if total > SETUP_LIMIT {
            return Err("The copied setup files are larger than 8 MB, so they cannot be sent to a computer.".into());
        }
        files.push((relative, false));
    }
    Ok(files)
}

/// A tar of the workspace's files and its copied setup files in a temporary file.
pub(crate) fn archive(workspace: &Path, setup: &[String]) -> Result<std::fs::File, String> {
    let mut files = listed(workspace).unwrap_or_else(|| walked(workspace));
    let known: HashSet<String> = files.iter().map(|(path, _)| path.clone()).collect();
    files.extend(setup_files(workspace, setup, &known)?);
    let file = tempfile_in_temp()?;
    let mut builder = tar::Builder::new(file);
    builder.follow_symlinks(false);
    let mut total = 0u64;
    for (relative, executable) in files {
        if relative
            .split('/')
            .any(|part| part == ".." || part == ".git")
        {
            continue;
        }
        let path = workspace.join(&relative);
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            // Deleted in the workspace but still in the index.
            continue;
        };
        if metadata.file_type().is_symlink() {
            let target = std::fs::read_link(&path).map_err(|e| e.to_string())?;
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            header.set_mode(0o777);
            builder
                .append_link(&mut header, &relative, &target)
                .map_err(|e| e.to_string())?;
        } else if metadata.is_file() {
            total += metadata.len();
            if total > UPLOAD_LIMIT {
                return Err("The workspace is larger than 512 MB, so it cannot run on a computer. Ignore build output in .gitignore.".into());
            }
            let mut header = tar::Header::new_gnu();
            header.set_size(metadata.len());
            header.set_mode(if executable { 0o755 } else { 0o644 });
            header.set_entry_type(tar::EntryType::Regular);
            let source = std::fs::File::open(&path).map_err(|e| format!("{relative}: {e}"))?;
            builder
                .append_data(&mut header, &relative, source)
                .map_err(|e| format!("{relative}: {e}"))?;
        }
    }
    let mut file = builder.into_inner().map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    Ok(file)
}

/// An anonymous read-write file, deleted as soon as it is created where the
/// platform allows and otherwise when it is closed.
fn tempfile_in_temp() -> Result<std::fs::File, String> {
    let path = std::env::temp_dir().join(format!(
        "jackalope-upload-{}.tar",
        uuid::Uuid::new_v4().simple()
    ));
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    Temporary::register(path);
    Ok(file)
}

/// Removes upload archives. On Unix the file is unlinked at once; Windows keeps
/// it until the handle closes, so it is removed by the next upload or exit.
struct Temporary;

impl Temporary {
    fn register(path: std::path::PathBuf) {
        if std::fs::remove_file(&path).is_ok() {
            return;
        }
        use std::sync::{Mutex, OnceLock};
        static PENDING: OnceLock<Mutex<Vec<std::path::PathBuf>>> = OnceLock::new();
        let pending = PENDING.get_or_init(Default::default);
        if let Ok(mut pending) = pending.lock() {
            pending.retain(|old| std::fs::remove_file(old).is_err());
            pending.push(path);
        }
    }
}

/// Applies a run's patch to the local workspace.
pub(crate) fn apply(workspace: &Path, patch: &[u8]) -> Result<(), String> {
    if patch.is_empty() {
        return Ok(());
    }
    let mut command = git_command::command(
        workspace,
        &["apply", "--binary", "--whitespace=nowarn", "-"],
        git_command::Policy::Isolated,
    );
    // A folder that is not its own repository must not apply paths relative
    // to an enclosing one.
    if !workspace.join(".git").exists() {
        if let Some(parent) = workspace.parent() {
            command.env("GIT_CEILING_DIRECTORIES", parent);
        }
    }
    let mut child = command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Git did not accept the changes.")?;
    let data = patch.to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&data));
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let _ = writer.join();
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(600)
            .collect())
    }
}

/// Splits streamed bytes into lines, bounding each line.
pub(crate) struct Lines {
    pending: Vec<u8>,
    limit: usize,
    truncated: bool,
}

impl Lines {
    pub fn new(limit: usize) -> Self {
        Self {
            pending: Vec::new(),
            limit,
            truncated: false,
        }
    }

    /// Complete lines in `data`, each with whether it was cut at the limit.
    pub fn push(&mut self, data: &[u8]) -> Vec<(String, bool)> {
        let mut lines = Vec::new();
        for byte in data {
            if *byte == b'\n' {
                let mut line = std::mem::take(&mut self.pending);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                lines.push((String::from_utf8_lossy(&line).into_owned(), self.truncated));
                self.truncated = false;
            } else if self.pending.len() < self.limit {
                self.pending.push(*byte);
            } else {
                self.truncated = true;
            }
        }
        lines
    }

    /// The last line when the stream ended without a newline.
    pub fn finish(&mut self) -> Option<(String, bool)> {
        (!self.pending.is_empty()).then(|| {
            let line = String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned();
            (line, std::mem::take(&mut self.truncated))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_split_across_chunks_and_bound_length() {
        let mut lines = Lines::new(5);
        assert!(lines.push(b"ab").is_empty());
        assert_eq!(
            lines.push(b"c\r\nlonger line\nx"),
            vec![("abc".into(), false), ("longe".into(), true)]
        );
        assert_eq!(lines.finish(), Some(("x".into(), false)));
        assert_eq!(lines.finish(), None);
    }

    #[test]
    fn run_name_follows_the_workspace() {
        assert_eq!(run_name("/a/b"), run_name("/a/b"));
        assert_ne!(run_name("/a/b"), run_name("/a/c"));
        assert!(run_name("/a/b").starts_with('w'));
        assert_eq!(run_name("/a/b").len(), 21);
        assert_eq!(read_only_run_name("/a/b")[1..], run_name("/a/b")[1..]);
        assert!(read_only_run_name("/a/b").starts_with('r'));
    }

    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn root() -> Scratch {
        let path = std::env::temp_dir().join(format!("jackalope-runs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Scratch(path)
    }

    // Linux CI has no Secret Service keyring to hold the saved sign-in.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn translation_drops_local_state_and_uses_the_computer_as_sandbox() {
        let root = root();
        credentials::set(
            root.path(),
            "claude-token",
            Some("sk-ant-oat01-abcdefghijklmnop"),
        )
        .unwrap();
        let mut command = Command::new(if cfg!(windows) {
            "C:\\bin\\claude.cmd"
        } else {
            "/usr/bin/claude"
        });
        command
            .args(["--print", "--verbose", "--output-format", "stream-json"])
            .args(["--permission-mode", "acceptEdits"])
            .args(["--mcp-config", "{\"mcpServers\":{}}"])
            .args(["--model", "sonnet"])
            .env("CLAUDE_CONFIG_DIR", "C:\\Users\\me\\profile")
            .env("JACKALOPE_BRIDGE_TOKEN", "secret")
            .env("GIT_AUTHOR_NAME", "Claude")
            .env("SOME_PATH", "D:\\cache");
        let (argv, env) = translate("claude", &command, root.path(), None).unwrap();
        assert_eq!(
            argv,
            [
                "claude",
                "--print",
                "--verbose",
                "--output-format",
                "stream-json",
                "--permission-mode",
                "bypassPermissions",
                "--model",
                "sonnet"
            ]
        );
        let names: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
        assert!(names.contains(&"GIT_AUTHOR_NAME"));
        assert!(names.contains(&"CLAUDE_CODE_OAUTH_TOKEN"));
        assert!(!names.contains(&"CLAUDE_CONFIG_DIR"));
        assert!(!names.contains(&"JACKALOPE_BRIDGE_TOKEN"));
        assert!(!names.contains(&"SOME_PATH"));
    }

    // Linux CI has no Secret Service keyring to hold the saved sign-in.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn codex_runs_without_its_own_sandbox_and_local_tools() {
        let root = root();
        credentials::set(
            root.path(),
            "openai-key",
            Some("sk-proj-abcdefghijklmnopqrst"),
        )
        .unwrap();
        let mut command = Command::new("codex");
        command.args([
            "exec",
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"workspace-write\"",
            "-c",
            "mcp_servers.docs.command=\"x\"",
            "--json",
            "-",
        ]);
        let (argv, env) = translate("codex", &command, root.path(), None).unwrap();
        assert_eq!(
            argv,
            [
                "codex",
                "exec",
                "-c",
                "approval_policy=\"never\"",
                "-c",
                "sandbox_mode=\"danger-full-access\"",
                "--json",
                "-"
            ]
        );
        assert!(env.iter().any(|(k, _)| k == "CODEX_API_KEY"));
        assert!(env.iter().any(|(k, _)| k == "OPENAI_API_KEY"));
    }

    // Linux CI has no Secret Service keyring to hold the saved sign-in.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn bridge_points_at_the_computer_relay_without_the_credential() {
        let root = root();
        credentials::set(
            root.path(),
            "claude-token",
            Some("sk-ant-oat01-abcdefghijklmnop"),
        )
        .unwrap();
        credentials::set(
            root.path(),
            "openai-key",
            Some("sk-proj-abcdefghijklmnopqrst"),
        )
        .unwrap();
        let endpoint = "http://127.0.0.1:4321";
        let config = json!({"mcpServers": {
            "jackalope": {"url": format!("{endpoint}/mcp"), "headers": {"Authorization": "Bearer ${JACKALOPE_BRIDGE_TOKEN}"}},
            "docs": {"url": "https://docs.example/mcp", "headers": {"Authorization": "Bearer ${DOCS_TOKEN}"}},
            "files": {"command": "local-files", "env": {"ROOT": "/home/me"}}
        }})
        .to_string();
        let mut command = Command::new("claude");
        command
            .args(["--print", "--mcp-config", &config])
            .args([
                "--permission-prompt-tool",
                "mcp__jackalope__permission_prompt",
            ])
            .args(["--allowedTools", "mcp__jackalope__peers"])
            .env("JACKALOPE_BRIDGE_URL", endpoint)
            .env("JACKALOPE_BRIDGE_TOKEN", "real-secret");
        let (argv, env) = translate("claude", &command, root.path(), Some(endpoint)).unwrap();
        assert_eq!(argv[2], "--mcp-config");
        assert!(argv[3].contains(&format!("{RELAY_URL}/mcp")));
        assert!(!argv[3].contains(endpoint));
        let delivered: Value = serde_json::from_str(&argv[3]).unwrap();
        assert_eq!(
            delivered["mcpServers"]
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>(),
            ["jackalope"]
        );
        assert!(!argv[3].contains("DOCS_TOKEN") && !argv[3].contains("local-files"));
        assert!(!argv.iter().any(|arg| arg == "--permission-prompt-tool"));
        assert_eq!(argv[4..], ["--allowedTools", "mcp__jackalope__peers"]);
        let value = |name: &str| env.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str());
        assert_eq!(value("JACKALOPE_BRIDGE_URL"), Some(RELAY_URL));
        assert_eq!(value("JACKALOPE_BRIDGE_TOKEN"), Some(RELAY_TOKEN));
        assert!(!env.iter().any(|(_, v)| v.contains("real-secret")));

        let mut command = Command::new("codex");
        command.args([
            "exec",
            "-c",
            &format!("mcp_servers={{ jackalope = {{ url = \"{endpoint}/mcp\", bearer_token_env_var = \"JACKALOPE_BRIDGE_TOKEN\" }}, \"docs.server\" = {{ url = \"https://docs.example/mcp\", bearer_token_env_var = \"DOCS_TOKEN\" }} }}"),
            "-c",
            "mcp_servers.docs.command=\"x\"",
        ]);
        let (argv, _) = translate("codex", &command, root.path(), Some(endpoint)).unwrap();
        assert_eq!(argv.len(), 4);
        assert!(argv[3].contains(&format!("{RELAY_URL}/mcp")));
        assert!(!argv[3].contains("DOCS_TOKEN") && !argv[3].contains("docs.server"));
        let parsed: toml::Table = toml::from_str(&argv[3]).unwrap();
        assert_eq!(
            parsed["mcp_servers"]["jackalope"]["bearer_token_env_var"].as_str(),
            Some("JACKALOPE_BRIDGE_TOKEN")
        );
    }

    #[test]
    fn project_secrets_join_the_run_without_replacing_sign_ins() {
        let mut env: Environment = vec![
            ("GIT_AUTHOR_NAME".into(), "Claude".into()),
            ("SHARED".into(), "from-command".into()),
            ("CLAUDE_CODE_OAUTH_TOKEN".into(), "sign-in".into()),
            ("JACKALOPE_BRIDGE_TOKEN".into(), RELAY_TOKEN.into()),
        ];
        add_secrets(
            &mut env,
            vec![
                ("HIGGSFIELD_API_KEY".into(), "hf-value".into()),
                ("KEY_FILE".into(), "C:\\keys\\service.json".into()),
                ("SHARED".into(), "from-secret".into()),
                ("CLAUDE_CODE_OAUTH_TOKEN".into(), "not-a-sign-in".into()),
                ("JACKALOPE_BRIDGE_TOKEN".into(), "not-the-relay".into()),
            ],
        );
        let value = |name: &str| {
            let found: Vec<&str> = env
                .iter()
                .filter(|(k, _)| k == name)
                .map(|(_, v)| v.as_str())
                .collect();
            assert!(found.len() <= 1, "{name} appears more than once");
            found.first().copied()
        };
        assert_eq!(value("HIGGSFIELD_API_KEY"), Some("hf-value"));
        assert_eq!(value("KEY_FILE"), Some("C:\\keys\\service.json"));
        assert_eq!(value("SHARED"), Some("from-secret"));
        assert_eq!(value("CLAUDE_CODE_OAUTH_TOKEN"), Some("sign-in"));
        assert_eq!(value("JACKALOPE_BRIDGE_TOKEN"), Some(RELAY_TOKEN));
        assert_eq!(value("GIT_AUTHOR_NAME"), Some("Claude"));
    }

    #[test]
    fn unreadable_bridge_configuration_is_refused() {
        let endpoint = "http://127.0.0.1:4321";
        assert!(bridge_only("claude", &format!("{{\"x\":\"{endpoint}\"}}")).is_err());
        assert!(bridge_only("codex", "mcp_servers=not toml {").is_err());
    }

    #[test]
    fn missing_credentials_and_adapters_are_reported() {
        let root = root();
        let error = translate("claude", &Command::new("claude"), root.path(), None).unwrap_err();
        assert!(error.contains("Settings → Computers"), "{error}");
        let error = translate("gemini", &Command::new("gemini"), root.path(), None).unwrap_err();
        assert!(error.contains("cannot run on a computer"), "{error}");
    }

    // Linux CI has no Secret Service keyring to hold the saved sign-in.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn credentials_are_validated_listed_and_removed() {
        let root = root();
        assert!(credentials::set(root.path(), "claude-token", Some("short")).is_err());
        assert!(credentials::set(root.path(), "nope", Some("x".repeat(30).as_str())).is_err());
        credentials::set(
            root.path(),
            "anthropic-key",
            Some("sk-ant-api03-abcdefghijklmnop"),
        )
        .unwrap();
        let status = credentials::status(root.path()).unwrap();
        assert!(status.iter().any(|s| s.id == "anthropic-key" && s.saved));
        assert!(status.iter().any(|s| s.id == "claude-token" && !s.saved));
        let env = credentials::environment(root.path(), "claude").unwrap();
        assert_eq!(env[0].0, "ANTHROPIC_API_KEY");
        credentials::set(root.path(), "anthropic-key", None).unwrap();
        assert!(credentials::environment(root.path(), "claude").is_err());
    }

    #[test]
    fn archive_includes_untracked_files_and_skips_ignored_ones() {
        let dir = root();
        let path = dir.path();
        let git = |args: &[&str]| {
            assert!(Command::new("git")
                .args(args)
                .current_dir(path)
                .output()
                .unwrap()
                .status
                .success());
        };
        git(&["init", "-q"]);
        std::fs::write(path.join(".gitignore"), "build/\n.env.local\n").unwrap();
        std::fs::write(path.join("tracked.txt"), "a").unwrap();
        git(&["add", "."]);
        git(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-qm",
            "x",
        ]);
        std::fs::write(path.join("new.txt"), "b").unwrap();
        std::fs::create_dir(path.join("build")).unwrap();
        std::fs::write(path.join("build/out.bin"), "c").unwrap();
        std::fs::write(path.join(".env.local"), "KEY=1").unwrap();
        let setup = [".env.local", "../escape", "missing.txt", "tracked.txt"].map(String::from);
        let mut file = archive(path, &setup).unwrap();
        file.seek(std::io::SeekFrom::Start(0)).unwrap();
        let mut names: Vec<String> = tar::Archive::new(file)
            .entries()
            .unwrap()
            .map(|entry| {
                entry
                    .unwrap()
                    .path()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        assert_eq!(
            names,
            [".env.local", ".gitignore", "new.txt", "tracked.txt"]
        );
    }

    /// Answers the run protocol from memory.
    struct Fake {
        upload: std::sync::Arc<std::sync::Mutex<Vec<u8>>>,
        patch: Vec<u8>,
        digest: String,
    }

    impl Transport for Fake {
        fn call(&mut self, payload: &Value, _: Duration, _: &AtomicBool) -> Result<Value, String> {
            let engine = base64::engine::general_purpose::STANDARD;
            match payload["action"].as_str().unwrap() {
                "workspace_put" => {
                    let mut upload = self.upload.lock().unwrap();
                    assert_eq!(payload["offset"].as_u64().unwrap() as usize, upload.len());
                    let data = engine.decode(payload["data"].as_str().unwrap()).unwrap();
                    assert!(data.len() <= CHUNK);
                    upload.extend(data);
                    if payload["final"] == true {
                        let hex: String = Sha256::digest(&*upload)
                            .iter()
                            .map(|b| format!("{b:02x}"))
                            .collect();
                        assert_eq!(payload["sha256"], json!(hex));
                    }
                    Ok(json!({"received": upload.len()}))
                }
                "workspace_diff" => Ok(json!({"size": self.patch.len(), "sha256": self.digest})),
                "workspace_get" => {
                    let offset = payload["offset"].as_u64().unwrap() as usize;
                    let end = (offset + 3).min(self.patch.len());
                    Ok(json!({"data": engine.encode(&self.patch[offset..end])}))
                }
                other => panic!("unexpected {other}"),
            }
        }
    }

    #[test]
    fn session_uploads_in_chunks_and_checks_the_returned_patch() {
        let dir = root();
        let big: Vec<u8> = (0..CHUNK * 2 + 10).map(|n| (n % 251) as u8).collect();
        std::fs::write(dir.path().join("big.bin"), &big).unwrap();
        let upload = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let patch = b"diff --git a/x b/x\n".to_vec();
        let digest: String = Sha256::digest(&patch)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let fake = Fake {
            upload: upload.clone(),
            patch: patch.clone(),
            digest,
        };
        let mut session = Session::with_transport(Box::new(fake), "w1".into());
        let sent = std::sync::Mutex::new(0);
        session
            .upload(dir.path(), &[], &|done, _| *sent.lock().unwrap() = done)
            .unwrap();
        let archived = upload.lock().unwrap().clone();
        assert_eq!(*sent.lock().unwrap() as usize, archived.len());
        let mut names = tar::Archive::new(std::io::Cursor::new(archived));
        let mut entry = names.entries().unwrap().next().unwrap().unwrap();
        assert_eq!(entry.path().unwrap().to_string_lossy(), "big.bin");
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        assert_eq!(content, big);
        assert_eq!(session.collect().unwrap(), patch);

        let bad = Fake {
            upload,
            patch: patch.clone(),
            digest: "0".repeat(64),
        };
        let mut session = Session::with_transport(Box::new(bad), "w1".into());
        assert!(session.collect().unwrap_err().contains("corrupted"));
    }

    #[test]
    fn apply_writes_a_binary_patch_into_the_workspace() {
        let dir = root();
        std::fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        let patch =
            b"diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n";
        apply(dir.path(), patch).unwrap();
        // Git writes the checkout's line endings (CRLF under Windows autocrlf).
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "two\n"
        );
        assert!(apply(dir.path(), patch).is_err());
        apply(dir.path(), b"").unwrap();
    }
}
