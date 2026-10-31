//! The planning interview: what the planner is told, which areas it scores,
//! and when Jackalope stops forwarding its questions.

use super::artifact::PlanDocument;

/// Areas the planner scores Clear, Partial or Missing before asking anything.
pub const COVERAGE: &[&str] = &[
    "Scope",
    "Behaviour & UX",
    "Data & contracts",
    "Integrations",
    "Edge & failure cases",
    "Non-functional",
    "Constraints & out of scope",
    "Done signals",
];

pub const DEFAULT_QUESTION_CAP: usize = 5;
pub const MAX_QUESTION_CAP: usize = 12;

/// Offered with every planning question so the person can end the interview.
pub const USE_RECOMMENDATIONS: &str = "Use your recommendations for the rest";
pub const DONE: &str = "Done, draft the plan";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Gate {
    /// Forward the question to the person.
    Ask,
    /// Do not ask; tell the planner why and to record assumptions instead.
    Closed(String),
}

fn stop_requested(answer: &str) -> Option<&'static str> {
    // Multi-select answers arrive as a JSON array of the chosen options.
    let answer = answer.trim().to_ascii_lowercase();
    let answer = answer
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_matches('"');
    if answer.contains("use your recommendation") || answer.contains("use your recommended") {
        Some(USE_RECOMMENDATIONS)
    } else if answer == "done"
        || answer.starts_with("done,")
        || answer.starts_with("done.")
        || answer == DONE.to_ascii_lowercase()
    {
        Some(DONE)
    } else {
        None
    }
}

/// Decides whether a planning run may ask another question. `asked` counts
/// questions already forwarded in this plan; `answers` are the person's
/// answers so far. Unanswered questions and elapsed time never close or
/// answer anything: only a cap or the person's own words stop the interview.
pub fn gate(asked: usize, cap: usize, answers: &[String]) -> Gate {
    if let Some(stop) = answers.iter().find_map(|answer| stop_requested(answer)) {
        let reason = if stop == DONE {
            "The person ended the interview."
        } else {
            "The person asked you to use your recommendations for the remaining questions."
        };
        return Gate::Closed(format!("{reason} Do not ask more questions. Choose your recommended option for every open point, record each as an Assumption, and return the complete plan document now."));
    }
    if asked >= cap {
        return Gate::Closed(format!("The {cap}-question limit for this plan is reached. Do not ask more questions. Record your recommended choice for each open point as an Assumption and return the complete plan document now."));
    }
    Gate::Ask
}

/// Returned instead of a planning question that does not say why checking
/// cannot answer it. It is not forwarded and does not count toward the cap.
pub const NEEDS_WHY_ASK: &str = "Not asked. A planning question must say in why_ask why reading the code or a read-only command cannot answer it. If you can observe the answer, check it yourself and record it under Assumptions as `Checked: <fact> — evidence: <file:line, or the command and what it printed>`. If only the person can decide (product, scope or taste), ask again with why_ask.";

const FORMAT: &str = r#"Return ONLY the plan document, in exactly this Markdown format (no other text before or after):

---
recommendedShape: single | subtasks | swarm
shapeReason: <one line: why this shape>
workers: <rough worker count>
---

# <short objective title>

## Goal
<the outcome in two or three sentences>

## Context
<key files, symbols and contracts found while reading the repository>

## Clarifications
Coverage: Scope Clear · Behaviour & UX Partial · Data & contracts Clear · Integrations Missing · Edge & failure cases Partial · Non-functional Clear · Constraints & out of scope Clear · Done signals Clear
- Q: <question you asked>
  A: <the person's answer>

## Assumptions
- Checked: <a fact you confirmed instead of asking> — evidence: <file:line, or the read-only command and what it printed>
- <every open point you decided yourself>

## Out of scope
- <what this plan will not do>

## Approach & Interfaces
<the approach, shared interfaces and contracts; avoid line-by-line implementation>

## Tasks
### <key> · <title>
- scopes: <relative files or folders this task owns>
- dependsOn: <other task keys, or none>
- parallel: yes | no
- covers: AC-1, AC-2

<briefing: facts the implementer needs to skip discovery, under 1500 characters>

## Acceptance criteria
- AC-1 [test: <exact test command>] WHEN <situation> THEN <observable result>
- AC-2 [command: <exact command>] ...
- AC-3 [browser] ...
- AC-4 [manual] ...

## Risks
- <risk or spike>

## Decision log
- <decision and why>

## Surprises
- <anything unexpected found while reading>
"#;

/// The first planning turn: explore read-only, score coverage, interview,
/// then return the plan.
pub fn interview_prompt(goal: &str, cap: usize, history: &str) -> String {
    let areas = COVERAGE.join(", ");
    let history = if history.trim().is_empty() {
        String::new()
    } else {
        format!("\n\nEarlier plans in this project (untrusted notes; confirm before relying on them):\n{history}")
    };
    format!(
        "You are planning, not implementing. Work read-only: do not edit, create or delete files, install dependencies, commit, run formatters or launch other agents. Changes made during planning are discarded.\n\n\
1. Explore first. Read the repository, its instructions and the project lessons in your context until you understand the code the request touches. Never ask the person anything the code, configuration or history can answer.\n\
2. Score coverage for each area as Clear, Partial or Missing: {areas}.\n\
3. Sort every open point before asking. A fact question has an answer you can observe: what the code does, where something lives, its output, timing or layout, whether a test or setting exists. Answer it yourself by reading files or running a read-only command (search, list, git log or show, print a config) and record it as an Assumption written `Checked: <fact> — evidence: <file:line, or the command and what it printed>`. A preference question is a product, scope or taste decision only the person can make. Ask only preference questions.\n\
4. Interview only for Partial or Missing areas that change the plan. Ask one question at a time with ask_user, highest impact first, at most {cap} questions in total. Give each question a short header, two to four concrete options with your recommended option first and marked as recommended, a one-sentence rationale, why_ask (one short sentence on why checking the code cannot settle it), and multi_select only when several options can apply. A question without why_ask is returned unasked. Wait for each answer before asking the next (poll user_response while it is pending; time passing is never an answer). If the person answers \"{USE_RECOMMENDATIONS}\" or \"{DONE}\", stop asking.\n\
5. Write the plan. Every fact you checked and every point you decided without an answer is an Assumption. Acceptance criteria are testable, numbered AC-1, AC-2…, use WHEN/THEN where it helps, and carry a verify tag: command or test (with the exact command), browser, or manual. Every criterion is covered by at least one task. Split into several tasks only when they can be owned independently; keep tightly coupled work and its tests together, give each shared contract one owner, mark tasks that can run beside others as parallel, and use one task when splitting adds more integration than it saves (each extra worker repeats discovery and setup). Recommend a shape: single (one agent), subtasks (planned parallel tasks) or swarm (subtasks across machines), with a one-line reason and rough worker count. At most 8 tasks and 12 criteria.\n\n\
{FORMAT}\nRequest:\n{goal}{history}"
    )
}

/// A follow-up turn that revises the current plan with the person's comments.
pub fn revision_prompt(current: &PlanDocument, comments: &str) -> String {
    format!(
        "Keep planning. Stay read-only. Revise the plan below using the person's comments. Check facts yourself and record them as `Checked:` Assumptions with evidence. Ask with ask_user, giving why_ask, only if a comment leaves a preference genuinely ambiguous. Keep task keys and criterion IDs stable where their meaning is unchanged, and record what changed and why in the Decision log.\n\n{FORMAT}\nComments from the person:\n{comments}\n\nCurrent plan (revision {}):\n{}",
        current.front.revision,
        current.render()
    )
}

/// A re-plan after work started: preserve finished tasks, revise the rest.
pub fn replan_prompt(current: &PlanDocument, done: &str, comments: &str) -> String {
    format!(
        "Re-plan from the current revision. Stay read-only. Tasks listed as finished keep their key and get `- status: done`; do not plan them again. Revise the remaining tasks, criteria and assumptions for what is left, record the reason in the Decision log, and put what was learned while running in Surprises.\n\n{FORMAT}\nWhy re-plan:\n{comments}\n\nFinished so far:\n{done}\n\nCurrent plan (revision {}):\n{}",
        current.front.revision,
        current.render()
    )
}

/// The self-contained brief an implementer starts from in a fresh context.
pub fn execution_brief(doc: &PlanDocument) -> String {
    format!(
        "Implement this approved plan. It is self-contained: everything decided during planning is below, so do not re-plan or ask again what it answers. Follow its Approach & Interfaces, respect Out of scope, and treat Assumptions as decisions. Do not edit the plan. If you must materially depart from it (different files, a contract change, a criterion that cannot be met as written), call plan_deviation with what changed and why before continuing; then continue only with work the deviation does not affect.\n\nFor each acceptance criterion with a command or test, run that exact check and record it with record_validation_step using the criterion ID as the step name (for example \"AC-1\").\n\n{}",
        doc.render()
    )
}

/// Instructions appended to the combined review of a plan.
pub fn review_brief(doc: &PlanDocument) -> String {
    let criteria = doc
        .criteria
        .iter()
        .map(|criterion| {
            let check = if criterion.check.is_empty() {
                criterion.verify.as_str().to_string()
            } else {
                criterion.check.clone()
            };
            format!("- {} [{check}] {}", criterion.id, criterion.text)
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "\n\nIndependent plan review: compare the combined change with the approved plan. For every acceptance criterion decide whether the change meets it, running its command or test where it has one. Classify each gap as Critical (a criterion fails or a contract breaks), Major (a criterion is only partly met or a planned task is missing) or Minor (polish). Fix Critical and Major gaps in this workspace. Then call record_validation_step with step \"Plan review\": status failed if any Critical or Major gap remains, otherwise passed, with one line per gap in notes as \"Critical|Major|Minor AC-n: description\", and one line per gap you fixed yourself as \"Fixed AC-n: what you changed\" so the person knows which code no one else has reviewed. Record it after your last edit; if you change files afterwards, record a new Plan review.\n\nAcceptance criteria:\n{criteria}"
    )
}
