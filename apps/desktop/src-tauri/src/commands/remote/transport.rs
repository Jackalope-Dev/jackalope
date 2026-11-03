use super::super::process_control::{self, ProcessTree};
use super::*;
use std::{
    collections::HashMap,
    process::{Child, Command, Stdio},
    sync::LazyLock,
};

pub(super) struct Tunnel {
    child: Child,
    tree: ProcessTree,
    port: u16,
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.wait();
    }
}
static TUNNELS: LazyLock<Mutex<HashMap<String, Tunnel>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
pub fn close_tunnels() {
    TUNNELS.lock().unwrap().clear();
}
pub(super) fn close_tunnel(id: &str) {
    TUNNELS.lock().unwrap().remove(id);
}
fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}
pub(super) fn ssh_alias(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 200
        || value.starts_with('-')
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-@".contains(&b))
    {
        return Err("Use an SSH configuration alias or user@hostname.".into());
    }
    Ok(())
}
pub(super) fn tunnel(id: &str, alias: &str, remote_port: u16) -> Result<u16, String> {
    ssh_alias(alias)?;
    let mut tunnels = TUNNELS.lock().map_err(|e| e.to_string())?;
    if let Some(tunnel) = tunnels.get_mut(id) {
        if tunnel
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Ok(tunnel.port);
        }
    }
    tunnels.remove(id);
    let reserved = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| e.to_string())?;
    let port = reserved.local_addr().map_err(|e| e.to_string())?.port();
    drop(reserved);
    let mut child = command("ssh")
        .args([
            "-N",
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
            "-L",
            &format!("127.0.0.1:{port}:127.0.0.1:{remote_port}"),
            alias,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "OpenSSH is unavailable. Install an SSH client or connect using HTTPS.")?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut tunnel = Tunnel { child, tree, port };
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if tunnel
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err("SSH could not connect. Sign in with this alias in your terminal first and verify its host key, then retry.".into());
        }
        if std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(150),
        )
        .is_ok()
        {
            tunnels.insert(id.into(), tunnel);
            return Ok(port);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("SSH did not become ready. Check that the host is reachable and SSH port forwarding is allowed.".into())
}
/// The Tailscale CLI: on PATH, or inside the app where the macOS and Windows installers
/// put it without adding it to PATH.
fn tailscale_program() -> Option<std::path::PathBuf> {
    let name = if cfg!(windows) {
        "tailscale.exe"
    } else {
        "tailscale"
    };
    let on_path = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(name))
            .find(|path| path.is_file())
    });
    let bundled = [
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        r"C:\Program Files\Tailscale\tailscale.exe",
    ]
    .into_iter()
    .map(std::path::PathBuf::from)
    .find(|path| path.is_file());
    on_path.or(bundled)
}
fn tailscale(args: &[&str]) -> Result<Value, String> {
    let program = tailscale_program().ok_or("Tailscale isn't installed on this computer.")?;
    let mut cmd = command(&program.to_string_lossy());
    cmd.args(args);
    let output = process_control::run(cmd, Duration::from_secs(25))
        .map_err(|_| "Tailscale didn't respond. Open the Tailscale app and try again.")?;
    if !output.success {
        return Err(format!(
            "Tailscale could not complete setup. {}",
            output.stderr.chars().take(2000).collect::<String>()
        ));
    }
    serde_json::from_str(&output.stdout)
        .map_err(|_| "Tailscale returned an unreadable status.".into())
}
#[tauri::command]
pub async fn remote_private_https(service: State<'_, RemoteAccess>) -> Result<Value, String> {
    let service = service.inner().clone();
    let _gate = service.gate.lock().await;
    let copy = service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = copy.inner.lock().map_err(|e| e.to_string())?.config.clone();
        if !config.enabled { return Err("Enable remote access first.".to_string()); }
        let status = tailscale(&["status", "--json"])?;
        if status["BackendState"] != "Running" { return Err("Sign in to Tailscale on this host first.".into()); }
        let dns = status["Self"]["DNSName"].as_str().ok_or("Tailscale has no hostname for this device.")?.trim_end_matches('.');
        let address = origin(&format!("https://{dns}:8443"))?;
        let serve = tailscale(&["serve", "status", "--json"])?;
        if !serve["TCP"]["8443"].is_null() { return Err("Tailscale port 8443 is already configured. Enter its existing HTTPS address, or choose an unused port in Tailscale without replacing other services.".into()); }
        let program = tailscale_program().ok_or("Tailscale isn't installed on this computer.")?;
        let mut cmd = command(&program.to_string_lossy()); cmd.args(["serve", "--bg", "--https=8443", "--yes", &format!("http://127.0.0.1:{}",config.port)]);
        let result = process_control::run(cmd, Duration::from_secs(30))?;
        if !result.success { return Err(format!("Enable HTTPS for this device in Tailscale and retry. {} {}",result.stdout.chars().take(1500).collect::<String>(),result.stderr.chars().take(1500).collect::<String>())); }
        let mut inner = copy.inner.lock().map_err(|e| e.to_string())?;
        let mut config = inner.config.clone(); config.public_origin = address;
        copy.save(&config)?; inner.config = config;
        drop(inner); copy.status()
    }).await.map_err(|e| e.to_string())?
}

/// Where Tailscale setup stands for private HTTPS, one field per step the person takes.
/// Phones are other devices on the same tailnet; the app cannot see more than that.
fn tailscale_setup(status: &Value) -> Value {
    let phones: Vec<&str> = status["Peer"]
        .as_object()
        .map(|peers| {
            peers
                .values()
                .filter(|peer| matches!(peer["OS"].as_str(), Some("iOS" | "android")))
                .filter_map(|peer| peer["HostName"].as_str())
                .collect()
        })
        .unwrap_or_default();
    json!({
        "installed": true,
        "signedIn": status["BackendState"] == "Running",
        "magicDns": status["CurrentTailnet"]["MagicDNSEnabled"] == true,
        "https": status["CertDomains"].as_array().is_some_and(|domains| !domains.is_empty()),
        "phones": phones,
        "error": null,
    })
}
#[tauri::command]
pub async fn remote_tailscale_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if tailscale_program().is_none() {
            return json!({"installed":false,"signedIn":false,"magicDns":false,"https":false,"phones":[],"error":null});
        }
        match tailscale(&["status", "--json"]) {
            Ok(status) => tailscale_setup(&status),
            // A stopped or signed-out Tailscale can refuse status; report its own words.
            Err(error) => json!({"installed":true,"signedIn":false,"magicDns":false,"https":false,"phones":[],"error":error}),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tailscale_setup_reports_each_step_from_status() {
        let ready = tailscale_setup(&serde_json::json!({
            "BackendState": "Running",
            "CurrentTailnet": {"MagicDNSEnabled": true},
            "CertDomains": ["studio.tail1234.ts.net"],
            "Peer": {
                "a": {"OS": "iOS", "HostName": "Cadens-iPhone"},
                "b": {"OS": "macOS", "HostName": "laptop"},
            },
        }));
        assert_eq!(ready["signedIn"], true);
        assert_eq!(ready["magicDns"], true);
        assert_eq!(ready["https"], true);
        assert_eq!(ready["phones"], serde_json::json!(["Cadens-iPhone"]));
        let fresh = tailscale_setup(&serde_json::json!({"BackendState": "NeedsLogin"}));
        assert_eq!(fresh["signedIn"], false);
        assert_eq!(fresh["https"], false);
        assert_eq!(fresh["phones"], serde_json::json!([]));
    }
    #[test]
    fn ssh_destination_cannot_supply_options_or_commands() {
        for bad in [
            "-oProxyCommand=evil",
            "host;command",
            "host command",
            "host\ncommand",
            "$(command)",
        ] {
            assert!(ssh_alias(bad).is_err());
        }
        assert!(ssh_alias("dev@build-host").is_ok());
    }
}
