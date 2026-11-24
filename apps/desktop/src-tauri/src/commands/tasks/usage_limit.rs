//! When a provider's usage, rate or billing limit stopped an attempt, and when it says
//! the limit resets. Agent CLIs report the reset in several shapes: Claude Code's
//! `rate_limit_event` (`resetsAt`), its older `usage limit reached|<epoch>` line and
//! "resets 3pm (Zone)" wording, Codex's "try again at 4:12 PM." text, Codex and OpenAI
//! error bodies (`resets_at`, `resets_in_seconds`), Codex `rate_limits` snapshots and
//! Gemini's "reset after 2h3m" and `retryDelay`. A reset is kept only when one of these
//! states it; nothing is estimated.

use super::routing::QuotaFailure;
use super::{failure::FailureKind, RunStatus, TaskRun, TaskRuntime};
use chrono::{
    DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A retry the person asked for once the limit that stopped an attempt resets.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeAtReset {
    /// The reported reset the retry waits for, in Unix seconds.
    pub at: i64,
    /// Why the retry could not start when it was due. The schedule then stays, inactive,
    /// so the person sees what happened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// How long after the reported reset a scheduled retry starts. Codex reports resets to the
/// minute, and a window that has only just reset can still refuse the first request.
pub(in crate::commands) const RESUME_GRACE_SECONDS: i64 = 60;

/// The zone a reset written as a wall-clock time is read in.
#[derive(Clone, Copy)]
pub(super) enum Zone {
    /// This computer's zone, which is the one a local agent CLI prints its times in.
    Local,
    Named(chrono_tz::Tz),
}

impl Zone {
    fn date(self, now: DateTime<Utc>) -> NaiveDate {
        match self {
            Zone::Local => now.with_timezone(&Local).date_naive(),
            Zone::Named(zone) => now.with_timezone(&zone).date_naive(),
        }
    }

    /// The later instant of a repeated hour, so a resume never fires before the reset.
    fn instant(self, at: NaiveDateTime) -> Option<i64> {
        match self {
            Zone::Local => Local.from_local_datetime(&at).latest(),
            Zone::Named(zone) => zone
                .from_local_datetime(&at)
                .latest()
                .map(|time| time.with_timezone(&Local)),
        }
        .map(|time| time.timestamp())
    }
}

/// Resets further away than this are not a usage window; such a value is misread.
const FURTHEST_RESET_DAYS: i64 = 400;

/// Unix seconds; a value in milliseconds would otherwise read as a far-future date.
fn seconds(value: i64) -> i64 {
    if value > 100_000_000_000 {
        value / 1000
    } else {
        value
    }
}

fn plausible(at: i64, now: DateTime<Utc>) -> Option<i64> {
    let now = now.timestamp();
    (at > now - 60 && at < now + FURTHEST_RESET_DAYS * 86_400).then_some(at)
}

/// The reset a provider error event states in its own fields.
pub(super) fn structured_reset(event: &Value, now: DateTime<Utc>) -> Option<i64> {
    let mut objects = vec![event, &event["error"], &event["error"]["data"]];
    if let Some(info) = event.get("rate_limit_info") {
        objects.push(info);
    }
    objects.into_iter().find_map(|object| {
        ["resets_at", "resetsAt", "reset_at", "resetAt"]
            .iter()
            .find_map(|key| object[key].as_i64().filter(|at| *at > 0).map(seconds))
            .or_else(|| {
                ["resets_in_seconds", "resetsInSeconds"]
                    .iter()
                    .find_map(|key| object[key].as_f64())
                    .filter(|wait| wait.is_finite() && *wait >= 0.0)
                    .map(|wait| now.timestamp() + wait.ceil() as i64)
            })
            .and_then(|at| plausible(at, now))
    })
}

/// The reset a provider's error text states, read at `now`; wall-clock times without a
/// named zone are read in `zone`.
pub(super) fn reset_in_text(text: &str, now: DateTime<Utc>, zone: Zone) -> Option<i64> {
    let lower = text.to_ascii_lowercase();
    epoch_after_pipe(&lower)
        .or_else(|| json_reset(&lower, now))
        .or_else(|| relative_reset(&lower, now))
        .or_else(|| clock_reset(text, &lower, now, zone))
        .and_then(|at| plausible(at, now))
}

/// The reset an attempt's failure text states, read now in this computer's zone.
pub(super) fn reset_at(text: &str) -> Option<i64> {
    reset_in_text(text, Utc::now(), Zone::Local)
}

/// Claude Code's older form: `Claude AI usage limit reached|1751500800`.
fn epoch_after_pipe(lower: &str) -> Option<i64> {
    let at = lower.find("limit reached|")? + "limit reached|".len();
    let digits: String = lower[at..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    (digits.len() >= 9)
        .then(|| digits.parse().ok().map(seconds))
        .flatten()
}

/// An error body pasted into the message, such as Codex's
/// `{"error":{"type":"usage_limit_reached","resets_in_seconds":1234}}` or Gemini's
/// `"retryDelay": "23s"`.
fn json_reset(lower: &str, now: DateTime<Utc>) -> Option<i64> {
    let number = |key: &str| -> Option<f64> {
        let at = lower.find(key)? + key.len();
        let rest = lower[at..].trim_start().strip_prefix(':')?.trim_start();
        let rest = rest.strip_prefix('"').unwrap_or(rest);
        let digits: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        digits.parse().ok()
    };
    for key in ["\"resets_at\"", "\"resetsat\"", "\"reset_at\""] {
        if let Some(at) = number(key).filter(|at| *at > 0.0) {
            return Some(seconds(at as i64));
        }
    }
    [
        "\"resets_in_seconds\"",
        "\"resetsinseconds\"",
        "\"retrydelay\"",
    ]
    .iter()
    .find_map(|key| number(key))
    .filter(|wait| wait.is_finite() && *wait >= 0.0)
    .map(|wait| now.timestamp() + wait.ceil() as i64)
}

/// "try again in 4 days 3 hours 2 minutes", "reset after 2h33m17s", "retry in 23.4s".
fn relative_reset(lower: &str, now: DateTime<Utc>) -> Option<i64> {
    const PHRASES: [&str; 9] = [
        "try again in ",
        "resets in ",
        "reset in ",
        "reset after ",
        "resets after ",
        "retry in ",
        "retry after ",
        "available again in ",
        "available in ",
    ];
    PHRASES.iter().find_map(|phrase| {
        lower
            .match_indices(phrase)
            .find_map(|(at, _)| duration(&lower[at + phrase.len()..]))
            .map(|wait| now.timestamp() + wait)
    })
}

/// Seconds in a written duration at the start of `text`, rounded up.
fn duration(text: &str) -> Option<i64> {
    let mut rest = text;
    let mut total = 0.0;
    let mut parts = 0;
    loop {
        rest = rest.trim_start_matches([' ', ',']);
        if parts > 0 {
            rest = rest.strip_prefix("and ").unwrap_or(rest);
        }
        let number: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        let Ok(value) = number.parse::<f64>() else {
            break;
        };
        let after = rest[number.len()..].trim_start();
        let unit: String = after
            .chars()
            .take_while(char::is_ascii_alphabetic)
            .collect();
        let scale = match unit.as_str() {
            "d" | "day" | "days" => 86_400.0,
            "h" | "hr" | "hrs" | "hour" | "hours" => 3_600.0,
            "m" | "min" | "mins" | "minute" | "minutes" => 60.0,
            "s" | "sec" | "secs" | "second" | "seconds" => 1.0,
            _ => break,
        };
        total += value * scale;
        parts += 1;
        rest = &after[unit.len()..];
    }
    (parts > 0 && total.is_finite()).then(|| total.ceil() as i64)
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// "try again at 4:12 PM.", "try again at Nov 11th, 2026 3:37 PM.", "resets 10pm",
/// "resets Oct 9, 5pm (Europe/Berlin)", "will reset at 3pm (America/New_York)".
fn clock_reset(text: &str, lower: &str, now: DateTime<Utc>, zone: Zone) -> Option<i64> {
    const PHRASES: [&str; 7] = [
        "try again at ",
        "try again on ",
        "resets at ",
        "reset at ",
        "resets on ",
        "available again at ",
        "resets ",
    ];
    PHRASES.iter().find_map(|phrase| {
        lower.match_indices(phrase).find_map(|(at, _)| {
            let start = at + phrase.len();
            clock(&text[start..], &lower[start..], now, zone)
        })
    })
}

fn clock(text: &str, lower: &str, now: DateTime<Utc>, zone: Zone) -> Option<i64> {
    let mut rest = lower;
    let mut date = None;
    let month = MONTHS
        .iter()
        .position(|month| rest.starts_with(month))
        .map(|index| index as u32 + 1);
    if let Some(month) = month {
        rest = rest.trim_start_matches(char::is_alphabetic).trim_start();
        rest = rest.strip_prefix('.').unwrap_or(rest).trim_start();
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        let day: u32 = digits.parse().ok()?;
        rest = &rest[digits.len()..];
        for suffix in ["st", "nd", "rd", "th"] {
            rest = rest.strip_prefix(suffix).unwrap_or(rest);
        }
        rest = rest.trim_start_matches([',', ' ']);
        let year: String = rest.chars().take_while(char::is_ascii_digit).collect();
        let year = if year.len() == 4 {
            rest = rest[4..].trim_start_matches([',', ' ']);
            Some(year.parse().ok()?)
        } else {
            None
        };
        rest = rest.strip_prefix("at ").unwrap_or(rest);
        date = Some((year, month, day));
    }
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || digits.len() > 2 {
        return None;
    }
    let mut hour: u32 = digits.parse().ok()?;
    rest = &rest[digits.len()..];
    let mut minute = 0;
    let mut colon = false;
    if let Some(after) = rest.strip_prefix(':') {
        let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
        if digits.len() != 2 {
            return None;
        }
        minute = digits.parse().ok()?;
        rest = &after[2..];
        colon = true;
    }
    let spaced = rest.trim_start();
    let meridiem = ["am", "a.m.", "pm", "p.m."]
        .iter()
        .find(|word| spaced.starts_with(**word))
        .map(|word| (word.starts_with('p'), word.len()));
    match meridiem {
        Some((afternoon, length)) => {
            if !(1..=12).contains(&hour) {
                return None;
            }
            hour = hour % 12 + if afternoon { 12 } else { 0 };
            rest = &spaced[length..];
        }
        // A bare number such as "resets 5 hours" is not a time of day.
        None if !colon => return None,
        None => {}
    }
    let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
    // A zone in parentheses names where the CLI printed the time.
    let offset = lower.len() - rest.len();
    let zone = text
        .get(offset..)
        .and_then(|tail| tail.trim_start().strip_prefix('('))
        .and_then(|tail| tail.split(')').next())
        .and_then(|name| name.trim().parse::<chrono_tz::Tz>().ok())
        .map_or(zone, Zone::Named);
    let today = zone.date(now);
    let at = match date {
        None => {
            let at = zone.instant(today.and_time(time))?;
            if at <= now.timestamp() {
                zone.instant((today + Duration::days(1)).and_time(time))?
            } else {
                at
            }
        }
        Some((year, month, day)) => {
            let on = |year| NaiveDate::from_ymd_opt(year, month, day).map(|d| d.and_time(time));
            let at = zone.instant(on(year.unwrap_or(today.year()))?)?;
            if year.is_none() && at < now.timestamp() - 86_400 {
                zone.instant(on(today.year() + 1)?)?
            } else {
                at
            }
        }
    };
    Some(at)
}

/// What a Codex `rate_limits` snapshot says about the account: `None` when `event` is not
/// one, `Some(None)` when no window is used up or a used-up window has no reported reset,
/// and otherwise the latest reset among the used-up windows, since all of them must reset
/// before work can continue. Reads the exec/rollout form (`used_percent`,
/// `resets_in_seconds`) and the app-server form (`usedPercent`, `resetsAt`).
pub(super) fn snapshot_reset(event: &Value, now: DateTime<Utc>) -> Option<Option<i64>> {
    let snapshot = [
        &event["rate_limits"],
        &event["msg"]["rate_limits"],
        &event["payload"]["rate_limits"],
        &event["rateLimits"],
        &event["params"]["rateLimits"],
    ]
    .into_iter()
    .find(|value| value.is_object())?;
    let mut latest: Option<i64> = None;
    for window in ["primary", "secondary"] {
        let window = &snapshot[window];
        let used = window["used_percent"]
            .as_f64()
            .or_else(|| window["usedPercent"].as_f64());
        if used.is_none_or(|used| used < 100.0) {
            continue;
        }
        let Some(reset) = structured_reset(window, now) else {
            return Some(None);
        };
        latest = Some(latest.map_or(reset, |known| known.max(reset)));
    }
    Some(latest)
}

/// Keeps a quota error on the attempt. The latest error's message wins, but a reset an
/// earlier event or snapshot reported stays when the later one leaves it out: Claude Code
/// reports `resetsAt` in its rate-limit event and then ends the turn with plain text.
pub(in crate::commands) fn record(run: &mut TaskRun, mut failure: QuotaFailure) {
    failure.resets_at = failure
        .resets_at
        .or_else(|| run.quota_failure.as_ref().and_then(|old| old.resets_at))
        .or(run.limit_snapshot_reset);
    run.quota_failure = Some(failure);
}

/// Follows Codex `rate_limits` snapshots, which can arrive before or after the error.
pub(super) fn observe_snapshot(run: &mut TaskRun, event: &Value) {
    if let Some(reset) = snapshot_reset(event, Utc::now()) {
        run.limit_snapshot_reset = reset;
        if let (Some(failure), Some(reset)) = (run.quota_failure.as_mut(), reset) {
            failure.resets_at.get_or_insert(reset);
        }
    }
}

/// How a limit that stopped work reads in a notice: "Usage limit — resets 3:40 PM", with
/// the weekday or date when the reset is not today, in this computer's zone.
pub(in crate::commands) fn headline(
    kind: FailureKind,
    resets_at: Option<i64>,
    now: DateTime<Utc>,
) -> String {
    headline_in(kind, resets_at, now, &Local)
}

fn headline_in<Z: TimeZone>(
    kind: FailureKind,
    resets_at: Option<i64>,
    now: DateTime<Utc>,
    zone: &Z,
) -> String
where
    Z::Offset: std::fmt::Display,
{
    let name = match kind {
        FailureKind::RateLimited => "Rate limit",
        FailureKind::Billing => return "Billing limit — add credit or switch account".into(),
        _ => "Usage limit",
    };
    let Some(at) = resets_at.and_then(|at| zone.timestamp_opt(at, 0).single()) else {
        return format!("{name} — reset time not reported");
    };
    let today = now.with_timezone(zone).date_naive();
    let days = (at.date_naive() - today).num_days();
    let time = at.format("%-I:%M %p");
    let when = if at.timestamp() <= now.timestamp() {
        return format!("{name} — reset at {time}");
    } else if days == 0 {
        time.to_string()
    } else if days == 1 {
        format!("tomorrow {time}")
    } else if days < 7 {
        format!("{} {time}", at.format("%a"))
    } else {
        format!("{} {time}", at.format("%b %-d,"))
    };
    format!("{name} — resets {when}")
}

/// Whether a later or still active attempt at the same task has taken over from `run`.
fn replaced<'a>(mut runs: impl Iterator<Item = &'a TaskRun>, run: &TaskRun) -> bool {
    runs.any(|other| {
        other.id != run.id
            && other.task_id == run.task_id
            && (other.started_at > run.started_at || other.status.is_active())
    })
}

impl TaskRuntime {
    /// Schedules, or with `schedule` false cancels, a retry of attempt `id` once the
    /// usage limit that stopped it resets. Only the latest attempt of an ordinary task can
    /// be scheduled, and only when the provider reported the reset.
    pub(in crate::commands) fn schedule_limit_resume(
        &self,
        id: &str,
        schedule: bool,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let run = inner.runs.get(id).ok_or("Attempt not found")?;
        let mut updated = run.clone();
        if schedule {
            if run.live_session_id.is_some() {
                return Err("Resume a conversation from the conversation itself.".into());
            }
            if run.status != RunStatus::Failed {
                return Err(
                    "Only an attempt a usage limit stopped can resume at its reset.".into(),
                );
            }
            if run.failure_kind.is_none_or(|kind| !kind.is_limit())
                || run.failure_kind == Some(FailureKind::Billing)
            {
                return Err("This attempt did not stop at a usage limit that resets.".into());
            }
            let at = run
                .quota_failure
                .as_ref()
                .and_then(|failure| failure.resets_at)
                .ok_or("The provider did not report when this limit resets.")?;
            if replaced(inner.runs.values(), run) {
                return Err("A newer attempt has replaced this one.".into());
            }
            updated.resume_at_reset = Some(ResumeAtReset { at, error: None });
        } else {
            updated.resume_at_reset = None;
        }
        self.save(&updated)?;
        inner.runs.insert(id.into(), updated);
        Ok(())
    }

    /// Attempts whose scheduled retry is due at `now`. Each is unscheduled before it is
    /// returned, so a retry is started at most once even if starting it fails. A schedule
    /// on an attempt that another attempt has since replaced, such as a manual retry or a
    /// switch to another account, is dropped instead of starting the task a second time.
    pub(in crate::commands) fn take_due_limit_resumes(&self, now: i64) -> Vec<(String, i64)> {
        let Ok(mut inner) = self.inner.lock() else {
            return vec![];
        };
        let due: Vec<String> = inner
            .runs
            .values()
            .filter(|run| {
                run.resume_at_reset.as_ref().is_some_and(|resume| {
                    resume.error.is_none() && resume.at + RESUME_GRACE_SECONDS <= now
                })
            })
            .map(|run| run.id.clone())
            .collect();
        let mut taken = vec![];
        for id in due {
            let Some(run) = inner.runs.get(&id) else {
                continue;
            };
            let mut updated = run.clone();
            let Some(resume) = updated.resume_at_reset.take() else {
                continue;
            };
            let current =
                updated.status == RunStatus::Failed && !replaced(inner.runs.values(), run);
            if self.save(&updated).is_ok() {
                inner.runs.insert(id.clone(), updated);
                if current {
                    taken.push((id, resume.at));
                }
            }
        }
        taken
    }

    /// Refuses a switch to an account turned off in Settings, for this project or the whole
    /// app. The start itself checks the agent and the account a project assigns.
    pub(in crate::commands) fn ensure_switch_allowed(
        &self,
        request: &super::RunRequest,
    ) -> Result<(), String> {
        if matches!(request.agent.as_str(), "auto" | "default") {
            return Ok(());
        }
        let policy = self.policy()?;
        let adapter = policy.adapter(&request.agent)?;
        let assigned = policy
            .projects
            .get(&request.project_id)
            .and_then(|project| {
                project
                    .agent_accounts
                    .get(&adapter)
                    .or_else(|| project.agent_accounts.get(&request.agent))
            });
        let binding = crate::commands::agent_profiles::bind_account(
            &self.profiles_root(),
            &adapter,
            request
                .agent_profile_id
                .as_deref()
                .or(assigned.map(String::as_str)),
        )?;
        if policy.account_allowed(&request.project_id, &request.agent, &binding) {
            Ok(())
        } else {
            Err("That account is turned off for this project in Settings.".into())
        }
    }

    /// Keeps a scheduled retry that could not start, with the reason, on attempt `id`.
    pub(in crate::commands) fn limit_resume_failed(&self, id: &str, at: i64, error: String) {
        self.update(id, |run| {
            run.resume_at_reset = Some(ResumeAtReset {
                at,
                error: Some(error),
            })
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Monday 24 November 2026, 14:00 in Los Angeles (22:00 UTC).
    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 24, 22, 0, 0).unwrap()
    }

    fn la() -> Zone {
        Zone::Named(chrono_tz::America::Los_Angeles)
    }

    fn at(zone: chrono_tz::Tz, y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        zone.with_ymd_and_hms(y, m, d, h, min, 0)
            .unwrap()
            .timestamp()
    }

    fn read(text: &str) -> Option<i64> {
        reset_in_text(text, now(), la())
    }

    #[test]
    fn claude_reset_wording_is_read_in_the_named_or_local_zone() {
        let pacific = chrono_tz::America::Los_Angeles;
        assert_eq!(
            read("Claude AI usage limit reached|1795564800"),
            Some(1_795_564_800)
        );
        assert_eq!(
            read("You've hit your limit · resets 10pm"),
            Some(at(pacific, 2026, 11, 24, 22, 0))
        );
        // Already past today, so the next one.
        assert_eq!(
            read("5-hour limit reached ∙ resets 9am"),
            Some(at(pacific, 2026, 11, 25, 9, 0))
        );
        assert_eq!(
            read("Claude usage limit reached. Your limit will reset at 3pm (America/New_York)."),
            Some(at(chrono_tz::America::New_York, 2026, 11, 25, 15, 0))
        );
        assert_eq!(
            read("Weekly limit reached ∙ resets Dec 1, 5pm (Europe/Berlin)"),
            Some(at(chrono_tz::Europe::Berlin, 2026, 12, 1, 17, 0))
        );
        assert_eq!(
            read("You've hit your limit · resets 3:40pm"),
            Some(at(pacific, 2026, 11, 24, 15, 40))
        );
    }

    #[test]
    fn codex_reset_wording_and_error_bodies_are_read() {
        let pacific = chrono_tz::America::Los_Angeles;
        assert_eq!(
            read("You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 4:12 PM."),
            Some(at(pacific, 2026, 11, 24, 16, 12))
        );
        assert_eq!(
            read("You've hit your usage limit. Upgrade to Plus to continue using Codex, or try again at Nov 28th, 2026 9:05 AM."),
            Some(at(pacific, 2026, 11, 28, 9, 5))
        );
        assert_eq!(
            read("You've hit your usage limit. Try again in 4 days 3 hours 2 minutes."),
            Some(now().timestamp() + 4 * 86_400 + 3 * 3_600 + 2 * 60)
        );
        assert_eq!(
            read(
                r#"unexpected status 429 Too Many Requests: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_in_seconds":5400}}"#
            ),
            Some(now().timestamp() + 5400)
        );
        assert_eq!(
            read(r#"{"error":{"type":"usage_limit_reached","resets_at":1795564800}}"#),
            Some(1_795_564_800)
        );
    }

    #[test]
    fn gemini_and_api_rate_limit_wording_is_read() {
        assert_eq!(
            read("TerminalQuotaError: You have exhausted your capacity on this model. Your quota will reset after 2h33m17s."),
            Some(now().timestamp() + 2 * 3_600 + 33 * 60 + 17)
        );
        assert_eq!(
            read(
                r#"{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"23.4s"}]}}"#
            ),
            Some(now().timestamp() + 24)
        );
        assert_eq!(
            read("Rate limit reached for gpt-5 in organization org-1 on tokens per min (TPM). Please try again in 1.2s."),
            Some(now().timestamp() + 2)
        );
    }

    #[test]
    fn text_without_a_stated_reset_reports_none() {
        for text in [
            "429 Too Many Requests",
            "You exceeded your current quota, please check your plan and billing details.",
            "Retry after checking the enabled accounts.",
            "Usage limit reached; resets 5 hours from now",
            "Claude AI usage limit reached|12",
            "resets at 25:00",
            "resets at 13pm",
        ] {
            assert_eq!(read(text), None, "{text}");
        }
        // A reset far in the past or future is a misread, not a window.
        assert_eq!(read(r#"{"resets_at": 1000}"#), None);
        assert_eq!(read(r#"{"resets_at": 99999999999}"#), None);
    }

    #[test]
    fn headlines_name_the_limit_and_its_local_reset() {
        let pacific = chrono_tz::America::Los_Angeles;
        let line = |kind, at| headline_in(kind, at, now(), &pacific);
        assert_eq!(
            line(
                FailureKind::QuotaExhausted,
                Some(at(pacific, 2026, 11, 24, 15, 40))
            ),
            "Usage limit — resets 3:40 PM"
        );
        assert_eq!(
            line(
                FailureKind::QuotaExhausted,
                Some(at(pacific, 2026, 11, 25, 9, 5))
            ),
            "Usage limit — resets tomorrow 9:05 AM"
        );
        assert_eq!(
            line(
                FailureKind::RateLimited,
                Some(at(pacific, 2026, 11, 27, 9, 0))
            ),
            "Rate limit — resets Fri 9:00 AM"
        );
        assert_eq!(
            line(
                FailureKind::QuotaExhausted,
                Some(at(pacific, 2026, 12, 8, 9, 0))
            ),
            "Usage limit — resets Dec 8, 9:00 AM"
        );
        assert_eq!(
            line(FailureKind::QuotaExhausted, None),
            "Usage limit — reset time not reported"
        );
        assert_eq!(
            line(FailureKind::Billing, None),
            "Billing limit — add credit or switch account"
        );
    }

    #[test]
    fn structured_event_fields_are_read() {
        assert_eq!(
            structured_reset(
                &json!({"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1_795_564_800_000_i64}}),
                now()
            ),
            Some(1_795_564_800)
        );
        assert_eq!(
            structured_reset(
                &json!({"type":"error","error":{"type":"usage_limit_reached","resets_in_seconds":60}}),
                now()
            ),
            Some(now().timestamp() + 60)
        );
        assert_eq!(
            structured_reset(&json!({"type":"error","message":"x"}), now()),
            None
        );
    }

    #[test]
    fn codex_snapshots_report_the_latest_used_up_window() {
        let exec = json!({"id":"0","msg":{"type":"token_count","info":null,"rate_limits":{
            "primary":{"used_percent":100.0,"window_minutes":300,"resets_in_seconds":600},
            "secondary":{"used_percent":100.0,"window_minutes":10080,"resets_in_seconds":7200}}}});
        assert_eq!(
            snapshot_reset(&exec, now()),
            Some(Some(now().timestamp() + 7200))
        );
        let app_server = json!({"method":"account/rateLimits/updated","params":{"rateLimits":{
            "primary":{"usedPercent":100,"windowDurationMins":300,"resetsAt":1_795_564_800},
            "secondary":{"usedPercent":40,"resetsAt":1_796_000_000}}}});
        assert_eq!(
            snapshot_reset(&app_server, now()),
            Some(Some(1_795_564_800))
        );
        let healthy =
            json!({"rate_limits":{"primary":{"used_percent":12.5,"resets_in_seconds":60}}});
        assert_eq!(snapshot_reset(&healthy, now()), Some(None));
        let unknown = json!({"rate_limits":{"primary":{"used_percent":100}}});
        assert_eq!(snapshot_reset(&unknown, now()), Some(None));
        assert_eq!(
            snapshot_reset(&json!({"type":"turn.completed"}), now()),
            None
        );
    }
}
