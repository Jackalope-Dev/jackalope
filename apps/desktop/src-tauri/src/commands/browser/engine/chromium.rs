use super::{check_canceled, ProcessTree, Slot};
use std::{
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

pub(super) struct BrowserProcess {
    child: Child,
    tree: Arc<ProcessTree>,
    pub endpoint: String,
}

impl BrowserProcess {
    pub fn start(executable: &Path, directory: &Path, slot: &Slot) -> Result<Self, String> {
        let profile = directory.join("chromium");
        std::fs::create_dir(&profile).map_err(|e| e.to_string())?;
        let mut command = Command::new(executable);
        command
            .env_clear()
            .current_dir(directory)
            .env("HOME", directory)
            .env("XDG_CONFIG_HOME", directory.join("config"))
            .env("XDG_CACHE_HOME", directory.join("cache"));
        for key in [
            "PATH",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
            "DBUS_SESSION_BUS_ADDRESS",
            "XAUTHORITY",
            "LANG",
            "LC_ALL",
            "TMPDIR",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command
            .args([
                "--headless=new",
                "--remote-debugging-port=0",
                "--remote-debugging-address=127.0.0.1",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-sync",
                "--disable-breakpad",
                "--disable-crash-reporter",
                "--password-store=basic",
                "--use-mock-keychain",
            ])
            .arg(format!("--user-data-dir={}", profile.display()))
            .arg("about:blank")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not start Chromium: {e}"))?;
        let tree = match ProcessTree::attach(&child) {
            Ok(tree) => Arc::new(tree),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let mut owned = Self {
            child,
            tree,
            endpoint: String::new(),
        };
        slot.trees
            .lock()
            .map_err(|e| e.to_string())?
            .push(owned.tree.clone());
        let started = Instant::now();
        loop {
            check_canceled(&slot.canceled)?;
            if owned.child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err("Chromium exited during startup. Check its installation and system dependencies.".into());
            }
            if let Ok(bytes) =
                crate::commands::history::read_bounded(&profile.join("DevToolsActivePort"), 4096)
            {
                if let Some(endpoint) = endpoint(&bytes) {
                    owned.endpoint = endpoint;
                    return Ok(owned);
                }
            }
            if started.elapsed() > Duration::from_secs(15) {
                return Err(
                    "Chromium did not become ready. Check its installation and retry.".into(),
                );
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(test)]
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn terminate(&self) {
        self.tree.terminate();
    }
}

fn endpoint(bytes: &[u8]) -> Option<String> {
    let mut lines = std::str::from_utf8(bytes).ok()?.lines();
    let port = lines
        .next()?
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)?;
    let path = lines.next()?;
    let id = path.strip_prefix("/devtools/browser/")?;
    if id.is_empty()
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return None;
    }
    Some(format!("ws://127.0.0.1:{port}{path}"))
}

impl Drop for BrowserProcess {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_requires_a_local_port_and_browser_path() {
        assert_eq!(
            endpoint(b"4321\n/devtools/browser/a-b\n").as_deref(),
            Some("ws://127.0.0.1:4321/devtools/browser/a-b")
        );
        for invalid in [
            "0\n/devtools/browser/a",
            "65536\n/devtools/browser/a",
            "4321\nhttps://example.com",
            "4321\n/devtools/browser/",
            "4321\n/devtools/browser/a?other",
        ] {
            assert!(endpoint(invalid.as_bytes()).is_none());
        }
    }
}
