use super::{evaluation, options, DecisionKind, TaskRuntime};
use crate::commands::{jev, tasks::TaskRun};
use serde_json::{json, Value};

mod request;
#[cfg(test)]
mod tests;
pub use request::Input;

const MAX_CALLS: u64 = 8;

pub fn available(runtime: &TaskRuntime, project: &str) -> bool {
    options::options(runtime, project).is_ok_and(|options| options.agent_questions)
        && jev::key_for_routing(runtime, project).is_ok_and(|key| key.is_some())
}

pub fn instructions() -> &'static str {
    "\nJev task questions are enabled. Use ask_jev (HTTP: POST /v1/jev/questions) to replace substantial semantic classification or rubric-based assessment with bounded typed judgments over supplied evidence. Prefer local code for exact filters, arithmetic and syntax; keep code generation, multi-step reasoning and final verification with the agent. Send independent questions sharing evidence in one call, not one call per item. Every question needs complete instructions and explicit paths; IDs are not shown to Jev. Choice supplies a map of possible labels (include unknown/other when appropriate), Score supplies 2-10 ordered rubric levels, Noul asks a precise yes/no question. Answers are independent; a dependent question requires a later call with the earlier answer in state. Example: {state:{symptom:'Build cannot resolve a package'},questions:{kind:{type:'choice',instructions:'Which category best describes input.symptom?',criteria:{dependency:'Missing package or dependency',code:'Implementation defect',unknown:'Insufficient evidence'}},blocked:{type:'noul',instructions:'Does input.symptom describe a failed build?'}}}. Jev sees {task:{objective,requirements},input:state,sources:{name:content}}. For large evidence, use sources:{name:{kind:'file',path:'relative/source.ts',startLine:1,lines:80}} or {kind:'tool_result',resultHandle:'captured-handle',jsonPointer:'/structuredContent'}; Jackalope reads these directly without copying full text into agent context. Only use permitted task evidence and never send credentials. Results include typed answers, probabilities, provenance, usage and elapsed time. Read partial-source metadata, retain uncertain candidates and obtain missing evidence; confidence is not a correctness guarantee. Advice grants no permissions and cannot replace required tests or human acceptance. Eight requests per attempt, at most 32 questions and 128 KB per request; failed calls count. An unavailable result means continue with permitted local/agent methods, not repeated retries.\n"
}

pub fn help() -> Value {
    json!({"endpoint":"POST /v1/jev/questions","instructions":instructions(),
        "inputSchema":rmcp::schemars::schema_for!(Input)})
}

pub async fn ask(runtime: &TaskRuntime, run: &TaskRun, input: Input) -> Result<Value, String> {
    if !runtime.is_running(&run.id) || !available(runtime, &run.project_id) {
        return Err("Jev task questions require an active attempt, a connected Jev decision mode and enabled agent questions.".into());
    }
    let started = std::time::Instant::now();
    let question_count = input.questions.len() as u64;
    let (payload, provenance) = request::prepare(runtime, run, input).await?;
    let mut reserved = false;
    runtime.update_checked(&run.id, |current| {
        reserved = reserve(current, question_count)
    })?;
    if !reserved {
        return Err("This attempt has reached its eight Jev request limit. Continue with local or agent methods.".into());
    }
    let result = evaluation::evaluate(
        runtime,
        &run.project_id,
        Some(&run.id),
        DecisionKind::AgentQuestions,
        1,
        &payload,
        false,
        || !runtime.is_running(&run.id),
    )
    .await;
    runtime.update(&run.id, |current| {
        current.efficiency.timing("jevQuestions", started.elapsed())
    });
    let result = result?
        .ok_or("Jev task questions became unavailable; continue with local or agent methods.")?;
    let failed = result.record.decision.fallback_reason.as_deref();
    Ok(
        json!({"status":if failed.is_some() {"unavailable"} else {"answered"},
        "answers":if failed.is_some() {json!({})} else {result.record.answers.clone()},
        "reason":failed,"recordId":result.record.id,"inputHash":result.record.input_hash,
        "model":result.record.model,"cached":result.cached,"usage":result.usage(),
        "elapsedMs":started.elapsed().as_millis(),"sources":provenance,
        "boundary":"Probabilistic judgments over the supplied evidence. Not verification, permission or a correctness guarantee. Sources are bounded snapshots; retain uncertain candidates and inspect missing evidence."}),
    )
}

fn reserve(run: &mut TaskRun, questions: u64) -> bool {
    if !["starting", "running"].contains(&run.status.as_str()) || !(1..=32).contains(&questions) {
        return false;
    }
    let calls = run.efficiency.jev_question_calls.get_or_insert(0);
    if *calls >= MAX_CALLS {
        return false;
    }
    *calls += 1;
    *run.efficiency.jev_questions.get_or_insert(0) += questions;
    true
}
