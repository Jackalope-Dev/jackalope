//! `desktop_control` on a run's bot computer. The computer is the bot's (or
//! the task's approved) own machine, so the whole screen is in scope without
//! an access question, an indicator or a lease on the person's desktop.
//! Snapshot IDs, element refs, key validation, the action log and per-site
//! questions for the computer's browser work as on the person's desktop.

use super::{actions, elements, summarize, DesktopActionRecord, DesktopRequest, ACTION_LOG_LIMIT};
use crate::commands::{
    computers::{self, Computer},
    harness::{PendingUserPrompt, QuestionPresentation, ScreenshotArtifact},
    tasks::{TaskRun, TaskRuntime},
};
use base64::Engine as _;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(30);

struct Shot {
    id: String,
    bounds: Value,
    refs: elements::RefTable,
    taken: Instant,
}

#[derive(Default)]
struct Session {
    snapshot: Option<Shot>,
    allowed: HashSet<String>,
    denied: HashSet<String>,
    site_prompt: Option<(String, String)>,
    site: Option<String>,
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<Mutex<Session>>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Mutex<Session>>>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

pub fn close(run_id: &str) {
    if let Ok(mut map) = sessions().lock() {
        map.remove(run_id);
    }
}

fn session(run_id: &str) -> Result<Arc<Mutex<Session>>, String> {
    Ok(sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .entry(run_id.into())
        .or_default()
        .clone())
}

/// The host a computer's site decisions use, if the snapshot names a page.
fn host_of(value: &Value) -> Option<String> {
    value["site"]["url"]
        .as_str()
        .and_then(super::grant::site_host)
}

fn site_options(host: &str, owner: &str) -> Vec<(String, (bool, bool))> {
    vec![
        (format!("Allow {host} for this task"), (true, false)),
        (format!("Always allow {host} for {owner}"), (true, true)),
        (format!("Not {host}"), (false, false)),
        (format!("Never allow {host} for {owner}"), (false, true)),
    ]
}

struct Call<'a> {
    runtime: &'a TaskRuntime,
    run: &'a TaskRun,
    computer: &'a Computer,
    root: PathBuf,
    state: &'a mut Session,
}

impl Call<'_> {
    fn agent(&self, payload: Value) -> Result<Value, String> {
        computers::call(
            &self.root,
            self.computer,
            payload,
            TIMEOUT,
            &AtomicBool::new(false),
        )
    }

    fn store(&self) -> PathBuf {
        super::grant::store_path(&self.runtime.preferences_directory())
    }

    fn record(&self, record: DesktopActionRecord) -> Result<(), String> {
        let line = format!("{}: {}", self.computer.name, record.summary);
        self.runtime.update_checked(&self.run.id, |r| {
            r.activity.push(line.clone());
            r.desktop_actions.push(record.clone());
            let excess = r.desktop_actions.len().saturating_sub(ACTION_LOG_LIMIT);
            r.desktop_actions.drain(..excess);
        })
    }

    /// Saves a capture into the task's evidence folder.
    fn artifact(&self, value: &mut Value, name: &str) -> Result<ScreenshotArtifact, String> {
        let png = value
            .as_object_mut()
            .and_then(|fields| fields.remove("png"))
            .and_then(|png| png.as_str().map(str::to_owned))
            .ok_or("The computer returned no capture.")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png)
            .map_err(|_| "The computer returned an invalid capture.")?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("The capture exceeds the 8 MiB preview limit.".into());
        }
        let (width, height) = crate::commands::harness::png_dimensions(&bytes)?;
        let id = uuid::Uuid::new_v4().to_string();
        let directory =
            std::path::Path::new(&self.run.workspace).join(".jackalope/artifacts/screenshots");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let file = directory.join(format!("{id}.png"));
        std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
        Ok(ScreenshotArtifact {
            id,
            name: name.into(),
            url: "computer://screen".into(),
            file_path: file.to_string_lossy().into_owned(),
            width,
            height,
            timestamp: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn ask_site(&mut self, host: &str) -> Result<Value, String> {
        let owner = self.computer.name.clone();
        let prompt = PendingUserPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: self.run.id.clone(),
            question: format!("The agent reached {host} in the browser of {owner}. Allow it to read and act on this site there?"),
            input_type: "choice".into(),
            options: site_options(host, &owner).into_iter().map(|(label, _)| label).collect(),
            default_value: None,
            status: "pending".into(),
            answer: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            answered_at: None,
            presentation: QuestionPresentation {
                header: Some("Website access".into()),
                allow_other: Some(false),
                ..Default::default()
            },
        };
        let mut pushed = false;
        self.runtime.update_checked(&self.run.id, |r| {
            if ["starting", "running"].contains(&r.status.as_str()) {
                r.prompts.push(prompt.clone());
                pushed = true;
            }
        })?;
        if !pushed {
            return Err("This attempt has ended.".into());
        }
        self.state.site_prompt = Some((prompt.id.clone(), host.into()));
        self.state.snapshot = None;
        Ok(
            json!({"status":"pending","questionId":prompt.id,"site":host,
            "instruction":"The person is deciding whether you may use this site. Wait, then take a new snapshot."}),
        )
    }

    /// Settles an open website question. Returns a pending response while open.
    fn site_answer(&mut self) -> Result<Option<Value>, String> {
        let Some((prompt_id, host)) = self.state.site_prompt.clone() else {
            return Ok(None);
        };
        let fresh = self
            .runtime
            .run_snapshot(&self.run.id)
            .ok_or("This attempt has ended.")?;
        let prompt = fresh
            .prompts
            .iter()
            .find(|prompt| prompt.id == prompt_id)
            .ok_or("The website question is no longer available.")?;
        if prompt.status == "pending" {
            return Ok(Some(
                json!({"status":"pending","questionId":prompt_id,"site":host}),
            ));
        }
        self.state.site_prompt = None;
        let answer = prompt.answer.clone().unwrap_or_default();
        let (allow, remember) = site_options(&host, &self.computer.name)
            .into_iter()
            .find(|(label, _)| *label == answer)
            .map_or((false, false), |(_, choice)| choice);
        if remember {
            super::grant::decide_site(&self.store(), &self.computer.decisions, &host, allow)?;
        }
        if allow {
            self.state.allowed.insert(host);
            Ok(None)
        } else {
            self.state.denied.insert(host.clone());
            Err(format!("The person declined {host}. Do not use this site."))
        }
    }

    /// Gates the page's site; Some(pending) withholds content until answered.
    fn gate(&mut self, value: &Value) -> Result<Option<Value>, String> {
        let Some(host) = host_of(value) else {
            return Ok(None);
        };
        self.state.site = Some(host.clone());
        if matches!(host.as_str(), "localhost" | "127.0.0.1") || self.state.allowed.contains(&host)
        {
            return Ok(None);
        }
        if self.state.denied.contains(&host) {
            return Err(format!(
                "The person declined {host} for this task. Navigate elsewhere only if they ask."
            ));
        }
        let decisions = super::grant::sites(&self.store(), &self.computer.decisions);
        match super::grant::site_decision(&decisions, &host) {
            Some(true) => {
                self.state.allowed.insert(host);
                Ok(None)
            }
            Some(false) => {
                self.state.denied.insert(host.clone());
                Err(format!(
                    "{host} is blocked for {} in its settings.",
                    self.computer.name
                ))
            }
            None => self.ask_site(&host).map(Some),
        }
    }

    fn observe(&mut self, request: &DesktopRequest) -> Result<Value, String> {
        let deadline = Instant::now() + Duration::from_millis(request.timeout_ms.unwrap_or(5000));
        loop {
            let action = if request.action == "screenshot" {
                "screenshot"
            } else {
                "snapshot"
            };
            let mut value = self.agent(json!({"action": action}))?;
            let artifact = if action == "screenshot" {
                Some(self.artifact(&mut value, &format!("{} screen", self.computer.name))?)
            } else {
                None
            };
            if let Some(pending) = self.gate(&value)? {
                return Ok(pending);
            }
            let refs = elements::normalize(&mut value);
            if let Some(artifact) = artifact {
                self.runtime
                    .update_checked(&self.run.id, |r| r.screenshots.push(artifact.clone()))?;
                value["artifact"] = json!(artifact);
            }
            if request.action == "wait_for" {
                let text = request.text.clone().unwrap_or_default();
                match elements::RefTable::find_text(&value, &text) {
                    Some(found) => value["found"] = found,
                    None if Instant::now() >= deadline => {
                        return Err(format!("\u{201c}{text}\u{201d} did not appear before the timeout. Take a snapshot to inspect the screen."));
                    }
                    None => {
                        std::thread::sleep(Duration::from_millis(250));
                        continue;
                    }
                }
            }
            let id = uuid::Uuid::new_v4().to_string();
            self.state.snapshot = Some(Shot {
                id: id.clone(),
                bounds: value["bounds"].clone(),
                refs,
                taken: Instant::now(),
            });
            value["snapshotId"] = json!(id);
            value["untrustedContent"] = json!(true);
            self.record(DesktopActionRecord {
                at: chrono::Utc::now().to_rfc3339(),
                action: request.action.clone(),
                summary: summarize(request, None),
                site: self.state.site.clone(),
                capture: serde_json::from_value(value["artifact"].clone()).ok(),
                ..Default::default()
            })?;
            return Ok(value);
        }
    }

    fn input(&mut self, request: &DesktopRequest) -> Result<Value, String> {
        let shot = self
            .state
            .snapshot
            .take()
            .ok_or("Take a fresh snapshot or screenshot before input.")?;
        if Some(shot.id.as_str()) != request.snapshot_id.as_deref()
            || shot.taken.elapsed() > Duration::from_secs(60)
        {
            return Err("The snapshot is stale. Take a new snapshot before input.".into());
        }
        let mut action = match request.action.as_str() {
            "invoke" | "focus" => "click".to_string(),
            "select" => return Err(
                "select is not available on a bot computer. Click the list, then click the option."
                    .into(),
            ),
            other => other.to_string(),
        };
        let mut payload = json!({"action": action, "text": request.text, "wheel": request.wheel,
            "x": request.x, "y": request.y, "to_x": request.to_x, "to_y": request.to_y});
        let area = elements::area(&shot.bounds);
        let mut target = None;
        for (reference, x, y) in [
            (&request.element, "x", "y"),
            (&request.to_element, "to_x", "to_y"),
        ] {
            let Some(reference) = reference else { continue };
            let element = shot.refs.resolve(reference)?;
            if x == "x" {
                target = Some(format!(
                    "{reference} \u{201c}{}\u{201d}",
                    element.name.chars().take(60).collect::<String>()
                ));
            }
            let (cx, cy) = shot.refs.center(reference, area)?;
            payload[x] = json!(cx);
            payload[y] = json!(cy);
        }
        if let Some(key) = &request.key {
            let chord = actions::chord(key)?;
            payload["chord"] = json!({"modifiers": chord.modifiers, "key": chord.key});
        }
        if action == "type" && request.element.is_none() {
            payload["x"] = Value::Null;
            payload["y"] = Value::Null;
        }
        let mut value = self.agent(payload)?;
        let summary = summarize(request, target.as_deref());
        std::thread::sleep(Duration::from_millis(120));
        let capture = self
            .agent(json!({"action":"screenshot","thumb":480}))
            .ok()
            .and_then(|mut after| self.artifact(&mut after, &format!("After {summary}")).ok());
        if let Some(host) = &self.state.site {
            value["site"] = json!({"host": host});
        }
        action = request.action.clone();
        self.record(DesktopActionRecord {
            at: chrono::Utc::now().to_rfc3339(),
            action,
            summary,
            method: Some("pointer or keyboard".into()),
            focus_changed: false,
            site: self.state.site.clone(),
            capture,
        })?;
        Ok(value)
    }

    fn dispatch(&mut self, request: &DesktopRequest) -> Result<Value, String> {
        let action = request.action.as_str();
        if actions::OBSERVE.contains(&action) {
            return self.observe(request);
        }
        if actions::is_input(request) {
            return self.input(request);
        }
        self.state.snapshot = None;
        let (value, summary) = match action {
            "list_windows" => {
                let value = self.agent(json!({"action":"list"}))?;
                let windows: Vec<Value> = value["windows"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|w| json!({"window": w["handle"], "title": w["title"], "app": w["appName"]}))
                    .collect();
                (
                    json!({"windows": windows, "monitors": value["monitors"], "untrustedContent": true}),
                    None,
                )
            }
            "switch_window" => {
                let handle = request.window.clone().unwrap_or_default();
                let value = self.agent(json!({"action":"focus","window":{"handle": handle}}))?;
                (value, Some(format!("switched to window {handle}")))
            }
            "open_app" => {
                let app = request.app.clone().ok_or("Name the app to open.")?;
                let app = app.trim().to_lowercase().replace(' ', "-");
                self.agent(json!({"action":"open_app","app": app}))?;
                (
                    json!({"status":"opened","instruction":"Take a screenshot or snapshot to see the new window."}),
                    Some(format!("opened {app}")),
                )
            }
            "clipboard_read" => {
                let mut value = self.agent(json!({"action":"clipboard_read"}))?;
                value["untrustedContent"] = json!(true);
                (value, Some("read the clipboard".into()))
            }
            "clipboard_write" => {
                let value = self.agent(json!({"action":"clipboard_write","text":request.text}))?;
                (value, Some("replaced the clipboard".into()))
            }
            "focus" => (json!({"status":"focused"}), None),
            _ => return Err("Unsupported desktop action.".into()),
        };
        if let Some(summary) = summary {
            self.record(DesktopActionRecord {
                at: chrono::Utc::now().to_rfc3339(),
                action: action.into(),
                summary,
                ..Default::default()
            })?;
        }
        Ok(value)
    }
}

/// Runs a desktop action on the run's computer.
pub async fn execute(
    runtime: TaskRuntime,
    run: TaskRun,
    request: DesktopRequest,
    computer: Computer,
) -> Result<Value, String> {
    if request.action == "release" {
        close(&run.id);
        return Ok(
            json!({"status":"released","instruction":"The computer keeps running; it belongs to the bot."}),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = runtime.computers_root();
        computers::ready(&root, &computer)?;
        if request.action == "request_access" {
            return Ok(json!({"status":"active","scope":"desktop","granted":format!("the whole screen of {}", computer.name),
                "instruction":"This is the bot's own computer, not the person's desktop. Take a snapshot or screenshot, then act by ref or coordinates. Each input consumes the latest snapshotId."}));
        }
        let owned = session(&run.id)?;
        let mut state = owned
            .try_lock()
            .map_err(|_| "A computer action is already in progress. Wait for it to finish.")?;
        let mut call = Call {
            runtime: &runtime,
            run: &run,
            computer: &computer,
            root,
            state: &mut state,
        };
        if let Some(pending) = call.site_answer()? {
            return Ok(pending);
        }
        call.dispatch(&request)
    })
    .await
    .map_err(|e| e.to_string())?
}
