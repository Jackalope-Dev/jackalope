//! Setting up a Mac the person owns as a cloud machine, without Docker.
//!
//! The setup script carries this app version's own `agent.py` and
//! `protocol.json`, so the Mac runs exactly the agent and protocol this
//! desktop speaks, whether or not an image was published. It installs them in
//! `~/.jackalope-computer`, keeps the pairing secret in a private file there
//! and starts `agent.py http 127.0.0.1:<port>` under a LaunchAgent. The
//! script holds no secret: the person runs it with
//! `JACKALOPE_COMPUTER_TOKEN` set, as the Pair machine form shows. HTTPS in
//! front of the port stays the person's choice (Tailscale Serve or Caddy), as
//! for any cloud machine.

use base64::Engine;
use std::path::{Path, PathBuf};

pub(crate) const SCRIPT_NAME: &str = "jackalope-mac-computer.sh";
pub(crate) const LAUNCH_AGENT: &str = "dev.jackalope.computer";
pub(crate) const DEFAULT_PORT: u16 = 8765;

fn embedded(directory: &Path, name: &str) -> Result<String, String> {
    let bytes = std::fs::read(directory.join(name))
        .map_err(|_| "The bot computer agent is missing. Reinstall Jackalope.".to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    // Short lines keep the script readable by editors and terminals.
    Ok(encoded
        .as_bytes()
        .chunks(76)
        .map(|line| String::from_utf8_lossy(line).into_owned())
        .collect::<Vec<_>>()
        .join("\n"))
}

/// The setup script for this app version's agent in `directory`.
pub(crate) fn script(directory: &Path, version: &str) -> Result<String, String> {
    let agent = embedded(directory, "agent.py")?;
    let protocol = embedded(directory, "protocol.json")?;
    Ok(format!(
        r#"#!/bin/sh
# Sets up this Mac as a Jackalope computer (Jackalope {version}).
#   JACKALOPE_COMPUTER_TOKEN=<pairing secret> sh {SCRIPT_NAME} [port]
# Installs the computer agent in ~/.jackalope-computer and starts it on
# 127.0.0.1:<port> (default {DEFAULT_PORT}) under the LaunchAgent {LAUNCH_AGENT}.
# Run it again to update the agent or change the secret. To remove it:
#   launchctl bootout gui/$(id -u)/{LAUNCH_AGENT}
#   rm -rf ~/.jackalope-computer ~/Library/LaunchAgents/{LAUNCH_AGENT}.plist
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo "Run this on the Mac. Linux machines run the jackalope-computer Docker image." >&2
  exit 1
fi
token="${{JACKALOPE_COMPUTER_TOKEN:-}}"
if [ "${{#token}}" -lt 32 ]; then
  echo "Set JACKALOPE_COMPUTER_TOKEN to the pairing secret Jackalope shows (32 or more characters)." >&2
  exit 1
fi
port="${{1:-{DEFAULT_PORT}}}"
python=/usr/bin/python3
if ! "$python" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then
  echo "This Mac has no Python 3.9 or later. Install Xcode (or run xcode-select --install), then run this again." >&2
  exit 1
fi
dir="$HOME/.jackalope-computer"
mkdir -p "$dir" "$HOME/Library/LaunchAgents"
chmod 700 "$dir"
decode() {{ "$python" -c 'import base64, sys; sys.stdout.buffer.write(base64.b64decode(sys.stdin.read()))' > "$1.tmp" && mv "$1.tmp" "$1"; }}
decode "$dir/agent.py" <<'JACKALOPE_AGENT'
{agent}
JACKALOPE_AGENT
decode "$dir/protocol.json" <<'JACKALOPE_PROTOCOL'
{protocol}
JACKALOPE_PROTOCOL
(umask 077 && printf '%s' "$token" > "$dir/token")
cat > "$dir/run.sh" <<'JACKALOPE_RUN'
#!/bin/sh
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
JACKALOPE_COMPUTER_TOKEN="$(cat "$HOME/.jackalope-computer/token")"
export JACKALOPE_COMPUTER_TOKEN
exec /usr/bin/python3 "$HOME/.jackalope-computer/agent.py" http "127.0.0.1:$1"
JACKALOPE_RUN
chmod 700 "$dir/run.sh"
plist="$HOME/Library/LaunchAgents/{LAUNCH_AGENT}.plist"
cat > "$plist" <<JACKALOPE_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LAUNCH_AGENT}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$dir/run.sh</string><string>$port</string></array>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$dir/agent.log</string>
  <key>StandardErrorPath</key><string>$dir/agent.log</string>
</dict>
</plist>
JACKALOPE_PLIST
launchctl bootout "gui/$(id -u)/{LAUNCH_AGENT}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
tries=0
until curl -fsS -o /dev/null -H "Authorization: Bearer $token" "http://127.0.0.1:$port/v1/health"; do
  tries=$((tries + 1))
  if [ "$tries" -ge 20 ]; then
    echo "The agent did not answer on 127.0.0.1:$port. See $dir/agent.log." >&2
    exit 1
  fi
  sleep 1
done
echo "The Jackalope computer agent answers on 127.0.0.1:$port."
echo "Put HTTPS in front of it, for example: tailscale serve --bg $port"
echo "Then pair it in Jackalope with that https:// address."
"#
    ))
}

/// Writes the setup script under `root` and returns its path.
pub(crate) fn write(root: &Path, directory: &Path) -> Result<PathBuf, String> {
    let script = script(directory, env!("CARGO_PKG_VERSION"))?;
    let folder = root.join("mac-setup");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(SCRIPT_NAME);
    crate::commands::history::write_atomic(&path, script.as_bytes())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/computer")
    }

    #[test]
    fn the_script_carries_this_versions_agent_and_no_secret() {
        let text = script(&bundled(), "9.9.9").unwrap();
        assert!(text.starts_with("#!/bin/sh\n"));
        assert!(text.contains("Jackalope 9.9.9"));
        let section = |marker: &str| {
            let start = text.find(&format!("<<'{marker}'\n")).unwrap() + marker.len() + 4;
            let end = start + text[start..].find(&format!("\n{marker}\n")).unwrap();
            base64::engine::general_purpose::STANDARD
                .decode(text[start..end].replace('\n', ""))
                .unwrap()
        };
        assert_eq!(
            section("JACKALOPE_AGENT"),
            std::fs::read(bundled().join("agent.py")).unwrap()
        );
        assert_eq!(
            section("JACKALOPE_PROTOCOL"),
            std::fs::read(bundled().join("protocol.json")).unwrap()
        );
        // The secret comes from the person's environment, never the file.
        assert!(text.contains(r#"token="${JACKALOPE_COMPUTER_TOKEN:-}""#));
        assert!(text.contains(&format!("{LAUNCH_AGENT}.plist")));
        assert!(text.contains("http \"127.0.0.1:$1\""));
        assert!(script(Path::new("/nonexistent"), "1").is_err());
    }

    /// Runs the script's installer in a scratch home with launchctl and curl
    /// stubbed, checking what it writes. macOS only: it refuses elsewhere.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_script_installs_the_agent_and_launch_agent() {
        let home = std::env::temp_dir().join(format!("jackalope-mac-{}", uuid::Uuid::new_v4()));
        let bin = home.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        for stub in ["launchctl", "curl"] {
            let path = bin.join(stub);
            std::fs::write(
                &path,
                format!("#!/bin/sh\necho {stub} \"$@\" >> \"$HOME/calls\"\n"),
            )
            .unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let script_path = home.join(SCRIPT_NAME);
        std::fs::write(&script_path, script(&bundled(), "9.9.9").unwrap()).unwrap();
        let run = |token: &str| {
            std::process::Command::new("/bin/sh")
                .arg(&script_path)
                .arg("9001")
                .env("HOME", &home)
                .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
                .env("JACKALOPE_COMPUTER_TOKEN", token)
                .output()
                .unwrap()
        };
        assert!(!run("short").status.success());
        let secret = "s".repeat(40);
        let done = run(&secret);
        assert!(
            done.status.success(),
            "{}",
            String::from_utf8_lossy(&done.stderr)
        );
        let dir = home.join(".jackalope-computer");
        assert_eq!(
            std::fs::read(dir.join("agent.py")).unwrap(),
            std::fs::read(bundled().join("agent.py")).unwrap()
        );
        assert_eq!(std::fs::read_to_string(dir.join("token")).unwrap(), secret);
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.join("token"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
        let plist = std::fs::read_to_string(
            home.join("Library/LaunchAgents")
                .join(format!("{LAUNCH_AGENT}.plist")),
        )
        .unwrap();
        assert!(plist.contains("<string>9001</string>"));
        assert!(!plist.contains(&secret));
        let calls = std::fs::read_to_string(home.join("calls")).unwrap();
        assert!(calls.contains("launchctl bootstrap gui/"));
        assert!(calls.contains("http://127.0.0.1:9001/v1/health"));
        std::fs::remove_dir_all(&home).unwrap();
    }
}
