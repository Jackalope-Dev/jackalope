//! A harness for testing the interactive view without a terminal or the app.
//!
//! A fake host on a private socket answers the view's requests from fixture
//! conversations and records every request it receives. Keys, typing, slash
//! commands and clicks drive `App` the way the event loop does, refreshes are
//! read back through the real refresh path, and frames render to plain text.
//! The profile directory points at an empty temporary folder, so the view can
//! never reach a running Jackalope.
//!
//! To look at the frames a test draws:
//! `JACKALOPE_TUI_PRINT=1 cargo test --bin jackalope ui::harness -- --nocapture`

use super::refresh;
use super::{App, Click, Event, NextStart, Overview};
use crate::connection::Connection;
use crate::protocol::{
    AgentStatus, Handshake, Message, Project, Question, Request, Response, SessionSummary,
    SessionView, VERSION,
};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

type Reply = Box<dyn Fn(&Request) -> Option<Response> + Send>;

/// What the fake host knows, and what it has been asked.
#[derive(Default)]
pub struct Host {
    pub projects: Vec<Project>,
    pub sessions: Vec<SessionSummary>,
    pub views: HashMap<String, SessionView>,
    /// Every request received, oldest first.
    pub requests: Vec<Request>,
    /// Answers requests the fixtures do not cover; anything else gets `Ok`.
    pub reply: Option<Reply>,
}

impl Host {
    fn answer(&mut self, request: &Request) -> Response {
        self.requests.push(request.clone());
        if let Some(response) = self.reply.as_ref().and_then(|reply| reply(request)) {
            return response;
        }
        match request {
            Request::Sessions => Response::Sessions {
                sessions: self.sessions.clone(),
            },
            Request::Projects => Response::Projects {
                projects: self.projects.clone(),
            },
            Request::SessionDetail { session_id } => match self.views.get(session_id) {
                Some(view) => Response::Session {
                    revision: 0,
                    session: Box::new(view.clone()),
                },
                None => Response::Error {
                    message: format!("No conversation {session_id}"),
                },
            },
            _ => Response::Ok,
        }
    }
}

/// Points the profile at an empty folder once per test process, so no
/// connection reads the real host's handshake.
fn isolate_profile() {
    static PROFILE: OnceLock<()> = OnceLock::new();
    PROFILE.get_or_init(|| {
        let directory =
            std::env::temp_dir().join(format!("jackalope-tui-profile-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&directory);
        std::env::set_var("JACKALOPE_PROFILE_DIR", directory);
    });
}

/// Serves `host` on a fresh socket and returns its path. Kept short, since
/// macOS limits socket paths to about 104 bytes.
fn serve(host: Arc<Mutex<Host>>) -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let path = format!(
        "/tmp/jackalope-tui-{}-{}.sock",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).expect("bind the fake host");
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let host = host.clone();
            std::thread::spawn(move || {
                let mut writer = stream.try_clone().expect("clone the stream");
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    let response = match serde_json::from_str::<Request>(&line) {
                        Ok(request) => host.lock().unwrap().answer(&request),
                        Err(error) => Response::Error {
                            message: format!("fake host could not read {line}: {error}"),
                        },
                    };
                    let mut text = serde_json::to_string(&response).expect("serialize");
                    text.push('\n');
                    if writer.write_all(text.as_bytes()).is_err() {
                        return;
                    }
                }
            });
        }
    });
    path
}

/// The project the harness opens in.
pub fn project() -> Project {
    serde_json::from_value(serde_json::json!({
        "id": "project-1",
        "name": "demo-app",
        // Not a repository, so no branch is read from it.
        "path": std::env::temp_dir().to_string_lossy(),
    }))
    .expect("project fixture")
}

/// A conversation with `messages` as (`you` or `agent`, text) pairs, idle.
pub fn conversation(id: &str, title: &str, messages: &[(&str, &str)]) -> SessionView {
    SessionView {
        id: id.into(),
        title: title.into(),
        paused: false,
        error: None,
        messages: messages
            .iter()
            .map(|(role, text)| Message {
                role: (*role).into(),
                text: (*text).into(),
                sent: true,
                attempt: None,
                id: None,
            })
            .collect(),
        run_id: Some(format!("run-{id}")),
        status: Some("review".into()),
        agent: Some("Claude Code".into()),
        account: None,
        model: None,
        routing: None,
        step: None,
        step_detail: None,
        attempt: None,
        workspace: None,
        branch: None,
        result: String::new(),
        activity: Vec::new(),
        questions: Vec::new(),
        partial: String::new(),
        review_screenshots: None,
        merged: false,
        draft: String::new(),
        draft_revision: 0,
    }
}

/// A question with options that the agent of `view` is waiting on.
pub fn question(view: &SessionView, text: &str, options: &[&str]) -> Question {
    serde_json::from_value(serde_json::json!({
        "id": format!("question-{}", view.id),
        "runId": view.run_id.clone().unwrap_or_default(),
        "question": text,
        "options": options,
    }))
    .expect("question fixture")
}

pub struct Harness {
    pub app: App,
    pub host: Arc<Mutex<Host>>,
    _events: mpsc::Receiver<Event>,
    refreshes: mpsc::Receiver<refresh::Request>,
}

impl Harness {
    /// The start screen of `project()`, with one ready agent.
    pub fn new() -> Self {
        isolate_profile();
        let host = Arc::new(Mutex::new(Host {
            projects: vec![project()],
            ..Host::default()
        }));
        let endpoint = serve(host.clone());
        let handshake = Handshake {
            version: VERSION,
            pid: std::process::id(),
            endpoint,
            windowed: false,
        };
        let (events, inbox) = mpsc::channel();
        let (refresher, refreshes) = mpsc::channel();
        let mut app = App::new(
            Connection::lazy(handshake),
            project(),
            None,
            NextStart {
                agent: None,
                model: None,
            },
            events,
            refresher,
        );
        app.overview = Some(Ok(Overview {
            agents: vec![AgentStatus {
                id: "claude".into(),
                name: "Claude Code".into(),
                state: "ready".into(),
                account: String::new(),
                detail: String::new(),
                models: Vec::new(),
                default_model: String::new(),
            }],
            default_agent: "claude".into(),
        }));
        app.refresh_now();
        Self {
            app,
            host,
            _events: inbox,
            refreshes,
        }
    }

    /// Adds `view` to the host as an open conversation in `project()`.
    pub fn add(&mut self, view: SessionView) {
        let mut host = self.host.lock().unwrap();
        host.sessions.retain(|session| session.id != view.id);
        host.sessions.insert(
            0,
            SessionSummary {
                id: view.id.clone(),
                title: view.title.clone(),
                project_id: project().id,
                paused: view.paused,
                pending: 0,
                error: view.error.clone(),
                updated_at: "2026-01-01T00:00:00Z".into(),
                status: view.status.clone(),
                asking: !view.questions.is_empty(),
            },
        );
        host.views.insert(view.id.clone(), view);
    }

    /// Replaces a conversation the host already has, as when work moves.
    pub fn update(&mut self, id: &str, change: impl FnOnce(&mut SessionView)) {
        let mut view = self.host.lock().unwrap().views[id].clone();
        change(&mut view);
        self.add(view);
        self.sync();
    }

    /// Shows the conversation `id`, as a tab click or `/sessions` would.
    pub fn open(&mut self, id: &str) {
        self.app.show(Some(id.into()));
        self.sync();
    }

    /// Reads the host again when the view asked to, as the refresher would.
    pub fn sync(&mut self) {
        while self.refreshes.try_recv().is_ok() {}
        self.app.refresh_now();
    }

    pub fn key(&mut self, code: KeyCode) {
        self.key_with(code, KeyModifiers::NONE);
    }

    pub fn key_with(&mut self, code: KeyCode, modifiers: KeyModifiers) {
        self.app.key(KeyEvent::new(code, modifiers));
        if self.refreshes.try_recv().is_ok() {
            self.sync();
        }
    }

    pub fn type_text(&mut self, text: &str) {
        for character in text.chars() {
            self.key(KeyCode::Char(character));
        }
    }

    /// Types `line` (a message, `/command` or `!command`) and presses Enter.
    pub fn submit(&mut self, line: &str) {
        self.type_text(line);
        self.key(KeyCode::Enter);
    }

    /// Clicks the first thing the last frame drew that does `click`.
    pub fn click(&mut self, click: Click) {
        let area = self
            .app
            .hits
            .borrow()
            .iter()
            .find(|(_, candidate)| *candidate == click)
            .map(|(area, _)| *area)
            .unwrap_or_else(|| panic!("nothing on screen does {click:?}"));
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            self.app.select(MouseEvent {
                kind,
                column: area.x,
                row: area.y,
                modifiers: KeyModifiers::NONE,
            });
        }
        if self.refreshes.try_recv().is_ok() {
            self.sync();
        }
    }

    /// Draws a `width` by `height` frame and returns its text, one line per
    /// row with trailing spaces trimmed. Prints it with `JACKALOPE_TUI_PRINT=1`.
    pub fn render(&mut self, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
        let frame = terminal
            .draw(|frame| super::render::draw(frame, &self.app))
            .expect("draw");
        let buffer = frame.buffer;
        let text = (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join("\n");
        if std::env::var_os("JACKALOPE_TUI_PRINT").is_some() {
            eprintln!(
                "{}\n{text}\n{}",
                "─".repeat(width as usize),
                "─".repeat(width as usize)
            );
        }
        text
    }

    /// Requests the host has received, oldest first.
    pub fn requests(&self) -> Vec<Request> {
        self.host.lock().unwrap().requests.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rows of `screen` from `first`, as one string.
    fn rows_from(screen: &str, first: usize) -> String {
        screen.lines().skip(first).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn the_start_screen_leads_with_the_project_name() {
        let mut harness = Harness::new();
        let screen = harness.render(100, 30);
        let header = screen.lines().next().unwrap();
        assert!(header.contains("demo-app"), "{screen}");
        assert!(
            !header.to_ascii_lowercase().contains("jackalope"),
            "{screen}"
        );
    }

    #[test]
    fn a_question_docks_in_place_of_the_input_and_esc_returns_it() {
        let mut harness = Harness::new();
        let mut view = conversation(
            "c1",
            "Pick a database",
            &[
                ("you", "Set up reporting"),
                ("agent", "I looked at the schema and the nightly jobs."),
            ],
        );
        view.status = Some("running".into());
        view.questions = vec![question(
            &view,
            "Which database should the reporting service use?",
            &["Postgres", "SQLite"],
        )];
        harness.add(view);
        harness.open("c1");

        let screen = harness.render(100, 30);
        let bottom = rows_from(&screen, 15);
        assert!(
            bottom.contains("Which database should the reporting service use?"),
            "{screen}"
        );
        assert!(
            bottom.contains("Postgres") && bottom.contains("SQLite"),
            "{screen}"
        );
        assert!(
            screen.contains("I looked at the schema"),
            "the reply stays in view: {screen}"
        );
        assert!(
            !screen.contains("Type your answer"),
            "the input is docked away: {screen}"
        );

        harness.key(KeyCode::Esc);
        let screen = harness.render(100, 30);
        assert!(screen.contains("Type your answer"), "{screen}");

        harness.submit("/answer");
        harness.key(KeyCode::Enter);
        assert!(
            harness.requests().iter().any(|request| matches!(
                request,
                Request::Answer { text, .. } if text == "Postgres"
            )),
            "Enter answers with the highlighted option"
        );
    }

    #[test]
    fn tabs_close_with_their_button_or_close_and_work_keeps_running() {
        let mut harness = Harness::new();
        harness.add(conversation("c1", "Fix login", &[("you", "Fix login")]));
        harness.add(conversation("c2", "Add search", &[("you", "Add search")]));
        harness.open("c1");
        harness.open("c2");
        let screen = harness.render(120, 30);
        assert!(
            screen.contains("Fix login") && screen.contains("Add search"),
            "{screen}"
        );

        harness.click(Click::CloseTab(1));
        let screen = harness.render(120, 30);
        assert_eq!(harness.app.tab_order(), ["c2"], "{screen}");

        harness.submit("/close");
        assert!(harness.app.session.is_none());
        assert!(harness.app.tab_order().is_empty());
        // Closing hides tabs; nothing was stopped.
        assert!(!harness.requests().iter().any(|request| matches!(
            request,
            Request::Stop { .. } | Request::SessionAction { .. }
        )));
    }

    #[test]
    fn notes_stay_where_they_were_added_and_hints_do_not_pile_up() {
        let mut harness = Harness::new();
        harness.add(conversation("c1", "Fix login", &[("you", "Fix login")]));
        harness.open("c1");
        harness.submit("/status");
        harness.update("c1", |view| {
            view.messages.push(Message {
                role: "agent".into(),
                text: "Login is fixed.".into(),
                sent: true,
                attempt: None,
                id: None,
            });
        });
        let screen = harness.render(100, 40);
        let note = screen.find("Project  demo-app").expect("status note");
        let reply = screen.find("Login is fixed.").expect("reply");
        assert!(
            note < reply,
            "the note keeps its place before the reply: {screen}"
        );

        let notes = harness.app.feed.len();
        harness.submit("/answer");
        harness.submit("/retryy");
        assert_eq!(harness.app.feed.len(), notes, "hints flash instead");

        harness.add(conversation("c2", "Add search", &[("you", "Add search")]));
        harness.open("c2");
        let screen = harness.render(100, 40);
        assert!(
            !screen.contains("Project  demo-app"),
            "notes stay in their conversation"
        );
    }
}
