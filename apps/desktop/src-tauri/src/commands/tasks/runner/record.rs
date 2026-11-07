//! What an attempt's workspace tools did, recorded the same way whichever
//! runner ran them.
//!
//! The bridge's browser handlers report through [`record`] for an agent on
//! this device, and a computer's runner reports through
//! `POST /v1/runner/event` ([`crate::commands::computers::policy::record_event`]),
//! which parses its event into the same [`ToolEvent`]. The attempt's activity
//! names the computer when the tool ran on one, and a screenshot taken there
//! is listed with the attempt only once it arrives with the agent's changes
//! ([`register_screenshots`]).

use super::super::{events::activity, TaskRun, TaskRuntime};
use crate::commands::harness::ScreenshotArtifact;
use chrono::Utc;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Mutex, OnceLock},
};

/// One thing a workspace tool did.
#[derive(Clone, Debug)]
pub(in crate::commands) enum ToolEvent {
    /// The task browser opened a page.
    Visited(String),
    /// A browser capture, saved in the workspace where the tool ran.
    Screenshot(ScreenshotArtifact),
    /// A browser interaction. `label` keeps each bridge route's wording.
    Interaction {
        label: &'static str,
        summary: String,
    },
    /// The task browser's tabs changed.
    Tabs,
    /// An inspection, which adds an accessibility validation step when it
    /// audited the page.
    Inspected(Value),
    /// The saved check ran in a computer's workspace. On this device the
    /// check records its own result (see `verification`).
    Checked(String),
}

/// Where a tool ran: `None` on this device, or the computer's name.
pub(in crate::commands) type Host<'a> = Option<&'a str>;

/// Records `event` in the attempt.
pub(in crate::commands) fn record(
    runtime: &TaskRuntime,
    run_id: &str,
    host: Host,
    event: ToolEvent,
) {
    match event {
        ToolEvent::Visited(url) => runtime.update(run_id, |run| {
            crate::commands::previews::review::record_visit(run, &url)
        }),
        ToolEvent::Screenshot(artifact) => match host {
            None => runtime.update(run_id, |run| {
                run.screenshots.push(artifact.clone());
                run.activity
                    .push(format!("Captured browser screenshot: {}", artifact.name));
            }),
            Some(computer) => {
                runtime.update(run_id, |run| {
                    activity(
                        run,
                        &format!(
                            "Captured browser screenshot on {computer}: {}. It comes back with the agent's changes.",
                            artifact.name
                        ),
                    )
                });
                let mut pending = pending();
                let shots = pending.entry(run_id.to_string()).or_default();
                if shots.len() < 200 {
                    shots.push(artifact);
                }
            }
        },
        ToolEvent::Interaction { label, summary } => runtime.update(run_id, |run| match host {
            None => run.activity.push(format!("{label}: {summary}")),
            Some(computer) => activity(run, &format!("{label} on {computer}: {summary}")),
        }),
        ToolEvent::Tabs => runtime.update(run_id, |run| match host {
            None => run.activity.push("Updated task browser tabs".into()),
            Some(computer) => activity(run, &format!("Updated task browser tabs on {computer}")),
        }),
        ToolEvent::Inspected(value) => {
            if let Some(step) = crate::commands::browser::accessibility_checkpoint(&value) {
                runtime.update(run_id, |run| run.validation_steps.push(step));
            }
        }
        ToolEvent::Checked(outcome) => runtime.update(run_id, |run| {
            activity(
                run,
                &match host {
                    None => format!("Ran the saved check: {outcome}."),
                    Some(computer) => format!("Ran the saved check on {computer}: {outcome}."),
                },
            )
        }),
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

/// Forgets captures a computer reported for an attempt, returning them.
pub(in crate::commands::tasks) fn take_screenshots(run_id: &str) -> Vec<ScreenshotArtifact> {
    pending().remove(run_id).unwrap_or_default()
}

/// Lists captures a computer took with the attempt, now that they are in this
/// device's workspace at `shots` (workspace-relative paths). Names and
/// addresses come from the runner's events; a capture whose event was lost
/// is listed as a browser capture.
pub(in crate::commands::tasks) fn register_screenshots(
    runtime: &TaskRuntime,
    id: &str,
    workspace: &str,
    shots: Vec<String>,
) {
    let mut reported = take_screenshots(id);
    for relative in shots {
        let path = Path::new(workspace).join(&relative);
        let Ok(bytes) = crate::commands::history::read_bounded(&path, 8 * 1024 * 1024) else {
            continue;
        };
        let Ok((width, height)) = crate::commands::harness::png_dimensions(&bytes) else {
            continue;
        };
        let stem = Path::new(&relative)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut artifact = match reported.iter().position(|shot| shot.id == stem) {
            Some(index) => reported.swap_remove(index),
            None => ScreenshotArtifact {
                id: stem,
                name: "Browser capture".into(),
                url: String::new(),
                file_path: String::new(),
                width,
                height,
                timestamp: Utc::now().to_rfc3339(),
            },
        };
        artifact.file_path = path.to_string_lossy().into_owned();
        artifact.width = width;
        artifact.height = height;
        runtime.update(id, |run: &mut TaskRun| {
            if !run.screenshots.iter().any(|shot| shot.id == artifact.id) {
                run.screenshots.push(artifact.clone());
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }

    fn events(shot: &str) -> Vec<ToolEvent> {
        vec![
            ToolEvent::Visited("http://localhost:5173/settings".into()),
            ToolEvent::Screenshot(ScreenshotArtifact {
                id: shot.into(),
                name: "Settings".into(),
                url: "http://localhost:5173/settings".into(),
                file_path: String::new(),
                width: 4,
                height: 3,
                timestamp: "2026-01-01T00:00:00Z".into(),
            }),
            ToolEvent::Interaction {
                label: "Browser interaction",
                summary: "click on #save".into(),
            },
            ToolEvent::Tabs,
            ToolEvent::Inspected(json!({
                "content": "1 violation",
                "audit": {"engine": "axe-core", "counts": {"violations": 1, "incomplete": 0}},
            })),
        ]
    }

    /// The same tool events from a runner on this device and from a
    /// computer's runner leave the same record once the computer's capture
    /// arrives with the agent's changes; only the activity names the computer.
    #[test]
    fn both_runners_record_the_same_results() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-record-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
        let shot = uuid::Uuid::new_v4().to_string();
        let relative = format!(".jackalope/artifacts/screenshots/{shot}.png");
        let mut recorded = Vec::new();
        for host in [None, Some("Box")] {
            let workspace = folder.join(if host.is_some() { "remote" } else { "local" });
            std::fs::create_dir_all(workspace.join(".jackalope/artifacts/screenshots")).unwrap();
            let mut run = super::super::super::tests::sample("claude");
            run.workspace = workspace.to_string_lossy().into_owned();
            run.id = uuid::Uuid::new_v4().to_string();
            let id = run.id.clone();
            runtime.inner.lock().unwrap().runs.insert(id.clone(), run);
            for event in events(&shot) {
                record(&runtime, &id, host, event);
            }
            if host.is_some() {
                assert!(runtime.inner.lock().unwrap().runs[&id]
                    .screenshots
                    .is_empty());
                std::fs::write(workspace.join(&relative), png(4, 3)).unwrap();
                register_screenshots(
                    &runtime,
                    &id,
                    &workspace.to_string_lossy(),
                    vec![relative.clone()],
                );
                assert!(take_screenshots(&id).is_empty());
            }
            recorded.push(runtime.inner.lock().unwrap().runs[&id].clone());
        }
        let (local, remote) = (&recorded[0], &recorded[1]);
        let steps = |run: &TaskRun| {
            run.validation_steps
                .iter()
                .map(|step| {
                    (
                        step.step.clone(),
                        step.status.clone(),
                        step.notes.clone(),
                        step.evidence.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(steps(local), steps(remote));
        assert_eq!(steps(local).len(), 1);
        let shots = |run: &TaskRun| {
            run.screenshots
                .iter()
                .map(|shot| {
                    (
                        shot.id.clone(),
                        shot.name.clone(),
                        shot.url.clone(),
                        shot.width,
                        shot.height,
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(shots(local), shots(remote));
        assert_eq!(shots(local).len(), 1);
        assert_eq!(local.visited_pages, remote.visited_pages);
        assert_eq!(local.visited_pages.len(), 1);
        assert_eq!(
            local.activity,
            [
                "Captured browser screenshot: Settings",
                "Browser interaction: click on #save",
                "Updated task browser tabs",
            ]
        );
        assert_eq!(
            remote.activity,
            [
                "Captured browser screenshot on Box: Settings. It comes back with the agent's changes.",
                "Browser interaction on Box: click on #save",
                "Updated task browser tabs on Box",
            ]
        );
        drop(runtime);
        let _ = std::fs::remove_dir_all(folder);
    }
}
