use super::{check_canceled, ProcessTree, Slot};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::{
    path::Path,
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

pub(in crate::commands::browser) struct BrowserProcess {
    child: Child,
    tree: Arc<ProcessTree>,
    pub endpoint: String,
    /// A persistent profile is closed through CDP first so Chromium writes its
    /// cookies and storage to disk before the process tree is ended.
    persistent: bool,
}

impl BrowserProcess {
    #[cfg(unix)]
    pub fn start(executable: &Path, directory: &Path, slot: &Slot) -> Result<Self, String> {
        Self::start_with_timeout(executable, directory, slot, super::COMMAND_TIMEOUT)
    }

    #[cfg(unix)]
    fn start_with_timeout(
        executable: &Path,
        directory: &Path,
        slot: &Slot,
        timeout: Duration,
    ) -> Result<Self, String> {
        let profile = directory.join("chromium");
        std::fs::create_dir(&profile).map_err(|e| e.to_string())?;
        Self::launch(executable, directory, &profile, slot, timeout, None)
    }

    /// Launches Chromium on a persistent user-data directory. `directory` is the
    /// session's private working folder; `start` is an optional first page.
    pub fn start_persistent(
        executable: &Path,
        directory: &Path,
        profile: &Path,
        slot: &Slot,
        start: Option<&str>,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(profile).map_err(|e| e.to_string())?;
        // A port file left by an earlier or crashed session would point at a dead browser.
        let _ = std::fs::remove_file(profile.join("DevToolsActivePort"));
        let mut owned = Self::launch(
            executable,
            directory,
            profile,
            slot,
            super::COMMAND_TIMEOUT,
            start,
        )
        .map_err(|error| {
            if error.contains("exited during startup") {
                "This browser profile is already open in another browser window. Close that window and try again.".to_string()
            } else {
                error
            }
        })?;
        owned.persistent = true;
        Ok(owned)
    }

    fn launch(
        executable: &Path,
        directory: &Path,
        profile: &Path,
        slot: &Slot,
        timeout: Duration,
        start: Option<&str>,
    ) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command.env_clear().current_dir(directory);
        #[cfg(unix)]
        command
            .env("HOME", directory)
            .env("XDG_CONFIG_HOME", directory.join("config"))
            .env("XDG_CACHE_HOME", directory.join("cache"));
        #[cfg(unix)]
        let keys = [
            "PATH",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
            "DBUS_SESSION_BUS_ADDRESS",
            "XAUTHORITY",
            "LANG",
            "LC_ALL",
            "TMPDIR",
        ];
        #[cfg(windows)]
        let keys = [
            "SystemRoot",
            "WINDIR",
            "PATH",
            "PATHEXT",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "LOCALAPPDATA",
            "APPDATA",
            "USERPROFILE",
            "TEMP",
            "TMP",
        ];
        for key in keys {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command
            .args([
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
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        command.process_group(0);
        if !slot.headed {
            command.arg("--headless=new");
        }
        command.arg(start.unwrap_or("about:blank"));
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
            persistent: false,
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
            if started.elapsed() >= timeout {
                return Err(
                    "Chromium did not become ready. Check its installation and retry.".into(),
                );
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(all(test, unix))]
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn terminate(&self) {
        self.tree.terminate();
    }

    /// Whether Chromium is still running, for a window the person may close.
    pub fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Asks Chromium to quit as if its last window closed, then waits briefly.
    fn close_gracefully(&mut self) {
        if !self.running() {
            return;
        }
        if super::super::cdp::call(
            &self.endpoint,
            "Browser.close",
            serde_json::json!({}),
            Duration::from_secs(5),
        )
        .is_err()
        {
            return;
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.running() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
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
        if self.persistent {
            self.close_gracefully();
        }
        self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    struct StartupFixture(std::path::PathBuf);

    impl StartupFixture {
        fn new(script: &str) -> Self {
            use std::os::unix::fs::PermissionsExt;

            let directory =
                std::env::temp_dir().join(format!("jl-chromium-startup-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&directory).unwrap();
            let executable = directory.join("browser");
            std::fs::write(&executable, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(executable, std::fs::Permissions::from_mode(0o700)).unwrap();
            Self(directory)
        }

        fn executable(&self) -> std::path::PathBuf {
            self.0.join("browser")
        }
    }

    impl Drop for StartupFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn startup_allows_cold_launch_beyond_fifteen_seconds() {
        let fixture = StartupFixture::new(
            "sleep 16\nprintf '4321\\n/devtools/browser/cold-start\\n' > chromium/DevToolsActivePort\nexec sleep 60",
        );
        let browser =
            BrowserProcess::start(&fixture.executable(), &fixture.0, &Slot::default()).unwrap();
        assert_eq!(
            browser.endpoint,
            "ws://127.0.0.1:4321/devtools/browser/cold-start"
        );
    }

    #[test]
    fn startup_timeout_remains_bounded() {
        let fixture = StartupFixture::new("exec sleep 60");
        let started = Instant::now();
        let result = BrowserProcess::start_with_timeout(
            &fixture.executable(),
            &fixture.0,
            &Slot::default(),
            Duration::from_millis(100),
        );
        assert!(result.err().unwrap().contains("did not become ready"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn startup_can_be_canceled_before_ready() {
        let fixture = StartupFixture::new("touch started\nexec sleep 60");
        let slot = Arc::new(Slot::default());
        std::thread::scope(|scope| {
            let startup =
                scope.spawn(|| BrowserProcess::start(&fixture.executable(), &fixture.0, &slot));
            let deadline = Instant::now() + Duration::from_secs(5);
            while !fixture.0.join("started").exists() {
                assert!(Instant::now() < deadline, "Browser fixture did not start");
                std::thread::sleep(Duration::from_millis(25));
            }
            let canceled = Instant::now();
            super::super::super::cancel(&slot);
            assert!(startup.join().unwrap().err().unwrap().contains("stopped"));
            assert!(canceled.elapsed() < Duration::from_secs(5));
        });
    }

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
