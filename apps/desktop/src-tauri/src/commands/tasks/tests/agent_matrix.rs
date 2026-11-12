//! The opt-in agent × model scenario matrix. Each pair runs one session through a first
//! turn, a follow-up, a model switch and back, a file the task must write and a
//! continuation after the runtime restarts, stopping at its first failing scenario.
//! Served-model, usage and account findings are recorded apart from the verdicts, and
//! only an adapter failure earns one retry. The scenarios and finding rules follow
//! HarnessRouter's support matrix (Apache-2.0).

use super::super::failure::FailureKind;
use super::super::served_model::ModelMismatch;
use super::*;
use chrono::Utc;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Instant;

const TURN_LIMIT: Duration = Duration::from_secs(300);
/// Claude Code's own system prompt and tools exceed this, so a Claude pair that read
/// none of its input from cache paid full price on every call.
const SUBSTANTIAL_INPUT: u64 = 10_000;
const EXCERPT: usize = 2000;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pair {
    agent: String,
    /// `None` runs the CLI's configured default.
    model: Option<String>,
    /// The model the switch scenario moves to and back from.
    partner: Option<String>,
}

impl Pair {
    fn label(&self) -> String {
        format!(
            "{} × {}",
            self.agent,
            self.model.as_deref().unwrap_or("CLI default")
        )
    }
}

/// Reads `agent=model,model;agent`. Every listed model is a pair whose switch partner is
/// the next model listed for that agent; an agent without models runs once on its default.
fn parse_matrix(spec: &str) -> Result<Vec<Pair>, String> {
    let mut pairs = Vec::new();
    let mut agents = HashSet::new();
    for entry in spec
        .split([';', '\n'])
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        let (agent, models) = entry.split_once('=').unwrap_or((entry, ""));
        let agent = agent.trim();
        if agent.is_empty() {
            return Err(format!("Name the agent in \"{entry}\"."));
        }
        if !agents.insert(agent) {
            return Err(format!("List {agent} once, with all of its models."));
        }
        let models: Vec<&str> = models
            .split(',')
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .collect();
        if models.iter().collect::<HashSet<_>>().len() != models.len() {
            return Err(format!("{agent} lists a model twice."));
        }
        if models.is_empty() {
            pairs.push(Pair {
                agent: agent.into(),
                model: None,
                partner: None,
            });
        }
        for (index, model) in models.iter().enumerate() {
            pairs.push(Pair {
                agent: agent.into(),
                model: Some(model.to_string()),
                partner: (models.len() > 1).then(|| models[(index + 1) % models.len()].into()),
            });
        }
    }
    if pairs.is_empty() {
        return Err("List at least one agent, such as claude=claude-haiku-4-5.".into());
    }
    Ok(pairs)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Scenario {
    First,
    FollowUp,
    Switch,
    Artifact,
    Restart,
}

const SCENARIOS: [Scenario; 5] = [
    Scenario::First,
    Scenario::FollowUp,
    Scenario::Switch,
    Scenario::Artifact,
    Scenario::Restart,
];

impl Scenario {
    fn label(self) -> &'static str {
        match self {
            Self::First => "first",
            Self::FollowUp => "follow-up",
            Self::Switch => "switch",
            Self::Artifact => "artifact",
            Self::Restart => "restart",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
enum Verdict {
    Pass,
    Fail {
        reason: String,
    },
    /// The account or provider stopped the turn. It says nothing about the adapter.
    Environment {
        kind: FailureKind,
        reason: String,
    },
    NotApplicable {
        reason: String,
    },
    /// An earlier scenario of the pair did not pass.
    NotRun,
}

fn fail(reason: impl Into<String>) -> Verdict {
    Verdict::Fail {
        reason: reason.into(),
    }
}

/// Failures that describe the account or the model's availability rather than the adapter.
fn environmental(kind: FailureKind) -> bool {
    matches!(
        kind,
        FailureKind::Authentication
            | FailureKind::QuotaExhausted
            | FailureKind::RateLimited
            | FailureKind::ModelUnavailable
    )
}

/// What one attempt reported, read from its saved run.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Turn {
    run_id: String,
    status: String,
    requested_model: Option<String>,
    /// The model the agent named; `None` when it named none.
    served_model: Option<String>,
    mismatch: Option<ModelMismatch>,
    session_id: Option<String>,
    answer: String,
    error: Option<String>,
    failure_kind: Option<FailureKind>,
    usage_reported: bool,
    input_tokens: u64,
    cache_read_tokens: u64,
    seconds: u64,
    timed_out: bool,
}

fn excerpt(text: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    chars[chars.len().saturating_sub(EXCERPT)..]
        .iter()
        .collect()
}

impl Turn {
    fn from_run(run: &TaskRun, seconds: u64, timed_out: bool) -> Self {
        Self {
            run_id: run.id.clone(),
            status: serde_json::to_value(&run.status)
                .ok()
                .and_then(|status| status.as_str().map(str::to_string))
                .unwrap_or_default(),
            requested_model: run.requested_model.clone(),
            served_model: run.model.clone().filter(|_| run.model_reported),
            mismatch: run.model_mismatch.clone(),
            session_id: run.session_id.clone(),
            answer: excerpt(&run.result),
            error: run.error.as_deref().map(excerpt),
            failure_kind: run.failure_kind,
            usage_reported: run.usage.reported,
            input_tokens: run.usage.input,
            cache_read_tokens: run.usage.cache_read,
            seconds,
            timed_out,
        }
    }

    /// An attempt Jackalope refused to start.
    fn refused(request: &RunRequest, error: String) -> Self {
        Self {
            run_id: request.id.clone(),
            status: "not_started".into(),
            requested_model: request.model.clone(),
            error: Some(error),
            ..Self::default()
        }
    }

    fn completed(&self) -> bool {
        self.status == "review"
    }
}

/// Whether the turn finished with an answer, and if not, whose failure it was.
fn outcome(turn: &Turn, limit: Duration) -> Result<(), Verdict> {
    if turn.timed_out {
        return Err(fail(format!(
            "No result after {} s; the attempt was stopped.",
            limit.as_secs()
        )));
    }
    if turn.completed() {
        return Ok(());
    }
    let reason = turn
        .error
        .clone()
        .unwrap_or_else(|| format!("The attempt ended {}.", turn.status));
    Err(match turn.failure_kind {
        Some(kind) if environmental(kind) => Verdict::Environment { kind, reason },
        _ => fail(reason),
    })
}

/// A reply turn passes when its own answer carries `expected`, does not repeat the
/// previous turn's word (an earlier answer replayed), and continued `session`.
fn judge_reply(
    turn: &Turn,
    expected: &str,
    earlier: Option<&str>,
    session: Option<&str>,
    limit: Duration,
) -> Verdict {
    if let Err(verdict) = outcome(turn, limit) {
        return verdict;
    }
    if !turn.answer.contains(expected) {
        return fail(format!("Answered without {expected}: {}", turn.answer));
    }
    if let Some(earlier) = earlier.filter(|earlier| turn.answer.contains(earlier)) {
        return fail(format!(
            "The answer repeats the previous turn's {earlier}: {}",
            turn.answer
        ));
    }
    match (session, turn.session_id.as_deref()) {
        (None, None) => fail("The agent reported no session, so the task cannot continue."),
        (Some(session), reported) if reported != Some(session) => fail(format!(
            "Started session {} instead of continuing {session}.",
            reported.unwrap_or("none")
        )),
        _ => Verdict::Pass,
    }
}

/// A turn served by another model than it asked for did not switch. An unreported
/// model cannot be judged here; it is an unlabelled finding.
fn judge_served(turn: &Turn) -> Verdict {
    match turn.mismatch.as_ref().filter(|mismatch| !mismatch.fallback) {
        Some(mismatch) => fail(format!(
            "Asked for {}; the agent reports serving {}.",
            mismatch.requested, mismatch.served
        )),
        None => Verdict::Pass,
    }
}

/// The file must be in the attempt's worktree with exactly `expected`, allowing one
/// trailing line ending, and must not have been written to the project checkout.
fn judge_artifact(
    turn: &Turn,
    session: Option<&str>,
    name: &str,
    written: Option<&str>,
    in_checkout: bool,
    expected: &str,
    limit: Duration,
) -> Verdict {
    if let Err(verdict) = outcome(turn, limit) {
        return verdict;
    }
    if session.is_some() && turn.session_id.as_deref() != session {
        return fail(format!(
            "Started session {} instead of continuing {}.",
            turn.session_id.as_deref().unwrap_or("none"),
            session.unwrap_or_default()
        ));
    }
    if in_checkout {
        return fail(format!(
            "{name} was written to the project checkout instead of the attempt's worktree."
        ));
    }
    let Some(text) = written else {
        return fail(format!("{name} is not in the attempt's worktree."));
    };
    let content = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);
    if content != expected {
        return fail(format!(
            "{name} contains {:?}, not {expected:?}.",
            excerpt(text)
        ));
    }
    Verdict::Pass
}

/// The attempt before the restart must come back from history as it was saved,
/// with its session and its worktree's file.
fn check_recovery(
    before: &TaskRun,
    after: Option<&TaskRun>,
    artifact_present: bool,
) -> Result<(), String> {
    let after = after.ok_or("The attempt was not recovered from history.")?;
    if after.session_id != before.session_id {
        return Err(format!(
            "History recovered session {}, not {}.",
            after.session_id.as_deref().unwrap_or("none"),
            before.session_id.as_deref().unwrap_or("none")
        ));
    }
    if after.status != before.status {
        return Err(format!(
            "History recovered the attempt as {:?}, not {:?}.",
            after.status, before.status
        ));
    }
    if !artifact_present {
        return Err("The written file is missing from the recovered worktree.".into());
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioResult {
    scenario: Scenario,
    outcome: Verdict,
    turns: Vec<Turn>,
}

impl ScenarioResult {
    fn new(scenario: Scenario, outcome: Verdict, turns: Vec<Turn>) -> Self {
        Self {
            scenario,
            outcome,
            turns,
        }
    }
}

/// Runs the scenarios in order while every earlier one passed or did not apply. The
/// switch does not apply without a partner model.
fn run_scenarios(
    pair: &Pair,
    mut execute: impl FnMut(Scenario) -> ScenarioResult,
) -> Vec<ScenarioResult> {
    let mut results = Vec::new();
    let mut stopped = false;
    for scenario in SCENARIOS {
        let result = if stopped {
            ScenarioResult::new(scenario, Verdict::NotRun, vec![])
        } else if scenario == Scenario::Switch && pair.partner.is_none() {
            let reason = if pair.model.is_some() {
                "Only one model is listed for this agent."
            } else {
                "The CLI default model has no partner to switch to."
            };
            ScenarioResult::new(
                scenario,
                Verdict::NotApplicable {
                    reason: reason.into(),
                },
                vec![],
            )
        } else {
            execute(scenario)
        };
        stopped |= !matches!(
            result.outcome,
            Verdict::Pass | Verdict::NotApplicable { .. }
        );
        results.push(result);
    }
    results
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "finding", rename_all = "snake_case")]
enum Finding {
    /// A turn on the pair's own model reports serving another model.
    Substituted {
        scenario: Scenario,
        requested: String,
        served: String,
    },
    /// Claude Code switched to the overload fallback Jackalope configured.
    Fallback {
        scenario: Scenario,
        requested: String,
        served: String,
    },
    /// Completed turns that asked for a model and named none, so it cannot be confirmed.
    Unlabelled {
        turns: usize,
    },
    NoCacheReads {
        input: u64,
    },
    NoUsage {
        turns: usize,
    },
    Environment {
        scenario: Scenario,
        kind: FailureKind,
        reason: String,
    },
    /// The pair failed on its first try and passed when run again.
    FirstTry {
        scenario: Scenario,
        reason: String,
    },
}

fn findings(pair: &Pair, results: &[ScenarioResult]) -> Vec<Finding> {
    let mut found = Vec::new();
    let turns = || {
        results
            .iter()
            .flat_map(|result| result.turns.iter().map(move |turn| (result.scenario, turn)))
    };
    for (scenario, turn) in turns() {
        // The switch turn asks for the partner on purpose; its verdict judges what served it.
        let Some(mismatch) = turn
            .mismatch
            .as_ref()
            .filter(|_| turn.requested_model.is_some() && turn.requested_model == pair.model)
        else {
            continue;
        };
        let (requested, served) = (mismatch.requested.clone(), mismatch.served.clone());
        found.push(if mismatch.fallback {
            Finding::Fallback {
                scenario,
                requested,
                served,
            }
        } else {
            Finding::Substituted {
                scenario,
                requested,
                served,
            }
        });
    }
    let completed: Vec<&Turn> = turns()
        .map(|(_, turn)| turn)
        .filter(|turn| turn.completed())
        .collect();
    let unlabelled = completed
        .iter()
        .filter(|turn| turn.requested_model.is_some() && turn.served_model.is_none())
        .count();
    if unlabelled > 0 {
        found.push(Finding::Unlabelled { turns: unlabelled });
    }
    let unreported = completed.iter().filter(|turn| !turn.usage_reported).count();
    if unreported > 0 {
        found.push(Finding::NoUsage { turns: unreported });
    }
    let (input, cache_read) = usage_totals(results);
    if pair.agent == "claude" && input >= SUBSTANTIAL_INPUT && cache_read == 0 {
        found.push(Finding::NoCacheReads { input });
    }
    for result in results {
        if let Verdict::Environment { kind, reason } = &result.outcome {
            found.push(Finding::Environment {
                scenario: result.scenario,
                kind: *kind,
                reason: reason.clone(),
            });
        }
    }
    found
}

fn usage_totals(results: &[ScenarioResult]) -> (u64, u64) {
    results
        .iter()
        .flat_map(|result| &result.turns)
        .filter(|turn| turn.usage_reported)
        .fold((0, 0), |(input, cache), turn| {
            (input + turn.input_tokens, cache + turn.cache_read_tokens)
        })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Attempt {
    /// The retained disposable repository and history of this attempt.
    fixture: String,
    scenarios: Vec<ScenarioResult>,
}

fn first_failure(results: &[ScenarioResult]) -> Option<(Scenario, &str)> {
    results.iter().find_map(|result| match &result.outcome {
        Verdict::Fail { reason } => Some((result.scenario, reason.as_str())),
        _ => None,
    })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairReport {
    #[serde(flatten)]
    pair: Pair,
    #[serde(flatten)]
    attempt: Attempt,
    /// The first try when an adapter failure was run again; the retry's result stands.
    #[serde(skip_serializing_if = "Option::is_none")]
    first_try: Option<Attempt>,
    findings: Vec<Finding>,
    input_tokens: u64,
    cache_read_tokens: u64,
}

/// Only an adapter failure is retried; an account or provider stop would repeat.
fn needs_retry(attempt: &Attempt) -> bool {
    first_failure(&attempt.scenarios).is_some()
}

fn settle(pair: Pair, first: Attempt, retry: Option<Attempt>) -> PairReport {
    let (attempt, first_try) = match retry {
        Some(retry) => (retry, Some(first)),
        None => (first, None),
    };
    let mut findings = findings(&pair, &attempt.scenarios);
    if let Some((scenario, reason)) = first_try
        .as_ref()
        .filter(|_| first_failure(&attempt.scenarios).is_none())
        .and_then(|first| first_failure(&first.scenarios))
    {
        findings.push(Finding::FirstTry {
            scenario,
            reason: reason.into(),
        });
    }
    let (input_tokens, cache_read_tokens) = usage_totals(&attempt.scenarios);
    PairReport {
        pair,
        attempt,
        first_try,
        findings,
        input_tokens,
        cache_read_tokens,
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentBuild {
    agent: String,
    executable: Option<String>,
    version: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct MatrixReport {
    matrix: String,
    started_at: String,
    finished_at: Option<String>,
    commit: Option<String>,
    turn_limit_seconds: u64,
    agents: Vec<AgentBuild>,
    pairs: Vec<PairReport>,
}

fn cell(result: Option<&ScenarioResult>) -> String {
    let Some(result) = result else {
        return "not run".into();
    };
    let mark = match result.outcome {
        Verdict::Pass => "pass",
        Verdict::Fail { .. } => "FAIL",
        Verdict::Environment { .. } => "env",
        Verdict::NotApplicable { .. } => "n/a",
        Verdict::NotRun => "not run",
    };
    let partner = (result.scenario == Scenario::Switch)
        .then(|| result.turns.first())
        .flatten()
        .and_then(|turn| turn.requested_model.as_deref());
    match partner {
        Some(partner) => format!("{mark} ({partner})"),
        None => mark.into(),
    }
}

fn kind_label(kind: FailureKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|kind| kind.as_str().map(|kind| kind.replace('_', " ")))
        .unwrap_or_default()
}

fn short(text: &str, limit: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut short: String = text.chars().take(limit).collect();
    if short.len() < text.len() {
        short.push('…');
    }
    short.replace('|', "/")
}

fn describe(finding: &Finding) -> String {
    match finding {
        Finding::Substituted {
            scenario,
            requested,
            served,
        } => format!(
            "{} asked for {requested}; the agent reports serving {served}",
            scenario.label()
        ),
        Finding::Fallback {
            scenario,
            requested,
            served,
        } => format!(
            "{} moved from {requested} to the overload fallback {served}",
            scenario.label()
        ),
        Finding::Unlabelled { turns } => format!(
            "{turns} completed turn(s) named no served model, so the requested model is unconfirmed"
        ),
        Finding::NoCacheReads { input } => {
            format!("no prompt cache reads over {input} input tokens")
        }
        Finding::NoUsage { turns } => format!("{turns} completed turn(s) reported no usage"),
        Finding::Environment {
            scenario,
            kind,
            reason,
        } => format!(
            "{} stopped by {}: {}",
            scenario.label(),
            kind_label(*kind),
            short(reason, 200)
        ),
        Finding::FirstTry { scenario, reason } => format!(
            "failed {} on the first try and passed when run again: {}",
            scenario.label(),
            short(reason, 200)
        ),
    }
}

/// A pass on a model nobody can show it ran is not counted, as in HarnessRouter's matrix.
fn counted(pair: &PairReport) -> bool {
    !pair.findings.iter().any(|finding| {
        matches!(
            finding,
            Finding::Substituted { .. } | Finding::Unlabelled { .. }
        )
    })
}

fn render_markdown(report: &MatrixReport) -> String {
    let mut out = vec![
        "# Agent matrix".to_string(),
        String::new(),
        format!(
            "Matrix `{}`, Jackalope {}, {} s per turn. Started {}{}.",
            report.matrix,
            report.commit.as_deref().unwrap_or("at an unknown commit"),
            report.turn_limit_seconds,
            report.started_at,
            report
                .finished_at
                .as_deref()
                .map(|at| format!(", finished {at}"))
                .unwrap_or_else(|| ", still running".into())
        ),
        String::new(),
    ];
    for agent in &report.agents {
        out.push(format!(
            "- {}: {} ({})",
            agent.agent,
            agent.version.as_deref().unwrap_or("version unknown"),
            agent
                .executable
                .as_deref()
                .unwrap_or("executable not found")
        ));
    }
    out.extend([
        String::new(),
        "Scenarios: first turn, follow-up in the same session, switch to the partner model and back, artifact (a named file with exact content in the attempt's worktree), restart (the runtime reopens from history and a follow-up recalls the first turn). pass, FAIL, env (stopped by the account or provider), n/a, not run (an earlier scenario did not pass).".into(),
        String::new(),
        "| Agent | Model | First | Follow-up | Switch | Artifact | Restart | Cache | Notes |".into(),
        "|---|---|---|---|---|---|---|---|---|".into(),
    ]);
    let mut findings = Vec::new();
    let mut environment = Vec::new();
    for pair in &report.pairs {
        let scenarios = &pair.attempt.scenarios;
        let mut notes: Vec<String> = scenarios
            .iter()
            .filter_map(|result| match &result.outcome {
                Verdict::Fail { reason } => Some(format!(
                    "{}: {}",
                    result.scenario.label(),
                    short(reason, 140)
                )),
                _ => None,
            })
            .collect();
        if pair.first_try.is_some() {
            notes.push("run twice".into());
        }
        for finding in &pair.findings {
            let line = format!("{}: {}", pair.pair.label(), describe(finding));
            if matches!(finding, Finding::Environment { .. }) {
                environment.push(line);
            } else {
                findings.push(line);
            }
        }
        let cache = if pair.input_tokens > 0 {
            format!(
                "{}%",
                (pair.cache_read_tokens * 100 + pair.input_tokens / 2) / pair.input_tokens
            )
        } else {
            "-".into()
        };
        let find = |scenario: Scenario| scenarios.iter().find(|result| result.scenario == scenario);
        out.push(format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            pair.pair.agent,
            pair.pair.model.as_deref().unwrap_or("CLI default"),
            cell(find(Scenario::First)),
            cell(find(Scenario::FollowUp)),
            cell(find(Scenario::Switch)),
            cell(find(Scenario::Artifact)),
            cell(find(Scenario::Restart)),
            cache,
            notes.join("; ")
        ));
    }
    let clean: Vec<&PairReport> = report.pairs.iter().filter(|pair| counted(pair)).collect();
    let verdicts = || {
        clean
            .iter()
            .flat_map(|pair| &pair.attempt.scenarios)
            .map(|result| &result.outcome)
    };
    let passed = verdicts().filter(|v| matches!(v, Verdict::Pass)).count();
    let judged = verdicts()
        .filter(|v| matches!(v, Verdict::Pass | Verdict::Fail { .. }))
        .count();
    let excluded = report.pairs.len() - clean.len();
    out.extend([
        String::new(),
        format!(
            "{} pairs, {passed} of {judged} scenario runs passed{}",
            report.pairs.len(),
            if excluded > 0 {
                format!("; {excluded} pairs with a substituted or unconfirmed served model are findings and are not counted.")
            } else {
                ".".into()
            }
        ),
    ]);
    for (heading, lines) in [
        ("Findings", findings),
        ("Stopped by the account or provider", environment),
    ] {
        if !lines.is_empty() {
            out.extend([String::new(), format!("## {heading}"), String::new()]);
            out.extend(lines.into_iter().map(|line| format!("- {line}")));
        }
    }
    out.push(String::new());
    out.join("\n")
}

/// One pair's session in a disposable repository and history of its own.
struct PairRun<'a> {
    pair: &'a Pair,
    limit: Duration,
    repo: PathBuf,
    history: PathBuf,
    runtime: Option<TaskRuntime>,
    project_id: String,
    token: String,
    session: Option<String>,
    last: Option<TaskRun>,
}

impl PairRun<'_> {
    fn word(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.token)
    }

    fn artifact_name(&self) -> String {
        format!("matrix-{}.txt", self.token)
    }

    fn turn(&mut self, prompt: &str, model: Option<String>) -> Turn {
        let runtime = self.runtime.as_ref().expect("The pair's runtime is open");
        let mut request = trial_request(&self.repo, &self.pair.agent, model, prompt);
        request.project_id = self.project_id.clone();
        request.previous_run_id = self.last.as_ref().map(|last| last.id.clone());
        let started = Instant::now();
        if let Err(error) = runtime.start(request.clone()) {
            return Turn::refused(&request, error);
        }
        let finished = trial_settled(runtime, &request.id, self.limit);
        let timed_out = finished.is_none();
        let run = finished.unwrap_or_else(|| {
            trial_settled(runtime, &request.id, Duration::from_secs(30))
                .unwrap_or_else(|| runtime.inner.lock().unwrap().runs[&request.id].clone())
        });
        let turn = Turn::from_run(&run, started.elapsed().as_secs(), timed_out);
        if run.status == RunStatus::Review {
            self.last = Some(run);
        }
        turn
    }

    fn reply(&mut self, word: &str, model: Option<String>) -> Turn {
        self.turn(
            &format!("Reply with exactly: {word}. Do not use tools."),
            model,
        )
    }

    fn execute(&mut self, scenario: Scenario) -> ScenarioResult {
        let model = self.pair.model.clone();
        let limit = self.limit;
        let (outcome, turns) = match scenario {
            Scenario::First => {
                let word = self.word("M1");
                let turn = self.reply(&word, model);
                self.session = turn.session_id.clone();
                (judge_reply(&turn, &word, None, None, limit), vec![turn])
            }
            Scenario::FollowUp => {
                let word = self.word("M2");
                let turn = self.reply(&word, model);
                let verdict = judge_reply(
                    &turn,
                    &word,
                    Some(&self.word("M1")),
                    self.session.as_deref(),
                    limit,
                );
                (verdict, vec![turn])
            }
            Scenario::Switch => {
                let partner = self.pair.partner.clone();
                let (away, back) = (self.word("M3"), self.word("M4"));
                let there = self.reply(&away, partner);
                let mut verdict = judge_reply(
                    &there,
                    &away,
                    Some(&self.word("M2")),
                    self.session.as_deref(),
                    limit,
                );
                if verdict == Verdict::Pass {
                    verdict = judge_served(&there);
                }
                let mut turns = vec![there];
                if verdict == Verdict::Pass {
                    let returned = self.reply(&back, model);
                    verdict = judge_reply(
                        &returned,
                        &back,
                        Some(&away),
                        self.session.as_deref(),
                        limit,
                    );
                    if verdict == Verdict::Pass {
                        verdict = judge_served(&returned);
                    }
                    turns.push(returned);
                }
                (verdict, turns)
            }
            Scenario::Artifact => {
                let (name, content) = (self.artifact_name(), self.word("ARTIFACT"));
                let turn = self.turn(&format!("Create a file named {name} in the current directory containing exactly {content} and nothing else. Do not run shell commands or use network tools. Then reply DONE."), model);
                let workspace = self
                    .last
                    .as_ref()
                    .filter(|last| last.id == turn.run_id)
                    .map(|last| PathBuf::from(&last.workspace));
                let written = workspace
                    .and_then(|workspace| std::fs::read_to_string(workspace.join(&name)).ok());
                let verdict = judge_artifact(
                    &turn,
                    self.session.as_deref(),
                    &name,
                    written.as_deref(),
                    self.repo.join(&name).exists(),
                    &content,
                    limit,
                );
                (verdict, vec![turn])
            }
            Scenario::Restart => match self.restart() {
                Err(reason) => (fail(reason), vec![]),
                Ok(()) => {
                    let turn = self.turn("What exact word did I ask you to reply with in my very first message of this task? Reply with just that word. Do not use tools.", model);
                    let verdict = judge_reply(
                        &turn,
                        &self.word("M1"),
                        None,
                        self.session.as_deref(),
                        limit,
                    );
                    (verdict, vec![turn])
                }
            },
        };
        ScenarioResult::new(scenario, outcome, turns)
    }

    /// Closes the runtime as an app exit does, discarding warm sessions and helpers, then
    /// reopens the same history so the next turn resumes from what was saved.
    fn restart(&mut self) -> Result<(), String> {
        let before = self
            .last
            .clone()
            .ok_or("No finished attempt to continue.")?;
        if let Some(runtime) = self.runtime.take() {
            runtime.stop_all();
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        let runtime = loop {
            std::thread::sleep(Duration::from_millis(300));
            match TaskRuntime::with_test_access(self.history.clone()) {
                Ok(runtime) => break runtime,
                Err(error) if Instant::now() > deadline => {
                    return Err(format!("History did not reopen: {error}"))
                }
                Err(_) => {}
            }
        };
        let after = runtime.inner.lock().unwrap().runs.get(&before.id).cloned();
        self.runtime = Some(runtime);
        let present = after.as_ref().is_some_and(|after| {
            Path::new(&after.workspace)
                .join(self.artifact_name())
                .is_file()
        });
        check_recovery(&before, after.as_ref(), present)?;
        self.last = after;
        Ok(())
    }
}

fn run_pair(pair: &Pair, limit: Duration) -> Attempt {
    let root =
        std::env::temp_dir().join(format!("jackalope-agent-matrix-{}", uuid::Uuid::new_v4()));
    let repo = trial_repository(&root);
    let history = root.join("history");
    let runtime = TaskRuntime::with_test_access(history.clone()).unwrap();
    let mut run = PairRun {
        pair,
        limit,
        repo,
        history,
        runtime: Some(runtime),
        project_id: uuid::Uuid::new_v4().to_string(),
        token: uuid::Uuid::new_v4().simple().to_string()[..8].to_uppercase(),
        session: None,
        last: None,
    };
    let scenarios = run_scenarios(pair, |scenario| {
        let result = run.execute(scenario);
        println!(
            "{} {}: {:?}",
            pair.label(),
            scenario.label(),
            result.outcome
        );
        result
    });
    if let Some(runtime) = run.runtime.take() {
        runtime.stop_all();
    }
    Attempt {
        fixture: root.display().to_string(),
        scenarios,
    }
}

fn agent_build(agent: &str) -> AgentBuild {
    let executable = super::super::executable(agent).ok();
    AgentBuild {
        agent: agent.into(),
        version: executable.as_deref().and_then(version),
        executable: executable.map(|path| path.display().to_string()),
    }
}

/// The first line `--version` prints, waiting at most ten seconds.
fn version(executable: &Path) -> Option<String> {
    let mut child = Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(10);
    while child.try_wait().ok()?.is_none() {
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(120).collect())
}

fn commit() -> Option<String> {
    let output = Command::new("git")
        .args(["describe", "--always", "--dirty"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .ok()?;
    let commit = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !commit.is_empty()).then_some(commit)
}

fn write_report(directory: &Path, report: &MatrixReport) {
    std::fs::write(
        directory.join("report.json"),
        serde_json::to_vec_pretty(report).unwrap(),
    )
    .unwrap();
    std::fs::write(directory.join("report.md"), render_markdown(report)).unwrap();
}

#[test]
#[ignore = "Runs installed agents against their providers and spends their usage; set JACKALOPE_AGENT_MATRIX"]
fn installed_agent_matrix() {
    let matrix = std::env::var("JACKALOPE_AGENT_MATRIX").expect(
        "List the agents and models explicitly, such as claude=claude-haiku-4-5,claude-sonnet-4-5",
    );
    let pairs = parse_matrix(&matrix).unwrap_or_else(|error| panic!("{error}"));
    for pair in &pairs {
        assert!(
            crate::commands::agents::is_builtin(&pair.agent),
            "{} is not a built-in agent.",
            pair.agent
        );
    }
    let limit = std::env::var("JACKALOPE_AGENT_MATRIX_TURN_SECONDS")
        .ok()
        .map(|seconds| {
            Duration::from_secs(
                seconds
                    .parse()
                    .expect("JACKALOPE_AGENT_MATRIX_TURN_SECONDS is a whole number"),
            )
        })
        .unwrap_or(TURN_LIMIT);
    let output = match std::env::var_os("JACKALOPE_AGENT_MATRIX_OUT") {
        Some(directory) => PathBuf::from(directory),
        None => Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../output/agent-matrix")
            .join(Utc::now().format("%Y%m%dT%H%M%SZ").to_string()),
    };
    assert!(
        output.is_absolute(),
        "JACKALOPE_AGENT_MATRIX_OUT must be absolute"
    );
    std::fs::create_dir_all(&output).unwrap();
    let mut agents: Vec<&str> = pairs.iter().map(|pair| pair.agent.as_str()).collect();
    agents.dedup();
    let mut report = MatrixReport {
        matrix,
        started_at: Utc::now().to_rfc3339(),
        finished_at: None,
        commit: commit(),
        turn_limit_seconds: limit.as_secs(),
        agents: agents.into_iter().map(agent_build).collect(),
        pairs: Vec::new(),
    };
    for pair in pairs {
        let first = run_pair(&pair, limit);
        let retry = needs_retry(&first).then(|| run_pair(&pair, limit));
        report.pairs.push(settle(pair, first, retry));
        write_report(&output, &report);
    }
    report.finished_at = Some(Utc::now().to_rfc3339());
    write_report(&output, &report);
    println!(
        "Agent matrix report: {}",
        output.join("report.md").display()
    );
    let failing: Vec<String> = report
        .pairs
        .iter()
        .filter(|pair| first_failure(&pair.attempt.scenarios).is_some())
        .map(|pair| pair.pair.label())
        .collect();
    assert!(
        failing.is_empty(),
        "Failing pairs: {}. Report: {}",
        failing.join(", "),
        output.display()
    );
}

mod tests {
    use super::*;

    const LIMIT: Duration = Duration::from_secs(300);

    fn pair(model: Option<&str>, partner: Option<&str>) -> Pair {
        Pair {
            agent: "claude".into(),
            model: model.map(str::to_string),
            partner: partner.map(str::to_string),
        }
    }

    fn turn(answer: &str) -> Turn {
        Turn {
            run_id: "run".into(),
            status: "review".into(),
            requested_model: Some("claude-haiku-4-5".into()),
            served_model: Some("claude-haiku-4-5-20251001".into()),
            session_id: Some("session-1".into()),
            answer: answer.into(),
            usage_reported: true,
            input_tokens: 20_000,
            cache_read_tokens: 15_000,
            ..Turn::default()
        }
    }

    fn failed(error: &str, kind: Option<FailureKind>) -> Turn {
        Turn {
            status: "failed".into(),
            error: Some(error.into()),
            failure_kind: kind,
            ..turn("")
        }
    }

    fn result(scenario: Scenario, outcome: Verdict, turns: Vec<Turn>) -> ScenarioResult {
        ScenarioResult::new(scenario, outcome, turns)
    }

    fn passing(turns: Vec<Turn>) -> Vec<ScenarioResult> {
        SCENARIOS
            .iter()
            .map(|&scenario| result(scenario, Verdict::Pass, turns.clone()))
            .collect()
    }

    #[test]
    fn the_matrix_lists_pairs_and_switch_partners_explicitly() {
        assert_eq!(
            parse_matrix(
                " claude=claude-haiku-4-5, claude-sonnet-4-5 ;codex\nopencode=opencode/mimo"
            )
            .unwrap(),
            vec![
                pair(Some("claude-haiku-4-5"), Some("claude-sonnet-4-5")),
                pair(Some("claude-sonnet-4-5"), Some("claude-haiku-4-5")),
                Pair {
                    agent: "codex".into(),
                    model: None,
                    partner: None
                },
                Pair {
                    agent: "opencode".into(),
                    model: Some("opencode/mimo".into()),
                    partner: None
                },
            ]
        );
        for spec in ["", " ; ", "=gpt-5", "claude=a;claude=b", "claude=a,a"] {
            assert!(parse_matrix(spec).is_err(), "{spec:?}");
        }
    }

    #[test]
    fn a_pair_stops_at_its_first_scenario_that_does_not_pass() {
        let mut ran = Vec::new();
        let results = run_scenarios(&pair(Some("a"), Some("b")), |scenario| {
            ran.push(scenario);
            let outcome = if scenario == Scenario::FollowUp {
                fail("Answered without M2")
            } else {
                Verdict::Pass
            };
            result(scenario, outcome, vec![])
        });
        assert_eq!(ran, [Scenario::First, Scenario::FollowUp]);
        assert_eq!(results.len(), 5);
        assert!(results[2..].iter().all(|r| r.outcome == Verdict::NotRun));

        let mut ran = Vec::new();
        let results = run_scenarios(&pair(Some("a"), None), |scenario| {
            ran.push(scenario);
            result(scenario, Verdict::Pass, vec![])
        });
        assert!(!ran.contains(&Scenario::Switch));
        assert_eq!(ran.len(), 4);
        assert!(matches!(results[2].outcome, Verdict::NotApplicable { .. }));

        let mut ran = 0;
        let results = run_scenarios(&pair(None, None), |scenario| {
            ran += 1;
            let kind = FailureKind::QuotaExhausted;
            result(
                scenario,
                Verdict::Environment {
                    kind,
                    reason: "limit".into(),
                },
                vec![],
            )
        });
        assert_eq!(ran, 1);
        assert_eq!(results[4].outcome, Verdict::NotRun);
    }

    #[test]
    fn a_reply_is_judged_on_its_own_answer_session_and_failure_kind() {
        let ok = turn("M2-AB12");
        assert_eq!(
            judge_reply(&ok, "M2-AB12", Some("M1-AB12"), Some("session-1"), LIMIT),
            Verdict::Pass
        );
        assert!(matches!(
            judge_reply(&turn("Done."), "M2-AB12", None, Some("session-1"), LIMIT),
            Verdict::Fail { .. }
        ));
        let replayed = turn("M1-AB12 M2-AB12");
        assert!(
            matches!(judge_reply(&replayed, "M2-AB12", Some("M1-AB12"), Some("session-1"), LIMIT), Verdict::Fail { reason } if reason.contains("repeats"))
        );
        let restarted = Turn {
            session_id: Some("session-2".into()),
            ..ok.clone()
        };
        assert!(
            matches!(judge_reply(&restarted, "M2-AB12", None, Some("session-1"), LIMIT), Verdict::Fail { reason } if reason.contains("session-2"))
        );
        let sessionless = Turn {
            session_id: None,
            ..ok.clone()
        };
        assert!(matches!(
            judge_reply(&sessionless, "M2-AB12", None, None, LIMIT),
            Verdict::Fail { .. }
        ));
        let hung = Turn {
            timed_out: true,
            status: "stopped".into(),
            ..ok.clone()
        };
        assert!(
            matches!(judge_reply(&hung, "M2-AB12", None, None, LIMIT), Verdict::Fail { reason } if reason.contains("300 s"))
        );

        for kind in [
            FailureKind::Authentication,
            FailureKind::QuotaExhausted,
            FailureKind::RateLimited,
            FailureKind::ModelUnavailable,
        ] {
            assert_eq!(
                judge_reply(
                    &failed("Usage limit reached", Some(kind)),
                    "M1",
                    None,
                    None,
                    LIMIT
                ),
                Verdict::Environment {
                    kind,
                    reason: "Usage limit reached".into()
                }
            );
        }
        for kind in [
            None,
            Some(FailureKind::AgentExited),
            Some(FailureKind::ContextTooLong),
        ] {
            assert_eq!(
                judge_reply(&failed("exit 1", kind), "M1", None, None, LIMIT),
                fail("exit 1")
            );
        }
        assert_eq!(
            judge_reply(
                &Turn {
                    error: None,
                    ..failed("", None)
                },
                "M1",
                None,
                None,
                LIMIT
            ),
            fail("The attempt ended failed.")
        );
    }

    #[test]
    fn a_switch_that_did_not_take_fails_and_a_fallback_does_not() {
        let mismatch = |fallback| ModelMismatch {
            requested: "claude-sonnet-4-5".into(),
            served: "claude-haiku-4-5".into(),
            fallback,
        };
        let stayed = Turn {
            mismatch: Some(mismatch(false)),
            ..turn("M3")
        };
        assert!(
            matches!(judge_served(&stayed), Verdict::Fail { reason } if reason.contains("serving claude-haiku-4-5"))
        );
        assert_eq!(
            judge_served(&Turn {
                mismatch: Some(mismatch(true)),
                ..turn("M3")
            }),
            Verdict::Pass
        );
        assert_eq!(
            judge_served(&Turn {
                served_model: None,
                ..turn("M3")
            }),
            Verdict::Pass
        );
    }

    #[test]
    fn an_artifact_needs_its_exact_content_in_the_attempts_worktree() {
        let done = turn("DONE");
        let judge = |written: Option<&str>, in_checkout| {
            judge_artifact(
                &done,
                Some("session-1"),
                "matrix.txt",
                written,
                in_checkout,
                "ARTIFACT-1",
                LIMIT,
            )
        };
        assert_eq!(judge(Some("ARTIFACT-1"), false), Verdict::Pass);
        assert_eq!(judge(Some("ARTIFACT-1\n"), false), Verdict::Pass);
        assert_eq!(judge(Some("ARTIFACT-1\r\n"), false), Verdict::Pass);
        assert!(matches!(
            judge(Some("ARTIFACT-1\n\n"), false),
            Verdict::Fail { .. }
        ));
        assert!(matches!(
            judge(Some("artifact-1"), false),
            Verdict::Fail { .. }
        ));
        assert!(
            matches!(judge(None, false), Verdict::Fail { reason } if reason.contains("not in"))
        );
        assert!(
            matches!(judge(Some("ARTIFACT-1"), true), Verdict::Fail { reason } if reason.contains("checkout"))
        );
        assert!(matches!(
            judge_artifact(
                &failed("quota", Some(FailureKind::QuotaExhausted)),
                None,
                "matrix.txt",
                None,
                false,
                "ARTIFACT-1",
                LIMIT
            ),
            Verdict::Environment { .. }
        ));
    }

    #[test]
    fn recovery_keeps_the_saved_attempt_session_and_file() {
        let before = TaskRun {
            session_id: Some("session-1".into()),
            status: RunStatus::Review,
            ..super::super::sample("claude")
        };
        assert_eq!(check_recovery(&before, Some(&before), true), Ok(()));
        assert!(check_recovery(&before, None, true).is_err());
        assert!(check_recovery(&before, Some(&before), false).is_err());
        let lost = TaskRun {
            session_id: None,
            ..before.clone()
        };
        assert!(check_recovery(&before, Some(&lost), true)
            .unwrap_err()
            .contains("none"));
        let interrupted = TaskRun {
            status: RunStatus::Interrupted,
            ..before.clone()
        };
        assert!(check_recovery(&before, Some(&interrupted), true).is_err());
    }

    #[test]
    fn a_turn_names_a_served_model_only_when_the_agent_reported_one() {
        let mut run = super::super::sample("claude");
        run.status = RunStatus::Review;
        run.requested_model = Some("claude-haiku-4-5".into());
        run.model = run.requested_model.clone();
        let quiet = Turn::from_run(&run, 3, false);
        assert_eq!(
            (quiet.status.as_str(), quiet.served_model),
            ("review", None)
        );
        super::super::super::served_model::observe(&mut run, "claude-haiku-4-5-20251001");
        assert_eq!(
            Turn::from_run(&run, 3, false).served_model.as_deref(),
            Some("claude-haiku-4-5-20251001")
        );
    }

    #[test]
    fn findings_are_kept_apart_from_verdicts() {
        let pair = pair(Some("claude-haiku-4-5"), Some("claude-sonnet-4-5"));
        assert!(findings(&pair, &passing(vec![turn("M1")])).is_empty());

        let substituted = Turn {
            mismatch: Some(ModelMismatch {
                requested: "claude-haiku-4-5".into(),
                served: "claude-sonnet-4-5".into(),
                fallback: false,
            }),
            ..turn("M1")
        };
        // The switch turn asks for the partner; its served model is the switch verdict's to judge.
        let partner = Turn {
            requested_model: Some("claude-sonnet-4-5".into()),
            mismatch: Some(ModelMismatch {
                requested: "claude-sonnet-4-5".into(),
                served: "claude-opus-5".into(),
                fallback: false,
            }),
            ..turn("M3")
        };
        let unlabelled = Turn {
            served_model: None,
            ..turn("M2")
        };
        let uncached = Turn {
            cache_read_tokens: 0,
            ..unlabelled.clone()
        };
        let unreported = Turn {
            usage_reported: false,
            ..turn("M4")
        };
        let results = vec![
            result(Scenario::First, Verdict::Pass, vec![substituted]),
            result(Scenario::FollowUp, Verdict::Pass, vec![uncached]),
            result(Scenario::Switch, Verdict::Pass, vec![partner, unreported]),
            result(
                Scenario::Artifact,
                Verdict::Environment {
                    kind: FailureKind::RateLimited,
                    reason: "429".into(),
                },
                vec![failed("429", Some(FailureKind::RateLimited))],
            ),
            result(Scenario::Restart, Verdict::NotRun, vec![]),
        ];
        let found = findings(&pair, &results);
        assert_eq!(
            found,
            vec![
                Finding::Substituted {
                    scenario: Scenario::First,
                    requested: "claude-haiku-4-5".into(),
                    served: "claude-sonnet-4-5".into()
                },
                Finding::Unlabelled { turns: 1 },
                Finding::NoUsage { turns: 1 },
                Finding::Environment {
                    scenario: Scenario::Artifact,
                    kind: FailureKind::RateLimited,
                    reason: "429".into()
                },
            ]
        );

        let cold = passing(vec![Turn {
            cache_read_tokens: 0,
            ..turn("M1")
        }]);
        assert!(findings(&pair, &cold).contains(&Finding::NoCacheReads { input: 100_000 }));
        let codex = Pair {
            agent: "codex".into(),
            ..pair.clone()
        };
        assert!(findings(&codex, &cold).is_empty());
        let small = passing(vec![Turn {
            cache_read_tokens: 0,
            input_tokens: 100,
            ..turn("M1")
        }]);
        assert!(findings(&pair, &small).is_empty());
    }

    #[test]
    fn a_retry_that_passes_keeps_the_first_failure_as_a_finding() {
        let failing = Attempt {
            fixture: "first".into(),
            scenarios: vec![result(
                Scenario::First,
                fail("exit 1"),
                vec![failed("exit 1", None)],
            )],
        };
        let clean = Attempt {
            fixture: "retry".into(),
            scenarios: passing(vec![turn("M1")]),
        };
        assert!(needs_retry(&failing));
        assert!(!needs_retry(&clean));
        let blocked = Attempt {
            fixture: "env".into(),
            scenarios: vec![result(
                Scenario::First,
                Verdict::Environment {
                    kind: FailureKind::Authentication,
                    reason: "signed out".into(),
                },
                vec![],
            )],
        };
        assert!(!needs_retry(&blocked));

        let pair = pair(Some("claude-haiku-4-5"), None);
        let report = settle(pair.clone(), failing.clone(), Some(clean.clone()));
        assert_eq!(report.attempt.fixture, "retry");
        assert_eq!(report.first_try.as_ref().unwrap().fixture, "first");
        assert_eq!(
            report.findings,
            vec![Finding::FirstTry {
                scenario: Scenario::First,
                reason: "exit 1".into()
            }]
        );
        assert_eq!(
            (report.input_tokens, report.cache_read_tokens),
            (100_000, 75_000)
        );

        let twice = settle(pair.clone(), failing.clone(), Some(failing.clone()));
        assert!(twice.first_try.is_some());
        assert!(twice.findings.is_empty());
        assert!(settle(pair, clean, None).first_try.is_none());
    }

    #[test]
    fn the_report_renders_verdicts_counts_and_findings_separately() {
        let haiku = pair(Some("claude-haiku-4-5"), Some("claude-sonnet-4-5"));
        let mut switched = passing(vec![turn("M1")]);
        switched[2].turns = vec![
            Turn {
                requested_model: Some("claude-sonnet-4-5".into()),
                ..turn("M3")
            },
            turn("M4"),
        ];
        switched[3] = result(
            Scenario::Artifact,
            fail("matrix.txt is not in the attempt's worktree."),
            vec![turn("DONE")],
        );
        switched[4] = result(Scenario::Restart, Verdict::NotRun, vec![]);
        let first = Attempt {
            fixture: "a".into(),
            scenarios: switched,
        };
        let substituted = Attempt {
            fixture: "b".into(),
            scenarios: passing(vec![Turn {
                mismatch: Some(ModelMismatch {
                    requested: "claude-sonnet-4-5".into(),
                    served: "claude-opus-5".into(),
                    fallback: false,
                }),
                requested_model: Some("claude-sonnet-4-5".into()),
                ..turn("M1")
            }]),
        };
        let blocked = Attempt {
            fixture: "c".into(),
            scenarios: run_scenarios(&pair(None, None), |scenario| {
                result(
                    scenario,
                    Verdict::Environment {
                        kind: FailureKind::QuotaExhausted,
                        reason: "Usage | limit reached".into(),
                    },
                    vec![],
                )
            }),
        };
        let report = MatrixReport {
            matrix: "claude=claude-haiku-4-5,claude-sonnet-4-5;codex".into(),
            started_at: "2026-11-12T00:00:00Z".into(),
            finished_at: Some("2026-11-12T00:10:00Z".into()),
            commit: Some("abc1234".into()),
            turn_limit_seconds: 300,
            agents: vec![AgentBuild {
                agent: "claude".into(),
                executable: Some("/bin/claude".into()),
                version: Some("2.1.0".into()),
            }],
            pairs: vec![
                settle(haiku, first, None),
                settle(
                    pair(Some("claude-sonnet-4-5"), Some("claude-haiku-4-5")),
                    substituted,
                    None,
                ),
                settle(
                    Pair {
                        agent: "codex".into(),
                        model: None,
                        partner: None,
                    },
                    blocked,
                    None,
                ),
            ],
        };
        let markdown = render_markdown(&report);
        assert!(markdown.contains("- claude: 2.1.0 (/bin/claude)"));
        assert!(markdown.contains("| claude | claude-haiku-4-5 | pass | pass | pass (claude-sonnet-4-5) | FAIL | not run | 75% | artifact: matrix.txt is not in the attempt's worktree. |"), "{markdown}");
        assert!(
            markdown.contains(
                "| codex | CLI default | env | not run | not run | not run | not run | - |  |"
            ),
            "{markdown}"
        );
        // The substituted pair is a finding: its passes are not counted.
        assert!(
            markdown.contains("3 pairs, 3 of 4 scenario runs passed; 1 pairs with a substituted"),
            "{markdown}"
        );
        assert!(markdown.contains("## Findings\n\n- claude × claude-sonnet-4-5: first asked for claude-sonnet-4-5; the agent reports serving claude-opus-5"));
        assert!(markdown.contains("## Stopped by the account or provider\n\n- codex × CLI default: first stopped by quota exhausted: Usage / limit reached"));

        let json = serde_json::to_value(&report).unwrap();
        let first = &json["pairs"][0];
        assert_eq!(first["agent"], "claude");
        assert_eq!(first["fixture"], "a");
        assert_eq!(first["scenarios"][3]["outcome"]["result"], "fail");
        assert_eq!(json["pairs"][1]["findings"][0]["finding"], "substituted");
        assert_eq!(json["pairs"][2]["findings"][0]["kind"], "quota_exhausted");
    }
}
