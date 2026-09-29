//! The one-shot commands that print and exit: `status`, `ls` and `stop`.

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
