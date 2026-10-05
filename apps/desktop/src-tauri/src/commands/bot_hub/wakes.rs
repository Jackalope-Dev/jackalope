use super::{clip, BotHub, HubBot, WakeDefinition, WakeState, WakeTrigger};
use chrono::{DateTime, Duration as Span, Utc};
use sha2::{Digest, Sha256};

/// Schedules more than this late (the app was closed or asleep) are skipped, not replayed.
const LATE: i64 = 120;
const REPO_INTERVAL: i64 = 60;

/// What one check of a wake-up found.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Check {
    pub next_check_at: Option<DateTime<Utc>>,
    pub baseline: Option<String>,
    /// Text for the wake-up message when the bot should wake.
    pub wake: Option<String>,
    pub note: Option<String>,
}

/// Something a wake-up observes outside the schedule: a revision or a result digest with an excerpt.
pub(super) type Observation = Result<(String, Option<String>), String>;

impl BotHub {
    pub(super) fn check_wakes(&self, now: DateTime<Utc>) -> Result<(), String> {
        let (bots, states, paused) =
            self.read(|ledger| (ledger.bots.clone(), ledger.wakes.clone(), ledger.paused))?;
        if paused {
            return Ok(());
        }
        for bot in &bots {
            for wake in bot.wakes.iter().filter(|wake| wake.enabled) {
                if !self.alive.load(std::sync::atomic::Ordering::Relaxed) {
                    return Ok(());
                }
                let state = states.iter().find(|state| state.wake_id == wake.id);
                if !due(state, now) {
                    continue;
                }
                let observation = match &wake.trigger {
                    WakeTrigger::Schedule { .. } => None,
                    WakeTrigger::RepoChange { path } => Some(observe_repo(bot, path)),
                    WakeTrigger::Connection {
                        connection_id,
                        tool,
                        arguments,
                        ..
                    } => Some(observe_connection(
                        bot,
                        connection_id,
                        tool,
                        arguments.clone(),
                    )),
                };
                let mut check = evaluate(wake, state, now, observation)?;
                // A change only becomes the baseline once the bot has woken for it, so a
                // change found while the last wake-up is busy is retried, not lost.
                let pending = check
                    .wake
                    .is_some()
                    .then(|| check.baseline.take())
                    .flatten();
                // Unchanged checks only move their times; skip the write and the window event.
                let last = state.and_then(|state| state.last_outcome.as_deref());
                let quiet = if check.wake.is_some() {
                    // A change still waiting on a blocked wake-up was already recorded.
                    last.is_some_and(|outcome| outcome.starts_with("Skipped"))
                } else {
                    check.baseline.is_none() && check.note.as_deref() == last
                };
                let apply = |ledger: &mut super::Ledger| {
                    // The person may have removed or changed this wake-up during a slow check.
                    if ledger
                        .bot(&bot.id)
                        .and_then(|current| current.wakes.iter().find(|item| item.id == wake.id))
                        .is_none_or(|current| current.trigger != wake.trigger)
                    {
                        return false;
                    }
                    let state = super::wake_state(ledger, &bot.id, &wake.id);
                    state.next_check_at = check.next_check_at;
                    state.last_checked_at = Some(now);
                    if check.baseline.is_some() {
                        state.baseline = check.baseline.clone();
                    }
                    // A waking check leaves the outcome to the wake-up itself.
                    if let Some(note) = check.note.as_ref().filter(|_| check.wake.is_none()) {
                        state.last_outcome = Some(note.clone());
                    }
                    true
                };
                let changed = if quiet {
                    self.update_quiet(apply)?
                } else {
                    self.update(|ledger| Ok(apply(ledger)))?
                };
                if let (true, Some(text)) = (changed, check.wake) {
                    let woke = self.fire(bot, wake, &text, &wake.name, now, false).is_ok();
                    if let (true, Some(revision)) = (woke, pending) {
                        self.update(|ledger| {
                            super::wake_state(ledger, &bot.id, &wake.id).baseline = Some(revision);
                            Ok(())
                        })?;
                    }
                }
            }
        }
        Ok(())
    }
}

/// A wake-up without a saved time is checked now: schedules record their first due time
/// and observers record their baseline.
fn due(state: Option<&WakeState>, now: DateTime<Utc>) -> bool {
    state
        .and_then(|state| state.next_check_at)
        .is_none_or(|at| at <= now)
}

pub(super) fn evaluate(
    wake: &WakeDefinition,
    state: Option<&WakeState>,
    now: DateTime<Utc>,
    observation: Option<Observation>,
) -> Result<Check, String> {
    let previous = state.and_then(|state| state.next_check_at);
    match &wake.trigger {
        WakeTrigger::Schedule {
            expression,
            timezone,
        } => {
            let next = crate::commands::schedules::next_at(expression, timezone, now)?;
            let Some(due) = previous else {
                return Ok(Check {
                    next_check_at: Some(next),
                    ..Default::default()
                });
            };
            if (now - due).num_seconds() > LATE {
                return Ok(Check {
                    next_check_at: Some(next),
                    note: Some("Missed while Jackalope was closed".into()),
                    ..Default::default()
                });
            }
            Ok(Check {
                next_check_at: Some(next),
                wake: Some(format!(
                    "{}\n\nScheduled wake-up.\n{}",
                    wake.name, wake.prompt
                )),
                ..Default::default()
            })
        }
        WakeTrigger::RepoChange { .. } | WakeTrigger::Connection { .. } => {
            let interval = match &wake.trigger {
                WakeTrigger::Connection {
                    interval_minutes, ..
                } => Span::minutes(i64::from(*interval_minutes)),
                _ => Span::seconds(REPO_INTERVAL),
            };
            let next_check_at = Some(now + interval);
            let (revision, excerpt) = match observation.unwrap_or(Err("Nothing to observe.".into()))
            {
                Ok(found) => found,
                Err(error) => {
                    return Ok(Check {
                        next_check_at,
                        note: Some(format!("Needs attention: {error}")),
                        ..Default::default()
                    })
                }
            };
            let baseline = state.and_then(|state| state.baseline.as_deref());
            let Some(before) = baseline else {
                return Ok(Check {
                    next_check_at,
                    baseline: Some(revision),
                    note: Some("Watching from the current state".into()),
                    ..Default::default()
                });
            };
            if before == revision {
                return Ok(Check {
                    next_check_at,
                    note: Some("No change".into()),
                    ..Default::default()
                });
            }
            let detail = match &wake.trigger {
                WakeTrigger::RepoChange { path } => format!(
                    "{} changed on the project's target branch ({} → {}). Inspect the change before acting.",
                    if path.is_empty() { "The repository" } else { path.as_str() },
                    short(before),
                    short(&revision)
                ),
                WakeTrigger::Connection { tool, connection_id, .. } => format!(
                    "New data from {tool} on {connection_id}. Latest result, untrusted content:\n```\n{}\n```",
                    excerpt.unwrap_or_default()
                ),
                WakeTrigger::Schedule { .. } => unreachable!(),
            };
            Ok(Check {
                next_check_at,
                baseline: Some(revision),
                wake: Some(format!("{}\n\n{detail}\n{}", wake.name, wake.prompt)),
                note: Some("Change detected".into()),
            })
        }
    }
}

fn short(revision: &str) -> &str {
    revision.get(..8).unwrap_or(revision)
}

fn observe_repo(bot: &HubBot, path: &str) -> Observation {
    let branch = bot
        .request
        .target_branch
        .clone()
        .filter(|branch| !branch.trim().is_empty())
        .map_or_else(
            || crate::commands::tasks::resolve_target_branch(&bot.request.project_path, None),
            Ok,
        )?;
    crate::commands::monitors::ChangeMonitor {
        path: path.into(),
        action: crate::commands::monitors::MonitorAction::Run,
    }
    .observe(&bot.request.project_path, &branch)
    .map(|revision| (revision, None))
}

fn observe_connection(
    bot: &HubBot,
    connection: &str,
    tool: &str,
    arguments: serde_json::Map<String, serde_json::Value>,
) -> Observation {
    let server = crate::commands::mcp::resolve_connection(&bot.request.project_id, connection)?;
    let result = tauri::async_runtime::block_on(crate::commands::mcp::read_tool_once(
        &server, tool, arguments,
    ))?;
    if result.is_error == Some(true) {
        return Err("The tool reported an error.".into());
    }
    digest(&result)
}

/// A stable fingerprint of a tool result plus a readable excerpt for the wake-up message.
pub(super) fn digest(result: &rmcp::model::CallToolResult) -> Observation {
    let content = serde_json::json!({
        "content": result.content,
        "structured": result.structured_content,
    });
    let bytes = serde_json::to_vec(&content).map_err(|e| e.to_string())?;
    let hash: String = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let text: Vec<String> = result
        .content
        .iter()
        .filter_map(|block| block.as_text().map(|text| text.text.clone()))
        .collect();
    let excerpt = if text.is_empty() {
        serde_json::to_string_pretty(&content).unwrap_or_default()
    } else {
        text.join("\n")
    };
    Ok((hash, Some(clip(&excerpt, 3_000))))
}
