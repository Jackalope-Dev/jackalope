//! The one-shot commands that print and exit: `status`, `ls`, `stop`, `diff`,
//! `merge` and `pr`.

use crate::connection::{resolve, short, unexpected, Connection};
use crate::git;
use crate::host::{self, ColdStart};
use crate::protocol::{
    self, profile_root, AgentStatus, Project, Request, Response, SessionSummary,
};
use serde_json::json;

/// The project for this directory. A terminal tool should work where the user
/// already is rather than asking them to pick from a list.
pub fn here(connection: &mut Connection) -> Result<Project, String> {
    let directory = std::env::current_dir().map_err(|error| error.to_string())?;
    connection.project(&directory.to_string_lossy())
}

/// The most recent conversation in this project, for `--continue`. The host
/// lists conversations newest first.
pub fn latest(connection: &mut Connection, project: &Project) -> Result<Option<String>, String> {
    Ok(connection
        .sessions()?
        .into_iter()
        .find(|session| session.project_id == project.id)
        .map(|session| session.id))
}

/// What a conversation is waiting on, in a word or two.
fn state(session: &SessionSummary) -> String {
    if protocol::present(session.error.as_deref()).is_some() {
        "needs you".into()
    } else if session.paused {
        "paused".into()
    } else if session.pending > 0 {
        format!("{} queued", session.pending)
    } else {
        "open".into()
    }
}

/// How long ago an RFC 3339 time was, briefly.
fn age(timestamp: &str) -> String {
    let Ok(then) = chrono::DateTime::parse_from_rfc3339(timestamp) else {
        return String::new();
    };
    let seconds = (chrono::Utc::now() - then.with_timezone(&chrono::Utc))
        .num_seconds()
        .max(0);
    match seconds {
        0..60 => "just now".into(),
        60..3600 => format!("{}m ago", seconds / 60),
        3600..86400 => format!("{}h ago", seconds / 3600),
        _ => format!("{}d ago", seconds / 86400),
    }
}

pub fn list(preference: Option<ColdStart>, as_json: bool) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let sessions = connection.sessions()?;
    let projects = connection.projects().unwrap_or_default();
    let project_name = |id: &str| {
        projects
            .iter()
            .find(|project| project.id == id)
            .map(|project| project.name.clone())
            .unwrap_or_default()
    };
    if as_json {
        let rows: Vec<_> = sessions
            .iter()
            .map(|session| {
                json!({
                    "id": session.id,
                    "title": session.title,
                    "projectId": session.project_id,
                    "project": project_name(&session.project_id),
                    "state": state(session),
                    "paused": session.paused,
                    "pending": session.pending,
                    "error": protocol::present(session.error.as_deref()),
                    "updatedAt": session.updated_at,
                })
            })
            .collect();
        println!("{}", serde_json::Value::Array(rows));
        return Ok(());
    }
    if sessions.is_empty() {
        println!("No open conversations.");
        return Ok(());
    }
    for session in &sessions {
        let project = project_name(&session.project_id);
        let place = if project.is_empty() {
            String::new()
        } else {
            format!("{project} · ")
        };
        println!(
            "{}  {:<10}  {:>8}  {place}{}",
            short(&session.id),
            state(session),
            age(&session.updated_at),
            session.title
        );
        if let Some(error) = protocol::present(session.error.as_deref()) {
            println!("{:10}{error}", "");
        }
    }
    Ok(())
}

pub fn stop(preference: Option<ColdStart>, prefix: &str) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let id = resolve(&connection.sessions()?, prefix)?;
    let view = connection.session(&id)?;
    match view
        .run_id
        .filter(|_| protocol::working(view.status.as_deref()))
    {
        Some(run_id) => {
            connection.call(&Request::Stop { run_id })?;
            println!("Stopping {}.", view.title);
        }
        None => println!("Nothing is running in {}.", view.title),
    }
    Ok(())
}

/// Shows the question a conversation is waiting on, or answers it. A number
/// picks that option, so `jackalope answer ab 1` approves without retyping it.
pub fn answer(
    preference: Option<ColdStart>,
    prefix: &str,
    text: Option<String>,
) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let id = resolve(&connection.sessions()?, prefix)?;
    let view = connection.session(&id)?;
    let question = view
        .questions
        .first()
        .cloned()
        .ok_or_else(|| format!("Nothing is waiting on you in {}.", view.title))?;
    let Some(text) = text else {
        println!("{}", question.question);
        for (index, option) in question.options.iter().enumerate() {
            println!("  {}. {option}", index + 1);
        }
        println!(
            "Reply with 'jackalope answer {} <number or text>'.",
            short(&id)
        );
        return Ok(());
    };
    let reply = text
        .trim()
        .parse::<usize>()
        .ok()
        .and_then(|number| question.options.get(number.checked_sub(1)?))
        .cloned()
        .unwrap_or(text);
    connection.call(&Request::Answer {
        run_id: question.run_id,
        prompt_id: question.id,
        text: reply.clone(),
    })?;
    println!("Answered: {reply}");
    Ok(())
}

/// Prints what a conversation changed: its worktree against the commit where it
/// left the project's branch, uncommitted edits included, or the uncommitted
/// edits of a conversation that works in the project folder itself.
pub fn diff(preference: Option<ColdStart>, prefix: &str, stat: bool) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let sessions = connection.sessions()?;
    let id = resolve(&sessions, prefix)?;
    let view = connection.session(&id)?;
    let project_id = sessions
        .iter()
        .find(|session| session.id == id)
        .map(|session| session.project_id.clone())
        .unwrap_or_default();
    let project = connection
        .projects()?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or("This conversation's project is no longer in Jackalope.")?;
    let workspace = protocol::present(view.workspace.as_deref()).unwrap_or(&project.path);
    let untracked = git::diff(workspace, &project.path, stat)?;
    if !untracked.is_empty() {
        eprintln!(
            "New files not yet added to Git, so not shown: {}",
            untracked.join(", ")
        );
    }
    Ok(())
}

/// Merges a conversation's latest reviewed attempt into the project's target
/// branch through the app's merge review, pausing the conversation first so no
/// new message starts mid-merge. Shows the plan and asks before applying.
pub fn merge(
    preference: Option<ColdStart>,
    prefix: &str,
    message: Option<String>,
    yes: bool,
) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let id = resolve(&connection.sessions()?, prefix)?;
    let view = connection.session(&id)?;
    if protocol::working(view.status.as_deref()) {
        return Err("The agent is still working. Merge once it finishes.".into());
    }
    if !view.paused {
        connection.call(&Request::SessionAction {
            session_id: id.clone(),
            action: "pause".into(),
        })?;
        eprintln!(
            "Paused {} so no new message starts during the merge.",
            view.title
        );
    }
    let prepared = connection.call(&Request::MergePrepare {
        session_id: id.clone(),
        message,
    });
    let plan = match prepared {
        Ok(Response::Merge { plan }) => plan,
        other => {
            // Nothing was prepared, so the pause this command added is undone.
            if !view.paused {
                let _ = connection.call(&Request::SessionAction {
                    session_id: id.clone(),
                    action: "resume".into(),
                });
            }
            return Err(match other {
                Err(error) => error,
                _ => unexpected(),
            });
        }
    };
    if !plan.conflicts.is_empty() {
        return Err(format!(
            "{} conflicts with {}: {}. Resolve them in the app's merge review.",
            view.title,
            plan.target_branch,
            plan.conflicts.join(", ")
        ));
    }
    if plan.files.is_empty() {
        return Err("There are no changes to merge.".into());
    }
    let count = plan.files.len();
    eprintln!(
        "Merge {count} {} from {} into {}:",
        if count == 1 { "file" } else { "files" },
        view.title,
        plan.target_branch
    );
    for file in plan.files.iter().take(20) {
        eprintln!("  {file}");
    }
    if count > 20 {
        eprintln!("  … and {} more", count - 20);
    }
    eprintln!(
        "Commit message: {}",
        plan.commit_message.lines().next().unwrap_or_default()
    );
    if plan.cleanup {
        eprintln!("The worktree is removed afterwards, as your commit settings ask.");
    }
    if !approved(yes, "Merge now?")? {
        eprintln!(
            "Not merged. {} stays paused; resume it with /unpause in jackalope attach {}.",
            view.title,
            short(&id)
        );
        return Ok(());
    }
    match connection.call(&Request::MergeApply {
        plan_id: plan.id,
        cleanup: plan.cleanup,
    })? {
        Response::Merge { plan } => {
            println!("Merged {} into {}.", view.title, plan.target_branch);
            for error in plan.cleanup_errors {
                eprintln!("Could not remove the worktree: {error}");
            }
            Ok(())
        }
        _ => Err(unexpected()),
    }
}

/// Commits a conversation's remaining changes with the project's commit
/// settings, pushes its branch and opens a pull request with the person's
/// GitHub CLI, as the app's Create pull request does. Draft unless `ready`.
pub fn pull_request(
    preference: Option<ColdStart>,
    prefix: &str,
    title: Option<String>,
    ready: bool,
    yes: bool,
) -> Result<(), String> {
    let mut connection = host::ensure(preference)?;
    let id = resolve(&connection.sessions()?, prefix)?;
    let view = connection.session(&id)?;
    if protocol::working(view.status.as_deref()) {
        return Err("The agent is still working. Open a pull request once it finishes.".into());
    }
    let title = title
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| view.title.trim().to_string());
    if title.is_empty() || title.contains('\n') {
        return Err("Give the pull request a one-line title with --title.".into());
    }
    let body: String = view.result.trim().chars().take(4000).collect();
    let branch = view.branch.clone().unwrap_or_default();
    eprintln!(
        "Commit any remaining changes with your commit settings, push {} and open a {} pull request:",
        if branch.is_empty() { "the branch".to_string() } else { branch },
        if ready { "ready" } else { "draft" }
    );
    eprintln!("  {title}");
    if !approved(yes, "Open it?")? {
        eprintln!("No pull request opened.");
        return Ok(());
    }
    match connection.call(&Request::PullRequest {
        session_id: id,
        title,
        body,
        draft: !ready,
    })? {
        Response::PullRequest { url } => {
            println!("{url}");
            Ok(())
        }
        _ => Err(unexpected()),
    }
}

/// `--yes`, or a yes typed at a terminal. A script without `--yes` is refused
/// rather than left waiting for an answer nobody will type.
fn approved(yes: bool, question: &str) -> Result<bool, String> {
    use std::io::{BufRead, IsTerminal, Write};
    if yes {
        return Ok(true);
    }
    if !std::io::stdin().is_terminal() {
        return Err("Pass --yes to go ahead without a prompt.".into());
    }
    loop {
        eprint!("{question} [y/N] ");
        std::io::stderr()
            .flush()
            .map_err(|error| error.to_string())?;
        let mut line = String::new();
        if std::io::stdin()
            .lock()
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            return Ok(false);
        }
        match line.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => return Ok(true),
            "n" | "no" | "" => return Ok(false),
            _ => eprintln!("Please answer y or n."),
        }
    }
}

fn agents(connection: &mut Connection) -> Result<(Vec<AgentStatus>, String), String> {
    match connection.call(&Request::Overview)? {
        Response::Overview {
            agents,
            default_agent,
        } => Ok((agents, default_agent)),
        _ => Err(unexpected()),
    }
}

fn usable(agent: &AgentStatus) -> bool {
    matches!(agent.state.as_str(), "ready" | "installed" | "sign-in")
}

pub fn status(as_json: bool) -> Result<(), String> {
    let profile = profile_root()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "unknown".into());
    let Some(mut connection) = host::attach_or_wait() else {
        if as_json {
            println!("{}", json!({ "running": false, "profile": profile }));
        } else {
            println!("Jackalope is not running. Run 'jackalope' to start it.");
        }
        return Ok(());
    };
    let handshake = connection.handshake().clone();
    // The project for this directory, when it is a repository.
    let project = here(&mut connection).ok();
    let branch = project
        .as_ref()
        .and_then(|project| git::branch(&project.path));
    let open_here = project.as_ref().and_then(|project| {
        connection.sessions().ok().map(|sessions| {
            sessions
                .iter()
                .filter(|session| session.project_id == project.id)
                .count()
        })
    });
    let overview = agents(&mut connection);

    if as_json {
        let (agents, default_agent) = overview.clone().unwrap_or_default();
        let value = json!({
            "running": true,
            "windowed": handshake.windowed,
            "pid": handshake.pid,
            "endpoint": handshake.endpoint,
            "profile": profile,
            "project": project.as_ref().map(|project| json!({
                "id": project.id,
                "name": project.name,
                "path": project.path,
                "branch": branch,
            })),
            "openHere": open_here,
            "agents": agents.iter().map(|agent| json!({
                "id": agent.id,
                "name": agent.name,
                "state": agent.state,
                "account": agent.account,
                "default": agent.id == default_agent,
            })).collect::<Vec<_>>(),
            "agentsError": overview.as_ref().err(),
        });
        println!("{value}");
        return Ok(());
    }

    let row = |label: &str, value: &str| println!("{label:<11}{value}");
    row(
        "Jackalope",
        &format!(
            "running {} (pid {})",
            if handshake.windowed {
                "with the app open"
            } else {
                "in the background"
            },
            handshake.pid
        ),
    );
    if let Some(project) = &project {
        let branch = branch
            .map(|branch| format!(" · {branch}"))
            .unwrap_or_default();
        row("Project", &format!("{}{branch}", project.name));
    }
    if let Some(count) = open_here {
        row("Open", &format!("{count} conversation(s) here"));
    }
    match overview {
        Ok((agents, default_agent)) => {
            let mut first = true;
            for agent in agents.iter().filter(|agent| usable(agent)) {
                let state = match agent.state.as_str() {
                    "ready" => agent.account.as_str(),
                    "sign-in" => "sign-in needed",
                    _ => "installed",
                };
                let default = if agent.id == default_agent {
                    "  (default)"
                } else {
                    ""
                };
                row(
                    if first { "Agents" } else { "" },
                    &format!("{:<14}{state}{default}", agent.name),
                );
                first = false;
            }
            if first {
                row("Agents", "none installed yet");
            }
        }
        Err(message) => row("Agents", &message),
    }
    row("Profile", &profile);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ages_read_briefly() {
        let ago = |seconds: i64| {
            age(&(chrono::Utc::now() - chrono::Duration::seconds(seconds)).to_rfc3339())
        };
        assert_eq!(ago(5), "just now");
        assert_eq!(ago(125), "2m ago");
        assert_eq!(ago(7200), "2h ago");
        assert_eq!(ago(3 * 86400), "3d ago");
        assert_eq!(age("not a time"), "");
    }

    #[test]
    fn states_name_what_a_conversation_waits_on() {
        let mut session = SessionSummary {
            id: "s".into(),
            title: "t".into(),
            project_id: "p".into(),
            paused: false,
            pending: 0,
            error: Some("null".into()),
            updated_at: String::new(),
            status: None,
            asking: false,
        };
        assert_eq!(state(&session), "open");
        session.pending = 2;
        assert_eq!(state(&session), "2 queued");
        session.paused = true;
        assert_eq!(state(&session), "paused");
        session.error = Some("no account".into());
        assert_eq!(state(&session), "needs you");
    }
}
