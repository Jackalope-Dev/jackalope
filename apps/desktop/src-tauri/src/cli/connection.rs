//! A connection to the host that survives the host restarting.
//!
//! A restarted host advertises a new endpoint in `host.json`, so a dropped
//! connection re-reads the handshake before reconnecting. Requests that only
//! read are retried once on the new connection; ones that change something
//! are not, since the first attempt may have landed before the drop.

use crate::protocol::{
    read_handshake, Client, Handshake, Project, Request, Response, SessionSummary, SessionView,
};

pub struct Connection {
    endpoint: String,
    client: Option<Client>,
    /// The handshake last seen, refreshed on reconnect.
    handshake: Handshake,
}

pub fn unexpected() -> String {
    "The host answered unexpectedly.".into()
}

impl Connection {
    pub fn new(handshake: Handshake, client: Client) -> Self {
        Self {
            endpoint: handshake.endpoint.clone(),
            client: Some(client),
            handshake,
        }
    }

    /// A connection that opens on first use, for threads of their own.
    pub fn lazy(handshake: Handshake) -> Self {
        Self {
            endpoint: handshake.endpoint.clone(),
            client: None,
            handshake,
        }
    }

    pub fn handshake(&self) -> &Handshake {
        &self.handshake
    }

    fn connect(&mut self) -> Result<&mut Client, String> {
        if self.client.is_none() {
            if let Some(handshake) = read_handshake() {
                self.endpoint = handshake.endpoint.clone();
                self.handshake = handshake;
            }
            self.client = Some(
                Client::connect(&self.endpoint)
                    .map_err(|_| "Jackalope is not running. Start it with 'jackalope'.")?,
            );
        }
        Ok(self.client.as_mut().expect("connected above"))
    }

    pub fn send(&mut self, request: &Request) -> Result<Response, String> {
        match self.connect().and_then(|client| client.send(request)) {
            Ok(response) => Ok(response),
            Err(error) => {
                self.client = None;
                if !read_only(request) {
                    return Err(error);
                }
                self.connect()?.send(request).inspect_err(|_| {
                    self.client = None;
                })
            }
        }
    }

    /// Sends and turns a host error into `Err`.
    pub fn call(&mut self, request: &Request) -> Result<Response, String> {
        match self.send(request)? {
            Response::Error { message } => Err(message),
            response => Ok(response),
        }
    }

    pub fn sessions(&mut self) -> Result<Vec<SessionSummary>, String> {
        match self.call(&Request::Sessions)? {
            Response::Sessions { sessions } => Ok(sessions),
            _ => Err(unexpected()),
        }
    }

    pub fn projects(&mut self) -> Result<Vec<Project>, String> {
        match self.call(&Request::Projects)? {
            Response::Projects { projects } => Ok(projects),
            _ => Err(unexpected()),
        }
    }

    /// The project for a repository, registering it when it is new.
    pub fn project(&mut self, path: &str) -> Result<Project, String> {
        match self.call(&Request::EnsureProject { path: path.into() })? {
            Response::Project { project } => Ok(project),
            _ => Err(unexpected()),
        }
    }

    pub fn session(&mut self, session_id: &str) -> Result<SessionView, String> {
        match self.call(&Request::SessionDetail {
            session_id: session_id.into(),
        })? {
            Response::Session { session, .. } => Ok(*session),
            _ => Err(unexpected()),
        }
    }

    pub fn start(
        &mut self,
        project_path: &str,
        text: String,
        agent: Option<String>,
    ) -> Result<String, String> {
        match self.call(&Request::StartSession {
            project_path: project_path.into(),
            text,
            agent,
            model: None,
        })? {
            Response::Started { session_id } => Ok(session_id),
            _ => Err(unexpected()),
        }
    }

    /// Blocks until work changes or the host's watch times out, returning the
    /// latest revision.
    pub fn watch(&mut self, since: u64) -> Result<u64, String> {
        match self.call(&Request::Watch { since })? {
            Response::Changed { revision } => Ok(revision),
            _ => Err(unexpected()),
        }
    }
}

/// Whether sending `request` twice is harmless.
fn read_only(request: &Request) -> bool {
    matches!(
        request,
        Request::Ping
            | Request::Projects
            | Request::EnsureProject { .. }
            | Request::Sessions
            | Request::SessionDetail { .. }
            | Request::Watch { .. }
            | Request::Overview
            | Request::CommitPolicy { .. }
            | Request::ShowWindow
            | Request::ShowChanges { .. }
            | Request::SetAccent { .. }
            | Request::Attached { .. }
    )
}

/// `ls` prints short ids, so accept any unambiguous prefix.
pub fn resolve(sessions: &[SessionSummary], prefix: &str) -> Result<String, String> {
    let mut matches = sessions
        .iter()
        .filter(|session| session.id.starts_with(prefix));
    match (matches.next(), matches.next()) {
        (Some(session), None) => Ok(session.id.clone()),
        (None, _) => Err(format!("No open conversation matches '{prefix}'.")),
        (Some(_), Some(_)) => Err(format!(
            "'{prefix}' matches more than one conversation; use more of the id."
        )),
    }
}

/// The first eight characters of an id, as `ls` shows it.
pub fn short(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(id: &str) -> SessionSummary {
        SessionSummary {
            id: id.into(),
            title: String::new(),
            project_id: String::new(),
            paused: false,
            pending: 0,
            error: None,
            updated_at: String::new(),
        }
    }

    #[test]
    fn prefixes_resolve_only_when_unambiguous() {
        let sessions = [summary("abc123"), summary("abd456"), summary("x")];
        assert_eq!(resolve(&sessions, "abc").unwrap(), "abc123");
        assert!(resolve(&sessions, "ab").is_err());
        assert!(resolve(&sessions, "zz").is_err());
        assert_eq!(short("x"), "x");
        assert_eq!(short("0123456789"), "01234567");
    }

    #[test]
    fn only_reads_are_retried() {
        assert!(read_only(&Request::Sessions));
        assert!(!read_only(&Request::Send {
            session_id: "s".into(),
            text: "t".into()
        }));
        assert!(!read_only(&Request::Stop { run_id: "r".into() }));
    }
}
