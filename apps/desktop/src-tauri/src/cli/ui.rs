//! The interactive conversation.
//!
//! Three threads feed one loop: keystrokes, change notifications from the host
//! (on their own connection, since a watch blocks), and the loop itself, which
//! re-reads the conversation whenever the host says work moved.

use crate::brand;
use crate::protocol::{Client, Handshake, Project, Request, Response, SessionView};
use crossterm::event::{self, Event as TermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

enum Event {
    Key(KeyEvent),
    Resize,
    Changed,
}

const HELP: &[(&str, &str)] = &[
    ("/new", "start a fresh conversation"),
    ("/sessions", "list conversations in this project"),
    ("/stop", "stop the work that is running"),
    ("/pause", "hold queued messages"),
    ("/resume", "send held messages"),
    ("/open", "show this conversation's app window"),
    ("/help", "show these commands"),
    ("/quit", "leave (work keeps running)"),
];

struct App {
    client: Client,
    project: Project,
    session: Option<String>,
    view: Option<SessionView>,
    input: String,
    history: Vec<String>,
    history_index: Option<usize>,
    /// Jackalope's own lines — help, errors, confirmations — shown under the
    /// conversation and never sent to an agent.
    notices: Vec<String>,
    /// Lines scrolled up from the bottom of the transcript.
    scroll_back: u16,
    quit: bool,
}

pub fn run(
    handshake: Handshake,
    client: Client,
    project: Project,
    session: Option<String>,
) -> Result<(), String> {
    let (events, inbox) = mpsc::channel();
    spawn_input(events.clone());
    spawn_watcher(handshake.endpoint.clone(), events);

    let mut app = App {
        client,
        project,
        session,
        view: None,
        input: String::new(),
        history: Vec::new(),
        history_index: None,
        notices: Vec::new(),
        scroll_back: 0,
        quit: false,
    };
    app.refresh();

    let mut terminal = ratatui::init();
    let result = event_loop(&mut terminal, &mut app, &inbox);
    ratatui::restore();
    if let Some(id) = &app.session {
        // Leaving is not stopping: the work belongs to the host.
        println!("Conversation continues in Jackalope. Rejoin with: jackalope attach {id}");
    }
    result
}

fn event_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    inbox: &Receiver<Event>,
) -> Result<(), String> {
    while !app.quit {
        terminal
            .draw(|frame| draw(frame, app))
            .map_err(|error| error.to_string())?;
        match inbox.recv() {
            Ok(Event::Key(key)) => app.key(key),
            Ok(Event::Changed) => app.refresh(),
            Ok(Event::Resize) => {}
            Err(_) => return Err("Lost the terminal input stream.".into()),
        }
    }
    Ok(())
}

fn spawn_input(events: Sender<Event>) {
    std::thread::spawn(move || loop {
        let forwarded = match event::read() {
            // Windows reports releases too; acting on them would double every key.
            Ok(TermEvent::Key(key)) if key.kind == KeyEventKind::Press => {
                events.send(Event::Key(key))
            }
            Ok(TermEvent::Resize(_, _)) => events.send(Event::Resize),
            Ok(_) => Ok(()),
            Err(_) => return,
        };
        if forwarded.is_err() {
            return;
        }
    });
}

/// Holds a second connection open on `watch`, which blocks until work changes.
/// Reconnects after a drop so a host that restarts is picked up again.
fn spawn_watcher(endpoint: String, events: Sender<Event>) {
    std::thread::spawn(move || {
        let mut since = 0;
        loop {
            let Ok(mut client) = Client::connect(&endpoint) else {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            };
            while let Ok(Response::Changed { revision }) = client.send(&Request::Watch { since }) {
                if revision != since {
                    since = revision;
                    if events.send(Event::Changed).is_err() {
                        return;
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

impl App {
    fn request(&mut self, request: Request) -> Option<Response> {
        match self.client.send(&request) {
            Ok(Response::Error { message }) => {
                self.notices.push(message);
                None
            }
            Ok(response) => Some(response),
            Err(error) => {
                self.notices
                    .push(format!("Lost contact with Jackalope: {error}"));
                None
            }
        }
    }

    fn refresh(&mut self) {
        let Some(id) = self.session.clone() else {
            return;
        };
        if let Some(Response::Session { session, .. }) =
            self.request(Request::SessionDetail { session_id: id })
        {
            self.view = Some(session);
        }
    }

    fn key(&mut self, key: KeyEvent) {
        let control = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Char('c') | KeyCode::Char('d') if control => self.quit = true,
            KeyCode::Char('l') if control => self.notices.clear(),
            KeyCode::Enter if key.modifiers.contains(KeyModifiers::ALT) => self.input.push('\n'),
            KeyCode::Enter => self.submit(),
            KeyCode::Esc => self.input.clear(),
            KeyCode::Backspace => {
                self.input.pop();
            }
            KeyCode::Up => self.recall(true),
            KeyCode::Down => self.recall(false),
            KeyCode::PageUp => self.scroll_back = self.scroll_back.saturating_add(10),
            KeyCode::PageDown => self.scroll_back = self.scroll_back.saturating_sub(10),
            KeyCode::Char(character) => {
                self.input.push(character);
                self.history_index = None;
            }
            _ => {}
        }
    }

    fn recall(&mut self, older: bool) {
        if self.history.is_empty() {
            return;
        }
        let last = self.history.len() - 1;
        let next = match (self.history_index, older) {
            (None, true) => Some(last),
            (Some(0), true) => Some(0),
            (Some(index), true) => Some(index - 1),
            (Some(index), false) if index < last => Some(index + 1),
            (_, false) => None,
        };
        self.history_index = next;
        self.input = next
            .map(|index| self.history[index].clone())
            .unwrap_or_default();
    }

    fn submit(&mut self) {
        let text = self.input.trim().to_string();
        self.input.clear();
        self.history_index = None;
        self.scroll_back = 0;
        if text.is_empty() {
            return;
        }
        self.history.push(text.clone());
        if let Some(command) = text.strip_prefix('/') {
            self.command(command.trim());
            return;
        }
        match self.session.clone() {
            Some(id) => {
                self.request(Request::Send {
                    session_id: id,
                    text,
                });
            }
            None => {
                if let Some(Response::Started { session_id }) =
                    self.request(Request::StartSession {
                        project_path: self.project.path.clone(),
                        text,
                    })
                {
                    self.session = Some(session_id);
                }
            }
        }
        self.refresh();
    }

    fn command(&mut self, command: &str) {
        let session = self.session.clone();
        let run = self.view.as_ref().and_then(|view| view.run_id.clone());
        match command {
            "help" | "?" => {
                for (name, about) in HELP {
                    self.notices.push(format!("{name:<11}{about}"));
                }
            }
            "quit" | "exit" | "q" => self.quit = true,
            "new" => {
                self.session = None;
                self.view = None;
                self.notices
                    .push("New conversation. Type a message to begin.".into());
            }
            "sessions" => self.list_sessions(),
            "stop" => match run {
                Some(run_id) => {
                    if self.request(Request::Stop { run_id }).is_some() {
                        self.notices.push("Stopping.".into());
                    }
                }
                None => self.notices.push("Nothing is running.".into()),
            },
            "pause" | "resume" => match session {
                Some(session_id) => {
                    if self
                        .request(Request::SessionAction {
                            session_id,
                            action: command.into(),
                        })
                        .is_some()
                    {
                        self.notices.push(format!("{}d.", capitalize(command)));
                    }
                }
                None => self.notices.push("Start a conversation first.".into()),
            },
            "open" => {
                self.request(Request::ShowWindow);
            }
            other => self.notices.push(format!(
                "Unknown command /{other}. Type /help for the list."
            )),
        }
        self.refresh();
    }

    fn list_sessions(&mut self) {
        let Some(Response::Sessions { sessions }) = self.request(Request::Sessions) else {
            return;
        };
        let mine: Vec<_> = sessions
            .into_iter()
            .filter(|session| session.project_id == self.project.id)
            .take(10)
            .collect();
        if mine.is_empty() {
            self.notices
                .push("No conversations in this project yet.".into());
            return;
        }
        for session in mine {
            let state = if session.error.is_some() {
                "needs you"
            } else if session.paused {
                "paused"
            } else {
                "open"
            };
            self.notices.push(format!(
                "{}  {:<10} {}",
                &session.id[..8],
                state,
                session.title
            ));
        }
        self.notices
            .push("Rejoin one with: jackalope attach <id>".into());
    }
}

fn capitalize(word: &str) -> String {
    let mut characters = word.chars();
    characters
        .next()
        .map(|first| first.to_uppercase().chain(characters).collect())
        .unwrap_or_default()
}

/// Lines the transcript occupies once wrapped to `width`, so the view can pin
/// itself to the newest output the way a terminal does.
fn wrapped_height(lines: &[Line], width: u16) -> u16 {
    let width = width.max(1) as usize;
    lines
        .iter()
        .map(|line| line.width().max(1).div_ceil(width))
        .sum::<usize>()
        .min(u16::MAX as usize) as u16
}

fn transcript(app: &App) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    match &app.view {
        None => {
            lines.push(Line::styled(
                format!("Working in {} — {}", app.project.name, app.project.path),
                muted,
            ));
            lines.push(Line::styled(
                "Describe what you want done. Jackalope picks the agent. /help for commands.",
                muted,
            ));
        }
        Some(view) => {
            for message in &view.messages {
                lines.push(Line::raw(""));
                let marker = if message.sent { "› " } else { "… " };
                for (index, text) in message.text.lines().enumerate() {
                    let lead = if index == 0 { marker } else { "  " };
                    lines.push(Line::from(vec![
                        Span::styled(lead, accent.add_modifier(Modifier::BOLD)),
                        Span::styled(
                            text.to_string(),
                            Style::default().add_modifier(Modifier::BOLD),
                        ),
                    ]));
                }
            }
            if !view.result.trim().is_empty() {
                lines.push(Line::raw(""));
                for text in view.result.lines() {
                    lines.push(Line::raw(text.to_string()));
                }
            }
            for question in &view.questions {
                lines.push(Line::raw(""));
                lines.push(Line::styled(format!("? {}", question.question), accent));
                if !question.options.is_empty() {
                    lines.push(Line::styled(
                        format!("  {}", question.options.join(" · ")),
                        muted,
                    ));
                }
                lines.push(Line::styled(
                    "  Answer in the app for now; terminal answers are coming.",
                    muted,
                ));
            }
            if let Some(error) = &view.error {
                lines.push(Line::raw(""));
                lines.push(Line::styled(format!("! {error}"), accent));
            }
        }
    }
    if !app.notices.is_empty() {
        lines.push(Line::raw(""));
        for notice in &app.notices {
            lines.push(Line::styled(notice.clone(), muted));
        }
    }
    lines
}

fn status(app: &App) -> Line<'static> {
    let muted = Style::default().fg(brand::muted());
    let accent = Style::default().fg(brand::accent());
    let Some(view) = &app.view else {
        return Line::styled(format!(" {} · new conversation", app.project.name), muted);
    };
    let mut parts: Vec<Span> = vec![Span::raw(" ")];
    let state = if view.error.is_some() {
        "needs you".to_string()
    } else {
        view.step
            .clone()
            .or_else(|| view.status.clone())
            .unwrap_or_else(|| {
                if view.paused {
                    "paused".into()
                } else {
                    "waiting".into()
                }
            })
    };
    parts.push(Span::styled(state, accent));
    if let Some(agent) = &view.agent {
        parts.push(Span::styled(" · ", muted));
        let model = view
            .model
            .as_deref()
            .map(|model| format!(" {model}"))
            .unwrap_or_default();
        parts.push(Span::raw(format!("{agent}{model}")));
    }
    if let Some(attempt) = view.attempt.filter(|attempt| *attempt > 1) {
        parts.push(Span::styled(format!(" · attempt {attempt}"), muted));
    }
    if let Some(branch) = view.branch.as_ref().filter(|branch| !branch.is_empty()) {
        parts.push(Span::styled(format!(" · {branch}"), muted));
    }
    if let Some(reason) = &view.routing {
        parts.push(Span::styled(format!(" · {reason}"), muted));
    }
    Line::from(parts)
}

fn draw(frame: &mut Frame, app: &App) {
    let area = frame.area();
    // The full banner costs five rows; on a short terminal the conversation
    // matters more.
    let header: Text = if area.height >= 24 {
        Text::from(brand::banner())
    } else {
        Text::from(brand::compact())
    };
    let input_rows = (app.input.lines().count().max(1) as u16).min(6) + 2;
    let [header_area, body, status_area, input_area] = Layout::vertical([
        Constraint::Length(header.height() as u16 + 1),
        Constraint::Min(3),
        Constraint::Length(1),
        Constraint::Length(input_rows),
    ])
    .areas(area);

    frame.render_widget(Paragraph::new(header), header_area);

    let lines = transcript(app);
    let height = wrapped_height(&lines, body.width);
    let top = height
        .saturating_sub(body.height)
        .saturating_sub(app.scroll_back);
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((top, 0)),
        body,
    );

    frame.render_widget(Paragraph::new(status(app)), status_area);

    let placeholder = app.input.is_empty();
    let shown = if placeholder {
        Text::styled(
            if app.session.is_some() {
                "Reply, or /help"
            } else {
                "What should we work on?"
            },
            Style::default().fg(brand::muted()),
        )
    } else {
        Text::raw(app.input.clone())
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(brand::accent()));
    let inner = block.inner(input_area);
    frame.render_widget(
        Paragraph::new(shown)
            .block(block)
            .wrap(Wrap { trim: false }),
        input_area,
    );
    place_cursor(frame, app, inner);
}

fn place_cursor(frame: &mut Frame, app: &App, inner: Rect) {
    let last = app.input.rsplit('\n').next().unwrap_or("");
    let row = app.input.matches('\n').count() as u16;
    let column = (last.chars().count() as u16).min(inner.width.saturating_sub(1));
    frame.set_cursor_position((
        inner.x + column,
        inner.y + row.min(inner.height.saturating_sub(1)),
    ));
}
