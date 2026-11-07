//! Swarm rounds. An approved swarm plan runs its assignments as a managed task;
//! once their result is merged (by the person or under the autonomy policy), a
//! read-only orchestrator attempt reviews the integrated tree against the
//! plan's acceptance criteria. It declares the plan done, with evidence and a
//! passing check when the plan has one, or names the next round's assignments,
//! which run like the first, or wait for the person's approval when the plan
//! asks first. Large plans may split the review into areas, each reviewed by
//! its own orchestrator attempt in parallel; their verdicts combine into the
//! round's. Rounds stop at the plan's round limit, pause and stop with the
//! plan, and start paused after a restart like all dispatch.

use super::{
    artifact::PlanDocument,
    handoff, interview, session,
    store::{AreaReview, PlanRecord, Round, RoundCheck, Store},
};
use crate::commands::{
    coordination::{managed::PlanLink, planned::PlanLaunch, Coordinator},
    tasks::TaskRun,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const DEFAULT_ROUNDS: u32 = 5;
pub const MAX_ROUNDS: u32 = 20;
/// Parallel orchestrators a round's review may use, one per area.
pub const MAX_ORCHESTRATORS: u32 = 4;
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

/// The current round's proposed assignments wait for a decision.
fn proposed(record: &PlanRecord) -> bool {
    open(record)
        && record
            .execution
            .as_ref()
            .and_then(|execution| execution.rounds.last())
            .is_some_and(|round| round.proposal.is_some())
}

/// The current round's proposed assignments wait for the person, not an agent.
pub fn awaiting(record: &PlanRecord) -> bool {
    proposed(record)
        && record
            .execution
            .as_ref()
            .and_then(|execution| execution.rounds.last())
            .is_some_and(|round| !round.agent_deciding)
}

/// An assignment the orchestrator names for the next round.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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

fn titles(items: &[RoundAssignment]) -> Vec<String> {
    items.iter().map(|item| clip(&item.title, 160)).collect()
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
        /// The validated assignments in the managed-task JSON shape.
        assignments: String,
        titles: Vec<String>,
        /// The assignments as named, for a proposal the person may edit.
        items: Vec<RoundAssignment>,
    },
    /// Review the round again, telling the orchestrator why.
    Retry(String),
}

/// A done verdict stands only when the plan's check passed on the integrated
/// tree in the orchestrator's own attempt.
pub fn decide(doc: &PlanDocument, round: u32, run: &TaskRun, check: Option<&str>) -> Outcome {
    if !run.status.is_done() || run.error.is_some() {
        return Outcome::Retry(format!(
            "The orchestrator attempt ended without a verdict ({}).",
            run.error.as_deref().unwrap_or(run.status.as_str())
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
                titles: titles(&next),
                items: next,
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

fn settled(round: &Round, merged: bool, enabled: bool) -> bool {
    !round.verdict.is_empty()
        || round.held.is_some()
        || round.proposal.is_some()
        || !merged
        || !enabled
}

pub fn step(round: &Round, merged: bool, enabled: bool, runs: &[TaskRun]) -> Step {
    if settled(round, merged, enabled) {
        return Step::Wait;
    }
    attempt_step(round.review_run_ids.last(), &round.handled, runs)
}

/// One step per area, in area order; an area with a verdict waits for the rest.
pub fn area_steps(round: &Round, merged: bool, enabled: bool, runs: &[TaskRun]) -> Vec<Step> {
    round
        .areas
        .iter()
        .map(|area| {
            if settled(round, merged, enabled) || !area.verdict.is_empty() {
                Step::Wait
            } else {
                attempt_step(area.run_ids.last(), &round.handled, runs)
            }
        })
        .collect()
}

fn attempt_step(last: Option<&String>, handled: &[String], runs: &[TaskRun]) -> Step {
    let Some(id) = last else {
        return Step::Review;
    };
    if handled.contains(id) {
        return Step::Review;
    }
    match runs.iter().find(|run| &run.id == id) {
        None => Step::Hold(
            "The orchestrator attempt is missing from task history. Resume to review the round again."
                .into(),
        ),
        Some(run) if run.status.is_active() || run.finishing => Step::Wait,
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
    area: Option<&AreaReview>,
) -> String {
    let check = match check {
        Some(command) => format!("Call computer_verify with {{}} to run the project's check (`{command}`) on this tree; a done verdict stands only when it passes."),
        None => "The project has no saved check: exercise each criterion yourself with read-only commands.".into(),
    };
    let earlier = history(rounds);
    let note = area.map_or(&round.note, |area| &area.note);
    let note = if note.is_empty() {
        String::new()
    } else {
        format!("\n\nYour previous review of this round was not accepted: {note}")
    };
    let area = match area {
        Some(area) => format!(
            "\n\nYou review one area of this plan: {} ({}). Other orchestrators review the other areas at the same time. Judge the criteria this area's work affects, declare done only when they are met here, and name next assignments only within these scopes unless an integration gap requires otherwise.",
            area.name,
            area.scopes.join(", ")
        ),
        None => String::new(),
    };
    format!(
        "You are the swarm orchestrator reviewing round {number} of at most {max_rounds}. Work read-only: do not edit, create or delete files, install dependencies, commit or launch agents. This workspace is the target branch with every earlier round's work merged.\n\n\
Review the integrated tree against every acceptance criterion of the approved plan below. {check}\n\n\
Then decide. Declare done only when every criterion is met, with one evidence line per criterion (\"AC-n: how you know\"). Otherwise name the next round's assignments: work that remains, fixes for failed checks or criteria, and integration gaps. Keep tightly coupled work and its tests together, give each shared contract one owner, make dependent work sequential, and keep independent assignments' scopes apart. Never assign files under .jackalope; gates and policy belong to the person.\n\n\
Return ONLY one JSON object:\n\
{{\"verdict\":\"done\"|\"next\",\"summary\":\"<two sentences>\",\"evidence\":[\"AC-1: ...\"],\"assignments\":[{{\"key\":\"...\",\"title\":\"...\",\"prompt\":\"<self-contained instructions>\",\"scopes\":[\"relative/path\"],\"dependsOn\":[],\"covers\":[\"AC-1\"],\"briefing\":\"<facts the worker needs, under 1500 characters>\"}}]}}\n\
Leave assignments empty when done.{area}{note}\n\n\
Earlier rounds:\n{earlier}\n\nApproved plan:\n{plan}",
        number = round.number,
        earlier = if earlier.is_empty() { "- None\n".into() } else { earlier },
        plan = doc.render(),
    )
}

fn normalize(scope: &str) -> String {
    scope
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_end_matches('/')
        .to_string()
}

/// Whether two scopes can touch the same files: equal, nested, or the root.
pub fn overlaps(a: &str, b: &str) -> bool {
    let (a, b) = (
        normalize(a).to_ascii_lowercase(),
        normalize(b).to_ascii_lowercase(),
    );
    let root = |scope: &str| scope.is_empty() || scope == ".";
    root(a.as_str())
        || root(b.as_str())
        || a == b
        || a.starts_with(&format!("{b}/"))
        || b.starts_with(&format!("{a}/"))
}

/// Splits a plan into at most `most` review areas by its tasks' scopes,
/// grouped under the shallowest path prefix that tells at least two apart and
/// balanced by scope count. Fewer than two areas means one orchestrator
/// reviews the whole plan.
pub fn partition(doc: &PlanDocument, most: u32) -> Vec<AreaReview> {
    let most = most.min(MAX_ORCHESTRATORS) as usize;
    if most < 2 {
        return vec![];
    }
    let scopes: Vec<String> = doc
        .tasks
        .iter()
        .flat_map(|task| task.scopes.iter())
        .map(|scope| normalize(scope))
        .filter(|scope| !scope.is_empty() && scope != ".")
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for depth in 1..=3 {
        groups.clear();
        for scope in &scopes {
            let key = scope.split('/').take(depth).collect::<Vec<_>>().join("/");
            groups.entry(key).or_default().push(scope.clone());
        }
        if groups.len() >= 2 {
            break;
        }
    }
    if groups.len() < 2 {
        return vec![];
    }
    let mut sorted: Vec<(String, Vec<String>)> = groups.into_iter().collect();
    sorted.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0)));
    let mut bins: Vec<(Vec<String>, Vec<String>)> = vec![(vec![], vec![]); most.min(sorted.len())];
    for (name, members) in sorted {
        // The first of the least-loaded bins, so the split is deterministic.
        if let Some(bin) = bins.iter_mut().min_by_key(|bin| bin.1.len()) {
            bin.0.push(name);
            bin.1.extend(members);
        }
    }
    bins.into_iter()
        .map(|(names, scopes)| AreaReview {
            name: names.join(", "),
            scopes,
            ..Default::default()
        })
        .collect()
}

fn same_work(a: &RoundAssignment, b: &RoundAssignment) -> bool {
    let scopes = |item: &RoundAssignment| {
        let mut scopes: Vec<String> = item
            .scopes
            .iter()
            .map(|scope| normalize(scope).to_ascii_lowercase())
            .collect();
        scopes.sort();
        scopes
    };
    (a.key == b.key || a.title.trim().eq_ignore_ascii_case(b.title.trim()))
        && scopes(a) == scopes(b)
}

/// Combines the areas' next assignments: work two areas both named runs once,
/// colliding keys get an area suffix, and work whose scopes overlap an earlier
/// area's runs after it, so the round's usual scope validation holds.
pub fn merge_assignments(areas: &[AreaReview]) -> Vec<RoundAssignment> {
    let mut merged: Vec<RoundAssignment> = vec![];
    for (index, area) in areas.iter().enumerate() {
        if area.verdict != "next" {
            continue;
        }
        let start = merged.len();
        let mut keys: HashMap<String, String> = HashMap::new();
        let mut fresh: Vec<RoundAssignment> = vec![];
        for item in &area.assignments {
            if let Some(same) = merged[..start]
                .iter()
                .find(|earlier| same_work(earlier, item))
            {
                keys.insert(item.key.clone(), same.key.clone());
                continue;
            }
            let mut key = item.key.clone();
            let mut suffix = index + 1;
            while merged
                .iter()
                .chain(fresh.iter())
                .any(|other| other.key == key)
            {
                key = format!("{}-{suffix}", item.key);
                suffix += 1;
            }
            keys.insert(item.key.clone(), key.clone());
            fresh.push(RoundAssignment {
                key,
                ..item.clone()
            });
        }
        for mut item in fresh {
            let mut depends: Vec<String> = vec![];
            for dependency in &item.depends_on {
                let dependency = keys.get(dependency).unwrap_or(dependency).clone();
                if !depends.contains(&dependency) {
                    depends.push(dependency);
                }
            }
            for earlier in &merged[..start] {
                let touches = earlier
                    .scopes
                    .iter()
                    .any(|a| item.scopes.iter().any(|b| overlaps(a, b)));
                if touches && !depends.contains(&earlier.key) {
                    depends.push(earlier.key.clone());
                }
            }
            item.depends_on = depends;
            merged.push(item);
        }
    }
    merged.truncate(MAX_NEXT);
    let kept: HashSet<String> = merged.iter().map(|item| item.key.clone()).collect();
    for item in &mut merged {
        item.depends_on
            .retain(|dependency| kept.contains(dependency));
    }
    merged
}

/// The round's verdict from its areas' verdicts. Done only when every area is
/// done; each area's done already required the plan's check to pass on the
/// integrated tree in its own attempt.
pub fn merge(doc: &PlanDocument, round: u32, areas: &[AreaReview]) -> Outcome {
    let summary = clip(
        &areas
            .iter()
            .map(|area| format!("{}: {}", area.name, area.summary.trim()))
            .collect::<Vec<_>>()
            .join(" "),
        2000,
    );
    let evidence: Vec<String> = areas
        .iter()
        .flat_map(|area| {
            area.evidence
                .iter()
                .map(move |line| format!("{} · {line}", area.name))
        })
        .take(48)
        .collect();
    if areas.iter().all(|area| area.verdict == "done") {
        return Outcome::Done {
            summary,
            evidence,
            check: areas.iter().find_map(|area| area.check.clone()),
        };
    }
    let next = merge_assignments(areas);
    if next.is_empty() {
        return Outcome::Retry("The areas named no next assignments.".into());
    }
    match assignments(doc, round + 1, &next) {
        Ok(assignments) => Outcome::Next {
            summary,
            evidence,
            assignments,
            titles: titles(&next),
            items: next,
        },
        Err(error) => Outcome::Retry(error),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaView {
    pub name: String,
    pub scopes: Vec<String>,
    /// `waiting`, `reviewing`, `done` or `next`.
    pub state: String,
    pub summary: String,
    pub evidence: Vec<String>,
    pub next: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundView {
    pub number: u32,
    pub managed_task_id: String,
    /// `working`, `reviewing`, `approval`, `held`, `done`, `next` or `limit`.
    pub state: String,
    pub summary: String,
    pub evidence: Vec<String>,
    pub check: Option<RoundCheck>,
    pub next: Vec<String>,
    pub held: Option<String>,
    pub review_run_id: Option<String>,
    pub decided_at: Option<String>,
    /// The next round's assignments waiting for the person's approval.
    pub proposal: Option<Vec<RoundAssignment>>,
    /// An agent is deciding the proposal for the person.
    pub agent_deciding: bool,
    pub areas: Vec<AreaView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundsView {
    pub current: u32,
    pub max: u32,
    /// The current round waits for the person to resume it.
    pub paused: bool,
    /// Each next round waits for the person's approval.
    pub ask_first: bool,
    pub orchestrators: u32,
    pub rounds: Vec<RoundView>,
}

fn live(run_id: Option<&String>, runs: &[TaskRun]) -> bool {
    run_id
        .and_then(|id| runs.iter().find(|run| &run.id == id))
        .is_some_and(|run| run.status.is_active() || run.finishing)
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
            let state = if !round.verdict.is_empty() {
                round.verdict.clone()
            } else if round.proposal.is_some() {
                "approval".into()
            } else if round.held.is_some() {
                "held".into()
            } else if live(round.review_run_ids.last(), runs)
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
                proposal: round.proposal.clone(),
                agent_deciding: round.agent_deciding,
                areas: round
                    .areas
                    .iter()
                    .map(|area| AreaView {
                        name: area.name.clone(),
                        scopes: area.scopes.clone(),
                        state: if !area.verdict.is_empty() {
                            area.verdict.clone()
                        } else if live(area.run_ids.last(), runs) {
                            "reviewing".into()
                        } else {
                            "waiting".into()
                        },
                        summary: area.summary.clone(),
                        evidence: area.evidence.clone(),
                        next: titles(&area.assignments),
                    })
                    .collect(),
            }
        })
        .collect();
    Some(RoundsView {
        current: current.number,
        max: execution.max_rounds,
        // A proposal waits for approval, not for Resume.
        paused: current.verdict.is_empty()
            && current.proposal.is_none()
            && (current.held.is_some() || !(dispatching || resumed(&record.id))),
        ask_first: execution.ask_before_rounds,
        orchestrators: execution.orchestrators.max(1),
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
pub(in crate::commands) fn check_of(coordinator: &Coordinator, round: &Round) -> Option<String> {
    coordinator
        .plan_template(&round.managed_task_id)
        .and_then(|(request, _)| request.verify_command)
        .filter(|command| !command.trim().is_empty())
}

/// Keeps a live orchestrator attempt read-only after the planning registry restarts.
fn keep_read_only(record: &PlanRecord, run_id: Option<&String>, runs: &[TaskRun]) {
    if live(run_id, runs) {
        if let Some(id) = run_id {
            super::register_run(id, &record.id, 0, 0);
        }
    }
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
    let record = crate::commands::agent_decider::reconcile(store, record);
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
    let merged = delivery.applied_at.is_some();
    let enabled =
        (delivery.dispatching || resumed(id)) && session::pending_deviation(&record).is_none();
    // A round splits into areas once, before its first review starts.
    if execution.orchestrators > 1
        && round.areas.is_empty()
        && round.review_run_ids.is_empty()
        && step(round, merged, enabled, runs) == Step::Review
    {
        if let Some(doc) = record.document() {
            let areas = partition(&doc, execution.orchestrators);
            if !areas.is_empty() {
                store.update(id, |saved| {
                    current(saved)?.areas = areas.clone();
                    Ok(())
                })?;
                return Ok(());
            }
        }
    }
    if !round.areas.is_empty() {
        return advance_areas(coordinator, store, &record, merged, enabled, runs);
    }
    match step(round, merged, enabled, runs) {
        Step::Wait => {
            keep_read_only(&record, round.review_run_ids.last(), runs);
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
        Step::Review => start_review(coordinator, store, &record, None),
        Step::Read(run_id) => {
            let run = runs.iter().find(|run| run.id == run_id).unwrap();
            let doc = record.document().ok_or("The plan could not be read.")?;
            let outcome = decide(
                &doc,
                round.number,
                run,
                check_of(coordinator, round).as_deref(),
            );
            conclude(coordinator, store, &record, &doc, outcome, Some(&run.id))
        }
    }
}

/// Starts or reads each area's orchestrator attempt, then combines the
/// areas' verdicts once every area has one.
fn advance_areas(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
    merged: bool,
    enabled: bool,
    runs: &[TaskRun],
) -> Result<(), String> {
    let round = record.execution.as_ref().unwrap().rounds.last().unwrap();
    for (index, step) in area_steps(round, merged, enabled, runs)
        .into_iter()
        .enumerate()
    {
        match step {
            Step::Wait => keep_read_only(record, round.areas[index].run_ids.last(), runs),
            Step::Hold(reason) => {
                store.update(&record.id, |saved| {
                    let round = current(saved)?;
                    if let Some(last) = round.areas[index].run_ids.last().cloned() {
                        round.handled.push(last);
                    }
                    round.held = Some(format!("{}: {reason}", round.areas[index].name));
                    Ok(())
                })?;
                return Ok(());
            }
            Step::Review => start_review(coordinator, store, record, Some(index))?,
            Step::Read(run_id) => {
                let run = runs.iter().find(|run| run.id == run_id).unwrap();
                read_area(coordinator, store, record, index, run)?;
            }
        }
    }
    let saved = store.load(&record.id)?;
    let Some(round) = saved
        .execution
        .as_ref()
        .and_then(|execution| execution.rounds.last())
    else {
        return Ok(());
    };
    let combined = round.verdict.is_empty()
        && round.held.is_none()
        && round.proposal.is_none()
        && !round.areas.is_empty()
        && round.areas.iter().all(|area| !area.verdict.is_empty());
    if combined {
        let doc = saved.document().ok_or("The plan could not be read.")?;
        let outcome = merge(&doc, round.number, &round.areas);
        conclude(coordinator, store, &saved, &doc, outcome, None)?;
    }
    Ok(())
}

fn read_area(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
    index: usize,
    run: &TaskRun,
) -> Result<(), String> {
    let doc = record.document().ok_or("The plan could not be read.")?;
    let round = record.execution.as_ref().unwrap().rounds.last().unwrap();
    let outcome = decide(
        &doc,
        round.number,
        run,
        check_of(coordinator, round).as_deref(),
    );
    store.update(&record.id, |saved| {
        let round = current(saved)?;
        round.handled.push(run.id.clone());
        let area = round
            .areas
            .get_mut(index)
            .ok_or("This round's areas changed.")?;
        match &outcome {
            Outcome::Done {
                summary,
                evidence,
                check,
            } => {
                area.verdict = "done".into();
                area.summary = summary.clone();
                area.evidence = evidence.clone();
                area.check = check.clone();
                area.assignments.clear();
                area.note.clear();
            }
            Outcome::Next {
                summary,
                evidence,
                items,
                ..
            } => {
                area.verdict = "next".into();
                area.summary = summary.clone();
                area.evidence = evidence.clone();
                area.assignments = items.clone();
                area.note.clear();
            }
            Outcome::Retry(reason) => {
                if area.retries < RETRIES {
                    area.retries += 1;
                    area.note = reason.clone();
                } else {
                    let held = format!("{}: {reason}", area.name);
                    round.held = Some(held);
                }
            }
        }
        Ok(())
    })?;
    Ok(())
}

/// Starts an orchestrator attempt on the integrated tree, for the whole plan
/// or for one area.
fn start_review(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
    area: Option<usize>,
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
        area.and_then(|index| round.areas.get(index)),
    );
    let mut request = session::planning_request(&record.request, &settings, prompt);
    // computer_verify runs the plan's check; the attempt itself stays read-only.
    request.verify_command = check;
    store.update(&record.id, |saved| {
        let round = current(saved)?;
        round.review_run_ids.push(request.id.clone());
        match area.and_then(|index| round.areas.get_mut(index)) {
            Some(area) => {
                area.run_ids.push(request.id.clone());
                area.note.clear();
            }
            None => round.note.clear(),
        }
        Ok(())
    })?;
    // No questions: the orchestrator decides from the code, the check and the plan.
    super::register_run(&request.id, &record.id, 0, 0);
    if let Err(error) = coordinator.start_manual(request.clone()) {
        store.update(&record.id, |saved| {
            let round = current(saved)?;
            round.handled.push(request.id.clone());
            round.held = Some(format!("The orchestrator review did not start: {error}"));
            Ok(())
        })?;
    }
    Ok(())
}

/// Records what a round's review concluded: the plan is done, the next round
/// starts or waits for approval, or the review runs again. `handled` is the
/// single orchestrator attempt read; area reviews mark theirs as they finish.
fn conclude(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
    doc: &PlanDocument,
    outcome: Outcome,
    handled: Option<&str>,
) -> Result<(), String> {
    let execution = record.execution.as_ref().unwrap();
    let round = execution.rounds.last().unwrap();
    let now = Utc::now().to_rfc3339();
    let settle = |saved: &mut PlanRecord,
                  verdict: &str,
                  summary: &str,
                  evidence: &[String]|
     -> Result<(), String> {
        let round = current(saved)?;
        if let Some(id) = handled {
            round.handled.push(id.into());
        }
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
            let criteria = session::progress(coordinator, &saved, doc, &runs)
                .map(|(_, evidence)| handoff::criterion_states(doc, &evidence))
                .unwrap_or_else(|| handoff::criterion_states(doc, &[]));
            super::learning::reflect(coordinator, store, &saved, doc, &criteria);
            Ok(())
        }
        Outcome::Next {
            summary,
            evidence,
            assignments,
            titles,
            items,
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
            if execution.ask_before_rounds {
                // An agent may approve in the person's place only after the
                // merged round passed its checks.
                let checks = match (
                    coordinator.plan_delivery(&round.managed_task_id),
                    coordinator.runtime.integration_runs(),
                ) {
                    (Ok(delivery), Ok(runs)) => {
                        crate::commands::agent_decider::round_checks_passed(
                            check_of(coordinator, round).as_deref(),
                            &delivery,
                            &runs,
                        )
                    }
                    (Err(error), _) | (_, Err(error)) => Err(error),
                };
                let job = crate::commands::agent_decider::route_round(
                    coordinator,
                    record,
                    round.number,
                    &summary,
                    &evidence,
                    &items,
                    checks,
                );
                let deciding = job.is_ok();
                store.update(&record.id, |saved| {
                    let round = current(saved)?;
                    if let Some(id) = handled {
                        round.handled.push(id.into());
                    }
                    round.summary = summary.clone();
                    round.evidence = evidence.clone();
                    round.next = titles.clone();
                    round.proposal = Some(items.clone());
                    round.agent_deciding = deciding;
                    saved.error = None;
                    Ok(())
                })?;
                match job {
                    Ok(job) => crate::commands::agent_decider::spawn_round(
                        coordinator.clone(),
                        job,
                        round.number,
                    ),
                    Err(_) => crate::commands::notifications::plan_decision_needed(
                        &record.id,
                        &format!("round-{}", round.number),
                    ),
                }
                return Ok(());
            }
            match launch(coordinator, record, doc, round, &summary, assignments) {
                Ok(managed) => {
                    store.update(&record.id, |saved| {
                        settle(saved, "next", &summary, &evidence)?;
                        current(saved)?.next = titles.clone();
                        next_round(saved, &managed, &now);
                        saved.error = None;
                        Ok(())
                    })?;
                    Ok(())
                }
                Err(error) => retry(store, record, handled, error),
            }
        }
        Outcome::Retry(reason) => retry(store, record, handled, reason),
    }
}

fn next_round(saved: &mut PlanRecord, managed: &str, now: &str) {
    if let Some(execution) = saved.execution.as_mut() {
        let number = execution.rounds.last().map_or(1, |round| round.number + 1);
        execution.managed_task_id = Some(managed.into());
        execution.rounds.push(Round {
            number,
            managed_task_id: managed.into(),
            started_at: now.into(),
            ..Default::default()
        });
    }
}

/// Reviews the round again with the reason, or holds it after the retries.
/// Area reviews all run again, since their combined verdict did not stand.
fn retry(
    store: &Store,
    record: &PlanRecord,
    handled: Option<&str>,
    reason: String,
) -> Result<(), String> {
    store.update(&record.id, |saved| {
        let round = current(saved)?;
        if let Some(id) = handled {
            round.handled.push(id.into());
        }
        if round.retries < RETRIES {
            round.retries += 1;
            round.note = reason.clone();
            for area in &mut round.areas {
                area.verdict.clear();
                area.assignments.clear();
                area.note = reason.clone();
            }
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

/// Checks the assignments a person approves, as proposed or edited.
pub fn approvable(items: &[RoundAssignment]) -> Result<(), String> {
    if items.is_empty() {
        return Err("Keep at least one assignment, or stop the swarm.".into());
    }
    if items.len() > MAX_NEXT {
        return Err(format!("Keep at most {MAX_NEXT} assignments for a round."));
    }
    let mut keys = HashSet::new();
    for item in items {
        if item.key.trim().is_empty()
            || item.title.trim().is_empty()
            || item.prompt.trim().is_empty()
            || item.scopes.iter().all(|scope| scope.trim().is_empty())
        {
            return Err(
                "Each assignment needs a title, instructions and at least one scope.".into(),
            );
        }
        if !keys.insert(item.key.as_str()) {
            return Err(format!("Two assignments share the key {}.", item.key));
        }
    }
    Ok(())
}

/// Starts the proposed round, with the person's edits when they made any.
fn approve(
    coordinator: &Coordinator,
    id: &str,
    edited: Option<Vec<RoundAssignment>>,
) -> Result<(), String> {
    let store = session::store(coordinator);
    let record = store.load(id)?;
    if !proposed(&record) {
        return Err("No swarm round is waiting for approval.".into());
    }
    let doc = record.document().ok_or("The plan could not be read.")?;
    let round = record.execution.as_ref().unwrap().rounds.last().unwrap();
    let items = match edited {
        Some(items) => items,
        None => round.proposal.clone().unwrap_or_default(),
    };
    approvable(&items)?;
    let json = assignments(&doc, round.number + 1, &items)?;
    let managed = launch(coordinator, &record, &doc, round, &round.summary, json)?;
    let now = Utc::now().to_rfc3339();
    store.update(id, |saved| {
        let round = current(saved)?;
        round.verdict = "next".into();
        round.next = titles(&items);
        round.proposal = None;
        round.agent_deciding = false;
        round.decided_at = Some(now.clone());
        next_round(saved, &managed, &now);
        saved.error = None;
        Ok(())
    })?;
    activate(id, false);
    Ok(())
}

/// Starts the proposed round as `agent` decided for the person, unless the
/// person already approved, edited or stopped it.
pub(in crate::commands) fn approve_by(
    coordinator: &Coordinator,
    id: &str,
    agent: &str,
) -> Result<(), String> {
    let record = session::store(coordinator).load(id)?;
    let deciding = record
        .execution
        .as_ref()
        .and_then(|execution| execution.rounds.last())
        .is_some_and(|round| round.agent_deciding && round.proposal.is_some());
    if !deciding {
        return Err(format!("The proposal changed before {agent} decided."));
    }
    approve(coordinator, id, None)
}

/// Acts on a swarm's rounds: `pause`, `resume` or `stop` the rounds and the
/// current round's work; `approve` the proposed next round, with `edited`
/// assignments in place of the proposal; `ask` or `auto` chooses whether
/// later rounds wait for approval.
pub fn action(
    coordinator: &Coordinator,
    id: &str,
    action: &str,
    edited: Option<Vec<RoundAssignment>>,
) -> Result<(), String> {
    if !["pause", "resume", "stop", "approve", "ask", "auto"].contains(&action) {
        return Err("Choose pause, resume, stop or approve.".into());
    }
    if edited.is_some() && action != "approve" {
        return Err("Edited assignments apply to approve.".into());
    }
    if action == "approve" {
        return approve(coordinator, id, edited);
    }
    let store = session::store(coordinator);
    let record = store.load(id)?;
    if !open(&record) {
        return Err("This plan has no swarm round to change.".into());
    }
    if action == "ask" || action == "auto" {
        // Applies to the next verdict; a proposal already waiting still needs a decision.
        store.update(id, |saved| {
            if let Some(execution) = saved.execution.as_mut() {
                execution.ask_before_rounds = action == "ask";
            }
            Ok(())
        })?;
        return Ok(());
    }
    let round = record
        .execution
        .as_ref()
        .unwrap()
        .rounds
        .last()
        .unwrap()
        .clone();
    if action == "stop" && round.proposal.is_some() {
        // Declining the proposal keeps the merged work; Resume reviews the round again.
        with_state(|state| state.resumed.remove(id));
        store.update(id, |saved| {
            let round = current(saved)?;
            round.proposal = None;
            round.agent_deciding = false;
            round.next.clear();
            for area in &mut round.areas {
                area.verdict.clear();
                area.assignments.clear();
            }
            round.held =
                Some("You stopped the proposed round. Resume to review the round again.".into());
            Ok(())
        })?;
        return Ok(());
    }
    let delivery = coordinator.plan_delivery(&round.managed_task_id)?;
    if action == "resume" {
        if delivery.applied_at.is_none() && !delivery.dispatching {
            coordinator.plan_dispatch(&round.managed_task_id, "resume")?;
        }
        store.update(id, |saved| {
            let round = current(saved)?;
            round.held = None;
            round.retries = 0;
            for area in &mut round.areas {
                area.retries = 0;
            }
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
        for run in runs
            .iter()
            .filter(|run| round.review_run_ids.contains(&run.id) && run.status.is_active())
        {
            coordinator.runtime.stop(&run.id)?;
        }
    }
    Ok(())
}
