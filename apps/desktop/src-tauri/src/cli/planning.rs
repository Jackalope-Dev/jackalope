//! `jackalope plan`: plan mode without the full-screen interface. Questions
//! are asked on the terminal when there is one; approval is always explicit.

use crate::connection::{short, unexpected, Connection};
use crate::host::{self, ColdStart};
use crate::protocol::{PlanSummary, PlanView, Question, Request, Response};
use std::io::{BufRead, IsTerminal, Write};
use std::time::Duration;

/// Exit status when the planner is waiting on an answer and there is no
/// terminal to ask on, matching `-p`.
pub const ASKED: i32 = 2;

fn plan(response: Response) -> Result<PlanView, String> {
    match response {
        Response::Plan { plan } => Ok(*plan),
        _ => Err(unexpected()),
    }
}

fn plans(connection: &mut Connection) -> Result<Vec<PlanSummary>, String> {
    let directory = std::env::current_dir().map_err(|error| error.to_string())?;
    match connection.call(&Request::Plans {
        project_path: directory.to_string_lossy().into_owned(),
    })? {
        Response::Plans { plans } => Ok(plans),
        _ => Err(unexpected()),
    }
}

fn resolve(connection: &mut Connection, prefix: &str) -> Result<String, String> {
    let matches: Vec<String> = plans(connection)?
        .into_iter()
        .filter(|plan| plan.id.starts_with(prefix))
        .map(|plan| plan.id)
        .collect();
    match matches.as_slice() {
        [id] => Ok(id.clone()),
        [] => Err(format!(
            "No plan here starts with '{prefix}'. Run 'jackalope plans'."
        )),
        _ => Err(format!(
            "'{prefix}' matches several plans; use more of the id."
        )),
    }
}

/// Whether a plan assumption is a fact the planner checked rather than a
/// choice it made: the plan document writes those `Checked: <fact> — evidence: …`.
pub fn checked(assumption: &str) -> bool {
    assumption
        .trim_start()
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("checked:"))
}

/// The question as lines, recommended option marked.
pub fn question_lines(question: &Question) -> Vec<String> {
    let mut lines = vec![];
    if let Some(header) = &question.header {
        lines.push(format!("[{header}]"));
    }
    lines.push(question.question.clone());
    if let Some(rationale) = &question.rationale {
        lines.push(format!("  {rationale}"));
    }
    if let Some(why) = &question.why_ask {
        lines.push(format!("  Why ask: {why}"));
    }
    for (index, option) in question.options.iter().enumerate() {
        let mark = if question.recommended.as_ref() == Some(option) {
            " (recommended)"
        } else {
            ""
        };
        lines.push(format!("  {}. {option}{mark}", index + 1));
    }
    lines
}

/// Turns `2` or `1,3` into the option text the host expects.
pub fn reply(question: &Question, text: &str) -> String {
    let pick = |number: &str| {
        number
            .trim()
            .parse::<usize>()
            .ok()
            .and_then(|number| question.options.get(number.checked_sub(1)?))
            .cloned()
    };
    if question.multi_select {
        let chosen: Option<Vec<String>> = text.split(',').map(pick).collect();
        if let Some(chosen) = chosen.filter(|chosen| !chosen.is_empty()) {
            return serde_json::to_string(&chosen).unwrap_or_default();
        }
    }
    // An option typed by name, in any case, answers with the option itself.
    pick(text)
        .or_else(|| {
            question
                .options
                .iter()
                .find(|option| option.eq_ignore_ascii_case(text.trim()))
                .cloned()
        })
        .unwrap_or_else(|| text.trim().to_string())
}

/// `reply`, refusing text that is not one of the options when the question
/// takes only its options: a permission request would read it as a denial.
pub fn checked_reply(question: &Question, text: &str) -> Result<String, String> {
    let answer = reply(question, text);
    let chosen = if question.multi_select {
        serde_json::from_str::<Vec<String>>(&answer).is_ok()
    } else {
        question.options.contains(&answer)
    };
    if question.allow_other == Some(false) && !chosen {
        let options = question
            .options
            .iter()
            .enumerate()
            .map(|(index, option)| format!("{}. {option}", index + 1))
            .collect::<Vec<_>>()
            .join("  ");
        return Err(format!("Choose an option by number or name: {options}"));
    }
    Ok(answer)
}

fn ask(question: &Question) -> Result<Option<String>, String> {
    for line in question_lines(question) {
        eprintln!("{line}");
    }
    eprint!("> ");
    std::io::stderr()
        .flush()
        .map_err(|error| error.to_string())?;
    loop {
        let mut line = String::new();
        if std::io::stdin()
            .lock()
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            return Ok(None);
        }
        match checked_reply(question, &line) {
            Ok(answer) => return Ok(Some(answer).filter(|text| !text.is_empty())),
            Err(problem) => {
                eprint!("{problem}\n> ");
                std::io::stderr()
                    .flush()
                    .map_err(|error| error.to_string())?;
            }
        }
    }
}

fn next_steps(view: &PlanView) {
    eprintln!();
    eprintln!(
        "Plan {} · revision {} · {} · recommended: {}{}",
        short(&view.id),
        view.revision.unwrap_or_default(),
        view.status,
        view.shape,
        if view.shape_reason.is_empty() {
            String::new()
        } else {
            format!(" ({})", view.shape_reason)
        }
    );
    eprintln!(
        "Approve with 'jackalope plan approve {} {}', or keep planning with /plans in 'jackalope'.",
        short(&view.id),
        view.shape
    );
}

pub fn start(
    preference: Option<ColdStart>,
    goal: String,
    agent: Option<String>,
    json: bool,
) -> Result<i32, String> {
    if goal.trim().is_empty() {
        return Err("Say what to plan: jackalope plan \"<goal>\"".into());
    }
    let mut connection = host::ensure(preference)?;
    let directory = std::env::current_dir().map_err(|error| error.to_string())?;
    let mut view = plan(connection.call(&Request::PlanStart {
        project_path: directory.to_string_lossy().into_owned(),
        goal,
        agent,
    })?)?;
    eprintln!("Planning {} · read-only", short(&view.id));
    let interactive = std::io::stdin().is_terminal();
    let mut asked = std::collections::HashSet::new();
    loop {
        if let Some(question) = view.questions.first().cloned() {
            if !interactive {
                for line in question_lines(&question) {
                    eprintln!("{line}");
                }
                eprintln!("The planner is waiting on this answer. Run 'jackalope' and open it with /plans.");
                return Ok(ASKED);
            }
            if asked.insert(question.id.clone()) {
                if let Some(text) = ask(&question)? {
                    connection.call(&Request::Answer {
                        run_id: question.run_id.clone(),
                        prompt_id: question.id.clone(),
                        text,
                    })?;
                }
            }
        } else if !view.planning {
            if let Some(error) = view.error.as_ref().filter(|_| view.revision.is_none()) {
                return Err(error.clone());
            }
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&view).map_err(|error| error.to_string())?
                );
            } else {
                println!("{}", view.markdown.as_deref().unwrap_or_default());
                if let Some(error) = &view.error {
                    eprintln!("{error}");
                }
                next_steps(&view);
            }
            return Ok(0);
        }
        std::thread::sleep(Duration::from_millis(800));
        view = plan(connection.call(&Request::PlanDetail {
            plan_id: view.id.clone(),
        })?)?;
    }
}

pub fn show(preference: Option<ColdStart>, prefix: &str, json: bool) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let id = resolve(&mut connection, prefix)?;
    let view = plan(connection.call(&Request::PlanDetail { plan_id: id })?)?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&view).map_err(|error| error.to_string())?
        );
        return Ok(());
    }
    println!("{}", view.markdown.as_deref().unwrap_or("No draft yet."));
    if let Some(progress) = &view.progress {
        eprintln!("{progress}");
    }
    next_steps(&view);
    Ok(())
}

pub fn list(preference: Option<ColdStart>, json: bool) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let plans = plans(&mut connection)?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&plans).map_err(|error| error.to_string())?
        );
        return Ok(());
    }
    if plans.is_empty() {
        println!("No plans in this project. Start one with jackalope plan \"<goal>\".");
    }
    for plan in plans {
        println!(
            "{}  {:<9} r{:<3} {}",
            short(&plan.id),
            plan.status,
            plan.revision.unwrap_or_default(),
            plan.title
        );
    }
    Ok(())
}

pub fn approve(
    preference: Option<ColdStart>,
    prefix: &str,
    shape: Option<String>,
    yes: bool,
) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let id = resolve(&mut connection, prefix)?;
    let view = plan(connection.call(&Request::PlanDetail {
        plan_id: id.clone(),
    })?)?;
    let (Some(revision), Some(hash)) = (view.revision, view.hash.clone()) else {
        return Err("There is no plan to approve yet.".into());
    };
    let shape = shape.unwrap_or_else(|| view.shape.clone());
    eprintln!(
        "{} · revision {revision} · {} tasks · {} criteria",
        view.title,
        view.tasks.len(),
        view.criteria.len()
    );
    for assumption in &view.assumptions {
        if checked(assumption) {
            eprintln!("  {assumption}");
        } else {
            eprintln!("  assumes: {assumption}");
        }
    }
    match (view.verification.as_deref(), &view.check) {
        (Some("review"), _) => eprintln!(
            "  No automatic check: results are reviewed but not test-verified. Add a check command in the app's Project settings."
        ),
        (_, Some(check)) => eprintln!("  checked with: {check}"),
        _ => {}
    }
    if !crate::subcommands::approved(
        yes,
        &format!("Approve revision {revision} and run it as {shape}?"),
    )? {
        eprintln!("Not approved.");
        return Ok(());
    }
    let view = plan(connection.call(&Request::PlanAction {
        plan_id: id,
        action: "approve".into(),
        text: shape.clone(),
        revision: Some(revision),
        hash: Some(hash),
    })?)?;
    println!(
        "Approved revision {revision}; {} started as {shape}.",
        view.title
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn question(multi: bool) -> Question {
        Question {
            id: "q".into(),
            run_id: "r".into(),
            question: "Which formats?".into(),
            options: vec!["CSV".into(), "JSON".into(), "Excel".into()],
            header: Some("Formats".into()),
            recommended: Some("CSV".into()),
            multi_select: multi,
            rationale: Some("Decides the serializers.".into()),
            why_ask: Some("A product choice.".into()),
            allow_other: None,
        }
    }

    #[test]
    fn options_only_questions_refuse_other_text() {
        let mut permission = question(false);
        permission.options = vec!["Allow once".into(), "Deny".into()];
        permission.allow_other = Some(false);
        assert_eq!(checked_reply(&permission, "1").unwrap(), "Allow once");
        assert_eq!(
            checked_reply(&permission, "allow once").unwrap(),
            "Allow once"
        );
        assert!(checked_reply(&permission, "yes").is_err());
        assert_eq!(
            checked_reply(&question(false), "Parquet").unwrap(),
            "Parquet"
        );
        assert_eq!(reply(&question(false), "json"), "JSON");
    }

    #[test]
    fn answers_accept_numbers_lists_and_free_text() {
        assert_eq!(reply(&question(false), "2"), "JSON");
        assert_eq!(reply(&question(false), "Parquet"), "Parquet");
        assert_eq!(reply(&question(true), "1,3"), r#"["CSV","Excel"]"#);
        assert_eq!(reply(&question(true), "1, 9"), "1, 9");
        let lines = question_lines(&question(false));
        assert_eq!(lines[0], "[Formats]");
        assert!(lines.contains(&"  1. CSV (recommended)".to_string()));
        assert!(lines.contains(&"  Decides the serializers.".to_string()));
        assert!(lines.contains(&"  Why ask: A product choice.".to_string()));
    }

    #[test]
    fn plan_protocol_stays_compatible_with_older_peers() {
        let older: Question = serde_json::from_value(serde_json::json!({
            "id": "q", "runId": "r", "question": "Continue?", "options": []
        }))
        .unwrap();
        assert!(older.header.is_none() && !older.multi_select);
        let request = serde_json::to_string(&Request::PlanAction {
            plan_id: "p".into(),
            action: "keep".into(),
            text: "Use tabs".into(),
            revision: None,
            hash: None,
        })
        .unwrap();
        assert_eq!(
            request,
            r#"{"request":"plan-action","plan_id":"p","action":"keep","text":"Use tabs"}"#
        );
        let parsed: Request =
            serde_json::from_str(r#"{"request":"plan-detail","plan_id":"p"}"#).unwrap();
        assert!(matches!(parsed, Request::PlanDetail { .. }));
    }

    #[test]
    fn new_conversation_fields_stay_compatible_with_older_peers() {
        // An older host refuses unknown fields, so a plain action omits message_id.
        let pause = serde_json::to_string(&Request::SessionAction {
            session_id: "s".into(),
            action: "pause".into(),
            message_id: None,
        })
        .unwrap();
        assert_eq!(
            pause,
            r#"{"request":"session-action","session_id":"s","action":"pause"}"#
        );
        // And an older terminal's request still parses here.
        let parsed: Request = serde_json::from_str(
            r#"{"request":"session-action","session_id":"s","action":"finish"}"#,
        )
        .unwrap();
        assert!(matches!(
            parsed,
            Request::SessionAction {
                message_id: None,
                ..
            }
        ));
        let older: crate::protocol::Message =
            serde_json::from_value(serde_json::json!({"role": "you", "text": "hi", "sent": false}))
                .unwrap();
        assert!(older.id.is_none());
        assert!(question(false).allow_other.is_none());
    }
}
