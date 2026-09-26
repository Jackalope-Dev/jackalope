//! The interactive conversation.
//!
//! Several threads feed one loop: keystrokes and the mouse, change
//! notifications from the host (on their own connection, since a watch
//! blocks), the agent overview (also its own connection, since probing sign-in
//! can take seconds), `!command` output, and the loop itself, which re-reads
//! the conversation whenever the host says work moved. Nothing the user types
//! waits on an agent: messages queue behind running work.

use crate::protocol::{
    AgentStatus, Client, Handshake, Project, Question, Request, Response, SessionSummary,
    SessionView,
};
use crate::shell::{self, Update};
use crate::ColdStart;
use crate::{brand, clipboard, files, history};
use crossterm::event::{
    self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
    Event as TermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, KeyboardEnhancementFlags,
    MouseButton, MouseEvent, MouseEventKind, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use crossterm::terminal::SetTitle;
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;
use std::cell::Cell;
use std::collections::HashSet;
use std::io::Write;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};
use unicode_width::UnicodeWidthChar;

enum Event {
    Key(KeyEvent),
    /// Mouse wheel: positive scrolls back through the conversation.
    Scroll(i16),
    /// A press, drag or release of the left button, for selecting text.
    Select(MouseEvent),
    Paste(String),
    Shell(Update),
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
    (
        "new",
        "start a fresh conversation, optionally with a message",
    ),
    ("bg", "start another conversation and stay on this one"),
    ("sessions", "switch to any open conversation"),
    ("projects", "switch to another project"),
    ("agents", "see which agents are ready"),
    ("settings", "change how Jackalope behaves"),
    ("status", "show the project, host and agents"),
    ("agent", "choose the agent for your next conversation"),
    (
        "learn",
        "save learnings from this session to project context",
    ),
    ("diff", "review and commit this work in the app"),
    ("stop", "stop the work that is running"),
    ("retry", "run the last message again"),
    ("finish", "mark this conversation done"),
    ("pause", "hold queued messages"),
    ("resume", "send held messages"),
    ("copy", "copy the latest reply"),
    ("history", "search what you have typed before"),
    ("kill", "stop running ! commands"),
    ("clear", "clear notes and finished ! output"),
    ("open", "show Jackalope's app window"),
    ("help", "show these commands"),
    ("quit", "leave (work keeps running)"),
];

const TIPS: &[&str] = &[
    "Run `/learn` to extract session history into reusable project context.",
    "Type `/` to search all commands with arrow navigation and tab completion.",
    "Run `/diff` to inspect changed files and review patches in the desktop app.",
    "Use `/agent` to choose which AI coding agent handles your next conversation.",
    "Switch between active conversations in this repository with `/sessions`.",
    "Start a fresh conversation anytime with `/new`.",
    "Press `Shift+Enter`, `Alt+Enter` or `Ctrl+J` to insert a newline without submitting.",
    "Use `/stop` to halt running agent execution immediately.",
    "Run `/retry` to re-execute the last message after an interruption or failure.",
    "Open the full Jackalope desktop workspace anytime with `/open`.",
    "Learned lessons from `/learn` are automatically applied to future relevant tasks.",
    "Scroll conversation history with mouse wheel or `Page Up` / `Page Down`.",
    "Use `/status` to inspect the host, connected agents, and current branch.",
    "Manage Git commit attribution and host settings with `/settings`.",
    "Clear notes and finished command output anytime with `Ctrl+L`.",
    "Start a line with `!` to run a shell command in this conversation's workspace.",
    "Drag across any text to copy it. `/copy` copies the latest reply.",
    "Keep typing while an agent works: messages queue and run in order.",
    "`/bg fix the flaky test` starts a parallel conversation without leaving this one.",
    "`Ctrl+N` and `Ctrl+P` step through open conversations.",
    "`Ctrl+C` clears the input, then stops running `!` commands, then leaves.",
    "Type `@` to mention a file; matching is fuzzy and `Tab` inserts it.",
    "`Ctrl+R` searches everything you have typed, across sessions.",
    "Press `Esc` twice to stop the agent. `Esc` alone clears the draft; `Ctrl+Y` restores it.",
    "End a line with `\\` or press `Shift+Enter` for a new line.",
    "`jackalope -p \"message\"` runs once and prints the reply, for scripts and CI.",
    "`Ctrl+Z` suspends to your shell; `fg` brings Jackalope back.",
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
    /// Put an earlier input back in the composer.
    Recall(String),
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
    History,
}

struct Picker {
    kind: PickerKind,
    title: String,
    items: Vec<Item>,
    /// Typed to narrow the rows, matched fuzzily against label and detail.
    filter: String,
    /// An index into `shown()`.
    selected: usize,
}

impl Picker {
    /// Indexes of the rows matching the filter, best match first; every row,
    /// in order, when there is no filter.
    fn shown(&self) -> Vec<usize> {
        if self.filter.is_empty() {
            return (0..self.items.len()).collect();
        }
        let mut scored: Vec<(i64, usize)> = self
            .items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                let label = files::score(&item.label, &self.filter);
                let detail = files::score(&item.detail, &self.filter).map(|score| score - 1000);
                label.max(detail).map(|score| (score, index))
            })
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        scored.into_iter().map(|(_, index)| index).collect()
    }

    fn chosen(&self) -> Option<&Item> {
        self.shown()
            .get(self.selected)
            .map(|index| &self.items[*index])
    }

    fn step(&mut self, down: bool) {
        let last = self.shown().len().saturating_sub(1);
        self.selected = if down {
            (self.selected + 1).min(last)
        } else {
            self.selected.saturating_sub(1)
        };
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Tone {
    Muted,
    Success,
    Warning,
    Danger,
}

impl Tone {
    fn color(self) -> Color {
        match self {
            Tone::Muted => brand::muted(),
            Tone::Success => brand::success(),
            Tone::Warning => brand::warning(),
            Tone::Danger => brand::danger(),
        }
    }
}

/// The state the window title and bell announce.
#[derive(Clone, PartialEq, Debug)]
enum Signal {
    Idle,
    Working,
    NeedsYou,
}

/// What Jackalope itself adds below the conversation, oldest first.
enum Entry {
    Note(String, Tone),
    /// An index into `App::shells`.
    Shell(usize),
}

/// A drag across the screen, in screen cells, from where it started to
/// where the pointer is now.
#[derive(Clone, Copy, PartialEq, Debug)]
struct Selection {
    anchor: (u16, u16),
    head: (u16, u16),
}

impl Selection {
    /// Start and end in reading order, as (column, row).
    fn ordered(&self) -> ((u16, u16), (u16, u16)) {
        let key = |(column, row): (u16, u16)| (row, column);
        if key(self.anchor) <= key(self.head) {
            (self.anchor, self.head)
        } else {
            (self.head, self.anchor)
        }
    }

    fn contains(&self, column: u16, row: u16) -> bool {
        let ((start_column, start_row), (end_column, end_row)) = self.ordered();
        (start_row..=end_row).contains(&row)
            && (row != start_row || column >= start_column)
            && (row != end_row || column <= end_column)
    }
}

struct App {
    client: Client,
    /// For threads the loop starts later, such as `!` commands.
    events: Sender<Event>,
    handshake: Handshake,
    project: Project,
    branch: Option<String>,
    session: Option<String>,
    view: Option<SessionView>,
    /// Open conversations across the workspace, newest first.
    sessions: Vec<SessionSummary>,
    projects: Vec<Project>,
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
    /// Text removed by Ctrl+K, Ctrl+U or Ctrl+W, for Ctrl+Y.
    kill_buffer: String,
    /// The workspace's files for `@` mentions, and the directory they came from.
    files: Option<(String, Vec<String>)>,
    /// Esc closed the `@` menu; it reopens once the mention changes.
    mention_closed: bool,
    /// Esc was pressed once while work ran; a second press stops it.
    stop_armed: Option<Instant>,
    /// Ctrl+Z asked to hand the terminal back to the shell.
    suspend: bool,
    /// What the window title and bell last reflected.
    signalled: Option<Signal>,
    /// Jackalope's own lines — help, errors, confirmations and `!` output —
    /// shown under the conversation and never sent to an agent.
    feed: Vec<Entry>,
    shells: Vec<shell::Run>,
    /// A short confirmation in the status line, such as "Copied".
    flash: Option<(String, Tone, Instant)>,
    /// When the current run was first seen working, for its elapsed time.
    work_started: Option<(String, Instant)>,
    selection: Option<Selection>,
    /// The last drawn screen, which selections copy from.
    screen: Option<Buffer>,
    /// Where the transcript and input were drawn, measured while drawing.
    body_area: Cell<Rect>,
    input_width: Cell<u16>,
    /// Lines scrolled up from the bottom of the transcript.
    scroll_back: u16,
    /// Animation frame for the working indicator.
    tick: usize,
    /// Currently displayed rotating tip.
    tip_index: usize,
    last_tip_change: Instant,
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
    spawn_ticker(events.clone());

    let mut app = App {
        client,
        events,
        branch: branch(&project.path),
        handshake,
        project,
        session,
        view: None,
        sessions: Vec::new(),
        projects: Vec::new(),
        overview: None,
        attribution: None,
        picker: None,
        slash: 0,
        input: String::new(),
        cursor: 0,
        next_agent: None,
        offered: HashSet::new(),
        max_scroll: Cell::new(0),
        history: history::load(),
        history_index: None,
        kill_buffer: String::new(),
        files: None,
        mention_closed: false,
        stop_armed: None,
        suspend: false,
        signalled: None,
        feed: Vec::new(),
        shells: Vec::new(),
        flash: None,
        work_started: None,
        selection: None,
        screen: None,
        body_area: Cell::new(Rect::default()),
        input_width: Cell::new(1),
        scroll_back: 0,
        tick: 0,
        tip_index: 0,
        last_tip_change: Instant::now(),
        quit: false,
    };
    app.refresh();

    let mut terminal = ratatui::init();
    let enhanced = enter_modes();
    let result = event_loop(&mut terminal, &mut app, &inbox, enhanced);
    // `!` commands belong to this terminal, unlike agent work.
    for run in app.shells.iter().filter(|run| run.running()) {
        run.interrupt();
    }
    leave_modes(enhanced);
    let _ = crossterm::execute!(std::io::stdout(), SetTitle(""));
    ratatui::restore();
    if let Some(id) = &app.session {
        // Leaving is not stopping: the work belongs to the host.
        println!("Conversation continues in Jackalope. Rejoin with: jackalope attach {id}");
    }
    result
}

/// Turns on what the interface relies on beyond raw mode, returning whether
/// the terminal reports modified keys (so Shift+Enter is distinguishable).
///
/// Without mouse capture the wheel scrolls the terminal's own scrollback,
/// which from the alternate screen shows empty space above the interface.
/// Captured, it scrolls the conversation instead, and dragging selects and
/// copies through the interface. Option (macOS) or Shift held while dragging
/// still reaches the terminal's own selection.
fn enter_modes() -> bool {
    let mut stdout = std::io::stdout();
    let _ = crossterm::execute!(stdout, EnableMouseCapture, EnableBracketedPaste);
    // Windows consoles report modifiers natively and reject the escape.
    let enhanced =
        cfg!(not(windows)) && crossterm::terminal::supports_keyboard_enhancement().unwrap_or(false);
    if enhanced {
        let _ = crossterm::execute!(
            stdout,
            PushKeyboardEnhancementFlags(KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES)
        );
    }
    enhanced
}

fn leave_modes(enhanced: bool) {
    let mut stdout = std::io::stdout();
    if enhanced {
        let _ = crossterm::execute!(stdout, PopKeyboardEnhancementFlags);
    }
    let _ = crossterm::execute!(stdout, DisableBracketedPaste, DisableMouseCapture);
}

/// Ctrl+Z: restores the terminal, stops this process as a shell's job, and
/// takes the screen back when `fg` continues it.
#[cfg(unix)]
fn suspend(terminal: &mut ratatui::DefaultTerminal, enhanced: bool) -> Result<(), String> {
    leave_modes(enhanced);
    ratatui::restore();
    let _ = std::process::Command::new("kill")
        .args(["-TSTP", &std::process::id().to_string()])
        .status();
    // Execution resumes here after `fg`.
    crossterm::terminal::enable_raw_mode().map_err(|error| error.to_string())?;
    crossterm::execute!(std::io::stdout(), crossterm::terminal::EnterAlternateScreen)
        .map_err(|error| error.to_string())?;
    enter_modes();
    terminal.clear().map_err(|error| error.to_string())
}

fn event_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    inbox: &Receiver<Event>,
    enhanced: bool,
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
        #[cfg(unix)]
        if std::mem::take(&mut app.suspend) {
            suspend(terminal, enhanced)?;
        }
        // Windows has no job control; Ctrl+Z is ignored there.
        #[cfg(not(unix))]
        let _ = (enhanced, std::mem::take(&mut app.suspend));
        app.signal();
        let drawn = terminal
            .draw(|frame| draw(frame, app))
            .map_err(|error| error.to_string())?;
        app.screen = Some(drawn.buffer.clone());
        match inbox.recv() {
            Ok(Event::Key(key)) => app.key(key),
            Ok(Event::Select(mouse)) => app.select(mouse),
            Ok(Event::Shell(update)) => app.shell_update(update),
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
                let tip_changed = app.rotate_tip_if_elapsed();
                let flash_expired = app
                    .flash
                    .as_ref()
                    .is_some_and(|(_, _, at)| at.elapsed() >= FLASH);
                if flash_expired {
                    app.flash = None;
                }
                // Only moving indicators, a tip or an expiring flash need a redraw.
                if !app.animating() && !tip_changed && !flash_expired {
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
                MouseEventKind::Down(MouseButton::Left)
                | MouseEventKind::Drag(MouseButton::Left)
                | MouseEventKind::Up(MouseButton::Left) => events.send(Event::Select(mouse)),
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

/// How long a status-line confirmation stays.
const FLASH: Duration = Duration::from_millis(2500);

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
    fn note(&mut self, text: impl Into<String>) {
        self.feed.push(Entry::Note(text.into(), Tone::Muted));
    }

    fn note_tone(&mut self, text: impl Into<String>, tone: Tone) {
        self.feed.push(Entry::Note(text.into(), tone));
    }

    fn flash(&mut self, text: impl Into<String>, tone: Tone) {
        self.flash = Some((text.into(), tone, Instant::now()));
    }

    /// Clears notes and finished command output; running commands stay.
    fn clear_feed(&mut self) {
        let shells = &self.shells;
        self.feed
            .retain(|entry| matches!(entry, Entry::Shell(run) if shells[*run].running()));
    }

    fn shells_running(&self) -> usize {
        self.shells.iter().filter(|run| run.running()).count()
    }

    /// Whether anything on screen moves: agent work or a running command.
    fn animating(&self) -> bool {
        self.working() || self.shells_running() > 0
    }

    /// Where `!` commands run: the conversation's own worktree when it has
    /// one, so they see what the agent sees.
    fn workspace(&self) -> String {
        self.view
            .as_ref()
            .and_then(|view| view.workspace.clone())
            .filter(|path| !path.is_empty() && std::path::Path::new(path).is_dir())
            .unwrap_or_else(|| self.project.path.clone())
    }

    fn run_shell(&mut self, command: &str) {
        let index = self.shells.len();
        let events = self.events.clone();
        let run = shell::start(index, command, &self.workspace(), move |update| {
            let _ = events.send(Event::Shell(update));
        });
        self.shells.push(run);
        self.feed.push(Entry::Shell(index));
    }

    fn shell_update(&mut self, update: Update) {
        match update {
            Update::Line { run, text, error } => {
                if let Some(run) = self.shells.get_mut(run) {
                    run.push(text, error);
                }
            }
            Update::Exit { run, outcome } => {
                if let Some(run) = self.shells.get_mut(run) {
                    let tone = match &outcome {
                        Ok(0) => Tone::Success,
                        _ => Tone::Danger,
                    };
                    let summary = match &outcome {
                        Ok(0) => format!("{} finished", run.command),
                        Ok(code) => format!("{} exited {code}", run.command),
                        Err(error) => error.clone(),
                    };
                    run.finished = Some((outcome, run.started.elapsed()));
                    self.flash(summary, tone);
                }
            }
        }
    }

    /// Stops every running `!` command; returns how many were asked to stop.
    fn interrupt_shells(&mut self) -> usize {
        let running: Vec<_> = self.shells.iter().filter(|run| run.running()).collect();
        for run in &running {
            run.interrupt();
        }
        running.len()
    }

    fn copy(&mut self, text: &str) {
        match clipboard::copy(text) {
            Ok(()) => {
                let lines = text.lines().count().max(1);
                self.flash(
                    format!(
                        "Copied {lines} {}",
                        if lines == 1 { "line" } else { "lines" }
                    ),
                    Tone::Success,
                );
            }
            Err(error) => self.flash(error, Tone::Danger),
        }
    }

    /// Selection by dragging, the way a terminal would, then copying on release.
    fn select(&mut self, mouse: MouseEvent) {
        if self.picker.is_some() {
            return;
        }
        let at = (mouse.column, mouse.row);
        match mouse.kind {
            MouseEventKind::Down(_) => {
                self.selection = Some(Selection {
                    anchor: at,
                    head: at,
                })
            }
            MouseEventKind::Drag(_) => {
                if let Some(selection) = self.selection.as_mut() {
                    selection.head = at;
                }
            }
            MouseEventKind::Up(_) => {
                let Some(selection) = self.selection.as_mut() else {
                    return;
                };
                selection.head = at;
                let selection = *selection;
                if selection.anchor == selection.head {
                    // A click, not a drag.
                    self.selection = None;
                    return;
                }
                let text = self
                    .screen
                    .as_ref()
                    .map(|screen| selected_text(screen, &selection))
                    .unwrap_or_default();
                if !text.trim().is_empty() {
                    self.copy(&text);
                }
            }
            _ => {}
        }
    }

    /// Moves to the next (`1`) or previous (`-1`) open conversation, across
    /// projects, in the order `/sessions` lists them.
    fn step_session(&mut self, direction: isize) {
        let order = self.session_order();
        if order.is_empty() {
            self.flash("No open conversations", Tone::Muted);
            return;
        }
        let current = self
            .session
            .as_ref()
            .and_then(|id| order.iter().position(|candidate| candidate == id));
        let next = match current {
            Some(index) => (index as isize + direction).rem_euclid(order.len() as isize) as usize,
            None if direction > 0 => 0,
            None => order.len() - 1,
        };
        self.open_session(order[next].clone());
        if let Some(view) = &self.view {
            let title = view.title.clone();
            self.flash(
                format!("{}/{} · {title}", next + 1, order.len()),
                Tone::Muted,
            );
        }
    }

    /// This project's conversations first, then the rest, each newest first.
    fn session_order(&self) -> Vec<String> {
        let (here, elsewhere): (Vec<_>, Vec<_>) = self
            .sessions
            .iter()
            .partition(|session| session.project_id == self.project.id);
        here.into_iter()
            .chain(elsewhere)
            .map(|session| session.id.clone())
            .collect()
    }

    fn open_session(&mut self, id: String) {
        self.session = Some(id);
        self.view = None;
        self.scroll_back = 0;
        self.selection = None;
        self.refresh();
    }

    fn project_name(&self, id: &str) -> String {
        self.projects
            .iter()
            .find(|project| project.id == id)
            .map(|project| project.name.clone())
            .unwrap_or_else(|| "another project".into())
    }

    /// How long the current run has been working, as the terminal saw it.
    fn elapsed(&self) -> Option<Duration> {
        let run = self.view.as_ref()?.run_id.as_ref()?;
        self.work_started
            .as_ref()
            .filter(|(started, _)| started == run && self.working())
            .map(|(_, at)| at.elapsed())
    }

    /// Keeps the window title on the conversation's state and rings the
    /// bell when work finishes or needs an answer, so a terminal in the
    /// background still says when to come back. `JACKALOPE_BELL=0` silences it.
    fn signal(&mut self) {
        let Some(view) = &self.view else {
            if self.signalled.take().is_some() {
                let _ = crossterm::execute!(std::io::stdout(), SetTitle("jackalope"));
            }
            return;
        };
        let (_, tone) = work_state(self, view);
        let signal = if self.working() {
            Signal::Working
        } else if matches!(tone, Tone::Danger | Tone::Warning) {
            Signal::NeedsYou
        } else {
            Signal::Idle
        };
        if self.signalled.as_ref() == Some(&signal) {
            return;
        }
        let previous = self.signalled.replace(signal.clone());
        let title: String = view.title.chars().take(40).collect();
        let mark = match signal {
            Signal::Working => "…",
            Signal::NeedsYou => "!",
            Signal::Idle => "✓",
        };
        let mut stdout = std::io::stdout();
        let _ = crossterm::execute!(stdout, SetTitle(format!("{mark} {title} · jackalope")));
        let finished = previous == Some(Signal::Working) && signal != Signal::Working;
        let bell = std::env::var("JACKALOPE_BELL").map_or(true, |value| value != "0");
        if bell && (finished || (previous.is_some() && signal == Signal::NeedsYou)) {
            let _ = stdout.write_all(b"\x07");
            let _ = stdout.flush();
        }
    }

    /// Whether an agent is working, so the status line animates.
    fn working(&self) -> bool {
        self.view.as_ref().is_some_and(|view| {
            view.error
                .as_deref()
                .filter(|e| !e.trim().is_empty() && *e != "null")
                .is_none()
                && view.questions.is_empty()
                && matches!(
                    view.status.as_deref(),
                    Some("starting" | "running" | "routing" | "queued" | "stopping")
                )
        })
    }

    /// Rotates to the next tip every 8 seconds, returning true when changed.
    fn rotate_tip_if_elapsed(&mut self) -> bool {
        if self.last_tip_change.elapsed() >= Duration::from_secs(8) {
            self.tip_index = (self.tip_index + 1) % TIPS.len();
            self.last_tip_change = Instant::now();
            true
        } else {
            false
        }
    }

    fn scroll(&mut self, lines: i16) {
        if let Some(picker) = self.picker.as_mut() {
            picker.step(lines < 0);
            return;
        }
        // A selection marks screen cells, which no longer hold the same text.
        self.selection = None;
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
                self.note(message);
                None
            }
            Ok(response) => Some(response),
            Err(error) => {
                self.note(format!("Lost contact with Jackalope: {error}"));
                None
            }
        }
    }

    fn refresh(&mut self) {
        if let Some(Response::Sessions { sessions }) = self.request(Request::Sessions) {
            self.sessions = sessions;
        }
        if let Some(Response::Projects { projects }) = self.request(Request::Projects) {
            self.projects = projects.clone();
            let project_id = self
                .session
                .as_ref()
                .and_then(|id| self.sessions.iter().find(|session| &session.id == id))
                .map(|session| session.project_id.as_str())
                .unwrap_or(&self.project.id);
            if let Some(project) = projects
                .into_iter()
                .find(|project| project.id == project_id)
            {
                if project.path != self.project.path {
                    self.branch = branch(&project.path);
                }
                brand::set_accent(project.accent.as_deref());
                self.project = project;
            }
        }
        let Some(id) = self.session.clone() else {
            return;
        };
        if let Some(Response::Session { session, .. }) =
            self.request(Request::SessionDetail { session_id: id })
        {
            self.view = Some(*session);
        }
        let run = self
            .view
            .as_ref()
            .and_then(|view| view.run_id.clone())
            .filter(|_| self.working());
        match run {
            Some(run)
                if self
                    .work_started
                    .as_ref()
                    .is_none_or(|(seen, _)| *seen != run) =>
            {
                self.work_started = Some((run, Instant::now()));
            }
            Some(_) => {}
            None => self.work_started = None,
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
            self.flash("Answered", Tone::Success);
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
        self.selection = None;
        if key.code == KeyCode::Char('c') && control {
            // Clear what is typed, then stop commands, then leave: one key
            // never throws away more than the step before it.
            if self.picker.is_some() {
                self.picker = None;
            } else if !self.input.is_empty() {
                self.set_input(String::new());
                self.history_index = None;
            } else if self.interrupt_shells() > 0 {
                self.flash("Stopping commands · Ctrl+C again to leave", Tone::Warning);
            } else {
                self.quit = true;
            }
            return;
        }
        if key.code == KeyCode::Char('d') && control && self.input.is_empty() {
            self.quit = true;
            return;
        }
        if self.picker.is_some() {
            self.picker_key(key);
            return;
        }
        let matches = slash_matches(&self.input);
        let mentions = self.mention_matches();
        let alt = key.modifiers.contains(KeyModifiers::ALT);
        let shift = key.modifiers.contains(KeyModifiers::SHIFT);
        if key.code != KeyCode::Esc {
            self.stop_armed = None;
        }
        match key.code {
            KeyCode::Char('l') if control => self.clear_feed(),
            KeyCode::Char('r') if control => self.open_picker(PickerKind::History),
            KeyCode::Char('z') if control => self.suspend = cfg!(unix),
            // Newline without sending: Shift+Enter where the terminal reports
            // it, Alt+Enter, Ctrl+J, or a trailing backslash, which works in
            // every terminal (Windows Terminal takes Alt+Enter for full screen).
            KeyCode::Enter if alt || shift => self.insert("\n"),
            KeyCode::Char('j') if control => self.insert("\n"),
            KeyCode::Enter
                if self.cursor > 0 && self.input.chars().nth(self.cursor - 1) == Some('\\') =>
            {
                self.delete_to(self.cursor - 1);
                self.insert("\n");
            }
            KeyCode::Enter | KeyCode::Tab if !mentions.is_empty() => {
                let path = mentions[self.slash.min(mentions.len() - 1)].clone();
                self.complete_mention(&path);
            }
            KeyCode::Up if !mentions.is_empty() => self.slash = self.slash.saturating_sub(1),
            KeyCode::Down if !mentions.is_empty() => {
                self.slash = (self.slash + 1).min(mentions.len() - 1)
            }
            KeyCode::Esc if !mentions.is_empty() => self.mention_closed = true,
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
            KeyCode::Esc if self.scroll_back > 0 && self.input.is_empty() => self.scroll_back = 0,
            // Esc twice stops the agent, so a stray press never does.
            KeyCode::Esc if self.input.is_empty() && self.working() => {
                if self
                    .stop_armed
                    .is_some_and(|armed| armed.elapsed() < Duration::from_secs(2))
                {
                    self.stop_armed = None;
                    self.command("stop");
                } else {
                    self.stop_armed = Some(Instant::now());
                    self.flash("Esc again to stop the agent", Tone::Warning);
                }
            }
            KeyCode::Esc => {
                // Clearing is undoable: Ctrl+Y brings the draft back.
                if !self.input.is_empty() {
                    self.kill_buffer = std::mem::take(&mut self.input);
                    self.cursor = 0;
                }
                self.slash = 0;
            }
            KeyCode::Up if !matches.is_empty() => self.slash = self.slash.saturating_sub(1),
            KeyCode::Down if !matches.is_empty() => {
                self.slash = (self.slash + 1).min(matches.len() - 1)
            }
            // Within a wrapped or multi-line draft, move between rows; at its
            // edges, step through history.
            KeyCode::Up => {
                if !self.move_row(-1) {
                    self.recall(true)
                }
            }
            KeyCode::Down => {
                if !self.move_row(1) {
                    self.recall(false)
                }
            }
            KeyCode::Char('n') if control => self.step_session(1),
            KeyCode::Char('p') if control => self.step_session(-1),
            KeyCode::PageUp => self.scroll(10),
            KeyCode::PageDown => self.scroll(-10),
            // Editing, with the shortcuts shells and editors share.
            KeyCode::Left if alt || control => self.cursor = self.word_start(),
            KeyCode::Right if alt || control => self.cursor = self.word_end(),
            KeyCode::Char('b') if alt => self.cursor = self.word_start(),
            KeyCode::Char('f') if alt => self.cursor = self.word_end(),
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(self.input_len()),
            KeyCode::Home if control => self.cursor = 0,
            KeyCode::End if control => self.cursor = self.input_len(),
            KeyCode::Home => self.cursor = self.line_start(),
            KeyCode::End => self.cursor = self.line_end(),
            KeyCode::Char('a') if control => self.cursor = self.line_start(),
            KeyCode::Char('e') if control => self.cursor = self.line_end(),
            KeyCode::Char('b') if control => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Char('f') if control => self.cursor = (self.cursor + 1).min(self.input_len()),
            KeyCode::Char('w') if control => self.kill_to(self.word_start()),
            KeyCode::Backspace if alt || control => self.kill_to(self.word_start()),
            KeyCode::Char('d') if alt => self.kill_to(self.word_end()),
            KeyCode::Delete if alt || control => self.kill_to(self.word_end()),
            // Ctrl+U clears to the start of the line, as shells do.
            KeyCode::Char('u') if control => self.kill_to(self.line_start()),
            KeyCode::Char('k') if control => self.kill_to(self.line_end()),
            KeyCode::Char('y') if control => {
                let text = self.kill_buffer.clone();
                self.insert(&text);
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
                self.mention_closed = false;
            }
            _ => {}
        }
        self.index_files_for_mention();
    }

    /// Removes from the cursor to `other` and keeps it for Ctrl+Y.
    fn kill_to(&mut self, other: usize) {
        let (from, to) = (other.min(self.cursor), other.max(self.cursor));
        let removed: String = self.input.chars().skip(from).take(to - from).collect();
        if !removed.is_empty() {
            self.kill_buffer = removed;
        }
        self.cursor = to;
        self.delete_to(from);
    }

    /// Start of the logical line the cursor is on.
    fn line_start(&self) -> usize {
        let before: Vec<char> = self.input.chars().take(self.cursor).collect();
        before
            .iter()
            .rposition(|character| *character == '\n')
            .map_or(0, |at| at + 1)
    }

    fn line_end(&self) -> usize {
        self.input
            .chars()
            .skip(self.cursor)
            .position(|character| character == '\n')
            .map_or(self.input_len(), |offset| self.cursor + offset)
    }

    /// Workspace files matching the `@` mention at the cursor.
    fn mention_matches(&self) -> Vec<String> {
        if self.mention_closed || self.input.starts_with('/') || self.input.starts_with('!') {
            return Vec::new();
        }
        let Some((_, query)) = files::mention_at(&self.input, self.cursor) else {
            return Vec::new();
        };
        match &self.files {
            Some((_, files)) => files::matches(files, &query, 8)
                .into_iter()
                .map(String::from)
                .collect(),
            None => Vec::new(),
        }
    }

    /// Lists the workspace's files the first time a mention starts there.
    fn index_files_for_mention(&mut self) {
        if files::mention_at(&self.input, self.cursor).is_none() {
            return;
        }
        let workspace = self.workspace();
        if self
            .files
            .as_ref()
            .is_none_or(|(directory, _)| *directory != workspace)
        {
            let listed = files::list(&workspace);
            self.files = Some((workspace, listed));
        }
    }

    /// Replaces the mention at the cursor with `@path `.
    fn complete_mention(&mut self, path: &str) {
        let Some((start, _)) = files::mention_at(&self.input, self.cursor) else {
            return;
        };
        self.delete_to(start);
        // Paths with spaces are quoted so the agent reads them whole.
        if path.contains(' ') {
            self.insert(&format!("@\"{path}\" "));
        } else {
            self.insert(&format!("@{path} "));
        }
        self.slash = 0;
    }

    /// Moves the cursor one visual row up or down, keeping its column where
    /// the row is long enough. False at the first or last row.
    fn move_row(&mut self, direction: i32) -> bool {
        let layout = InputLayout::new(&self.input, self.input_width.get());
        let (row, column) = layout.positions[self.cursor];
        let target = row as i32 + direction;
        if target < 0 || target as usize >= layout.rows.len() {
            return false;
        }
        let target = target as usize;
        // The last position on the target row at or before the column.
        self.cursor = layout
            .positions
            .iter()
            .enumerate()
            .filter(|(_, (candidate, at))| *candidate == target && *at <= column)
            .map(|(index, _)| index)
            .next_back()
            .or_else(|| {
                layout
                    .positions
                    .iter()
                    .position(|(candidate, _)| *candidate == target)
            })
            .unwrap_or(self.cursor);
        true
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
        let control = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            // Esc clears a filter before it closes the list.
            KeyCode::Esc if !picker.filter.is_empty() => {
                picker.filter.clear();
                picker.selected = 0;
            }
            KeyCode::Esc => self.picker = None,
            KeyCode::Up => picker.step(false),
            KeyCode::Down | KeyCode::Tab => picker.step(true),
            KeyCode::Char('p') if control => picker.step(false),
            KeyCode::Char('n') if control => picker.step(true),
            // Ctrl+R again steps to the next older match, as in a shell.
            KeyCode::Char('r') if control => picker.step(true),
            KeyCode::PageUp => (0..10).for_each(|_| picker.step(false)),
            KeyCode::PageDown => (0..10).for_each(|_| picker.step(true)),
            KeyCode::Enter => {
                if let Some(action) = picker.chosen().map(|item| item.action.clone()) {
                    self.choose(action);
                }
            }
            KeyCode::Backspace => {
                picker.filter.pop();
                picker.selected = 0;
            }
            KeyCode::Char('u') if control => {
                picker.filter.clear();
                picker.selected = 0;
            }
            KeyCode::Char(character) if !control => {
                picker.filter.push(character);
                picker.selected = 0;
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
                self.open_session(id);
            }
            Action::Project(project) => {
                self.picker = None;
                self.branch = branch(&project.path);
                brand::set_accent(project.accent.as_deref());
                self.note(format!(
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
                    self.note(format!("{}: {}", agent.name, agent.detail));
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
                self.note(if self.session.is_some() {
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
                self.note("Type your answer and press Enter.");
            }
            Action::Recall(entry) => {
                self.picker = None;
                self.set_input(entry);
                self.history_index = None;
            }
            Action::OpenApp => {
                self.picker = None;
                if self.request(Request::ShowWindow).is_some() {
                    self.flash("Opened Jackalope", Tone::Muted);
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
        let (selected, filter) = self
            .picker
            .as_ref()
            .filter(|picker| picker.kind == kind)
            .map(|picker| (picker.selected, picker.filter.clone()))
            .unwrap_or_default();
        let (title, items) = match kind {
            PickerKind::Sessions => {
                self.refresh();
                let mut items = vec![Item {
                    label: "+ New conversation".into(),
                    detail: String::new(),
                    action: Action::NewConversation,
                }];
                let order = self.session_order();
                let sessions: Vec<&SessionSummary> = order
                    .iter()
                    .filter_map(|id| self.sessions.iter().find(|session| &session.id == id))
                    .collect();
                items.extend(sessions.into_iter().map(|session| {
                    let project = if session.project_id == self.project.id {
                        String::new()
                    } else {
                        format!("{} · ", self.project_name(&session.project_id))
                    };
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
                        detail: format!(
                            "{project}{state}{queued} · {}",
                            session.id.get(..8).unwrap_or(&session.id)
                        ),
                        action: Action::Session(session.id.clone()),
                    }
                }));
                ("Conversations · Ctrl+N/P to step".to_string(), items)
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
            PickerKind::History => {
                // Newest first, matching the draft when there is one.
                let items = self
                    .history
                    .iter()
                    .rev()
                    .map(|entry| Item {
                        label: entry.replace('\n', " ⏎ "),
                        detail: String::new(),
                        action: Action::Recall(entry.clone()),
                    })
                    .collect();
                ("History · type to search".to_string(), items)
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
        let mut picker = Picker {
            kind,
            title,
            items,
            filter,
            selected: 0,
        };
        picker.selected = selected.min(picker.shown().len().saturating_sub(1));
        self.picker = Some(picker);
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
        history::remember(&mut self.history, &text);
        history::append(&text);
        self.mention_closed = false;
        if let Some(command) = text.strip_prefix('!') {
            let command = command.trim();
            if command.is_empty() {
                self.flash("Type a command after !", Tone::Warning);
            } else {
                self.run_shell(command);
            }
            return;
        }
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
                let busy = self.working();
                if self
                    .request(Request::Send {
                        session_id: id,
                        text,
                    })
                    .is_some()
                {
                    if busy {
                        self.flash("Queued · runs after the current work", Tone::Muted);
                    } else if self.view.as_ref().is_some_and(|view| view.paused) {
                        self.flash("Held · /resume to send", Tone::Warning);
                    }
                }
            }
            None => {
                if let Some(session_id) = self.start_conversation(text) {
                    self.session = Some(session_id);
                }
            }
        }
        self.refresh();
    }

    fn start_conversation(&mut self, text: String) -> Option<String> {
        match self.request(Request::StartSession {
            project_path: self.project.path.clone(),
            text,
            agent: self.next_agent.clone(),
        }) {
            Some(Response::Started { session_id }) => Some(session_id),
            _ => None,
        }
    }

    fn command(&mut self, line: &str) {
        let session = self.session.clone();
        let run = self.view.as_ref().and_then(|view| view.run_id.clone());
        let (command, argument) = line
            .split_once(char::is_whitespace)
            .map(|(command, argument)| (command, argument.trim()))
            .unwrap_or((line, ""));
        match command {
            "new" if !argument.is_empty() => {
                if let Some(id) = self.start_conversation(argument.into()) {
                    self.open_session(id);
                }
            }
            "bg" if argument.is_empty() => {
                self.note("Add the message: /bg <what to do>");
            }
            "bg" => {
                if let Some(id) = self.start_conversation(argument.into()) {
                    self.note_tone(
                        format!(
                            "Started in the background · {} · Ctrl+N to visit",
                            id.get(..8).unwrap_or(&id)
                        ),
                        Tone::Success,
                    );
                }
            }
            "copy" => {
                let reply = self.view.as_ref().and_then(|view| {
                    view.messages
                        .iter()
                        .rev()
                        .find(|message| message.role == "agent")
                        .map(|message| message.text.clone())
                        .or_else(|| {
                            Some(view.result.clone()).filter(|text| !text.trim().is_empty())
                        })
                });
                match reply {
                    Some(reply) => self.copy(&reply),
                    None => self.flash("No reply to copy yet", Tone::Muted),
                }
            }
            "kill" => {
                if self.interrupt_shells() == 0 {
                    self.flash("No commands running", Tone::Muted);
                }
            }
            "clear" => self.clear_feed(),
            "help" | "?" => {
                for (name, about) in COMMANDS {
                    self.note(format!("/{name:<10}{about}"));
                }
                self.note(format!(
                    "{:<11}run a shell command in this workspace",
                    "!<command>"
                ));
                self.note(format!("{:<11}mention a file (Tab inserts)", "@<file>"));
                for keys in [
                    "Enter send · Shift+Enter, \\ Enter, Alt+Enter or Ctrl+J new line",
                    "Esc clear draft (Ctrl+Y restores) · Esc Esc stop the agent",
                    "Up/Down rows, then history · Ctrl+R search history",
                    "Ctrl+N/P switch conversations · PgUp/PgDn scroll · drag to copy",
                    "Ctrl+A/E line start/end · Ctrl+W, Alt+Backspace delete word",
                    "Ctrl+U/K delete to line start/end · Ctrl+Y paste deleted text",
                    "Ctrl+L clear notes · Ctrl+Z suspend · Ctrl+C clear, stop commands, leave",
                ] {
                    self.note(format!("  {keys}"));
                }
            }
            "quit" | "exit" | "q" => self.quit = true,
            "new" => {
                self.session = None;
                self.view = None;
                self.note("New conversation. Type a message to begin.");
            }
            "sessions" => self.open_picker(PickerKind::Sessions),
            "history" => self.open_picker(PickerKind::History),
            "projects" => self.open_picker(PickerKind::Projects),
            "agents" => self.open_picker(PickerKind::Agents),
            "settings" | "config" => self.open_picker(PickerKind::Settings),
            "status" => {
                self.session = None;
                self.view = None;
                self.note("Your conversation is still open; /sessions to go back.");
            }
            "agent" | "model" => self.open_picker(PickerKind::NextAgent),
            "learn" => match session {
                Some(session_id) => {
                    if let Some(Response::Learned {
                        count,
                        lessons,
                        message,
                    }) = self.request(Request::SessionLearn { session_id })
                    {
                        if count == 0 {
                            self.note(message);
                        } else {
                            self.note(format!("{message}:"));
                            for lesson in lessons {
                                self.note(format!("  • {lesson}"));
                            }
                        }
                    }
                }
                None => self.note("Start a conversation first."),
            },
            "diff" | "changes" => {
                // The conversation's own worktree when it has one.
                let path = self
                    .view
                    .as_ref()
                    .and_then(|view| view.workspace.clone())
                    .filter(|path| !path.is_empty())
                    .unwrap_or_else(|| self.project.path.clone());
                if self.request(Request::ShowChanges { path }).is_some() {
                    self.flash("Opened Changes in Jackalope", Tone::Muted);
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
                        if command == "retry" {
                            self.flash("Retrying", Tone::Muted);
                        } else {
                            self.flash("Marked done", Tone::Success);
                        }
                    }
                }
                None => self.note("Start a conversation first."),
            },
            "stop" => match run {
                Some(run_id) => {
                    if self.request(Request::Stop { run_id }).is_some() {
                        self.flash("Stopping", Tone::Warning);
                    }
                }
                None => self.flash("Nothing is running", Tone::Muted),
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
                        self.flash(format!("{}d", capitalize(command)), Tone::Muted);
                    }
                }
                None => self.note("Start a conversation first."),
            },
            "open" => {
                self.request(Request::ShowWindow);
            }
            other => self.note(format!("Unknown command /{other}. Type / to see the list.")),
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
            let warning = Style::default().fg(brand::warning());
            for question in &view.questions {
                lines.push(Line::raw(""));
                lines.push(Line::from(vec![
                    Span::styled("? ", warning.add_modifier(Modifier::BOLD)),
                    Span::styled(
                        question.question.clone(),
                        Style::default().add_modifier(Modifier::BOLD),
                    ),
                ]));
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
            if let Some(error) = &view
                .error
                .as_deref()
                .filter(|e| !e.trim().is_empty() && *e != "null")
            {
                let danger = Style::default().fg(brand::danger());
                lines.push(Line::raw(""));
                lines.push(Line::from(vec![
                    Span::styled("✕ ", danger.add_modifier(Modifier::BOLD)),
                    Span::styled(error.to_string(), danger),
                ]));
                lines.push(Line::styled(
                    "  /retry to run it again, or reply with what to change",
                    muted,
                ));
            }
            lines
        }
    };
    let mut previous_was_note = false;
    for entry in &app.feed {
        match entry {
            Entry::Note(text, tone) => {
                if !previous_was_note {
                    lines.push(Line::raw(""));
                }
                lines.push(Line::styled(
                    format!("  {text}"),
                    Style::default().fg(tone.color()),
                ));
                previous_was_note = true;
            }
            Entry::Shell(index) => {
                lines.push(Line::raw(""));
                lines.extend(shell_block(&app.shells[*index], app.tick));
                previous_was_note = false;
            }
        }
    }
    lines
}

/// Output lines shown for a finished command; a running one shows its tail as
/// it streams. `/copy` and selection reach anything still on screen.
const SHELL_TAIL: usize = 40;

fn shell_block(run: &shell::Run, tick: usize) -> Vec<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let (tone, glyph) = match &run.finished {
        None => (brand::accent(), brand::spinner(tick).to_string()),
        Some((Ok(0), _)) => (brand::success(), "$".to_string()),
        Some(_) => (brand::danger(), "$".to_string()),
    };
    let mut lines = vec![Line::from(vec![
        Span::styled(
            format!("{glyph} "),
            Style::default().fg(tone).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            run.command.clone(),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::styled(format!("  {}", short_path(&run.directory)), muted),
    ])];
    let hidden = run.dropped + run.output.len().saturating_sub(SHELL_TAIL);
    if hidden > 0 {
        lines.push(Line::styled(format!("  │ … {hidden} earlier lines"), muted));
    }
    for (text, error) in run
        .output
        .iter()
        .skip(run.output.len().saturating_sub(SHELL_TAIL))
    {
        lines.push(Line::from(vec![
            Span::styled("  │ ", muted),
            if *error {
                Span::styled(text.clone(), Style::default().fg(brand::warning()))
            } else {
                Span::raw(text.clone())
            },
        ]));
    }
    let footer = match &run.finished {
        None => format!(
            "  └ running {} · Ctrl+C or /kill to stop",
            duration(run.started.elapsed())
        ),
        Some((Ok(code), took)) => format!("  └ exit {code} · {}", duration(*took)),
        Some((Err(error), _)) => format!("  └ {error}"),
    };
    lines.push(Line::styled(
        footer,
        if run.finished.is_none() {
            muted
        } else {
            Style::default().fg(tone)
        },
    ));
    lines
}

/// `~` for the home directory, so paths fit beside the command.
fn short_path(path: &str) -> String {
    std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .filter(|home| !home.is_empty())
        .and_then(|home| path.strip_prefix(&home).map(|rest| format!("~{rest}")))
        .unwrap_or_else(|| path.to_string())
}

fn duration(elapsed: Duration) -> String {
    let seconds = elapsed.as_secs();
    if seconds < 10 {
        format!("{:.1}s", elapsed.as_secs_f32())
    } else if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m {:02}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h {:02}m", seconds / 3600, seconds % 3600 / 60)
    }
}

/// The state of the conversation's work and the tone that carries it.
fn work_state(app: &App, view: &SessionView) -> (String, Tone) {
    let failed = view
        .error
        .as_deref()
        .is_some_and(|e| !e.trim().is_empty() && e != "null");
    if failed {
        return ("needs you".into(), Tone::Danger);
    }
    if !view.questions.is_empty() {
        return ("waiting on your answer".into(), Tone::Warning);
    }
    if view.paused {
        return ("paused".into(), Tone::Warning);
    }
    let state = view
        .step
        .clone()
        .or_else(|| view.status.clone())
        .unwrap_or_else(|| "ready".into());
    let tone = if app.working() {
        Tone::Muted
    } else if matches!(
        view.status.as_deref(),
        Some("failed" | "error" | "cancelled" | "canceled" | "stopped")
    ) {
        Tone::Danger
    } else {
        Tone::Success
    };
    (state, tone)
}

fn status(app: &App) -> Line<'static> {
    let muted = Style::default().fg(brand::muted());
    let accent = Style::default().fg(brand::accent());
    let mut parts: Vec<Span> = vec![Span::raw(" ")];
    match &app.view {
        None => {
            parts.push(Span::styled(app.project.name.clone(), muted));
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
        }
        Some(view) => {
            let (state, tone) = work_state(app, view);
            if app.working() {
                parts.push(Span::styled(
                    format!("{} ", brand::spinner(app.tick)),
                    accent,
                ));
                parts.extend(brand::shimmer(&state, app.tick, accent));
            } else {
                let glyph = brand::mark_glyph(match tone {
                    Tone::Danger | Tone::Warning => brand::Mark::Attention,
                    _ => brand::Mark::Full,
                });
                let style = Style::default().fg(tone.color());
                parts.push(Span::styled(format!("{glyph} "), style));
                parts.push(Span::styled(state, style));
            }
            if let Some(elapsed) = app.elapsed() {
                parts.push(Span::styled(format!(" {}", duration(elapsed)), muted));
            }
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
            let queued = view.messages.iter().filter(|message| !message.sent).count();
            if queued > 0 {
                parts.push(Span::styled(format!(" · {queued} queued"), accent));
            }
            if let Some(attempt) = view.attempt.filter(|attempt| *attempt > 1) {
                parts.push(Span::styled(format!(" · attempt {attempt}"), muted));
            }
        }
    }
    let running = app.shells_running();
    if running > 0 {
        parts.push(Span::styled(
            format!(
                " · {running} {} running",
                if running == 1 { "command" } else { "commands" }
            ),
            accent,
        ));
    }
    if app.scroll_back > 0 {
        parts.push(Span::styled(" · scrolled back, Esc to return", muted));
    }
    if let Some((text, tone, _)) = &app.flash {
        parts.push(Span::styled("  ", muted));
        parts.push(Span::styled(
            text.clone(),
            Style::default()
                .fg(tone.color())
                .add_modifier(Modifier::BOLD),
        ));
    }
    Line::from(parts)
}

/// The lines beside the small mark while a conversation is open: where you
/// are, what this conversation is doing, everything else that is open, and
/// which agents can take work.
fn header_info(app: &App) -> Vec<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let accent = Style::default().fg(brand::accent());
    let bold = Style::default().add_modifier(Modifier::BOLD);
    let mut lines = Vec::new();

    let mut place = vec![
        Span::styled("jackalope", accent.add_modifier(Modifier::BOLD)),
        Span::styled("  ", muted),
        Span::styled(app.project.name.clone(), bold),
    ];
    let branch = app
        .view
        .as_ref()
        .and_then(|view| view.branch.clone())
        .filter(|branch| !branch.is_empty())
        .or_else(|| app.branch.clone());
    if let Some(branch) = branch {
        place.push(Span::styled(format!("  {branch}"), accent));
    }
    lines.push(Line::from(place));

    if let Some(view) = &app.view {
        let title: String = view.title.chars().take(56).collect();
        let mut spans = vec![Span::styled(title, Style::default())];
        if let Some(reason) = view.routing.as_ref().filter(|reason| !reason.is_empty()) {
            let reason: String = reason.chars().take(48).collect();
            spans.push(Span::styled(format!("  {reason}"), muted));
        }
        lines.push(Line::from(spans));
    }

    let others: Vec<&SessionSummary> = app
        .sessions
        .iter()
        .filter(|session| Some(&session.id) != app.session.as_ref())
        .collect();
    let mut activity = vec![Span::styled(
        format!(
            "{} other {}",
            others.len(),
            if others.len() == 1 {
                "conversation"
            } else {
                "conversations"
            }
        ),
        muted,
    )];
    let needs_you: Vec<&str> = others
        .iter()
        .filter(|session| session.error.is_some())
        .map(|session| session.title.as_str())
        .collect();
    if !needs_you.is_empty() {
        let first: String = needs_you[0].chars().take(28).collect();
        let more = if needs_you.len() > 1 {
            format!(" +{}", needs_you.len() - 1)
        } else {
            String::new()
        };
        activity.push(Span::styled(
            format!(
                " · {} needs you: {first}{more}",
                brand::mark_glyph(brand::Mark::Attention)
            ),
            Style::default().fg(brand::warning()),
        ));
    }
    let queued: usize = others.iter().map(|session| session.pending).sum();
    if queued > 0 {
        activity.push(Span::styled(format!(" · {queued} queued"), muted));
    }
    let paused = others.iter().filter(|session| session.paused).count();
    if paused > 0 {
        activity.push(Span::styled(format!(" · {paused} paused"), muted));
    }
    if !others.is_empty() {
        activity.push(Span::styled("  Ctrl+N/P", accent));
    }
    lines.push(Line::from(activity));

    let mut agents = Vec::new();
    match &app.overview {
        None => agents.push(Span::styled("checking agents…", muted)),
        Some(Err(_)) => agents.push(Span::styled("agents unavailable · /agents", muted)),
        Some(Ok(overview)) => {
            for agent in overview
                .agents
                .iter()
                .filter(|agent| matches!(agent.state.as_str(), "ready" | "installed" | "sign-in"))
            {
                let color = match agent.state.as_str() {
                    "ready" => brand::success(),
                    "sign-in" => brand::warning(),
                    _ => brand::muted(),
                };
                agents.push(Span::styled(
                    format!("{} ", agent_glyph(&agent.state)),
                    Style::default().fg(color),
                ));
                agents.push(Span::styled(format!("{}  ", agent.name), muted));
            }
            if agents.is_empty() {
                agents.push(Span::styled("no agents set up · /agents", muted));
            }
        }
    }
    lines.push(Line::from(agents));
    lines
}

/// The draft laid out the way it is drawn: soft-wrapped at word boundaries
/// to `width` columns, with the (row, column) of every cursor position.
struct InputLayout {
    rows: Vec<String>,
    /// One entry per character plus the end of the text.
    positions: Vec<(usize, usize)>,
}

impl InputLayout {
    fn new(text: &str, width: u16) -> Self {
        let width = width.max(2) as usize;
        let characters: Vec<char> = text.chars().collect();
        let mut rows = Vec::new();
        let mut positions = vec![(0, 0); characters.len() + 1];
        let (mut row, mut column, mut row_start) = (0, 0, 0);
        // Where the row may break: just after its latest space.
        let mut last_break: Option<usize> = None;
        let mut index = 0;
        while index < characters.len() {
            let character = characters[index];
            if character == '\n' {
                positions[index] = (row, column);
                rows.push(characters[row_start..index].iter().collect());
                row += 1;
                index += 1;
                (row_start, column, last_break) = (index, 0, None);
                continue;
            }
            let character_width = character.width().unwrap_or(0);
            if column + character_width > width && column > 0 {
                // Carry the partial word down when the row has a space to
                // break at; otherwise break mid-word, as a terminal would.
                let end = last_break.filter(|at| *at > row_start).unwrap_or(index);
                rows.push(characters[row_start..end].iter().collect());
                row += 1;
                (row_start, column, last_break, index) = (end, 0, None, end);
                continue;
            }
            positions[index] = (row, column);
            column += character_width;
            if character == ' ' {
                last_break = Some(index + 1);
            }
            index += 1;
        }
        rows.push(characters[row_start..].iter().collect());
        positions[characters.len()] = if column >= width {
            // A full last row puts the cursor at the start of the next.
            rows.push(String::new());
            (row + 1, 0)
        } else {
            (row, column)
        };
        InputLayout { rows, positions }
    }
}

/// The text under a selection on the drawn screen, one line per row with
/// trailing blanks removed.
fn selected_text(screen: &Buffer, selection: &Selection) -> String {
    let ((start_column, start_row), (end_column, end_row)) = selection.ordered();
    let area = screen.area;
    let mut rows = Vec::new();
    for row in start_row..=end_row.min(area.bottom().saturating_sub(1)) {
        let from = if row == start_row {
            start_column
        } else {
            area.left()
        };
        let to = if row == end_row {
            end_column.min(area.right().saturating_sub(1))
        } else {
            area.right().saturating_sub(1)
        };
        let mut text = String::new();
        for column in from..=to {
            if let Some(cell) = screen.cell((column, row)) {
                text.push_str(cell.symbol());
            }
        }
        rows.push(text.trim_end().to_string());
    }
    rows.join("\n")
}

fn draw(frame: &mut Frame, app: &App) {
    let area = frame.area();
    // The full banner greets you; once a conversation is under way the small
    // mark keeps its place beside live context, and a short terminal keeps
    // one line so the conversation has room.
    let header: Vec<Line> = if app.view.is_none() && area.height >= 28 {
        brand::banner()
    } else if area.height >= 22 {
        brand::header(header_info(app), app.working(), app.tick)
    } else {
        vec![brand::compact()]
    };
    let show_tip = area.height >= 18;
    let tip_height = if show_tip { 1 } else { 0 };

    // The draft grows with what is typed, up to a third of the screen, then
    // scrolls to keep the cursor in view.
    let input_width = area.width.saturating_sub(2).max(2);
    app.input_width.set(input_width);
    let layout = InputLayout::new(&app.input, input_width);
    let most_rows = (area.height / 3).max(3) as usize;
    let visible_rows = layout.rows.len().clamp(1, most_rows);
    let input_rows = visible_rows as u16 + 2;

    let [header_area, body, status_area, input_area, tip_area] = Layout::vertical([
        Constraint::Length(header.len() as u16 + 1),
        Constraint::Min(3),
        Constraint::Length(1),
        Constraint::Length(input_rows),
        Constraint::Length(tip_height),
    ])
    .areas(area);
    app.body_area.set(body);

    let mut header_lines = header;
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

    // The border says what Enter will do: a shell command, a slash command,
    // or a message for the agent.
    let (mode_color, mode_title) = if app.input.starts_with('!') {
        (
            brand::warning(),
            " shell · runs here, not sent to an agent ",
        )
    } else if app.input.starts_with('/') {
        (brand::accent(), " command ")
    } else if app.working() && !app.input.is_empty() {
        (brand::accent(), " queues after the current work ")
    } else {
        (brand::accent(), "")
    };
    let mut block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(mode_color));
    if !mode_title.is_empty() {
        block = block.title(Span::styled(mode_title, Style::default().fg(mode_color)));
    }
    let inner = block.inner(input_area);
    let (cursor_row, cursor_column) = layout.positions[app.cursor.min(app.input_len())];
    let first_row = cursor_row.saturating_sub(visible_rows - 1);
    let shown = if app.input.is_empty() {
        Text::styled(
            if app.question().is_some() {
                "Type your answer · / commands · ! shell"
            } else if app.working() {
                "Queue a follow-up · / commands · ! shell"
            } else if app.session.is_some() {
                "Reply · / commands · ! shell"
            } else {
                "What should we work on?  / commands · ! shell"
            },
            Style::default().fg(brand::muted()),
        )
    } else {
        Text::from(
            layout
                .rows
                .iter()
                .skip(first_row)
                .take(visible_rows)
                .map(|row| Line::raw(row.clone()))
                .collect::<Vec<_>>(),
        )
    };
    frame.render_widget(Paragraph::new(shown).block(block), input_area);

    if show_tip {
        draw_tip(frame, app, tip_area);
    }

    if let Some(selection) = &app.selection {
        let buffer = frame.buffer_mut();
        let area = buffer.area;
        for row in area.top()..area.bottom() {
            for column in area.left()..area.right() {
                if selection.contains(column, row) {
                    if let Some(cell) = buffer.cell_mut((column, row)) {
                        cell.modifier.insert(Modifier::REVERSED);
                    }
                }
            }
        }
    }

    if let Some(picker) = &app.picker {
        draw_picker(frame, picker, area);
        return;
    }
    let matches = slash_matches(&app.input);
    if !matches.is_empty() {
        draw_slash_menu(frame, &matches, app.slash, input_area);
    } else {
        let mentions = app.mention_matches();
        if !mentions.is_empty() {
            draw_mention_menu(frame, &mentions, app.slash, input_area);
        }
    }
    frame.set_cursor_position((
        inner.x + (cursor_column as u16).min(inner.width.saturating_sub(1)),
        inner.y + ((cursor_row - first_row) as u16).min(inner.height.saturating_sub(1)),
    ));
}

fn draw_tip(frame: &mut Frame, app: &App, area: Rect) {
    if area.height == 0 || area.width < 10 {
        return;
    }
    let accent = Style::default().fg(brand::accent());
    let tip = TIPS[app.tip_index % TIPS.len()];
    let mut spans = vec![Span::styled("  Tip: ", accent.add_modifier(Modifier::BOLD))];
    spans.extend(inline(tip));
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

/// Files for an `@` mention, in the same place as the command menu.
fn draw_mention_menu(frame: &mut Frame, paths: &[String], selected: usize, input: Rect) {
    let accent = Style::default().fg(brand::accent());
    let muted = Style::default().fg(brand::muted());
    let rows = paths.len().min(8) as u16;
    let selected = selected.min(paths.len() - 1);
    let area = Rect {
        x: input.x,
        y: input.y.saturating_sub(rows + 2),
        width: input.width.min(80),
        height: rows + 2,
    };
    let lines: Vec<Line> = paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let (directory, name) = path
                .rsplit_once('/')
                .map_or(("", path.as_str()), |(directory, name)| (directory, name));
            let chosen = index == selected;
            Line::from(vec![
                Span::styled(
                    format!(" {name}"),
                    if chosen {
                        accent.add_modifier(Modifier::BOLD | Modifier::REVERSED)
                    } else {
                        accent
                    },
                ),
                Span::styled(
                    if directory.is_empty() {
                        String::new()
                    } else {
                        format!("  {directory}/")
                    },
                    muted,
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
                    " ↑↓ choose · Tab or Enter insert · Esc close ",
                    muted,
                )),
        ),
        area,
    );
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
    let shown = picker.shown();
    let width = area
        .width
        .saturating_sub(4)
        .min(if picker.kind == PickerKind::History {
            100
        } else {
            76
        });
    let visible = (area.height.saturating_sub(10) as usize).clamp(3, 14);
    let rows = shown.len().clamp(1, visible) as u16;
    let popup = Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        y: area.y + (area.height.saturating_sub(rows + 6)) / 3,
        width,
        height: (rows + 6).min(area.height),
    };
    let first = picker.selected.saturating_sub(visible - 1);
    // Rows without details use the whole width.
    let label_width = if picker.items.iter().all(|item| item.detail.is_empty()) {
        (width as usize).saturating_sub(5)
    } else {
        (width as usize / 2).saturating_sub(2)
    };
    let mut lines: Vec<Line> = vec![Line::from(if picker.filter.is_empty() {
        vec![Span::styled("  type to filter", muted)]
    } else {
        vec![
            Span::styled("  ", muted),
            Span::styled(
                picker.filter.clone(),
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("  {} of {}", shown.len(), picker.items.len()),
                muted,
            ),
        ]
    })];
    lines.extend(
        shown
            .iter()
            .enumerate()
            .skip(first)
            .take(visible)
            .map(|(position, index)| {
                let item = &picker.items[*index];
                let chosen = position == picker.selected;
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
            }),
    );
    if shown.is_empty() {
        lines.push(Line::styled(
            if picker.items.is_empty() {
                "  Nothing here yet."
            } else {
                "  No matches. Backspace or Esc to widen."
            },
            muted,
        ));
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
        assert_eq!(names("/le"), ["learn"]);
        assert_eq!(names("/").len(), COMMANDS.len());
        assert!(names("/stop now").is_empty(), "arguments close the menu");
        assert!(names("hello").is_empty());
    }

    #[test]
    fn the_draft_wraps_at_words_and_tracks_the_cursor() {
        let layout = InputLayout::new("fix the flaky test", 10);
        // The second row is full, so the cursor after it starts a third.
        assert_eq!(layout.rows, ["fix the ", "flaky test", ""]);
        // "flaky" moved down whole, so its first letter starts the row.
        assert_eq!(layout.positions[8], (1, 0));
        assert_eq!(layout.positions[18], (2, 0));
        // A word longer than the row breaks where it must.
        let long = InputLayout::new("abcdefghij", 4);
        assert_eq!(long.rows, ["abcd", "efgh", "ij"]);
        assert_eq!(long.positions[10], (2, 2));
        // Explicit newlines start rows; a full row moves the end cursor down.
        let lines = InputLayout::new("ab\ncd", 2);
        assert_eq!(lines.rows, ["ab", "cd", ""]);
        assert_eq!(lines.positions[5], (2, 0));
        // Wide characters take two columns.
        let wide = InputLayout::new("日本語", 4);
        assert_eq!(wide.rows, ["日本", "語"]);
        assert_eq!(InputLayout::new("", 8).rows, [""]);
    }

    #[test]
    fn a_selection_reads_the_screen_in_order_and_trims_rows() {
        let mut screen = Buffer::empty(Rect::new(0, 0, 8, 3));
        screen.set_string(0, 0, "alpha", Style::default());
        screen.set_string(0, 1, "bravo", Style::default());
        screen.set_string(0, 2, "charlie", Style::default());
        // Dragged upward from "char" back to "pha": still reads top to bottom.
        let selection = Selection {
            anchor: (3, 2),
            head: (2, 0),
        };
        assert_eq!(selected_text(&screen, &selection), "pha\nbravo\nchar");
        assert!(selection.contains(7, 1));
        assert!(!selection.contains(1, 0));
        assert!(!selection.contains(4, 2));
    }

    #[test]
    fn typing_in_a_picker_narrows_and_ranks_its_rows() {
        let item = |label: &str, detail: &str| Item {
            label: label.into(),
            detail: detail.into(),
            action: Action::TypeAnswer,
        };
        let mut picker = Picker {
            kind: PickerKind::Sessions,
            title: String::new(),
            items: vec![
                item("Fix login redirect", "web"),
                item("Refactor billing", "api"),
                item("Update docs", "web"),
            ],
            filter: String::new(),
            selected: 0,
        };
        assert_eq!(picker.shown(), [0, 1, 2]);
        picker.filter = "bill".into();
        assert_eq!(picker.shown(), [1]);
        // Labels outrank details.
        picker.filter = "web".into();
        assert_eq!(picker.shown(), [0, 2]);
        picker.step(true);
        assert_eq!(picker.chosen().unwrap().label, "Update docs");
        picker.step(true);
        assert_eq!(picker.selected, 1, "stops at the last match");
    }

    #[test]
    fn command_lines_split_their_argument() {
        assert!(COMMANDS.iter().any(|(name, _)| *name == "bg"));
        let names = |input: &str| -> Vec<&str> {
            slash_matches(input)
                .into_iter()
                .map(|(name, _)| name)
                .collect()
        };
        assert!(names("/bg fix it").is_empty());
        assert_eq!(names("/co"), ["copy"]);
    }

    #[test]
    fn rotating_tips_are_non_empty_and_render_cleanly() {
        assert!(!TIPS.is_empty());
        for tip in TIPS {
            let spans = inline(tip);
            assert!(!spans.is_empty(), "every tip should produce spans");
            let line = Line::from(spans);
            assert!(line.width() > 10, "tip should be substantive: {tip}");
        }
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
