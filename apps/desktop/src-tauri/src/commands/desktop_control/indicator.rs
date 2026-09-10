use super::*;
#[cfg(windows)]
use std::process::Stdio;
use std::{path::PathBuf, process::Child};

static ACCENT: OnceLock<Mutex<String>> = OnceLock::new();

#[tauri::command]
pub fn desktop_control_theme(accent: String) -> Result<(), String> {
    if accent.len() != 7
        || !accent.starts_with('#')
        || !accent[1..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Expected a six-digit theme color.".into());
    }
    *ACCENT
        .get_or_init(|| Mutex::new("#6366f1".into()))
        .lock()
        .map_err(|e| e.to_string())? = accent;
    Ok(())
}

pub(super) struct Indicator {
    child: Child,
    tree: super::super::process_control::ProcessTree,
    directory: PathBuf,
}

pub(super) struct State {
    pub status: String,
    pub epoch: u64,
    pub reason: String,
}

fn read_state(path: &std::path::Path) -> Result<State, String> {
    for attempt in 0..4 {
        match std::fs::read_to_string(path) {
            Ok(text) => return parse_state(&text, chrono::Utc::now().timestamp_millis()),
            Err(_) if attempt < 3 => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => return Err("Desktop indicator is not ready.".into()),
        }
    }
    unreachable!()
}

pub(super) fn parse_state(text: &str, now: i64) -> Result<State, String> {
    let fields: Vec<_> = text.split('|').collect();
    if fields.len() != 6 {
        return Err("Desktop indicator is unavailable.".into());
    }
    let checked = fields[2]
        .parse::<i64>()
        .map_err(|_| "Invalid indicator heartbeat.")?;
    if now < checked || now - checked > 3000 {
        return Err(
            "Desktop indicator stopped responding. Release access and request it again.".into(),
        );
    }
    if !["active", "paused", "canceled"].contains(&fields[0]) {
        return Err("Desktop indicator is starting.".into());
    }
    Ok(State {
        status: fields[0].into(),
        reason: fields[5].into(),
        epoch: fields[1].parse().map_err(|_| "Invalid desktop epoch.")?,
    })
}

impl Indicator {
    #[cfg(windows)]
    pub fn start(window: &Window) -> Result<Self, String> {
        let directory =
            std::env::temp_dir().join(format!("jackalope-window-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        let accent = ACCENT
            .get_or_init(|| Mutex::new("#6366f1".into()))
            .lock()
            .unwrap()
            .clone();
        std::fs::write(directory.join("theme"), accent).map_err(|e| e.to_string())?;
        std::fs::write(
            directory.join("logo.png"),
            include_bytes!("../../../icons/32x32.png"),
        )
        .map_err(|e| e.to_string())?;
        let script=format!("$ErrorActionPreference='Stop'\nAdd-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition @'\n{}\n'@\n$r=$env:JACKALOPE_DESKTOP_REQUEST | ConvertFrom-Json\n[JackalopeWindowIndicator]::Run([long]$r.window.handle,[int]$r.window.pid,[string]$r.window.started,[string]$r.file,[string]$r.theme,[string]$r.logo)",include_str!("indicator.cs"));
        let errors =
            std::fs::File::create(directory.join("error.log")).map_err(|e| e.to_string())?;
        let mut command = super::native_command(
            &script,
            json!({"window":window,"file":directory.join("state"),"theme":directory.join("theme"),"logo":directory.join("logo.png")}),
        )?;
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(errors);
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let tree = match super::super::process_control::ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let mut result = Self {
            child,
            tree,
            directory,
        };
        for _ in 0..100 {
            if result
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Err(format!(
                    "Desktop indicator could not start: {}",
                    std::fs::read_to_string(result.directory.join("error.log"))
                        .unwrap_or_default()
                        .chars()
                        .take(1200)
                        .collect::<String>()
                ));
            }
            if result.state().is_ok() {
                return Ok(result);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Desktop indicator did not become ready. No input was enabled.".into())
    }

    #[cfg(not(windows))]
    pub fn start(_: &Window) -> Result<Self, String> {
        Err("Desktop indicator requires Windows.".into())
    }

    pub fn state(&mut self) -> Result<State, String> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err(
                "Desktop control canceled or indicator closed. Request access again.".into(),
            );
        }
        read_state(&self.directory.join("state"))
    }

    pub fn guard(&self, epoch: u64) -> Value {
        json!({"file":self.directory.join("state"),"epoch":epoch})
    }

    pub fn watch(&self, session: &Arc<Session>, runtime: TaskRuntime, id: String) {
        let weak = Arc::downgrade(session);
        let state_file = self.directory.join("state");
        let theme_file = self.directory.join("theme");
        std::thread::spawn(move || {
            let mut prior_color = String::new();
            loop {
                std::thread::sleep(Duration::from_millis(100));
                let Some(session) = weak.upgrade() else {
                    break;
                };
                if session.canceled.load(Ordering::SeqCst) {
                    break;
                }
                let active = read_state(&state_file)
                    .ok()
                    .is_some_and(|state| state.status != "canceled");
                if !active {
                    close(&id);
                    let _ = runtime.update_checked(&id, |run|run.activity.push("Desktop access ended: Escape was pressed or the window indicator closed. A new window grant is required.".into()));
                    break;
                }
                let color = ACCENT.get().unwrap().lock().unwrap().clone();
                if color != prior_color {
                    if std::fs::write(&theme_file, &color).is_ok() {
                        prior_color = color;
                    }
                }
            }
        });
    }
}

impl Drop for Indicator {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indicator_fails_closed_on_missing_stale_or_invalid_state() {
        assert!(parse_state("active|4|1000|1|2|", 4001).is_err());
        assert!(parse_state("active|4|1000|1|2|", 999).is_err());
        assert!(parse_state("active", 1000).is_err());
        assert!(parse_state("unknown|4|1000|1|2|", 1000).is_err());
        let paused = parse_state("paused|5|1000|1|2|Mouse activity", 1100).unwrap();
        assert_eq!(paused.status, "paused");
        assert_eq!(paused.epoch, 5);
        assert_eq!(paused.reason, "Mouse activity");
    }
}
