//! Swarm rounds. An approved swarm plan runs its assignments as a managed task;
//! once their result is merged (by the person or under the autonomy policy), a
//! read-only orchestrator attempt reviews the integrated tree against the
//! plan's acceptance criteria. It declares the plan done, with evidence and a
//! passing check when the plan has one, or names the next round's assignments,
//! which run like the first. Rounds stop at the plan's round limit, pause and
//! stop with the plan, and start paused after a restart like all dispatch.

use super::{
    artifact::PlanDocument,
    handoff, interview, session,
    store::{PlanRecord, Round, RoundCheck, Store},
};
use crate::commands::{
    coordination::{managed::PlanLink, planned::PlanLaunch, Coordinator},
    tasks::TaskRun,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const DEFAULT_ROUNDS: u32 = 5;
pub const MAX_ROUNDS: u32 = 20;
/// Automatic orchestrator retries per round before it waits for the person.
const RETRIES: u32 = 1;
const INTERVAL: Duration = Duration::from_secs(3);
const MAX_VERDICT_BYTES: usize = 48_000;
/// Assignments a verdict may name; the round's launch applies the project's own limit.
const MAX_NEXT: usize = 24;

#[derive(Default)]
struct State {
    /// Plans whose rounds may still advance. Loaded from the store once.
    active: Option<HashSet<String>>,
    /// Plans the person resumed in this session, so a round whose merged task
    /// no longer dispatches can still be reviewed. Empty after a restart.
    resumed: HashSet<String>,
    last: Option<Instant>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with_state<T>(change: impl FnOnce(&mut State) -> T) -> T {
    let mut guard = STATE.lock().unwrap_or_else(|error| error.into_inner());
    change(guard.get_or_insert_with(State::default))
}

/// Marks a plan whose rounds may advance; approval and resume call this.
pub(super) fn activate(id: &str, resumed: bool) {
    with_state(|state| {
        if let Some(active) = &mut state.active {
            active.insert(id.into());
        }
        if resumed {
            state.resumed.insert(id.into());
        }
    });
}

fn deactivate(id: &str) {
    with_state(|state| {
        if let Some(active) = &mut state.active {
            active.remove(id);
        }
        state.resumed.remove(id);
    });
}

fn resumed(id: &str) -> bool {
    with_state(|state| state.resumed.contains(id))
}

/// Whether a plan's execution runs in rounds. Executions saved before rounds
/// existed, and every non-swarm execution, have a zero round limit.
pub fn in_rounds(record: &PlanRecord) -> bool {
    record
        .execution
        .as_ref()
        .is_some_and(|execution| execution.max_rounds > 0 && !execution.rounds.is_empty())
}

fn open(record: &PlanRecord) -> bool {
    in_rounds(record)
        && !record.archived
        && record.status() != "done"
        && record
            .execution
            .as_ref()
            .and_then(|execution| execution.rounds.last())
            .is_some_and(|round| round.verdict.is_empty())
}

fn active(status: &str) -> bool {
    ["starting", "running", "stopping", "routing", "queued"].contains(&status)
}

/// An assignment the orchestrator names for the next round.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoundAssignment {
    pub key: String,
    pub title: String,
    pub prompt: String,
    pub scopes: Vec<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Criterion IDs the assignment satisfies; they become its requirements.
    #[serde(default)]
    pub covers: Vec<String>,
    #[serde(default)]
    pub briefing: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Verdict {
    Done {
        summary: String,
        evidence: Vec<String>,
    },
    Next {
        summary: String,
        evidence: Vec<String>,
        assignments: Vec<RoundAssignment>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVerdict {
    verdict: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    evidence: Vec<String>,
    #[serde(default)]
    assignments: Vec<RoundAssignment>,
}

fn clip(text: &str, limit: usize) -> String {
    text.trim().chars().take(limit).collect()
}

/// Reads the orchestrator's final message: one JSON object, optionally fenced
/// or preceded by prose.
pub fn parse_verdict(text: &str) -> Result<Verdict, String> {
    let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) else {
        return Err("The orchestrator did not return a verdict.".into());
    };
    let body = &text[start..=end.max(start)];
    if body.len() > MAX_VERDICT_BYTES {
        return Err("The orchestrator's verdict is too large.".into());
    }
    let raw: RawVerdict = serde_json::from_str(body)
        .map_err(|error| format!("The orchestrator's verdict is not valid JSON: {error}."))?;
    let summary = clip(&raw.summary, 2000);
    let evidence: Vec<String> = raw
        .evidence
        .iter()
        .map(|item| clip(item, 500))
        .filter(|item| !item.is_empty())
        .take(24)
        .collect();
    match raw.verdict.trim().to_ascii_lowercase().as_str() {
        "done" if evidence.is_empty() => {
            Err("A done verdict needs evidence for each acceptance criterion.".into())
        }
        "done" => Ok(Verdict::Done { summary, evidence }),
        "next" if raw.assignments.is_empty() => {
            Err("A next verdict needs the next round's assignments.".into())
        }
        "next" if raw.assignments.len() > MAX_NEXT => Err(format!(
            "Name at most {MAX_NEXT} assignments for the next round."
        )),
        "next" => Ok(Verdict::Next {
            summary,
            evidence,
            assignments: raw.assignments,
        }),
        _ => Err("The verdict must be done or next.".into()),
    }
}

fn protected(scope: &str) -> bool {
    let scope = scope
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_ascii_lowercase();
    scope == ".jackalope" || scope.starts_with(".jackalope/")
}

/// The next round's assignments in the managed-task JSON shape, so the usual
/// plan validation (limits, scopes, overlap and cycles) applies at launch.
/// Agents never own the project's gates and policy under `.jackalope`.
pub fn assignments(
    doc: &PlanDocument,
    round: u32,
    next: &[RoundAssignment],
) -> Result<String, String> {
    let mut value = vec![];
    for assignment in next {
        if assignment.scopes.iter().any(|scope| protected(scope)) {
            return Err(
                "Round assignments may not change .jackalope; gates and policy belong to the person."
                    .into(),
            );
        }
        let covers: Vec<String> = assignment
            .covers
            .iter()
            .filter(|id| doc.criteria.iter().any(|criterion| &criterion.id == *id))
            .cloned()
            .collect();
        value.push(serde_json::json!({
            "key": assignment.key,
            "title": clip(&assignment.title, 160),
            "prompt": format!(
                "Swarm round {round}: {}{} Other assignments belong to other workers; the plan below is shared context.",
                assignment.prompt.trim(),
                if covers.is_empty() { String::new() } else { format!(" It satisfies {}.", covers.join(", ")) }
            ),
            "scopes": assignment.scopes,
            "dependsOn": assignment.depends_on,
            "outcomes": if covers.is_empty() { vec![] } else { handoff::outcomes(doc, &covers) },
            "briefing": clip(&assignment.briefing, 4000),
        }));
    }
    serde_json::to_string(&value).map_err(|error| error.to_string())
}

/// What one finished orchestrator attempt means for its round.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Done {
        summary: String,
        evidence: Vec<String>,
        check: Option<RoundCheck>,
    },
    Next {
        summary: String,
        evidence: Vec<String>,
        assignments: String,
        titles: Vec<String>,
    },
    /// Review the round again, telling the orchestrator why.
    Retry(String),
}

/// A done verdict stands only when the plan's check passed on the integrated
/// tree in the orchestrator's own attempt.
pub fn decide(doc: &PlanDocument, round: u32, run: &TaskRun, check: Option<&str>) -> Outcome {
    if !matches!(run.status.as_str(), "review" | "reviewed") || run.error.is_some() {
        return Outcome::Retry(format!(
            "The orchestrator attempt ended without a verdict ({}).",
            run.error.as_deref().unwrap_or(&run.status)
        ));
    }
    match parse_verdict(&run.result) {
        Err(error) => Outcome::Retry(error),
        Ok(Verdict::Done { summary, evidence }) => {
            let Some(command) = check else {
                return Outcome::Done {
                    summary,
                    evidence,
                    check: None,
                };
            };
            match run.verification.as_ref().filter(|ran| ran.command == command) {
                Some(ran) if ran.result.success => Outcome::Done {
                    summary,
                    evidence,
                    check: Some(RoundCheck {
                        command: command.into(),
                        passed: true,
                    }),
                },
                Some(_) => Outcome::Retry("You declared done, but the project's check failed on the integrated tree. Name the work that fixes it as next assignments.".into()),
                None => Outcome::Retry("You declared done without running the project's check. Call computer_verify with {} and decide again.".into()),
            }
        }
        Ok(Verdict::Next {
            summary,
            evidence,
            assignments: next,
        }) => match assignments(doc, round + 1, &next) {
            Ok(assignments) => Outcome::Next {
                summary,
                evidence,
                assignments,
                titles: next.iter().map(|item| clip(&item.title, 160)).collect(),
            },
            Err(error) => Outcome::Retry(error),
        },
    }
}

/// What the driver does next for a plan's current round.
#[derive(Debug, PartialEq)]
pub enum Step {
    Wait,
    /// Start an orchestrator attempt on the integrated tree.
    Review,
    /// Read the finished attempt's verdict.
    Read(String),
    /// The attempt disappeared; wait for the person.
    Hold(String),
}

pub fn step(round: &Round, merged: bool, enabled: bool, runs: &[TaskRun]) -> Step {
    if !round.verdict.is_empty() || round.held.is_some() || !merged || !enabled {
        return Step::Wait;
    }
    let Some(id) = round.review_run_ids.last() else {
        return Step::Review;
    };
    if round.handled.contains(id) {
        return Step::Review;
    }
    match runs.iter().find(|run| &run.id == id) {
        None => Step::Hold(
            "The orchestrator attempt is missing from task history. Resume to review the round again."
                .into(),
        ),
        Some(run) if active(&run.status) || run.finishing => Step::Wait,
        Some(_) => Step::Read(id.clone()),
    }
}

fn history(rounds: &[Round]) -> String {
    rounds
        .iter()
        .filter(|round| !round.verdict.is_empty())
        .map(|round| {
            format!(
                "- Round {}: {} — {}{}\n",
                round.number,
                round.verdict,
                round.summary,
                if round.next.is_empty() {
                    String::new()
                } else {
                    format!(" Next: {}.", round.next.join("; "))
                }
            )
        })
        .collect()
}

/// The orchestrator's brief for reviewing one round's integrated result.
pub fn review_prompt(
    doc: &PlanDocument,
    round: &Round,
    rounds: &[Round],
    max_rounds: u32,
    check: Option<&str>,
) -> String {
    let check = match check {
        Some(command) => format!("Call computer_verify with {{}} to run the project's check (`{command}`) on this tree; a done verdict stands only when it passes."),
        None => "The project has no saved check: exercise each criterion yourself with read-only commands.".into(),
    };
    let earlier = history(rounds);
    let note = if round.note.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nYour previous review of this round was not accepted: {}",
            round.note
        )
    };
    format!(
        "You are the swarm orchestrator reviewing round {number} of at most {max_rounds}. Work read-only: do not edit, create or delete files, install dependencies, commit or launch agents. This workspace is the target branch with every earlier round's work merged.\n\n\
Review the integrated tree against every acceptance criterion of the approved plan below. {check}\n\n\
Then decide. Declare done only when every criterion is met, with one evidence line per criterion (\"AC-n: how you know\"). Otherwise name the next round's assignments: work that remains, fixes for failed checks or criteria, and integration gaps. Keep tightly coupled work and its tests together, give each shared contract one owner, make dependent work sequential, and keep independent assignments' scopes apart. Never assign files under .jackalope; gates and policy belong to the person.\n\n\
Return ONLY one JSON object:\n\
{{\"verdict\":\"done\"|\"next\",\"summary\":\"<two sentences>\",\"evidence\":[\"AC-1: ...\"],\"assignments\":[{{\"key\":\"...\",\"title\":\"...\",\"prompt\":\"<self-contained instructions>\",\"scopes\":[\"relative/path\"],\"dependsOn\":[],\"covers\":[\"AC-1\"],\"briefing\":\"<facts the worker needs, under 1500 characters>\"}}]}}\n\
Leave assignments empty when done.{note}\n\n\
Earlier rounds:\n{earlier}\n\nApproved plan:\n{plan}",
        number = round.number,
        earlier = if earlier.is_empty() { "- None\n".into() } else { earlier },
        plan = doc.render(),
    )
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundView {
    pub number: u32,
    pub managed_task_id: String,
    /// `working`, `reviewing`, `held`, `done`, `next` or `limit`.
    pub state: String,
    pub summary: String,
    pub evidence: Vec<String>,
    pub check: Option<RoundCheck>,
    pub next: Vec<String>,
    pub held: Option<String>,
    pub review_run_id: Option<String>,
    pub decided_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundsView {
    pub current: u32,
    pub max: u32,
    /// The current round waits for the person to resume it.
    pub paused: bool,
    pub rounds: Vec<RoundView>,
}

pub fn view(
    coordinator: &Coordinator,
    record: &PlanRecord,
    runs: &[TaskRun],
) -> Option<RoundsView> {
    if !in_rounds(record) {
        return None;
    }
    let execution = record.execution.as_ref()?;
    let current = execution.rounds.last()?;
    let delivery = coordinator.plan_delivery(&current.managed_task_id).ok();
    let merged = delivery
        .as_ref()
        .is_some_and(|delivery| delivery.applied_at.is_some());
    let dispatching = delivery
        .as_ref()
        .is_some_and(|delivery| delivery.dispatching);
    let rounds = execution
        .rounds
        .iter()
        .map(|round| {
            let review = round
                .review_run_ids
                .last()
                .and_then(|id| runs.iter().find(|run| &run.id == id));
            let state = if !round.verdict.is_empty() {
                round.verdict.clone()
            } else if round.held.is_some() {
                "held".into()
            } else if review.is_some_and(|run| active(&run.status) || run.finishing)
                || (round.number == current.number && merged)
            {
                "reviewing".into()
            } else {
                "working".into()
            };
            RoundView {
                number: round.number,
                managed_task_id: round.managed_task_id.clone(),
                state,
                summary: round.summary.clone(),
                evidence: round.evidence.clone(),
                check: round.check.clone(),
                next: round.next.clone(),
                held: round.held.clone(),
                review_run_id: round.review_run_ids.last().cloned(),
                decided_at: round.decided_at.clone(),
            }
        })
        .collect();
    Some(RoundsView {
        current: current.number,
        max: execution.max_rounds,
        paused: current.verdict.is_empty()
            && (current.held.is_some() || !(dispatching || resumed(&record.id))),
        rounds,
    })
}

/// Advances every open swarm plan by at most one step. Runs on the
/// dispatcher thread without coordinator locks held, like automatic starts.
pub fn tick(coordinator: &Coordinator) {
    let due = with_state(|state| {
        if state.last.is_some_and(|last| last.elapsed() < INTERVAL) {
            return false;
        }
        state.last = Some(Instant::now());
        true
    });
    if !due {
        return;
    }
    let store = session::store(coordinator);
    if with_state(|state| state.active.is_none()) {
        let Ok((plans, _)) = store.list(None) else {
            return;
        };
        let open: HashSet<String> = plans
            .iter()
            .filter(|plan| open(plan))
            .map(|plan| plan.id.clone())
            .collect();
        with_state(|state| state.active = Some(open));
    }
    let ids: Vec<String> = with_state(|state| state.active.iter().flatten().cloned().collect());
    if ids.is_empty() {
        return;
    }
    let Ok(runs) = coordinator.runtime.integration_runs() else {
        return;
    };
    for id in ids {
        if let Err(error) = advance(coordinator, &store, &id, &runs) {
            // Written once, so a lasting failure does not rewrite the plan every tick.
            if store.load(&id).ok().and_then(|saved| saved.error) != Some(error.clone()) {
                let _ = store.update(&id, |saved| {
                    saved.error = Some(error.clone());
                    Ok(())
                });
            }
        }
    }
}

fn current<'a>(saved: &'a mut PlanRecord) -> Result<&'a mut Round, String> {
    saved
        .execution
        .as_mut()
        .and_then(|execution| execution.rounds.last_mut())
        .ok_or_else(|| "This plan has no swarm round.".to_string())
}

/// The check the plan's work runs with, from the round's managed task.
fn check_of(coordinator: &Coordinator, round: &Round) -> Option<String> {
    coordinator
        .plan_template(&round.managed_task_id)
        .and_then(|(request, _)| request.verify_command)
        .filter(|command| !command.trim().is_empty())
}

fn advance(
    coordinator: &Coordinator,
    store: &Store,
    id: &str,
    runs: &[TaskRun],
) -> Result<(), String> {
    let Ok(record) = store.load(id) else {
        deactivate(id);
        return Ok(());
    };
    if !open(&record) {
        deactivate(id);
        return Ok(());
    }
    let execution = record.execution.as_ref().unwrap();
    let round = execution.rounds.last().unwrap();
    let delivery = match coordinator.plan_delivery(&round.managed_task_id) {
        Ok(delivery) => delivery,
        Err(error) => {
            if round.held.is_none() {
                store.update(id, |saved| {
                    current(saved)?.held = Some(error.clone());
                    Ok(())
                })?;
            }
            return Ok(());
        }
    };
    let enabled =
        (delivery.dispatching || resumed(id)) && session::pending_deviation(&record).is_none();
    match step(round, delivery.applied_at.is_some(), enabled, runs) {
        Step::Wait => {
            // Keep a live attempt read-only after the planning registry restarts.
            if let Some(run) = round
                .review_run_ids
                .last()
                .and_then(|run_id| runs.iter().find(|run| &run.id == run_id))
                .filter(|run| active(&run.status) || run.finishing)
            {
                super::register_run(&run.id, &record.id, 0, 0);
            }
            Ok(())
        }
        Step::Hold(reason) => {
            store.update(id, |saved| {
                let round = current(saved)?;
                if let Some(last) = round.review_run_ids.last().cloned() {
                    round.handled.push(last);
                }
                round.held = Some(reason.clone());
                Ok(())
            })?;
            Ok(())
        }
        Step::Review => start_review(coordinator, store, &record),
        Step::Read(run_id) => {
            let run = runs.iter().find(|run| run.id == run_id).unwrap();
            read(coordinator, store, &record, run)
        }
    }
}

fn start_review(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
) -> Result<(), String> {
    let doc = record.document().ok_or("The plan could not be read.")?;
    let execution = record.execution.as_ref().unwrap();
    let round = execution.rounds.last().unwrap();
    let check = check_of(coordinator, round);
    let settings = store.settings(&record.project_id);
    let prompt = review_prompt(
        &doc,
        round,
        &execution.rounds,
        execution.max_rounds,
        check.as_deref(),
    );
    let mut request = session::planning_request(&record.request, &settings, prompt);
    // computer_verify runs the plan's check; the attempt itself stays read-only.
    request.verify_command = check;
    store.update(&record.id, |saved| {
        let round = current(saved)?;
        round.review_run_ids.push(request.id.clone());
        round.note.clear();
        Ok(())
    })?;
    // No questions: the orchestrator decides from the code, the check and the plan.
    super::register_run(&request.id, &record.id, 0, 0);
    if let Err(error) = coordinator.start_manual(request) {
        store.update(&record.id, |saved| {
            let round = current(saved)?;
            if let Some(last) = round.review_run_ids.last().cloned() {
                round.handled.push(last);
            }
            round.held = Some(format!("The orchestrator review did not start: {error}"));
            Ok(())
        })?;
    }
    Ok(())
}

fn read(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
    run: &TaskRun,
) -> Result<(), String> {
    let doc = record.document().ok_or("The plan could not be read.")?;
    let execution = record.execution.as_ref().unwrap();
    let round = execution.rounds.last().unwrap();
    let outcome = decide(
        &doc,
        round.number,
        run,
        check_of(coordinator, round).as_deref(),
    );
    let now = Utc::now().to_rfc3339();
    let settle = |saved: &mut PlanRecord,
                  verdict: &str,
                  summary: &str,
                  evidence: &[String]|
     -> Result<(), String> {
        let round = current(saved)?;
        round.handled.push(run.id.clone());
        round.verdict = verdict.into();
        round.summary = summary.into();
        round.evidence = evidence.to_vec();
        round.decided_at = Some(now.clone());
        Ok(())
    };
    match outcome {
        Outcome::Done {
            summary,
            evidence,
            check,
        } => {
            let (saved, _) = store.update(&record.id, |saved| {
                settle(saved, "done", &summary, &evidence)?;
                current(saved)?.check = check.clone();
                saved.error = None;
                session::set_front(saved, |front| front.status = "done".into())
            })?;
            deactivate(&record.id);
            let runs = coordinator.runtime.integration_runs()?;
            let criteria = session::progress(coordinator, &saved, &doc, &runs)
                .map(|(_, evidence)| handoff::criterion_states(&doc, &evidence))
                .unwrap_or_else(|| handoff::criterion_states(&doc, &[]));
            super::learning::reflect(coordinator, store, &saved, &doc, &criteria);
            Ok(())
        }
        Outcome::Next {
            summary,
            evidence,
            assignments,
            titles,
        } => {
            if execution.rounds.len() as u32 >= execution.max_rounds {
                let limit = execution.max_rounds;
                store.update(&record.id, |saved| {
                    settle(saved, "limit", &summary, &evidence)?;
                    current(saved)?.next = titles.clone();
                    saved.error = Some(format!("The swarm reached its {limit}-round limit with work left. Re-plan to continue."));
                    Ok(())
                })?;
                deactivate(&record.id);
                return Ok(());
            }
            match launch(coordinator, record, &doc, round, &summary, assignments) {
                Ok(managed) => {
                    let number = round.number + 1;
                    store.update(&record.id, |saved| {
                        settle(saved, "next", &summary, &evidence)?;
                        current(saved)?.next = titles.clone();
                        let execution = saved.execution.as_mut().unwrap();
                        execution.managed_task_id = Some(managed.clone());
                        execution.rounds.push(Round {
                            number,
                            managed_task_id: managed.clone(),
                            started_at: now.clone(),
                            ..Default::default()
                        });
                        saved.error = None;
                        Ok(())
                    })?;
                    Ok(())
                }
                Err(error) => retry(store, record, run, error),
            }
        }
        Outcome::Retry(reason) => retry(store, record, run, reason),
    }
}

fn retry(store: &Store, record: &PlanRecord, run: &TaskRun, reason: String) -> Result<(), String> {
    store.update(&record.id, |saved| {
        let round = current(saved)?;
        round.handled.push(run.id.clone());
        if round.retries < RETRIES {
            round.retries += 1;
            round.note = reason.clone();
        } else {
            round.held = Some(reason.clone());
        }
        Ok(())
    })?;
    Ok(())
}

/// Starts the next round as a managed task with the first round's checks,
/// agent and reviewer.
fn launch(
    coordinator: &Coordinator,
    record: &PlanRecord,
    doc: &PlanDocument,
    round: &Round,
    summary: &str,
    assignments: String,
) -> Result<String, String> {
    let (mut request, link) = coordinator
        .plan_template(&round.managed_task_id)
        .ok_or("The previous round's task is no longer in the queue.")?;
    let number = round.number + 1;
    request.id = Uuid::new_v4().to_string();
    request.previous_run_id = None;
    request.retry_of = None;
    request.prompt = format!(
        "{}\n\nSwarm round {number}. Earlier rounds are merged into the target branch. The orchestrator's review of round {}: {summary}",
        interview::execution_brief(doc),
        round.number
    );
    let title: String = format!("{} · round {number}", doc.title)
        .chars()
        .take(160)
        .collect();
    coordinator.launch_plan(PlanLaunch {
        request,
        title,
        link: PlanLink {
            assignments,
            ..link
        },
        max_assignments: Some(coordinator.swarm_limit(&record.project_id)),
    })
}

/// `pause`, `resume` or `stop` a swarm's rounds and its current round's work.
pub fn action(coordinator: &Coordinator, id: &str, action: &str) -> Result<(), String> {
    if !["pause", "resume", "stop"].contains(&action) {
        return Err("Choose pause, resume or stop.".into());
    }
    let store = session::store(coordinator);
    let record = store.load(id)?;
    if !open(&record) {
        return Err("This plan has no swarm round to change.".into());
    }
    let round = record
        .execution
        .as_ref()
        .unwrap()
        .rounds
        .last()
        .unwrap()
        .clone();
    let delivery = coordinator.plan_delivery(&round.managed_task_id)?;
    if action == "resume" {
        if delivery.applied_at.is_none() && !delivery.dispatching {
            coordinator.plan_dispatch(&round.managed_task_id, "resume")?;
        }
        store.update(id, |saved| {
            let round = current(saved)?;
            round.held = None;
            round.retries = 0;
            saved.error = None;
            Ok(())
        })?;
        activate(id, true);
        return Ok(());
    }
    with_state(|state| state.resumed.remove(id));
    coordinator.plan_dispatch(&round.managed_task_id, action)?;
    if action == "stop" {
        let runs = coordinator.runtime.integration_runs()?;
        if let Some(run) = round
            .review_run_ids
            .last()
            .and_then(|run_id| runs.iter().find(|run| &run.id == run_id))
            .filter(|run| active(&run.status))
        {
            coordinator.runtime.stop(&run.id)?;
        }
    }
    Ok(())
}
