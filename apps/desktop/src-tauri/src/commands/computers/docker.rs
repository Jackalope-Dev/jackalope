//! The `local-docker` provider: one container per computer from the image in
//! `resources/computer`, built locally on first use. Containers run as an
//! unprivileged user with no capabilities, `no-new-privileges`, CPU, memory and
//! process limits, no host mounts unless a task shares its project read-only,
//! and a named volume for the home folder. The viewer and browser ports are
//! published on the host's loopback interface only; with networking off the
//! container has no network at all. The agent is reached with `docker exec`,
//! so it needs no port or secret.

use super::{Computer, MachineState, Provider, Transport};
use crate::commands::desktop_control::helper::{Helper, Launch, Launcher};
use crate::commands::process_control::{self, Limits};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    process::Command,
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::{Duration, Instant},
};

pub(crate) const LABEL: &str = "dev.jackalope.computer";
const CONFIG_LABEL: &str = "dev.jackalope.computer.config";
const IMAGE_FILES: &[&str] = &["Dockerfile", "start.sh", "agent.py"];
const QUICK: Duration = Duration::from_secs(20);

fn docker(args: &[&str]) -> Command {
    let mut command = Command::new("docker");
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn run(args: &[&str], timeout: Duration) -> Result<String, String> {
    let output = process_control::run(docker(args), timeout).map_err(|error| {
        if error.contains("not found")
            || error.contains("cannot find")
            || error.contains("No such file")
        {
            missing_message()
        } else {
            error
        }
    })?;
    if output.timed_out {
        return Err("Docker did not answer in time. Check that it is running.".into());
    }
    if !output.success {
        return Err(clean(&output.stderr));
    }
    Ok(output.stdout.trim().to_string())
}

fn clean(stderr: &str) -> String {
    let text: String = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .last()
        .unwrap_or("Docker failed.")
        .chars()
        .filter(|c| !c.is_control())
        .take(400)
        .collect();
    text
}

fn missing_message() -> String {
    if cfg!(target_os = "macos") {
        "Docker is not installed. Install Docker Desktop, or Colima (`brew install colima docker`, then `colima start`), and refresh.".into()
    } else if cfg!(windows) {
        "Docker is not installed. Install Docker Desktop with the WSL 2 backend, start it, and refresh.".into()
    } else {
        "Docker is not installed. Install Docker Engine for your distribution, start it, and refresh.".into()
    }
}

/// Whether Docker can run bot computers here, as the settings pages show it.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatus {
    pub available: bool,
    /// docker-desktop, colima, docker or null when not detected.
    pub engine: Option<String>,
    pub client_version: Option<String>,
    pub server_version: Option<String>,
    /// Server architecture, such as x86_64 or aarch64.
    pub arch: Option<String>,
    /// What to do next when unavailable.
    pub message: Option<String>,
    pub install_url: Option<String>,
}

fn install_url() -> String {
    if cfg!(target_os = "linux") {
        "https://docs.docker.com/engine/install/".into()
    } else {
        "https://www.docker.com/products/docker-desktop/".into()
    }
}

/// Interprets `docker version --format '{{json .}}'` and the active context.
pub(crate) fn interpret(version: Result<&str, &str>, context: &str) -> DockerStatus {
    let engine = match context.trim() {
        name if name.starts_with("colima") => Some("colima".to_string()),
        name if name.starts_with("desktop") => Some("docker-desktop".to_string()),
        _ => Some("docker".to_string()),
    };
    let unavailable = |message: String| DockerStatus {
        engine: engine.clone(),
        message: Some(message),
        install_url: Some(install_url()),
        ..Default::default()
    };
    let text = match version {
        Ok(text) => text,
        Err(error) => {
            let parsed: Value =
                serde_json::from_str(error.lines().next().unwrap_or("")).unwrap_or(Value::Null);
            let client = parsed["Client"]["Version"].as_str().map(str::to_owned);
            let message = if engine.as_deref() == Some("colima") {
                "Colima is installed but not running. Run `colima start`, then refresh.".to_string()
            } else if cfg!(target_os = "linux") {
                "Docker is installed but its engine is not reachable. Start the Docker service and make sure your user can use it, then refresh.".to_string()
            } else {
                "Docker is installed but not running. Start Docker Desktop, then refresh."
                    .to_string()
            };
            return DockerStatus {
                client_version: client,
                ..unavailable(message)
            };
        }
    };
    let value: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let client = value["Client"]["Version"].as_str().map(str::to_owned);
    let server = value["Server"]["Version"].as_str().map(str::to_owned);
    let os = value["Server"]["Os"].as_str().unwrap_or_default();
    let arch = value["Server"]["Arch"].as_str().map(str::to_owned);
    if server.is_none() {
        return DockerStatus {
            client_version: client,
            ..unavailable("Docker is installed but not running. Start it, then refresh.".into())
        };
    }
    if os != "linux" {
        return DockerStatus {
            client_version: client,
            server_version: server,
            arch,
            ..unavailable("Docker is using Windows containers. Switch Docker Desktop to Linux containers, then refresh.".into())
        };
    }
    DockerStatus {
        available: true,
        engine,
        client_version: client,
        server_version: server,
        arch,
        message: None,
        install_url: None,
    }
}

pub(crate) fn detect() -> DockerStatus {
    let output = match process_control::run(docker(&["version", "--format", "{{json .}}"]), QUICK) {
        Ok(output) => output,
        Err(_) => {
            return DockerStatus {
                message: Some(missing_message()),
                install_url: Some(install_url()),
                ..Default::default()
            }
        }
    };
    let context = run(&["context", "show"], QUICK).unwrap_or_default();
    if output.timed_out {
        return interpret(Err(""), &context);
    }
    if output.success {
        interpret(Ok(output.stdout.trim()), &context)
    } else {
        interpret(Err(output.stdout.trim()), &context)
    }
}

pub(crate) fn container(computer: &Computer) -> String {
    format!("jackalope-computer-{}", computer.id)
}

pub(crate) fn volume(computer: &Computer) -> String {
    format!("jackalope-computer-{}-home", computer.id)
}

/// Image tag derived from the bundled build context, so an updated image
/// definition builds a new image instead of reusing a stale one.
pub(crate) fn image_tag(directory: &Path) -> Result<String, String> {
    let mut digest = Sha256::new();
    for name in IMAGE_FILES {
        let bytes = std::fs::read(directory.join(name))
            .map_err(|_| "The bot computer image definition is incomplete. Reinstall Jackalope.")?;
        digest.update(name.as_bytes());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(&bytes);
    }
    let hex: String = digest.finalize()[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(format!("jackalope-computer:{hex}"))
}

/// A digest of everything fixed when a container is created; a stopped
/// container whose digest differs is recreated over the same home volume.
pub(crate) fn config_digest(computer: &Computer, image: &str) -> String {
    let settings = serde_json::to_string(&computer.settings).unwrap_or_default();
    let digest = Sha256::digest(format!("{image}\n{settings}").as_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `docker create` arguments. The viewer password comes from the CLI's
/// environment (`-e NAME`), so it never appears in a process argument list.
pub(crate) fn create_args(computer: &Computer, image: &str) -> Vec<String> {
    let settings = &computer.settings;
    let mut args: Vec<String> = vec![
        "create".into(),
        "--name".into(),
        container(computer),
        "--label".into(),
        format!("{LABEL}={}", computer.id),
        "--label".into(),
        format!("{CONFIG_LABEL}={}", config_digest(computer, image)),
        "--hostname".into(),
        "computer".into(),
        "--init".into(),
        "--cpus".into(),
        format!("{}", settings.cpus),
        "--memory".into(),
        format!("{}m", settings.memory_mb),
        "--memory-swap".into(),
        format!("{}m", settings.memory_mb),
        "--pids-limit".into(),
        "2048".into(),
        "--shm-size".into(),
        "1g".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "--env".into(),
        "JACKALOPE_VNC_PASSWORD".into(),
        "--volume".into(),
        format!("{}:/home/bot", volume(computer)),
    ];
    if let Some(project) = &settings.project_mount {
        args.push("--mount".into());
        args.push(format!(
            "type=bind,source={project},target=/workspace/project,readonly"
        ));
    }
    if settings.network {
        for port in ["6080", "9223"] {
            args.push("--publish".into());
            args.push(format!("127.0.0.1::{port}"));
        }
    } else {
        args.push("--network".into());
        args.push("none".into());
    }
    args.push(image.into());
    args
}

/// Parses `docker port` output such as `127.0.0.1:49153`, accepting only loopback.
pub(crate) fn loopback_port(output: &str) -> Option<u16> {
    output.lines().find_map(|line| {
        let (host, port) = line.trim().rsplit_once(':')?;
        (host == "127.0.0.1").then(|| port.parse().ok()).flatten()
    })
}

fn published(computer: &Computer, port: &str) -> Option<u16> {
    run(
        &["port", &container(computer), &format!("{port}/tcp")],
        QUICK,
    )
    .ok()
    .and_then(|output| loopback_port(&output))
}

fn inspect(computer: &Computer) -> Result<Option<(String, String)>, String> {
    let format = format!("{{{{.State.Status}}}}|{{{{index .Config.Labels \"{CONFIG_LABEL}\"}}}}");
    match run(
        &["inspect", "--format", &format, &container(computer)],
        QUICK,
    ) {
        Ok(output) => {
            let (state, digest) = output.split_once('|').unwrap_or((&output, ""));
            Ok(Some((state.to_string(), digest.to_string())))
        }
        Err(error) if error.contains("No such") => Ok(None),
        Err(error) => Err(error),
    }
}

/// Builds the image unless it already exists, reporting build output lines.
fn ensure_image(id: &str, progress: &dyn Fn(&str)) -> Result<String, String> {
    let directory = super::image_directory()?;
    let tag = image_tag(&directory)?;
    if run(&["image", "inspect", "--format", "{{.Id}}", &tag], QUICK).is_ok() {
        return Ok(tag);
    }
    progress("Building the computer image (first use takes a few minutes)");
    let context = directory.to_string_lossy().into_owned();
    let latest: Arc<Mutex<String>> = Arc::default();
    let seen = latest.clone();
    let id = id.to_string();
    let output = process_control::run_supervised(
        docker(&[
            "build",
            "--progress",
            "plain",
            "--label",
            &format!("{LABEL}.image=1"),
            "--tag",
            &tag,
            &context,
        ]),
        Limits::supervised(Duration::from_secs(45 * 60), Duration::from_secs(10 * 60)),
        || false,
        move |bytes, _| {
            if let Some(line) = String::from_utf8_lossy(bytes)
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
            {
                let line: String = line.trim().chars().take(160).collect();
                super::set_phase(&id, Some(line.clone()), None);
                if let Ok(mut latest) = seen.lock() {
                    *latest = line;
                }
            }
        },
    );
    let line = latest.lock().map(|l| l.clone()).unwrap_or_default();
    if !line.is_empty() {
        progress(&line);
    }
    let output = output?;
    if !output.success {
        return Err(format!(
            "The computer image did not build: {}",
            clean(&output.stderr)
        ));
    }
    Ok(tag)
}

/// Detection reused for a few seconds, so status polling does not run Docker
/// for every view refresh.
fn detect_recent() -> DockerStatus {
    static RECENT: Mutex<Option<(Instant, DockerStatus)>> = Mutex::new(None);
    if let Ok(recent) = RECENT.lock() {
        if let Some((at, status)) = recent.as_ref() {
            if at.elapsed() < Duration::from_secs(10) {
                return status.clone();
            }
        }
    }
    let status = detect();
    if let Ok(mut recent) = RECENT.lock() {
        *recent = Some((Instant::now(), status.clone()));
    }
    status
}

pub(crate) struct LocalDocker;

impl Provider for LocalDocker {
    fn available(&self, _: &Path, _: &Computer) -> Result<(), String> {
        let status = detect_recent();
        if status.available {
            Ok(())
        } else {
            Err(status.message.unwrap_or_else(missing_message))
        }
    }

    fn state(&self, _: &Path, computer: &Computer) -> Result<MachineState, String> {
        Ok(match inspect(computer)? {
            None => MachineState::Missing,
            Some((state, _)) if state == "running" => MachineState::Running,
            Some(_) => MachineState::Stopped,
        })
    }

    fn start(
        &self,
        root: &Path,
        computer: &Computer,
        progress: &dyn Fn(&str),
    ) -> Result<(), String> {
        let image = ensure_image(&computer.id, progress)?;
        let name = container(computer);
        match inspect(computer)? {
            Some((state, _)) if state == "running" => return Ok(()),
            Some((_, digest)) if digest != config_digest(computer, &image) => {
                progress("Applying new settings");
                run(&["rm", "--force", &name], QUICK)?;
            }
            Some(_) => {}
            None => {}
        }
        if inspect(computer)?.is_none() {
            progress("Creating the computer");
            run(
                &[
                    "volume",
                    "create",
                    "--label",
                    &format!("{LABEL}={}", computer.id),
                    &volume(computer),
                ],
                QUICK,
            )?;
            let secret = super::secret(root, &computer.id)?;
            let args = create_args(computer, &image);
            let mut command = docker(&args.iter().map(String::as_str).collect::<Vec<_>>());
            command.env("JACKALOPE_VNC_PASSWORD", &secret.vnc_password);
            let output = process_control::run(command, Duration::from_secs(60))?;
            if !output.success {
                return Err(format!(
                    "Docker could not create the computer: {}",
                    clean(&output.stderr)
                ));
            }
        }
        progress("Starting the desktop");
        run(&["start", &name], Duration::from_secs(60))?;
        let mut transport = self.transport(root, computer)?;
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            match transport.call(
                &serde_json::json!({"action":"list"}),
                Duration::from_secs(20),
                &AtomicBool::new(false),
            ) {
                Ok(_) => return Ok(()),
                Err(error) if Instant::now() >= deadline => {
                    return Err(format!(
                        "The computer started but its desktop did not answer: {error}"
                    ))
                }
                Err(_) => std::thread::sleep(Duration::from_secs(1)),
            }
        }
    }

    fn stop(&self, _: &Path, computer: &Computer) -> Result<(), String> {
        match inspect(computer)? {
            Some((state, _)) if state == "running" => run(
                &["stop", "--time", "10", &container(computer)],
                Duration::from_secs(40),
            )
            .map(|_| ()),
            _ => Ok(()),
        }
    }

    fn delete(&self, _: &Path, computer: &Computer) -> Result<(), String> {
        if inspect(computer)?.is_some() {
            run(
                &["rm", "--force", &container(computer)],
                Duration::from_secs(40),
            )?;
        }
        match run(&["volume", "rm", &volume(computer)], QUICK) {
            Err(error) if !error.contains("No such") => Err(error),
            _ => Ok(()),
        }
    }

    fn transport(&self, _: &Path, computer: &Computer) -> Result<Box<dyn Transport>, String> {
        let name = container(computer);
        let launcher: Launcher = Arc::new(move || {
            Ok(Launch {
                command: docker(&[
                    "exec",
                    "--interactive",
                    &name,
                    "python3",
                    "/opt/jackalope/agent.py",
                    "serve",
                ]),
                preamble: Vec::new(),
            })
        });
        Ok(Box::new(Resident(Helper::new(launcher))))
    }

    fn viewer(
        &self,
        root: &Path,
        computer: &Computer,
        interactive: bool,
    ) -> Result<Option<String>, String> {
        if !computer.settings.network {
            return Ok(None);
        }
        let Some(port) = published(computer, "6080") else {
            return Ok(None);
        };
        let password = super::secret(root, &computer.id)?.vnc_password;
        Ok(Some(viewer_url(port, interactive, &password)))
    }

    fn devtools(&self, _: &Path, computer: &Computer) -> Option<String> {
        if !computer.settings.network {
            return None;
        }
        published(computer, "9223").map(|port| format!("http://127.0.0.1:{port}"))
    }
}

/// noVNC's lite client. The password is in the fragment, which the browser
/// never sends to the server.
pub(crate) fn viewer_url(port: u16, interactive: bool, password: &str) -> String {
    format!(
        "http://127.0.0.1:{port}/vnc_lite.html?scale=true&view_only={}#&password={password}",
        !interactive
    )
}

/// The resident `docker exec` agent, reusing the desktop helper's process
/// ownership, timeouts and JSON-lines framing.
struct Resident(Helper);

impl Transport for Resident {
    fn call(
        &mut self,
        payload: &Value,
        timeout: Duration,
        canceled: &AtomicBool,
    ) -> Result<Value, String> {
        self.0
            .call(payload, timeout, canceled)
            .map_err(String::from)
    }

    fn shutdown(&mut self) {
        self.0.shutdown();
    }
}
