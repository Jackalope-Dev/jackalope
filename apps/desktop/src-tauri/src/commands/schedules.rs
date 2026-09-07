use super::{coordination::Coordinator, tasks::RunRequest};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDefinition {
    #[serde(default)]
    pub monitor: Option<super::monitors::ChangeMonitor>,
    pub id: String,
    pub name: String,
    pub expression: String,
    pub timezone: String,
    pub missed: String,
    pub enabled: bool,
    pub request: RunRequest,
    #[serde(default)]
    pub raw_prompt: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    #[serde(default)]
    pub change: Option<super::monitors::MonitorChange>,
    pub due_at: DateTime<Utc>,
    pub run_id: Option<String>,
    pub outcome: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSchedule {
    #[serde(default)]
    pub last_notice: Option<Occurrence>,
    #[serde(default)]
    pub observed_revision: Option<String>,
    #[serde(default)]
    pub local_checks: u64,
    #[serde(default)]
    pub quiet_checks: u64,
    pub definition: ScheduleDefinition,
    pub next_at: DateTime<Utc>,
    pub history: Vec<Occurrence>,
    #[serde(default)]
    pub last_run_id: Option<String>,
    #[serde(default)]
    pub account: Option<super::agent_profiles::AccountBinding>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct ScheduleLedger {
    pub schedules: Vec<SavedSchedule>,
    #[serde(skip_deserializing)]
    pub error: Option<String>,
}

fn next_at(
    expression: &str,
    timezone: &str,
    after: DateTime<Utc>,
) -> Result<DateTime<Utc>, String> {
    let mut fields: Vec<String> = expression.split_whitespace().map(str::to_owned).collect();
    if fields.len() != 5 || expression.len() > 160 {
        return Err("Use five cron fields: minute, hour, day, month, weekday.".into());
    }
    if fields[2] != "*" && fields[4] != "*" {
        return Err("Choose a day of the month or a weekday, not both.".into());
    }
    if !fields[4]
        .chars()
        .all(|c| c.is_ascii_digit() || "*,-".contains(c))
    {
        return Err("Weekdays support 0–7, ranges and lists (0 and 7 are Sunday).".into());
    }
    fields[4] = fields[4]
        .chars()
        .map(|c| match c {
            '0' | '7' => "SUN".into(),
            '1' => "MON".into(),
            '2' => "TUE".into(),
            '3' => "WED".into(),
            '4' => "THU".into(),
            '5' => "FRI".into(),
            '6' => "SAT".into(),
            _ => c.to_string(),
        })
        .collect();
    let schedule =
        cron::Schedule::from_str(&format!("0 {}", fields.join(" "))).map_err(|e| e.to_string())?;
    let zone = chrono_tz::Tz::from_str(timezone)
        .map_err(|_| "Choose a valid IANA timezone, such as America/Denver.".to_string())?;
    schedule
        .after(&after.with_timezone(&zone))
        .next()
        .map(|at| at.with_timezone(&Utc))
        .ok_or("This schedule has no future occurrence.".into())
}

#[derive(Clone)]
pub struct Scheduler {
    ledger: Arc<Mutex<ScheduleLedger>>,
    path: PathBuf,
    coordinator: Coordinator,
    alive: Arc<AtomicBool>,
}

impl Scheduler {
    pub fn new(path: PathBuf, coordinator: Coordinator) -> Self {
        let loaded = if path.exists() {
            super::history::read_bounded(&path, 16_000_000).and_then(|data| {
                serde_json::from_slice::<ScheduleLedger>(&data).map_err(|e| e.to_string())
            })
        } else {
            Ok(ScheduleLedger::default())
        };
        let mut ledger = loaded.unwrap_or_else(|e| ScheduleLedger {
            schedules: vec![],
            error: Some(format!(
                "Schedules could not be loaded; the original is preserved: {e}"
            )),
        });
        for schedule in &mut ledger.schedules {
            for event in &mut schedule.history {
                if event.outcome == "Reserved" {
                    event.outcome =
                        "Interrupted dispatch; inspect task history before retrying".into();
                }
            }
        }
        Self {
            ledger: Arc::new(Mutex::new(ledger)),
            path,
            coordinator,
            alive: Arc::new(AtomicBool::new(true)),
        }
    }

    fn persist(&self, ledger: &ScheduleLedger) -> Result<(), String> {
        if let Some(error) = &ledger.error {
            return Err(error.clone());
        }
        super::history::write_atomic(
            &self.path,
            &serde_json::to_vec_pretty(ledger).map_err(|e| e.to_string())?,
        )
    }

    pub fn launch(&self) {
        let service = self.clone();
        std::thread::spawn(move || {
            while service.alive.load(Ordering::SeqCst) {
                if let Err(error) = service.tick(Utc::now()) {
                    service.ledger.lock().unwrap().error = Some(error);
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });
    }

    pub fn ensure_paused(&self) -> Result<(), String> {
        let ledger = self.ledger.lock().map_err(|e| e.to_string())?;
        if ledger.schedules.iter().any(|s| s.definition.enabled) {
            return Err("Pause recurring tasks before resetting Jackalope.".into());
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::SeqCst);
    }

    fn tick(&self, now: DateTime<Utc>) -> Result<(), String> {
        let mut ledger = self.ledger.lock().map_err(|e| e.to_string())?;
        if ledger.error.is_some() {
            return Ok(());
        }
        for index in 0..ledger.schedules.len() {
            let saved = &ledger.schedules[index];
            if !saved.definition.enabled || saved.next_at > now {
                continue;
            }
            let next = next_at(
                &saved.definition.expression,
                &saved.definition.timezone,
                now,
            )?;
            let monitor_only = saved
                .definition
                .monitor
                .as_ref()
                .is_some_and(|m| m.action == super::monitors::MonitorAction::Notify);
            let late = (now - saved.next_at).num_seconds() > 60;
            let observation = saved
                .definition
                .monitor
                .as_ref()
                .filter(|_| !(late && saved.definition.missed == "skip"))
                .map(|monitor| {
                    monitor.observe(
                        &saved.definition.request.project_path,
                        saved
                            .definition
                            .request
                            .target_branch
                            .as_deref()
                            .unwrap_or("master"),
                    )
                });
            let quiet = observation.as_ref().is_some_and(|result| {
                result.as_ref().is_ok_and(|revision| {
                    saved
                        .observed_revision
                        .as_ref()
                        .is_none_or(|old| old == revision)
                })
            });
            let change = observation
                .as_ref()
                .and_then(|r| r.as_ref().ok())
                .and_then(|after| {
                    saved
                        .observed_revision
                        .as_ref()
                        .filter(|before| *before != after)
                        .map(|before| super::monitors::MonitorChange {
                            project_path: saved.definition.request.project_path.clone(),
                            before: before.clone(),
                            after: after.clone(),
                            path: saved
                                .definition
                                .monitor
                                .as_ref()
                                .map(|m| m.path.clone())
                                .unwrap_or_default(),
                            branch: saved
                                .definition
                                .request
                                .target_branch
                                .clone()
                                .unwrap_or_default(),
                        })
                });
            if let Some(result) = observation
                .as_ref()
                .filter(|r| r.is_err() || quiet || monitor_only)
            {
                let mut updated = ledger.clone();
                let current = &mut updated.schedules[index];
                let outcome = match result {
                    Err(error) => format!("Monitor needs attention: {error}"),
                    Ok(revision) => {
                        current.local_checks += 1;
                        let first = current.observed_revision.is_none();
                        current.observed_revision = Some(revision.clone());
                        if quiet {
                            current.quiet_checks += 1;
                        }
                        if first {
                            "Baseline recorded · no agent used".into()
                        } else if quiet {
                            "Unchanged · no agent used".into()
                        } else {
                            "Change detected · no agent used".into()
                        }
                    }
                };
                let event = Occurrence {
                    change,
                    due_at: current.next_at,
                    run_id: None,
                    outcome,
                };
                if event.outcome.starts_with("Change detected")
                    || (result.is_err()
                        && current
                            .last_notice
                            .as_ref()
                            .is_none_or(|old| old.outcome != event.outcome))
                {
                    current.last_notice = Some(event.clone());
                } else if result.is_ok()
                    && current
                        .last_notice
                        .as_ref()
                        .is_some_and(|e| e.outcome.starts_with("Monitor needs attention"))
                {
                    current.last_notice = None;
                }
                current.history.push(event);
                current.next_at = next;
                if current.history.len() > 200 {
                    current.history.remove(0);
                }
                self.persist(&updated)?;
                *ledger = updated;
                continue;
            }
            let runs = self.coordinator.runtime.integration_runs()?;
            let overlap = saved.last_run_id.iter().any(|id| {
                runs.iter().any(|run| {
                    (&run.id == id || &run.task_id == id)
                        && ["starting", "running", "stopping", "interrupted"]
                            .contains(&run.status.as_str())
                })
            });
            let capacity_busy = runs
                .iter()
                .filter(|r| {
                    ["starting", "running", "stopping", "interrupted"].contains(&r.status.as_str())
                })
                .count()
                >= 3;
            let skip = overlap || capacity_busy || (late && saved.definition.missed == "skip");
            let mut request = saved.definition.request.clone();
            request.monitor_change = change.clone();
            request.id = uuid::Uuid::new_v4().to_string();
            let event = Occurrence {
                change,
                due_at: saved.next_at,
                run_id: (!skip).then(|| request.id.clone()),
                outcome: if overlap {
                    "Skipped: earlier run is active or interrupted"
                } else if capacity_busy {
                    "Skipped: three tasks already active or interrupted"
                } else if skip {
                    "Skipped: missed while unavailable"
                } else {
                    "Reserved"
                }
                .into(),
            };
            let mut updated = ledger.clone();
            updated.schedules[index].next_at = next;
            updated.schedules[index].history.push(event);
            if observation.as_ref().is_some_and(|r| r.is_ok()) {
                updated.schedules[index].local_checks += 1;
            }
            if !skip {
                updated.schedules[index].last_run_id = Some(request.id.clone());
                if let Some(Ok(revision)) = observation {
                    updated.schedules[index].observed_revision = Some(revision);
                }
            }
            if updated.schedules[index].history.len() > 200 {
                updated.schedules[index].history.remove(0);
            }
            self.persist(&updated)?;
            *ledger = updated;
            if skip {
                continue;
            }
            let start = (|| {
                let account = ledger.schedules[index]
                    .account
                    .as_ref()
                    .ok_or("Re-save this schedule to bind its account.")?;
                super::agent_profiles::validate_binding(
                    &self.coordinator.runtime.profiles_root(),
                    account,
                )?;
                let current = super::agent_profiles::bind_account(
                    &self.coordinator.runtime.profiles_root(),
                    &account.adapter,
                    request.agent_profile_id.as_deref(),
                )?;
                if current.directory != account.directory
                    || current.profile_id != account.profile_id
                {
                    return Err("The selected account changed. Re-save the schedule to approve this account.".into());
                }
                self.coordinator.start_manual(request)
            })();
            let outcome = match start {
                Ok(_) => "Started".to_string(),
                Err(error) => format!("Failed to start: {error}"),
            };
            ledger.schedules[index].history.last_mut().unwrap().outcome = outcome;
            if ledger.schedules[index].definition.monitor.is_some() {
                ledger.schedules[index].last_notice =
                    ledger.schedules[index].history.last().cloned();
            }
            self.persist(&ledger)?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn schedule_list(service: State<'_, Scheduler>) -> ScheduleLedger {
    service.ledger.lock().unwrap().clone()
}

#[tauri::command]
pub async fn schedule_inspect_change(
    id: String,
    due_at: DateTime<Utc>,
    service: State<'_, Scheduler>,
) -> Result<String, String> {
    let (project, change) = {
        let ledger = service.ledger.lock().map_err(|e| e.to_string())?;
        let saved = ledger
            .schedules
            .iter()
            .find(|s| s.definition.id == id)
            .ok_or("Schedule not found")?;
        let event = saved
            .history
            .iter()
            .chain(saved.last_notice.iter())
            .find(|e| e.due_at == due_at)
            .ok_or("This occurrence is no longer retained")?;
        let change = event
            .change
            .clone()
            .ok_or("No content change was recorded for this occurrence")?;
        let project = if change.project_path.is_empty() {
            saved.definition.request.project_path.clone()
        } else {
            change.project_path.clone()
        };
        (project, change)
    };
    tauri::async_runtime::spawn_blocking(move || super::monitors::inspect(&project, &change))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn schedule_save(
    definition: ScheduleDefinition,
    service: State<'_, Scheduler>,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || save_definition(definition, &service))
        .await
        .map_err(|e| e.to_string())?
}

fn save_definition(mut definition: ScheduleDefinition, service: &Scheduler) -> Result<(), String> {
    if uuid::Uuid::parse_str(&definition.id).is_err()
        || definition.name.trim().is_empty()
        || definition.name.len() > 160
        || !["skip", "once"].contains(&definition.missed.as_str())
        || (definition.request.prompt.trim().is_empty()
            && !definition
                .monitor
                .as_ref()
                .is_some_and(|m| m.action == super::monitors::MonitorAction::Notify))
        || definition.request.prompt.len() > 100_000
    {
        return Err("Provide a name, instructions and valid missed-run policy.".into());
    }
    definition.request.isolated = true;
    definition.request.previous_run_id = None;
    let monitor_only = definition
        .monitor
        .as_ref()
        .is_some_and(|m| m.action == super::monitors::MonitorAction::Notify);
    if !monitor_only {
        service
            .coordinator
            .runtime
            .apply_policy(&mut definition.request)?;
    }
    definition.request.target_branch = Some(super::tasks::resolve_target_branch(
        &definition.request.project_path,
        definition.request.target_branch.as_deref(),
    )?);
    if let Some(monitor) = &definition.monitor {
        let revision = monitor.observe(
            &definition.request.project_path,
            definition.request.target_branch.as_deref().unwrap(),
        )?;
        if revision == "absent" {
            return Err("Choose a path that exists on the saved local branch.".into());
        }
    }
    let account = if monitor_only {
        None
    } else {
        let (adapter, _) = service
            .coordinator
            .runtime
            .policy()?
            .resolve(&definition.request.agent)?;
        let account = super::agent_profiles::bind_account(
            &service.coordinator.runtime.profiles_root(),
            &adapter,
            definition.request.agent_profile_id.as_deref(),
        )?;
        definition.request.agent_profile_id = account.profile_id.clone();
        Some(account)
    };
    let next = next_at(&definition.expression, &definition.timezone, Utc::now())?;
    let mut ledger = service.ledger.lock().map_err(|e| e.to_string())?;
    let mut updated = ledger.clone();
    if let Some(saved) = updated
        .schedules
        .iter_mut()
        .find(|saved| saved.definition.id == definition.id)
    {
        if serde_json::to_value(&saved.definition.monitor).ok()
            != serde_json::to_value(&definition.monitor).ok()
            || saved.definition.request.project_path != definition.request.project_path
            || saved.definition.request.target_branch != definition.request.target_branch
        {
            saved.observed_revision = None;
            saved.last_notice = None;
            saved.local_checks = 0;
            saved.quiet_checks = 0;
        }
        saved.definition = definition;
        saved.next_at = next;
        saved.account = account;
    } else {
        if updated.schedules.len() >= 100 {
            return Err("This profile already has 100 schedules.".into());
        }
        updated.schedules.push(SavedSchedule {
            last_notice: None,
            observed_revision: None,
            local_checks: 0,
            quiet_checks: 0,
            definition,
            next_at: next,
            history: vec![],
            last_run_id: None,
            account,
        });
    }
    service.persist(&updated)?;
    *ledger = updated;
    Ok(())
}

#[tauri::command]
pub fn schedule_remove(id: String, service: State<'_, Scheduler>) -> Result<(), String> {
    let mut ledger = service.ledger.lock().map_err(|e| e.to_string())?;
    let mut updated = ledger.clone();
    updated.schedules.retain(|saved| saved.definition.id != id);
    service.persist(&updated)?;
    *ledger = updated;
    Ok(())
}

#[tauri::command]
pub fn schedule_set_enabled(
    id: String,
    enabled: bool,
    service: State<'_, Scheduler>,
) -> Result<(), String> {
    let mut ledger = service.ledger.lock().map_err(|e| e.to_string())?;
    let mut updated = ledger.clone();
    let saved = updated
        .schedules
        .iter_mut()
        .find(|s| s.definition.id == id)
        .ok_or("Schedule not found")?;
    saved.definition.enabled = enabled;
    if enabled {
        saved.next_at = next_at(
            &saved.definition.expression,
            &saved.definition.timezone,
            Utc::now(),
        )?;
    }
    service.persist(&updated)?;
    *ledger = updated;
    Ok(())
}

#[cfg(test)]
mod monitor_tests;
#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn fixture(missed: &str) -> (PathBuf, Scheduler) {
        let directory =
            std::env::temp_dir().join(format!("jackalope-schedule-{}", uuid::Uuid::new_v4()));
        let runtime = super::super::tasks::TaskRuntime::new(directory.clone()).unwrap();
        let coordinator = Coordinator::new(directory.join("coordination"), runtime).unwrap();
        let scheduler = Scheduler::new(directory.join("schedules.json"), coordinator);
        let definition: ScheduleDefinition = serde_json::from_value(serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(), "name": "Fixture", "expression": "0 * * * *", "timezone": "UTC", "missed": missed, "enabled": true,
            "request": { "id": "unused", "projectId": "fixture", "projectName": "Fixture", "projectPath": directory.to_string_lossy(), "agent": "missing-agent", "prompt": "Do not execute", "isolated": true }
        })).unwrap();
        scheduler
            .ledger
            .lock()
            .unwrap()
            .schedules
            .push(SavedSchedule {
                last_notice: None,
                observed_revision: None,
                local_checks: 0,
                quiet_checks: 0,
                definition,
                next_at: DateTime::parse_from_rfc3339("2026-09-06T09:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
                history: vec![],
                last_run_id: None,
                account: None,
            });
        (directory, scheduler)
    }
    #[test]
    #[cfg(windows)]
    fn due_schedule_dispatches_once_and_skips_overlap() {
        use super::super::agent_policy::{AgentPolicy, CustomAgent};
        let (directory, scheduler) = fixture("once");
        let repo = directory.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec![
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Fixture",
            ],
        ] {
            assert!(std::process::Command::new("git")
                .args(args)
                .current_dir(&repo)
                .output()
                .unwrap()
                .status
                .success());
        }
        let executable = directory.join("fixture.cmd");
        std::fs::write(&executable, "@echo off\r\nset /p TASK_INPUT=\r\nping -n 3 127.0.0.1 >nul\r\necho {\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Scheduled fixture complete\"}}\r\n").unwrap();
        let mut policy = AgentPolicy::default();
        policy.custom_agents.push(CustomAgent {
            id: "fixture".into(),
            name: "Fixture".into(),
            command: executable.to_string_lossy().into(),
            adapter: Some("codex".into()),
        });
        std::fs::create_dir_all(
            scheduler
                .coordinator
                .runtime
                .policy_path()
                .parent()
                .unwrap(),
        )
        .unwrap();
        std::fs::write(
            scheduler.coordinator.runtime.policy_path(),
            serde_json::to_vec(&policy).unwrap(),
        )
        .unwrap();
        let now = Utc::now();
        {
            let mut ledger = scheduler.ledger.lock().unwrap();
            let saved = &mut ledger.schedules[0];
            saved.next_at = now;
            saved.definition.request.agent = "fixture".into();
            saved.definition.request.project_path = repo.to_string_lossy().into();
            saved.definition.request.connection_ids = Some(vec![]);
            saved.account = Some(
                super::super::agent_profiles::bind_account(
                    &scheduler.coordinator.runtime.profiles_root(),
                    "codex",
                    None,
                )
                .unwrap(),
            );
        }
        scheduler.tick(now).unwrap();
        scheduler.tick(now).unwrap();
        let next = {
            let ledger = scheduler.ledger.lock().unwrap();
            assert_eq!(ledger.schedules[0].history.len(), 1);
            assert_eq!(ledger.schedules[0].history[0].outcome, "Started");
            ledger.schedules[0].next_at
        };
        scheduler.tick(next).unwrap();
        assert!(scheduler.ledger.lock().unwrap().schedules[0].history[1]
            .outcome
            .contains("earlier run"));
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        loop {
            let runs = scheduler.coordinator.runtime.integration_runs().unwrap();
            assert_eq!(runs.len(), 1);
            if !["starting", "running"].contains(&runs[0].status.as_str()) {
                assert_eq!(runs[0].status, "review", "{:?}", runs[0].error);
                assert_eq!(runs[0].result, "Scheduled fixture complete");
                assert_ne!(runs[0].workspace, repo.to_string_lossy());
                break;
            }
            if std::time::Instant::now() > deadline {
                scheduler.coordinator.runtime.stop_all();
                panic!("Scheduled fixture timed out");
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        drop(scheduler);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn missed_run_is_consumed_once_and_restart_preserves_its_history() {
        for policy in ["skip", "once"] {
            let (directory, scheduler) = fixture(policy);
            let now = DateTime::parse_from_rfc3339("2026-09-06T12:30:00Z")
                .unwrap()
                .with_timezone(&Utc);
            scheduler.tick(now).unwrap();
            scheduler.tick(now).unwrap();
            let ledger = scheduler.ledger.lock().unwrap();
            assert_eq!(ledger.schedules[0].history.len(), 1);
            assert_eq!(
                ledger.schedules[0].next_at.to_rfc3339(),
                "2026-09-06T13:00:00+00:00"
            );
            if policy == "skip" {
                assert!(ledger.schedules[0].history[0]
                    .outcome
                    .starts_with("Skipped"));
            } else {
                assert!(ledger.schedules[0].history[0]
                    .outcome
                    .starts_with("Failed to start"));
            }
            drop(ledger);
            let reopened = Scheduler::new(scheduler.path.clone(), scheduler.coordinator.clone());
            reopened.tick(now).unwrap();
            assert_eq!(
                reopened.ledger.lock().unwrap().schedules[0].history.len(),
                1
            );
            drop(reopened);
            drop(scheduler);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }
    #[test]
    fn persistence_failure_prevents_dispatch_and_keeps_the_occurrence_due() {
        let (directory, scheduler) = fixture("once");
        std::fs::create_dir(&scheduler.path).unwrap();
        let before = scheduler.ledger.lock().unwrap().schedules[0].next_at;
        assert!(scheduler.tick(before).is_err());
        assert!(scheduler.ledger.lock().unwrap().schedules[0]
            .history
            .is_empty());
        assert!(scheduler
            .coordinator
            .runtime
            .integration_runs()
            .unwrap()
            .is_empty());
        drop(scheduler);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn corrupt_schedules_are_preserved_and_errors_reach_the_ui() {
        let (directory, scheduler) = fixture("skip");
        std::fs::write(&scheduler.path, "broken").unwrap();
        let reopened = Scheduler::new(scheduler.path.clone(), scheduler.coordinator.clone());
        let data = serde_json::to_value(reopened.ledger.lock().unwrap().clone()).unwrap();
        assert!(data["error"].as_str().unwrap().contains("preserved"));
        assert_eq!(std::fs::read_to_string(&scheduler.path).unwrap(), "broken");
        drop(reopened);
        drop(scheduler);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn weekday_and_timezone_are_respected() {
        let friday = DateTime::parse_from_rfc3339("2026-09-04T16:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            next_at("0 9 * * 1-5", "America/Denver", friday)
                .unwrap()
                .to_rfc3339(),
            "2026-09-07T15:00:00+00:00"
        );
        assert!(next_at("0 9 1 * 1", "UTC", friday).is_err());
        assert!(next_at("0 9 * * *", "Invalid", friday).is_err());
    }
    #[test]
    fn timezone_follows_daylight_saving_transition() {
        let before = DateTime::parse_from_rfc3339("2026-03-07T17:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            next_at("0 9 * * *", "America/Denver", before)
                .unwrap()
                .to_rfc3339(),
            "2026-03-08T15:00:00+00:00"
        );
    }
}
