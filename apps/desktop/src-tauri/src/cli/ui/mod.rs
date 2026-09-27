//! The interactive conversation.
//!
//! Several threads feed one loop: keystrokes and the mouse, change
//! notifications from the host (on their own connection, since a watch
//! blocks), the agent overview (also its own connection, since probing sign-in
//! can take seconds), a refresher that re-reads the conversation off the loop
//! whenever the host says work moved, `!command` output, and a ticker for
//! animation. Nothing the user types waits on an agent: messages queue behind
//! running work.
//!
//! `App` holds the state; its behaviour is split by concern across the
//! submodules, each adding an `impl App` block.

mod commands;
mod conversation;
mod editor;
mod events;
mod feed;
mod keys;
mod pickers;
mod refresh;
mod render;
mod selection;

use crate::connection::Connection;
use crate::protocol::{AgentStatus, Handshake, Project, SessionSummary, SessionView};
use crate::{brand, git, history, shell};
use crossterm::event::{
    DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture, KeyEvent,
    KeyboardEnhancementFlags, MouseEvent, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use crossterm::terminal::SetTitle;
use editor::Editor;
use feed::{Entry, Tone};
use pickers::Picker;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use selection::Selection;
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::sync::mpsc::{self, Sender};
use std::time::Instant;

enum Event {
    Key(KeyEvent),
    /// Mouse wheel: positive scrolls back through the conversation.
    Scroll(i16),
    /// A press, drag or release of the left button, for selecting text.
    Select(MouseEvent),
    Paste(String),
    Shell(shell::Update),
    Resize,
    Changed,
    Snapshot(Box<refresh::Snapshot>),
    Overview(Result<Overview, String>),
    Files {
        directory: String,
        files: Vec<String>,
    },
    Tick,
}

#[derive(Clone)]
struct Overview {
    agents: Vec<AgentStatus>,
    default_agent: String,
}

/// The state the window title and bell announce.
#[derive(Clone, PartialEq, Debug)]
enum Signal {
    Idle,
    Working,
    NeedsYou,
}

/// The workspace's files for `@` mentions.
struct FileIndex {
    directory: String,
    files: Vec<String>,
    listed: Instant,
    /// Bumped on each listing, keying the cached matches.
    generation: u64,
}

struct App {
    connection: Connection,
    /// For threads the loop starts later, such as `!` commands.
    events: Sender<Event>,
    refresher: Sender<refresh::Request>,
    handshake: Handshake,
    project: Project,
    branch: Option<String>,
    session: Option<String>,
    /// Bumped whenever the conversation or project on screen changes, so a
    /// refresh begun for the previous one is dropped when it lands.
    context: u64,
    view: Option<SessionView>,
    /// Bumped whenever `view` changes, keying the rendered transcript.
    view_version: u64,
    /// Open conversations across the workspace, newest first.
    sessions: Vec<SessionSummary>,
    projects: Vec<Project>,
    overview: Option<Result<Overview, String>>,
    /// Why the host cannot be reached, while it cannot.
    offline: Option<String>,
    /// The last host error a refresh reported, so it is noted once.
    problem: Option<String>,
    /// This project's commit authorship, fetched when settings open.
    attribution: Option<String>,
    picker: Option<Picker>,
    /// The highlighted row of the slash-command or mention menu.
    slash: usize,
    editor: Editor,
    /// The agent for the next new conversation, when the user chose one.
    next_agent: Option<String>,
    /// Questions already offered as a picker, so dismissing one does not
    /// reopen it on every refresh.
    offered: HashSet<String>,
    history: Vec<String>,
    history_index: Option<usize>,
    files: Option<FileIndex>,
    /// A listing is running for this directory.
    indexing: Option<String>,
    /// Matches for the last mention query: (query, generation, paths).
    mention_cache: RefCell<Option<(String, u64, Vec<String>)>>,
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
    /// The last drawn screen while a selection is active, which it copies from.
    screen: Option<Buffer>,
    /// Where the transcript was drawn, measured while drawing.
    body_area: Cell<Rect>,
    input_width: Cell<u16>,
    /// The first transcript row shown when scrolled back; `None` follows the
    /// newest output. Anchoring to the top keeps text still as output arrives.
    scroll_top: Option<usize>,
    /// Furthest the transcript can scroll, measured while drawing.
    max_scroll: Cell<usize>,
    transcript: RefCell<Option<render::transcript::Cache>>,
    /// Animation frame for the working indicator.
    tick: usize,
    /// Currently displayed rotating tip.
    tip_index: usize,
    last_tip_change: Instant,
    quit: bool,
}

pub fn run(
    connection: Connection,
    project: Project,
    session: Option<String>,
) -> Result<(), String> {
    let handshake = connection.handshake().clone();
    let (events, inbox) = mpsc::channel();
    events::spawn_input(events.clone());
    events::spawn_watcher(handshake.clone(), events.clone());
    events::spawn_overview(handshake.clone(), events.clone());
    events::spawn_ticker(events.clone());
    let refresher = refresh::spawn(handshake.clone(), events.clone());

    let mut app = App {
        connection,
        events,
        refresher,
        branch: git::branch(&project.path),
        handshake,
        project,
        session,
        context: 0,
        view: None,
        view_version: 0,
        sessions: Vec::new(),
        projects: Vec::new(),
        overview: None,
        offline: None,
        problem: None,
        attribution: None,
        picker: None,
        slash: 0,
        editor: Editor::default(),
        next_agent: None,
        offered: HashSet::new(),
        history: history::load(),
        history_index: None,
        files: None,
        indexing: None,
        mention_cache: RefCell::new(None),
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
        scroll_top: None,
        max_scroll: Cell::new(0),
        transcript: RefCell::new(None),
        tick: 0,
        tip_index: 0,
        last_tip_change: Instant::now(),
        quit: false,
    };
    // The first read happens here rather than on the refresher, so the
    // conversation is on screen from the first frame.
    app.refresh_now();

    let mut terminal = ratatui::init();
    let enhanced = enter_modes();
    let result = events::event_loop(&mut terminal, &mut app, &inbox, enhanced);
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

impl App {
    /// Replaces the conversation on screen, or clears it for a new one.
    fn show(&mut self, session: Option<String>) {
        self.session = session;
        self.set_view(None);
        self.context += 1;
        self.scroll_top = None;
        self.selection = None;
        self.work_started = None;
        self.refresh();
    }

    fn set_view(&mut self, view: Option<SessionView>) {
        self.view = view;
        self.view_version += 1;
    }

    /// Switches to another project with no conversation open.
    fn switch_project(&mut self, project: Project) {
        self.branch = git::branch(&project.path);
        brand::set_accent(project.accent.as_deref());
        self.project = project;
        self.show(None);
    }
}
