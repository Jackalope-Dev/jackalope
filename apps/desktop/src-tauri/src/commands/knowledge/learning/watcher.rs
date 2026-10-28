//! Background reflection. A low-priority thread notices when a task has made
//! another `learning_cadence` tool calls or has finished, then reflects on what
//! the person said and what passed. It never blocks or fails the task: errors
//! are logged and the run is not retried.

use super::{reflect, Observation, ObservationKind};
use crate::commands::live_sessions::LiveSessions;
use crate::commands::tasks::{TaskRun, TaskRuntime};
use std::collections::HashMap;
use std::time::Duration;

const POLL: Duration = Duration::from_secs(15);
/// Reflections per poll, so a burst of finished work is spread out.
const PER_POLL: usize = 4;

#[derive(Default)]
struct Progress {
    reflected_calls: u64,
    done: bool,
}

/// Which runs are due. The first pass only records where every run stands, so
/// starting the app does not reflect on history again.
fn due(
    progress: &mut HashMap<String, Progress>,
    activity: &[crate::commands::tasks::RunActivity],
    first: bool,
    settings: &mut impl FnMut(&str) -> (bool, u32),
) -> Vec<String> {
    progress.retain(|id, _| activity.iter().any(|run| &run.id == id));
    let mut due = vec![];
    for run in activity {
        let state = progress.entry(run.id.clone()).or_default();
        if first {
            state.reflected_calls = run.tool_calls;
            state.done = run.finished;
            continue;
        }
        if state.done {
            continue;
        }
        let (enabled, cadence) = settings(&run.project_id);
        if !enabled {
            state.done = run.finished;
            state.reflected_calls = run.tool_calls;
            continue;
        }
        let cadence = u64::from(cadence.max(1));
        if run.finished || run.tool_calls >= state.reflected_calls + cadence {
            state.reflected_calls = run.tool_calls;
            state.done = run.finished;
            due.push(run.id.clone());
        }
    }
    due
}

pub fn launch(runtime: TaskRuntime, sessions: LiveSessions) {
    let spawned = std::thread::Builder::new()
        .name("jackalope-learning".into())
        .spawn(move || {
            let mut progress = HashMap::new();
            let mut first = true;
            let mut seen_revision = None;
            let mut queue: Vec<String> = vec![];
            loop {
                std::thread::sleep(POLL);
                let revision = runtime.revision();
                if seen_revision != Some(revision) || first {
                    seen_revision = Some(revision);
                    let mut cache = HashMap::new();
                    let mut settings = |project_id: &str| {
                        *cache.entry(project_id.to_string()).or_insert_with(|| {
                            let settings =
                                crate::commands::project_registry::settings(&runtime, project_id);
                            (settings.learn_automatically, settings.learning_cadence)
                        })
                    };
                    let activity = runtime.learning_activity();
                    for id in due(&mut progress, &activity, first, &mut settings) {
                        if !queue.contains(&id) {
                            queue.push(id);
                        }
                    }
                    first = false;
                }
                let batch: Vec<String> = queue.drain(..queue.len().min(PER_POLL)).collect();
                for id in batch {
                    let Some(run) = runtime.run_snapshot(&id) else {
                        continue;
                    };
                    if let Err(error) = reflect_run(&runtime, &sessions, &run) {
                        eprintln!("Background learning skipped a task: {error}");
                    }
                }
            }
        });
    if let Err(error) = spawned {
        eprintln!("Background learning is unavailable: {error}");
    }
}

/// What a run offers reflection: the person's words, typed answers and a
/// passing check. Conversation turns use the messages sent in that turn; other
/// tasks use the instruction's objective.
pub(in crate::commands) fn observations(
    run: &TaskRun,
    turn: Option<Vec<String>>,
) -> Vec<Observation> {
    let reference = match &run.live_session_id {
        Some(session) => format!("Conversation {session} · task {}", run.id),
        None => format!("Task {}", run.id),
    };
    let observe = |kind, text: &str| Observation {
        kind,
        text: text.to_string(),
        reference: reference.clone(),
        run_id: Some(run.id.clone()),
    };
    let mut found = vec![];
    match (turn, &run.live_session_id) {
        (Some(messages), _) => {
            for message in messages {
                found.push(observe(ObservationKind::Statement, &message));
            }
        }
        (None, None) => found.push(observe(
            ObservationKind::Statement,
            crate::commands::knowledge::automatic::objective(&run.prompt),
        )),
        // A conversation's batch prompt repeats earlier turns; without its own
        // messages there is nothing safe to read.
        (None, Some(_)) => {}
    }
    for prompt in &run.prompts {
        if prompt.status == "answered" && prompt.input_type == "text" {
            if let Some(answer) = prompt.answer.as_deref() {
                found.push(observe(
                    ObservationKind::Answer {
                        question: prompt.question.clone(),
                    },
                    answer,
                ));
            }
        }
    }
    if let Some(check) = &run.verification {
        if check.result.success && check.result.interruption().is_none() {
            found.push(observe(ObservationKind::Check, &check.command));
        }
    }
    found
}

fn reflect_run(
    runtime: &TaskRuntime,
    sessions: &LiveSessions,
    run: &TaskRun,
) -> Result<(), String> {
    if run.details_omitted || run.project_path.is_empty() {
        return Ok(());
    }
    let turn = run
        .live_session_id
        .as_ref()
        .map(|session| sessions.turn_messages(session, &run.id));
    let observations = observations(run, turn);
    if observations.is_empty() {
        return Ok(());
    }
    let existing = runtime.knowledge.list(&run.project_id, &run.project_path)?;
    let proposals = reflect(&observations, &existing);
    if proposals.is_empty() {
        return Ok(());
    }
    runtime
        .knowledge
        .promote(&run.project_id, &run.project_path, proposals, "reflection")?;
    Ok(())
}

#[cfg(test)]
pub(super) fn due_for_tests(
    progress_calls: &mut Vec<(String, u64, bool)>,
    activity: &[crate::commands::tasks::RunActivity],
    first: bool,
    enabled: bool,
    cadence: u32,
) -> Vec<String> {
    let mut progress: HashMap<String, Progress> = progress_calls
        .drain(..)
        .map(|(id, calls, done)| {
            (
                id,
                Progress {
                    reflected_calls: calls,
                    done,
                },
            )
        })
        .collect();
    let result = due(&mut progress, activity, first, &mut |_| (enabled, cadence));
    progress_calls.extend(
        progress
            .into_iter()
            .map(|(id, state)| (id, state.reflected_calls, state.done)),
    );
    result
}
