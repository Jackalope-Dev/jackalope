//! The interactive conversation.
//!
//! Four threads feed one loop: keystrokes, change notifications from the host
//! (on their own connection, since a watch blocks), the agent overview (also
//! its own connection, since probing sign-in can take seconds), and the loop
//! itself, which re-reads the conversation whenever the host says work moved.

use crate::brand;
use crate::protocol::{
    AgentStatus, Client, Handshake, Project, Question, Request, Response, SessionSummary,
    SessionView,
};
use crate::ColdStart;
use crossterm::event::{
    self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
    Event as TermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseEventKind,
};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;
use std::cell::Cell;
use std::collections::HashSet;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

enum Event {
    Key(KeyEvent),
    /// Mouse wheel: positive scrolls back through the conversation.
    Scroll(i16),
    Paste(String),
    Resize,
    Changed,
    Overview(Result<Overview, String>),
    Tick,
}

#[derive(Clone)]
struct Overview {
    agents: Vec<AgentStatus>,
    default_agent: String,
}

const COMMANDS: &[(&str, &str)] = &[
    ("new", "start a fresh conversation"),
    ("sessions", "switch to another conversation in this project"),
    ("projects", "switch to another project"),
    ("agents", "see which agents are ready"),
    ("settings", "change how Jackalope behaves"),
    ("status", "show the project, host and agents"),
    ("agent", "choose the agent for your next conversation"),
    ("diff", "review and commit this work in the app"),
    ("stop", "stop the work that is running"),
    ("retry", "run the last message again"),
    ("finish", "mark this conversation done"),
    ("pause", "hold queued messages"),
    ("resume", "send held messages"),
    ("open", "show Jackalope's app window"),
    ("help", "show these commands"),
    ("quit", "leave (work keeps running)"),
];

/// What choosing a picker row does.
#[derive(Clone)]
enum Action {
    NewConversation,
    Session(String),
    Project(Project),
    Agent(String),
    ColdStart,
    Attribution,
    OpenApp,
    /// Route the next new conversation to this agent; `None` lets Jackalope choose.
    NextAgent(Option<String>),
    /// Answer the pending question with this option.
    Answer(String),
    /// Type a free-form answer instead of choosing an option.
    TypeAnswer,
}

struct Item {
    label: String,
    detail: String,
    action: Action,
}

#[derive(Clone, Copy, PartialEq)]
enum PickerKind {
    Sessions,
    Projects,
    Agents,
    Settings,
    NextAgent,
    Question,
}

struct Picker {
    kind: PickerKind,
    title: String,
    items: Vec<Item>,
    selected: usize,
}

struct App {
    client: Client,
    handshake: Handshake,
    project: Project,
    branch: Option<String>,
    session: Option<String>,
    view: Option<SessionView>,
    /// Open conversations across the workspace, newest first.
    sessions: Vec<SessionSummary>,
    overview: Option<Result<Overview, String>>,
    /// This project's commit authorship, fetched when settings open.
    attribution: Option<String>,
    picker: Option<Picker>,
    /// The highlighted row of the slash-command menu.
    slash: usize,
    input: String,
    /// Cursor position in `input`, in characters.
    cursor: usize,
    /// The agent for the next new conversation, when the user chose one.
    next_agent: Option<String>,
    /// Questions already offered as a picker, so dismissing one does not
    /// reopen it on every refresh.
    offered: HashSet<String>,
    /// Furthest the transcript can scroll back, measured while drawing.
    max_scroll: Cell<u16>,
    history: Vec<String>,
    history_index: Option<usize>,
    /// Jackalope's own lines — help, errors, confirmations — shown under the
    /// conversation and never sent to an agent.
    notices: Vec<String>,
    /// Lines scrolled up from the bottom of the transcript.
    scroll_back: u16,
    /// Animation frame for the working indicator.
    tick: usize,
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
    spawn_watcher(handshake.endpoint.clone(), events.clone());
    spawn_overview(handshake.endpoint.clone(), events.clone());
    spawn_ticker(events);

    let mut app = App {
        client,
        branch: branch(&project.path),
        handshake,
        project,
        session,
        view: None,
        sessions: Vec::new(),
        overview: None,
        attribution: None,
        picker: None,
        slash: 0,
        input: String::new(),
        cursor: 0,
        next_agent: None,
        offered: HashSet::new(),
        max_scroll: Cell::new(0),
        history: Vec::new(),
        history_index: None,
        notices: Vec::new(),
        scroll_back: 0,
        tick: 0,
        quit: false,
    };
    app.refresh();

    let mut terminal = ratatui::init();
    // Without mouse capture the wheel scrolls the terminal's own scrollback,
    // which from the alternate screen shows empty space above the interface.
    // Captured, it scrolls the conversation instead. Text can still be
    // selected with Option (macOS) or Shift held while dragging.
    let _ = crossterm::execute!(std::io::stdout(), EnableMouseCapture, EnableBracketedPaste);
    let result = event_loop(&mut terminal, &mut app, &inbox);
    let _ = crossterm::execute!(
        std::io::stdout(),
        DisableBracketedPaste,
        DisableMouseCapture
    );
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
    // Set when the desktop app started this terminal; it asks which
    // conversation is showing here when the user moves it elsewhere.
    let key = std::env::var("JACKALOPE_TERMINAL").ok();
    let mut reported: Option<Option<String>> = None;
    while !app.quit {
        if let Some(key) = &key {
            if reported.as_ref() != Some(&app.session) {
                let _ = app.client.send(&Request::Attached {
                    terminal: key.clone(),
                    session_id: app.session.clone(),
                });
                reported = Some(app.session.clone());
            }
        }
        terminal
            .draw(|frame| draw(frame, app))
            .map_err(|error| error.to_string())?;
        match inbox.recv() {
            Ok(Event::Key(key)) => app.key(key),
            Ok(Event::Changed) => app.refresh(),
            Ok(Event::Overview(overview)) => {
                app.overview = Some(overview);
                if app.picker.as_ref().map(|picker| picker.kind) == Some(PickerKind::Agents) {
                    app.open_picker(PickerKind::Agents);
                }
            }
            Ok(Event::Resize) => {}
            Ok(Event::Scroll(lines)) => app.scroll(lines),
            Ok(Event::Paste(text)) => {
                if app.picker.is_none() {
                    // Normalise pasted line endings; keep the text multi-line.
                    app.insert(&text.replace("\r\n", "\n").replace('\r', "\n"));
                }
            }
            Ok(Event::Tick) => {
                // Only a visible spinner needs the extra frames.
                if !app.working() {
                    continue;
                }
                app.tick = app.tick.wrapping_add(1);
            }
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
            Ok(TermEvent::Paste(text)) => events.send(Event::Paste(text)),
            Ok(TermEvent::Mouse(mouse)) => match mouse.kind {
                MouseEventKind::ScrollUp => events.send(Event::Scroll(3)),
                MouseEventKind::ScrollDown => events.send(Event::Scroll(-3)),
                _ => Ok(()),
            },
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

/// Drives the working indicator. Cheap when idle: the loop skips redraws unless
/// work is running.
fn spawn_ticker(events: Sender<Event>) {
    std::thread::spawn(move || {
        while events.send(Event::Tick).is_ok() {
            std::thread::sleep(Duration::from_millis(120));
        }
    });
}

/// Asks for the agent overview on its own connection: the host probes each
/// agent's sign-in, which can take seconds, and the UI must stay responsive.
fn spawn_overview(endpoint: String, events: Sender<Event>) {
    std::thread::spawn(move || {
        let result = Client::connect(&endpoint).and_then(|mut client| {
            match client.send(&Request::Overview)? {
                Response::Overview {
                    agents,
                    default_agent,
                } => Ok(Overview {
                    agents,
                    default_agent,
                }),
                Response::Error { message } => Err(message),
                _ => Err("The host answered unexpectedly.".into()),
            }
        });
        let _ = events.send(Event::Overview(result));
    });
}

/// The checked-out branch, read locally: the CLI runs beside the repository.
fn branch(path: &str) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", path, "rev-parse", "--abbrev-ref", "HEAD"])
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !name.is_empty()).then_some(name)
}

/// Commands whose names start with what follows the `/`, while the input is
/// still a bare command.
fn slash_matches(input: &str) -> Vec<(&'static str, &'static str)> {
    let Some(typed) = input.strip_prefix('/') else {
        return Vec::new();
    };
    if typed.contains(char::is_whitespace) {
        return Vec::new();
    }
    COMMANDS
        .iter()
        .copied()
        .filter(|(name, _)| name.starts_with(typed))
        .collect()
}

fn cold_start_label(choice: Option<ColdStart>) -> &'static str {
    match choice {
        None => "Ask each time",
        Some(ColdStart::Open) => "Open the app",
        Some(ColdStart::Background) => "Run in the background",
    }
}

fn attribution_label(attribution: Option<&str>) -> &'static str {
    match attribution {
        Some("user") => "You",
        Some("coAuthor") => "You, with agents as co-authors",
        Some("agent") => "The agents",
        _ => "Loading…",
    }
}

fn agent_glyph(state: &str) -> &'static str {
    brand::mark_glyph(match state {
        "ready" => brand::Mark::Full,
        "installed" => brand::Mark::Partial,
        "sign-in" => brand::Mark::Attention,
        _ => brand::Mark::Empty,
    })
}

fn agent_state_label(agent: &AgentStatus) -> String {
    match agent.state.as_str() {
        "ready" => agent.account.clone(),
        "installed" => "installed".into(),
        "sign-in" => "sign-in needed".into(),
        "disabled" => "disabled".into(),
        _ => "not installed".into(),
    }
}

impl App {
    /// Whether an agent is working, so the status line animates.
    fn working(&self) -> bool {
        self.view.as_ref().is_some_and(|view| {
            view.error.is_none()
                && view.questions.is_empty()
                && matches!(
                    view.status.as_deref(),
                    Some("starting" | "running" | "routing" | "queued" | "stopping")
                )
        })
    }

    fn scroll(&mut self, lines: i16) {
        if let Some(picker) = self.picker.as_mut() {
            picker.selected = if lines > 0 {
                picker.selected.saturating_sub(1)
            } else {
                (picker.selected + 1).min(picker.items.len().saturating_sub(1))
            };
            return;
        }
        self.scroll_back = if lines > 0 {
            // Stop at the top of the conversation instead of scrolling into blank space.
            self.scroll_back
                .saturating_add(lines as u16)
                .min(self.max_scroll.get())
        } else {
            self.scroll_back.saturating_sub(lines.unsigned_abs())
        };
    }

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
        if let Some(Response::Sessions { sessions }) = self.request(Request::Sessions) {
            self.sessions = sessions;
        }
        let Some(id) = self.session.clone() else {
            return;
        };
        if let Some(Response::Session { session, .. }) =
            self.request(Request::SessionDetail { session_id: id })
        {
            self.view = Some(*session);
        }
        self.offer_question();
    }

    /// The question an agent is waiting on, if any. Answers go to the oldest.
    fn question(&self) -> Option<&Question> {
        self.view.as_ref()?.questions.first()
    }

    /// Opens a question with options as a picker, once, so answering is one
    /// keypress. Open questions are answered by typing into the input.
    fn offer_question(&mut self) {
        let Some(question) = self.question().cloned() else {
            return;
        };
        if self.picker.is_some()
            || question.options.is_empty()
            || !self.offered.insert(question.id.clone())
        {
            return;
        }
        self.open_picker(PickerKind::Question);
    }

    fn answer(&mut self, text: String) {
        let Some(question) = self.question().cloned() else {
            return;
        };
        if self
            .request(Request::Answer {
                run_id: question.run_id,
                prompt_id: question.id,
                text,
            })
            .is_some()
        {
            self.notices.push("Answered.".into());
        }
        self.refresh();
    }

    fn sessions_here(&self) -> Vec<&SessionSummary> {
        self.sessions
            .iter()
            .filter(|session| session.project_id == self.project.id)
            .collect()
    }

    fn key(&mut self, key: KeyEvent) {
        let control = key.modifiers.contains(KeyModifiers::CONTROL);
        if matches!(key.code, KeyCode::Char('c') | KeyCode::Char('d')) && control {
            self.quit = true;
            return;
        }
        if self.picker.is_some() {
            self.picker_key(key);
            return;
        }
        let matches = slash_matches(&self.input);
        let alt = key.modifiers.contains(KeyModifiers::ALT);
        match key.code {
            KeyCode::Char('l') if control => self.notices.clear(),
            // Newline without sending: Alt+Enter, or Ctrl+J where Alt is taken.
            KeyCode::Enter if alt => self.insert("\n"),
            KeyCode::Char('j') if control => self.insert("\n"),
            KeyCode::Enter if !matches.is_empty() => {
                // Run the highlighted command unless the input already names one.
                let typed = &self.input[1..];
                let chosen = if COMMANDS.iter().any(|(name, _)| *name == typed) {
                    typed.to_string()
                } else {
                    matches[self.slash.min(matches.len() - 1)].0.to_string()
                };
                self.set_input(format!("/{chosen}"));
                self.submit();
            }
            KeyCode::Enter => self.submit(),
            KeyCode::Tab if !matches.is_empty() => {
                let name = matches[self.slash.min(matches.len() - 1)].0;
                self.set_input(format!("/{name} "));
                self.slash = 0;
            }
            KeyCode::Esc => {
                self.set_input(String::new());
                self.slash = 0;
            }
            KeyCode::Up if !matches.is_empty() => self.slash = self.slash.saturating_sub(1),
            KeyCode::Down if !matches.is_empty() => {
                self.slash = (self.slash + 1).min(matches.len() - 1)
            }
            KeyCode::Up => self.recall(true),
            KeyCode::Down => self.recall(false),
            KeyCode::PageUp => self.scroll(10),
            KeyCode::PageDown => self.scroll(-10),
            // Editing, with the shortcuts shells and editors share.
            KeyCode::Left if alt => self.cursor = self.word_start(),
            KeyCode::Right if alt => self.cursor = self.word_end(),
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(self.input_len()),
            KeyCode::Home => self.cursor = 0,
            KeyCode::End => self.cursor = self.input_len(),
            KeyCode::Char('a') if control => self.cursor = 0,
            KeyCode::Char('e') if control => self.cursor = self.input_len(),
            KeyCode::Char('b') if control => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Char('f') if control => self.cursor = (self.cursor + 1).min(self.input_len()),
            KeyCode::Char('w') if control => self.delete_to(self.word_start()),
            KeyCode::Backspace if alt => self.delete_to(self.word_start()),
            KeyCode::Char('u') if control => self.delete_to(0),
            KeyCode::Char('k') if control => {
                let end = self.input_len();
                let cursor = self.cursor;
                self.cursor = end;
                self.delete_to(cursor);
            }
            KeyCode::Backspace => {
                if self.cursor > 0 {
                    self.delete_to(self.cursor - 1);
                }
            }
            KeyCode::Delete => {
                if self.cursor < self.input_len() {
                    self.cursor += 1;
                    self.delete_to(self.cursor - 1);
                }
            }
            KeyCode::Char(character) if !control => {
                self.insert(&character.to_string());
                self.history_index = None;
                self.slash = 0;
            }
            _ => {}
        }
    }

    fn input_len(&self) -> usize {
        self.input.chars().count()
    }

    /// Byte offset of character `index` in the input.
    fn byte(&self, index: usize) -> usize {
        self.input
            .char_indices()
            .nth(index)
            .map_or(self.input.len(), |(offset, _)| offset)
    }

    fn insert(&mut self, text: &str) {
        let at = self.byte(self.cursor);
        self.input.insert_str(at, text);
        self.cursor += text.chars().count();
    }

    /// Deletes from `start` to the cursor (either order), leaving the cursor at the start.
    fn delete_to(&mut self, start: usize) {
        let (from, to) = (start.min(self.cursor), start.max(self.cursor));
        let (from_byte, to_byte) = (self.byte(from), self.byte(to));
        self.input.replace_range(from_byte..to_byte, "");
        self.cursor = from;
        self.slash = 0;
    }

    fn set_input(&mut self, text: String) {
        self.cursor = text.chars().count();
        self.input = text;
    }

    fn word_start(&self) -> usize {
        let characters: Vec<char> = self.input.chars().collect();
        let mut index = self.cursor;
        while index > 0 && characters[index - 1].is_whitespace() {
            index -= 1;
        }
        while index > 0 && !characters[index - 1].is_whitespace() {
            index -= 1;
        }
        index
    }

    fn word_end(&self) -> usize {
        let characters: Vec<char> = self.input.chars().collect();
        let mut index = self.cursor;
        while index < characters.len() && characters[index].is_whitespace() {
            index += 1;
        }
        while index < characters.len() && !characters[index].is_whitespace() {
            index += 1;
        }
        index
    }

    fn picker_key(&mut self, key: KeyEvent) {
        let Some(picker) = self.picker.as_mut() else {
            return;
        };
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => self.picker = None,
            KeyCode::Up | KeyCode::Char('k') => picker.selected = picker.selected.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => {
                picker.selected = (picker.selected + 1).min(picker.items.len().saturating_sub(1))
            }
            KeyCode::Enter | KeyCode::Char(' ') => {
                if let Some(action) = picker
                    .items
                    .get(picker.selected)
                    .map(|item| item.action.clone())
                {
                    self.choose(action);
                }
            }
            _ => {}
        }
    }

    fn choose(&mut self, action: Action) {
        match action {
            Action::NewConversation => {
                self.picker = None;
                self.command("new");
            }
            Action::Session(id) => {
                self.picker = None;
                self.session = Some(id);
                self.view = None;
                self.scroll_back = 0;
                self.refresh();
            }
            Action::Project(project) => {
                self.picker = None;
                self.branch = branch(&project.path);
                brand::set_accent(project.accent.as_deref());
                self.notices.push(format!(
                    "Switched to {}. Type a message to begin.",
                    project.name
                ));
                self.project = project;
                self.session = None;
                self.view = None;
                self.refresh();
            }
            Action::Agent(id) => {
                self.picker = None;
                let agent = self
                    .overview
                    .as_ref()
                    .and_then(|overview| overview.as_ref().ok())
                    .and_then(|overview| overview.agents.iter().find(|agent| agent.id == id));
                if let Some(agent) = agent {
                    self.notices
                        .push(format!("{}: {}", agent.name, agent.detail));
                }
            }
            Action::ColdStart => {
                let next = match crate::remembered_choice() {
                    None => Some(ColdStart::Open),
                    Some(ColdStart::Open) => Some(ColdStart::Background),
                    Some(ColdStart::Background) => None,
                };
                match next {
                    Some(choice) => crate::remember_choice(choice),
                    None => crate::forget_choice(),
                }
                self.open_picker(PickerKind::Settings);
            }
            Action::Attribution => {
                let next = match self.attribution.as_deref() {
                    Some("user") => "coAuthor",
                    Some("coAuthor") => "agent",
                    _ => "user",
                };
                if let Some(Response::CommitPolicy { attribution, .. }) =
                    self.request(Request::SetCommitAttribution {
                        project_path: self.project.path.clone(),
                        attribution: next.into(),
                    })
                {
                    self.attribution = Some(attribution);
                }
                self.open_picker(PickerKind::Settings);
            }
            Action::NextAgent(agent) => {
                self.picker = None;
                let name = agent
                    .as_ref()
                    .map(|id| self.agent_name(id))
                    .unwrap_or_else(|| "Jackalope's choice".into());
                self.next_agent = agent;
                self.notices.push(if self.session.is_some() {
                    format!("{name} will take your next new conversation (/new). This one stays with its agent.")
                } else {
                    format!("{name} will take this conversation.")
                });
            }
            Action::Answer(option) => {
                self.picker = None;
                self.answer(option);
            }
            Action::TypeAnswer => {
                self.picker = None;
                self.notices
                    .push("Type your answer and press Enter.".into());
            }
            Action::OpenApp => {
                self.picker = None;
                if self.request(Request::ShowWindow).is_some() {
                    self.notices.push("Opened Jackalope.".into());
                }
            }
        }
    }

    fn agent_name(&self, id: &str) -> String {
        self.overview
            .as_ref()
            .and_then(|overview| overview.as_ref().ok())
            .and_then(|overview| overview.agents.iter().find(|agent| agent.id == id))
            .map(|agent| agent.name.clone())
            .unwrap_or_else(|| id.to_string())
    }

    /// Builds (or rebuilds, keeping the highlighted row) a picker.
    fn open_picker(&mut self, kind: PickerKind) {
        let selected = self
            .picker
            .as_ref()
            .filter(|picker| picker.kind == kind)
            .map(|picker| picker.selected)
            .unwrap_or(0);
        let (title, items) = match kind {
            PickerKind::Sessions => {
                self.refresh();
                let mut items = vec![Item {
                    label: "+ New conversation".into(),
                    detail: String::new(),
                    action: Action::NewConversation,
                }];
                items.extend(self.sessions_here().into_iter().map(|session| {
                    let state = if session.error.is_some() {
                        "needs you"
                    } else if session.paused {
                        "paused"
                    } else if Some(&session.id) == self.session.as_ref() {
                        "showing"
                    } else {
                        "open"
                    };
                    let queued = if session.pending > 0 {
                        format!(" · {} queued", session.pending)
                    } else {
                        String::new()
                    };
                    Item {
                        label: session.title.clone(),
                        detail: format!("{state}{queued} · {}", &session.id[..8]),
                        action: Action::Session(session.id.clone()),
                    }
                }));
                ("Conversations in this project".to_string(), items)
            }
            PickerKind::Projects => {
                let projects = match self.request(Request::Projects) {
                    Some(Response::Projects { projects }) => projects,
                    _ => Vec::new(),
                };
                let items = projects
                    .into_iter()
                    .map(|project| Item {
                        detail: if project.id == self.project.id {
                            format!("current · {}", project.path)
                        } else {
                            project.path.clone()
                        },
                        label: project.name.clone(),
                        action: Action::Project(project),
                    })
                    .collect();
                ("Projects".to_string(), items)
            }
            PickerKind::Agents => {
                let mut items = Vec::new();
                if let Some(Ok(overview)) = &self.overview {
                    let mut agents = overview.agents.clone();
                    // Usable agents first; the order is otherwise the host's.
                    agents.sort_by_key(|agent| {
                        ["ready", "installed", "sign-in", "disabled", "missing"]
                            .iter()
                            .position(|state| *state == agent.state)
                    });
                    for agent in agents {
                        let default = if agent.id == overview.default_agent {
                            " · default"
                        } else {
                            ""
                        };
                        items.push(Item {
                            label: format!("{} {}", agent_glyph(&agent.state), agent.name),
                            detail: format!("{}{default}", agent_state_label(&agent)),
                            action: Action::Agent(agent.id),
                        });
                    }
                }
                items.push(Item {
                    label: "Manage agents in the app".into(),
                    detail: "sign in, accounts, models".into(),
                    action: Action::OpenApp,
                });
                ("Agents".to_string(), items)
            }
            PickerKind::Settings => {
                if self.attribution.is_none() {
                    if let Some(Response::CommitPolicy { attribution, .. }) =
                        self.request(Request::CommitPolicy {
                            project_path: self.project.path.clone(),
                        })
                    {
                        self.attribution = Some(attribution);
                    }
                }
                let default_agent = self
                    .overview
                    .as_ref()
                    .and_then(|overview| overview.as_ref().ok())
                    .map(|overview| {
                        overview
                            .agents
                            .iter()
                            .find(|agent| agent.id == overview.default_agent)
                            .map(|agent| agent.name.clone())
                            .unwrap_or_else(|| overview.default_agent.clone())
                    })
                    .unwrap_or_else(|| "Checking…".into());
                let items = vec![
                    Item {
                        label: "When Jackalope isn't running".into(),
                        detail: cold_start_label(crate::remembered_choice()).into(),
                        action: Action::ColdStart,
                    },
                    Item {
                        label: format!("Commit author in {}", self.project.name),
                        detail: attribution_label(self.attribution.as_deref()).into(),
                        action: Action::Attribution,
                    },
                    Item {
                        label: "Default agent".into(),
                        detail: format!("{default_agent} · change in the app"),
                        action: Action::OpenApp,
                    },
                    Item {
                        label: "Open Jackalope".into(),
                        detail: "every other setting".into(),
                        action: Action::OpenApp,
                    },
                ];
                ("Settings".to_string(), items)
            }
            PickerKind::NextAgent => {
                let mut items = vec![Item {
                    label: "Let Jackalope choose".into(),
                    detail: if self.next_agent.is_none() {
                        "current".into()
                    } else {
                        "routes each conversation".into()
                    },
                    action: Action::NextAgent(None),
                }];
                if let Some(Ok(overview)) = &self.overview {
                    for agent in overview
                        .agents
                        .iter()
                        .filter(|agent| matches!(agent.state.as_str(), "ready" | "installed"))
                    {
                        items.push(Item {
                            label: format!("{} {}", agent_glyph(&agent.state), agent.name),
                            detail: if self.next_agent.as_deref() == Some(agent.id.as_str()) {
                                "current".into()
                            } else {
                                agent_state_label(agent)
                            },
                            action: Action::NextAgent(Some(agent.id.clone())),
                        });
                    }
                }
                ("Agent for the next conversation".to_string(), items)
            }
            PickerKind::Question => {
                let question = self.question().cloned();
                let mut items: Vec<Item> = question
                    .iter()
                    .flat_map(|question| question.options.clone())
                    .map(|option| Item {
                        label: option.clone(),
                        detail: String::new(),
                        action: Action::Answer(option),
                    })
                    .collect();
                items.push(Item {
                    label: "Type a different answer…".into(),
                    detail: String::new(),
                    action: Action::TypeAnswer,
                });
                (
                    question
                        .map(|question| question.question)
                        .unwrap_or_else(|| "Question".into()),
                    items,
                )
            }
        };
        let selected = selected.min(items.len().saturating_sub(1));
        self.picker = Some(Picker {
            kind,
            title,
            items,
            selected,
        });
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
        self.set_input(
            next.map(|index| self.history[index].clone())
                .unwrap_or_default(),
        );
    }

    fn submit(&mut self) {
        let text = self.input.trim().to_string();
        self.set_input(String::new());
        self.history_index = None;
        self.scroll_back = 0;
        self.slash = 0;
        if text.is_empty() {
            return;
        }
        self.history.push(text.clone());
        if let Some(command) = text.strip_prefix('/') {
            self.command(command.trim());
            return;
        }
        if self.question().is_some() {
            self.answer(text);
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
                        agent: self.next_agent.clone(),
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
                for (name, about) in COMMANDS {
                    self.notices.push(format!("/{name:<10}{about}"));
                }
                self.notices
                    .push("Tip: type / to pick a command with the arrow keys.".into());
            }
            "quit" | "exit" | "q" => self.quit = true,
            "new" => {
                self.session = None;
                self.view = None;
                self.notices
                    .push("New conversation. Type a message to begin.".into());
            }
            "sessions" => self.open_picker(PickerKind::Sessions),
            "projects" => self.open_picker(PickerKind::Projects),
            "agents" => self.open_picker(PickerKind::Agents),
            "settings" | "config" => self.open_picker(PickerKind::Settings),
            "status" => {
                self.session = None;
                self.view = None;
                self.notices
                    .push("Your conversation is still open; /sessions to go back.".into());
            }
            "agent" | "model" => self.open_picker(PickerKind::NextAgent),
            "diff" | "changes" => {
                // The conversation's own worktree when it has one.
                let path = self
                    .view
                    .as_ref()
                    .and_then(|view| view.workspace.clone())
                    .filter(|path| !path.is_empty())
                    .unwrap_or_else(|| self.project.path.clone());
                if self.request(Request::ShowChanges { path }).is_some() {
                    self.notices.push("Opened Changes in Jackalope.".into());
                }
            }
            "finish" | "retry" => match session {
                Some(session_id) => {
                    if self
                        .request(Request::SessionAction {
                            session_id,
                            action: command.into(),
                        })
                        .is_some()
                    {
                        self.notices.push(if command == "retry" {
                            "Retrying.".into()
                        } else {
                            "Marked done.".into()
                        });
                    }
                }
                None => self.notices.push("Start a conversation first.".into()),
            },
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
            other => self
                .notices
                .push(format!("Unknown command /{other}. Type / to see the list.")),
        }
        self.refresh();
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

/// The start screen: where you are, what is running, and who can do the work.
fn welcome(app: &App) -> Vec<Line<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let bold = Style::default().add_modifier(Modifier::BOLD);
    let label = |text: &str| Span::styled(format!("  {text:<10}"), muted);
    let mut lines = vec![Line::raw("")];

    let mut project = vec![
        label("Project"),
        Span::styled(app.project.name.clone(), bold),
    ];
    if let Some(branch) = &app.branch {
        project.push(Span::styled(format!("  {branch}"), accent));
    }
    lines.push(Line::from(project));
    lines.push(Line::from(vec![
        label(""),
        Span::styled(app.project.path.clone(), muted),
    ]));
    lines.push(Line::from(vec![
        label("Jackalope"),
        Span::raw(if app.handshake.windowed {
            "running with the app open"
        } else {
            "running in the background"
        }),
        Span::styled("  /open to show the app", muted),
    ]));

    match &app.overview {
        None => lines.push(Line::from(vec![
            label("Agents"),
            Span::styled("checking sign-in…", muted),
        ])),
        Some(Err(error)) => lines.push(Line::from(vec![
            label("Agents"),
            Span::styled(error.clone(), muted),
        ])),
        Some(Ok(overview)) => {
            let usable: Vec<_> = overview
                .agents
                .iter()
                .filter(|agent| matches!(agent.state.as_str(), "ready" | "installed" | "sign-in"))
                .collect();
            if usable.is_empty() {
                lines.push(Line::from(vec![
                    label("Agents"),
                    Span::raw("none installed yet · /agents to set one up"),
                ]));
            }
            for (index, agent) in usable.iter().enumerate() {
                let glyph_style = if agent.state == "sign-in" {
                    muted
                } else {
                    accent
                };
                let mut spans = vec![
                    label(if index == 0 { "Agents" } else { "" }),
                    Span::styled(format!("{} ", agent_glyph(&agent.state)), glyph_style),
                    Span::raw(format!("{:<14}", agent.name)),
                    Span::styled(agent_state_label(agent), muted),
                ];
                if agent.id == overview.default_agent {
                    spans.push(Span::styled("  default", accent));
                }
                lines.push(Line::from(spans));
            }
            let missing: Vec<_> = overview
                .agents
                .iter()
                .filter(|agent| !matches!(agent.state.as_str(), "ready" | "installed" | "sign-in"))
                .map(|agent| agent.name.clone())
                .collect();
            if !missing.is_empty() {
                lines.push(Line::from(vec![
                    label(""),
                    Span::styled(format!("Not set up: {}", missing.join(", ")), muted),
                ]));
            }
        }
    }

    let here = app.sessions_here();
    if !here.is_empty() {
        let waiting = here
            .iter()
            .filter(|session| session.error.is_some())
            .count();
        let mut spans = vec![
            label("Open"),
            Span::raw(format!(
                "{} {} here",
                here.len(),
                if here.len() == 1 {
                    "conversation"
                } else {
                    "conversations"
                }
            )),
        ];
        if waiting > 0 {
            spans.push(Span::styled(format!(" · {waiting} need you"), accent));
        }
        spans.push(Span::styled("  /sessions to switch", muted));
        lines.push(Line::from(spans));
    }

    lines.push(Line::raw(""));
    lines.push(Line::styled(
        "  Describe what you want done and Jackalope picks the agent.",
        muted,
    ));
    lines.push(Line::from(vec![
        Span::styled("  ", muted),
        Span::styled("/", accent),
        Span::styled(" commands   ", muted),
        Span::styled("/projects", accent),
        Span::styled(" switch repo   ", muted),
        Span::styled("/settings", accent),
        Span::styled(" preferences   ", muted),
        Span::styled("Ctrl+C", accent),
        Span::styled(" leave", muted),
    ]));
    lines
}

/// A small Markdown renderer for agent replies: headings, lists, quotes, code
/// blocks, and inline `code`, **bold** and *emphasis*. Anything else is shown
/// as written, which is how Markdown reads anyway.
fn markdown(text: &str) -> Vec<Line<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let mut lines = Vec::new();
    let mut in_code = false;
    for raw in text.lines() {
        let trimmed = raw.trim_start();
        if trimmed.starts_with("```") {
            in_code = !in_code;
            if in_code {
                let language = trimmed.trim_start_matches('`').trim();
                lines.push(Line::styled(
                    format!(
                        "  ┌ {}",
                        if language.is_empty() {
                            "code"
                        } else {
                            language
                        }
                    ),
                    muted,
                ));
            } else {
                lines.push(Line::styled("  └", muted));
            }
            continue;
        }
        if in_code {
            lines.push(Line::from(vec![
                Span::styled("  │ ", muted),
                Span::styled(raw.to_string(), accent),
            ]));
            continue;
        }
        let indent = " ".repeat(raw.len() - trimmed.len());
        if let Some(heading) = ["### ", "## ", "# "]
            .iter()
            .find_map(|marker| trimmed.strip_prefix(marker))
        {
            lines.push(Line::styled(
                heading.to_string(),
                accent.add_modifier(Modifier::BOLD),
            ));
        } else if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        {
            let mut spans = vec![Span::raw(format!("{indent}  ")), Span::styled("• ", accent)];
            spans.extend(inline(item));
            lines.push(Line::from(spans));
        } else if let Some(quote) = trimmed.strip_prefix("> ") {
            let mut spans = vec![Span::styled("  ▎ ", muted)];
            spans.extend(
                inline(quote)
                    .into_iter()
                    .map(|span| span.patch_style(muted)),
            );
            lines.push(Line::from(spans));
        } else if trimmed.chars().all(|c| matches!(c, '-' | '*' | '_')) && trimmed.len() >= 3 {
            lines.push(Line::styled("  ⠒⠒⠒", muted));
        } else {
            let mut spans = vec![Span::raw(indent)];
            spans.extend(inline(trimmed));
            lines.push(Line::from(spans));
        }
    }
    lines
}

/// Inline Markdown: `code`, **bold** and *emphasis*.
fn inline(text: &str) -> Vec<Span<'static>> {
    let accent = Style::default().fg(brand::accent());
    let mut spans = Vec::new();
    let mut plain = String::new();
    let mut rest = text;
    let flush = |plain: &mut String, spans: &mut Vec<Span<'static>>| {
        if !plain.is_empty() {
            spans.push(Span::raw(std::mem::take(plain)));
        }
    };
    while let Some(character) = rest.chars().next() {
        let marker = if rest.starts_with("**") {
            Some(("**", Style::default().add_modifier(Modifier::BOLD)))
        } else if character == '`' {
            Some(("`", accent))
        } else if character == '*' || character == '_' {
            Some((&rest[..1], Style::default().add_modifier(Modifier::ITALIC)))
        } else {
            None
        };
        if let Some((marker, style)) = marker {
            if let Some(end) = rest[marker.len()..].find(marker).filter(|end| *end > 0) {
                flush(&mut plain, &mut spans);
                let inner = &rest[marker.len()..marker.len() + end];
                spans.push(Span::styled(inner.to_string(), style));
                rest = &rest[marker.len() * 2 + end..];
                continue;
            }
        }
        plain.push(character);
        rest = &rest[character.len_utf8()..];
    }
    flush(&mut plain, &mut spans);
    spans
}

fn transcript(app: &App) -> Vec<Line<'static>> {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let mut lines = match &app.view {
        None => welcome(app),
        Some(view) => {
            let mut lines = Vec::new();
            for message in &view.messages {
                lines.push(Line::raw(""));
                if message.role == "agent" {
                    lines.extend(markdown(&message.text));
                    continue;
                }
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
            if view.messages.iter().all(|message| message.role != "agent")
                && !view.result.trim().is_empty()
            {
                // A host that predates agent messages still sends the latest output.
                lines.push(Line::raw(""));
                lines.extend(markdown(&view.result));
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
                    if question.options.is_empty() {
                        "  Type your answer below and press Enter."
                    } else {
                        "  Choose an answer, or type your own below."
                    },
                    muted,
                ));
            }
            if let Some(error) = &view.error {
                lines.push(Line::raw(""));
                lines.push(Line::styled(format!("! {error}"), accent));
            }
            lines
        }
    };
    if !app.notices.is_empty() {
        lines.push(Line::raw(""));
        for notice in &app.notices {
            lines.push(Line::styled(format!("  {notice}"), muted));
        }
    }
    lines
}

fn status(app: &App) -> Line<'static> {
    let muted = Style::default().fg(brand::muted());
    let accent = Style::default().fg(brand::accent());
    let Some(view) = &app.view else {
        let mut parts = vec![Span::styled(format!(" {}", app.project.name), muted)];
        if let Some(branch) = &app.branch {
            parts.push(Span::styled(format!(" · {branch}"), muted));
        }
        parts.push(Span::styled(" · new conversation", muted));
        if let Some(agent) = &app.next_agent {
            parts.push(Span::styled(
                format!(" · {}", app.agent_name(agent)),
                accent,
            ));
        }
        return Line::from(parts);
    };
    let mut parts: Vec<Span> = vec![Span::raw(" ")];
    if app.working() {
        parts.push(Span::styled(
            format!("{} ", brand::spinner(app.tick)),
            accent,
        ));
    }
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
    if let Some(detail) = view
        .step_detail
        .as_ref()
        .filter(|detail| !detail.is_empty() && app.working())
    {
        let short: String = detail.chars().take(60).collect();
        parts.push(Span::styled(format!(" · {short}"), muted));
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
    // The full banner greets you; once a conversation is under way, or on a
    // short terminal, the conversation matters more.
    let header: Text = if app.view.is_none() && area.height >= 28 {
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

    let mut header_lines = header.lines;
    header_lines.push(brand::divider(header_area.width));
    frame.render_widget(Paragraph::new(header_lines), header_area);

    let lines = transcript(app);
    let height = wrapped_height(&lines, body.width);
    app.max_scroll.set(height.saturating_sub(body.height));
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
            if app.question().is_some() {
                "Type your answer, or / for commands"
            } else if app.session.is_some() {
                "Reply, or / for commands"
            } else {
                "What should we work on?  / for commands"
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

    if let Some(picker) = &app.picker {
        draw_picker(frame, picker, area);
        return;
    }
    let matches = slash_matches(&app.input);
    if !matches.is_empty() {
        draw_slash_menu(frame, &matches, app.slash, input_area);
    }
    place_cursor(frame, app, inner);
}

/// The command menu, floating just above the input like an editor's completions.
fn draw_slash_menu(frame: &mut Frame, matches: &[(&str, &str)], selected: usize, input: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let rows = matches.len().min(8) as u16;
    let selected = selected.min(matches.len() - 1);
    // Keep the highlighted row visible when the list is longer than the menu.
    let first = selected.saturating_sub(rows as usize - 1);
    let area = Rect {
        x: input.x,
        y: input.y.saturating_sub(rows + 2),
        width: input.width.min(64),
        height: rows + 2,
    };
    let lines: Vec<Line> = matches
        .iter()
        .enumerate()
        .skip(first)
        .take(rows as usize)
        .map(|(index, (name, about))| {
            let chosen = index == selected;
            let name_style = if chosen {
                accent.add_modifier(Modifier::BOLD | Modifier::REVERSED)
            } else {
                accent
            };
            Line::from(vec![
                Span::styled(format!(" /{name:<10}"), name_style),
                Span::styled(
                    format!(" {about}"),
                    if chosen { Style::default() } else { muted },
                ),
            ])
        })
        .collect();
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(muted)
                .title(Span::styled(
                    " ↑↓ choose · Tab complete · Enter run ",
                    muted,
                )),
        ),
        area,
    );
}

fn draw_picker(frame: &mut Frame, picker: &Picker, area: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let width = area.width.saturating_sub(4).min(76);
    let visible = (area.height.saturating_sub(8) as usize).clamp(3, 14);
    let rows = picker.items.len().clamp(1, visible) as u16;
    let popup = Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        y: area.y + (area.height.saturating_sub(rows + 4)) / 3,
        width,
        height: rows + 4,
    };
    let first = picker.selected.saturating_sub(visible - 1);
    let label_width = (width as usize / 2).saturating_sub(2);
    let mut lines: Vec<Line> = picker
        .items
        .iter()
        .enumerate()
        .skip(first)
        .take(visible)
        .map(|(index, item)| {
            let chosen = index == picker.selected;
            let mut label: String = item.label.chars().take(label_width).collect();
            label = format!("{label:<label_width$}");
            let lead = if chosen {
                format!("{} ", brand::mark_glyph(brand::Mark::Cursor))
            } else {
                "  ".into()
            };
            Line::from(vec![
                Span::styled(lead, accent),
                Span::styled(
                    label,
                    if chosen {
                        Style::default().add_modifier(Modifier::BOLD)
                    } else {
                        Style::default()
                    },
                ),
                Span::styled(
                    format!(" {}", item.detail),
                    if chosen { accent } else { muted },
                ),
            ])
        })
        .collect();
    if picker.items.is_empty() {
        lines.push(Line::styled("  Nothing here yet.", muted));
    }
    lines.push(Line::raw(""));
    lines.push(Line::styled(
        if picker.kind == PickerKind::Settings {
            "  ↑↓ choose · Enter change · Esc close"
        } else {
            "  ↑↓ choose · Enter select · Esc close"
        },
        muted,
    ));
    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(accent)
                .title(Span::styled(
                    format!(" {} ", picker.title),
                    accent.add_modifier(Modifier::BOLD),
                )),
        ),
        popup,
    );
}

fn place_cursor(frame: &mut Frame, app: &App, inner: Rect) {
    let before: String = app.input.chars().take(app.cursor).collect();
    let row = before.matches('\n').count() as u16;
    let column = before.rsplit('\n').next().unwrap_or("").chars().count() as u16;
    frame.set_cursor_position((
        inner.x + column.min(inner.width.saturating_sub(1)),
        inner.y + row.min(inner.height.saturating_sub(1)),
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slash_menu_filters_bare_commands_only() {
        let names = |input: &str| -> Vec<&str> {
            slash_matches(input)
                .into_iter()
                .map(|(name, _)| name)
                .collect()
        };
        assert_eq!(names("/se"), ["sessions", "settings"]);
        assert_eq!(names("/").len(), COMMANDS.len());
        assert!(names("/stop now").is_empty(), "arguments close the menu");
        assert!(names("hello").is_empty());
    }

    fn text(line: &Line) -> String {
        line.spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect()
    }

    #[test]
    fn inline_markdown_styles_code_bold_and_emphasis() {
        let spans = inline("run `cargo test` then **ship** it _now_");
        let shown: String = spans.iter().map(|span| span.content.as_ref()).collect();
        assert_eq!(shown, "run cargo test then ship it now");
        let bold = spans.iter().find(|span| span.content == "ship").unwrap();
        assert!(bold.style.add_modifier.contains(Modifier::BOLD));
        // An unmatched marker is left as written.
        let plain: String = inline("2 * 3 = 6")
            .iter()
            .map(|s| s.content.as_ref())
            .collect();
        assert_eq!(plain, "2 * 3 = 6");
    }

    #[test]
    fn markdown_frames_code_and_marks_lists() {
        let lines = markdown("# Plan\n- one\n```rust\nlet x = 1;\n```");
        let shown: Vec<String> = lines.iter().map(text).collect();
        assert_eq!(shown[0], "Plan");
        assert!(shown[1].contains("• one"));
        assert!(shown[2].contains("rust"));
        assert!(shown[3].ends_with("let x = 1;"));
        assert_eq!(lines.len(), 5);
    }
}
