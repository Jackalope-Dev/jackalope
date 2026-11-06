//! The control plane's side of a runner's callbacks.
//!
//! A computer's runner (`resources/computer/agent.py`) asks this device before
//! anything a person or project rule governs, through `POST /v1/policy` over
//! the bridge relay, and reports what its workspace tools did through
//! `POST /v1/runner/event`. Decisions reuse this device's own logic: tools go
//! through the permission prompt's rules, auto-approval and question
//! (`coordination_mcp::approve_computer_tool`), websites through the
//! computer's per-site questions and saved decisions ([`super::browser`]),
//! and secrets through the project's secrets available to computers. Every
//! answer is `{"behavior":"allow"}` or `{"behavior":"deny","message":…}`; the
//! runner treats anything else, including no answer, as a denial.

use crate::commands::{
    coordination::Coordinator,
    harness::ScreenshotArtifact,
    tasks::{events::activity, TaskRun, TaskRuntime},
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

/// What a runner may ask about.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Kind {
    /// Running a gated tool, as Claude Code's permission prompt would ask.
    Tool,
    /// Reading or acting on a website in the computer's browser.
    Site,
    /// Using a project secret by name.
    Secret,
}

impl Kind {
    pub fn parse(body: &Value) -> Result<Self, String> {
        match body["kind"].as_str() {
            Some("tool") => Ok(Self::Tool),
            Some("site") => Ok(Self::Site),
            Some("secret") => Ok(Self::Secret),
            _ => Err("Ask about a tool, site or secret.".into()),
        }
    }
}

pub(crate) fn allow() -> Value {
    json!({"behavior": "allow"})
}

pub(crate) fn deny(message: impl Into<String>) -> Value {
    json!({"behavior": "deny", "message": message.into()})
}

/// Answers one policy callback from the runner of `run`'s computer.
pub(crate) async fn decide(
    service: &Coordinator,
    run: &TaskRun,
    body: Value,
) -> Result<Value, String> {
    if run.remote.is_none() {
        return Err("Only an agent on a computer asks Jackalope this way.".into());
    }
    match Kind::parse(&body)? {
        Kind::Tool => {
            crate::commands::coordination_mcp::approve_computer_tool(service, run, body).await
        }
        Kind::Site => {
            let url = body["url"].as_str().unwrap_or_default();
            if url.is_empty() || url.len() > 8000 {
                return Err("Name the website's address.".into());
            }
            let runtime = service.runtime.clone();
            let (run_id, url, login) = (run.id.clone(), url.to_string(), body["login"] == true);
            tauri::async_runtime::spawn_blocking(move || {
                super::browser::site_policy(&runtime, &run_id, &url, login)
            })
            .await
            .map_err(|error| error.to_string())
        }
        Kind::Secret => Ok(secret(
            &service.runtime.project_secrets_root(),
            &run.project_id,
            body["name"].as_str().unwrap_or_default(),
        )),
    }
}

/// A project secret is allowed when it exists and is available to agents on
/// computers. Its value never travels in the answer.
fn secret(root: &std::path::Path, project_id: &str, name: &str) -> Value {
    if name.is_empty() || name.len() > 128 {
        return deny("Name the project secret.");
    }
    match crate::commands::project_secrets::environment(
        root,
        project_id,
        crate::commands::project_secrets::Place::Computer,
    ) {
        Ok(secrets) if secrets.iter().any(|(saved, _)| saved == name) => allow(),
        Ok(_) => deny(format!(
            "{name} is not a project secret available to agents on computers. Ask the person to add it in Project settings."
        )),
        Err(error) => deny(format!("Project secrets could not be read: {error}")),
    }
}

type Pending = Mutex<HashMap<String, Vec<ScreenshotArtifact>>>;
static SCREENSHOTS: OnceLock<Pending> = OnceLock::new();

fn pending() -> std::sync::MutexGuard<'static, HashMap<String, Vec<ScreenshotArtifact>>> {
    SCREENSHOTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Screenshots a run's runner reported, for when its changes come back.
pub(crate) fn take_screenshots(run_id: &str) -> Vec<ScreenshotArtifact> {
    pending().remove(run_id).unwrap_or_default()
}

/// Untrusted text from the computer, made fit for one activity line.
fn short(value: &Value, limit: usize) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}

/// Records what one workspace tool did on the computer in the attempt.
pub(crate) fn record_event(runtime: &TaskRuntime, run: &TaskRun, event: &Value) -> Result<(), String> {
    let computer = run
        .remote
        .as_ref()
        .map(|remote| remote.computer_name.clone())
        .ok_or("Only an agent on a computer reports runner events.")?;
    match event["tool"].as_str().unwrap_or_default() {
        "computer_verify" => {
            let check = &event["check"];
            let outcome = if check["reused"] == true {
                "reused an unchanged passing result".to_string()
            } else if check["success"] == true {
                "passed".to_string()
            } else if check["timedOut"] == true {
                "timed out".to_string()
            } else {
                match check["exitCode"].as_i64() {
                    Some(code) => format!("failed with exit code {code}"),
                    None => "failed".to_string(),
                }
            };
            runtime.update(&run.id, |run| {
                activity(run, &format!("Ran the saved check on {computer}: {outcome}."))
            });
        }
        "browser_navigate" => {
            let url = short(&event["url"], 2000);
            runtime.update(&run.id, |run| {
                crate::commands::previews::review::record_visit(run, &url)
            });
        }
        "browser_screenshot" => {
            let shot = &event["screenshot"];
            let artifact = ScreenshotArtifact {
                id: short(&shot["id"], 64),
                name: short(&shot["name"], 160),
                url: short(&shot["url"], 2000),
                file_path: String::new(),
                width: shot["width"].as_u64().unwrap_or(0) as u32,
                height: shot["height"].as_u64().unwrap_or(0) as u32,
                timestamp: short(&shot["timestamp"], 64),
            };
            if uuid::Uuid::parse_str(&artifact.id).is_err() {
                return Err("Report a screenshot by its id.".into());
            }
            runtime.update(&run.id, |run| {
                activity(
                    run,
                    &format!(
                        "Captured browser screenshot on {computer}: {}. It comes back with the agent's changes.",
                        artifact.name
                    ),
                )
            });
            let mut pending = pending();
            let shots = pending.entry(run.id.clone()).or_default();
            if shots.len() < 200 {
                shots.push(artifact);
            }
        }
        "browser_interact" => {
            let summary = short(&event["summary"], 300);
            runtime.update(&run.id, |run| {
                activity(run, &format!("Browser interaction on {computer}: {summary}"))
            });
        }
        "browser_tabs" => runtime.update(&run.id, |run| {
            activity(run, &format!("Updated task browser tabs on {computer}"))
        }),
        "browser_inspect" => {
            let audit = &event["audit"];
            let value = json!({
                "content": short(&audit["content"], 16000),
                "truncated": audit["truncated"] == true,
                "audit": {
                    "engine": audit["engine"],
                    "counts": audit["counts"],
                    "scope": audit["scope"],
                },
            });
            if let Some(step) = crate::commands::browser::accessibility_checkpoint(&value) {
                runtime.update(&run.id, |run| run.validation_steps.push(step));
            }
        }
        _ => return Err("Unknown runner event.".into()),
    }
    Ok(())
}

/// New screenshots in a patch brought back from the computer: files added
/// under `.jackalope/artifacts/screenshots`.
pub(crate) fn patch_screenshots(patch: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(patch);
    let mut found = Vec::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        if let Some(header) = line.strip_prefix("diff --git a/") {
            current = header
                .split_once(" b/")
                .map(|(path, _)| path.to_string())
                .filter(|path| {
                    path.starts_with(".jackalope/artifacts/screenshots/")
                        && path.ends_with(".png")
                        && !path.contains("..")
                        && path.matches('/').count() == 3
                });
        } else if line.starts_with("new file mode") {
            if let Some(path) = current.take() {
                found.push(path);
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_kinds_are_explicit() {
        assert_eq!(Kind::parse(&json!({"kind":"tool"})).unwrap(), Kind::Tool);
        assert_eq!(Kind::parse(&json!({"kind":"site"})).unwrap(), Kind::Site);
        assert_eq!(Kind::parse(&json!({"kind":"secret"})).unwrap(), Kind::Secret);
        for body in [json!({}), json!({"kind":"everything"}), json!({"kind":1})] {
            assert!(Kind::parse(&body).is_err(), "{body}");
        }
        assert_eq!(allow()["behavior"], "allow");
        assert_eq!(deny("No.")["behavior"], "deny");
        assert_eq!(deny("No.")["message"], "No.");
    }

    #[test]
    fn secrets_are_allowed_only_when_available_to_computers() {
        let root = std::env::temp_dir().join(format!("jackalope-policy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        // No secrets at all: denied, and the answer never carries a value.
        let answer = secret(&root, "project-1", "API_KEY");
        assert_eq!(answer["behavior"], "deny");
        assert!(answer["message"].as_str().unwrap().contains("API_KEY"));
        assert_eq!(secret(&root, "project-1", "")["behavior"], "deny");
        assert_eq!(secret(&root, "", "API_KEY")["behavior"], "deny");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn screenshots_are_found_among_new_files_of_a_patch() {
        let patch = b"diff --git a/.jackalope/artifacts/screenshots/0f8fad5b-d9cb-469f-a165-70867728950e.png b/.jackalope/artifacts/screenshots/0f8fad5b-d9cb-469f-a165-70867728950e.png\nnew file mode 100644\nindex 0000000..1111111\nGIT binary patch\nliteral 3\nabc\n\ndiff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\ndiff --git a/.jackalope/artifacts/screenshots/old.png b/.jackalope/artifacts/screenshots/old.png\ndeleted file mode 100644\ndiff --git a/.jackalope/artifacts/screenshots/deep/x.png b/.jackalope/artifacts/screenshots/deep/x.png\nnew file mode 100644\n";
        assert_eq!(
            patch_screenshots(patch),
            [".jackalope/artifacts/screenshots/0f8fad5b-d9cb-469f-a165-70867728950e.png"]
        );
        assert!(patch_screenshots(b"").is_empty());
    }

    #[test]
    fn untrusted_event_text_is_bounded_and_plain() {
        assert_eq!(short(&json!("a\nb\u{7}c"), 10), "abc");
        assert_eq!(short(&json!("x".repeat(500)), 300).len(), 300);
        assert_eq!(short(&json!(5), 10), "");
    }
}
