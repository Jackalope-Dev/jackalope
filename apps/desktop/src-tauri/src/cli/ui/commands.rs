//! Submitting the draft: messages, answers, `!` commands and `/` commands.

use super::feed::Tone;
use super::pickers::PickerKind;
use super::App;
use crate::connection::short;
use crate::history;
use crate::protocol::{AgentStatus, Request, Response};

pub const COMMANDS: &[(&str, &str)] = &[
    (
        "new",
        "start a fresh conversation, optionally with a message",
    ),
    ("bg", "start another conversation and stay on this one"),
    (
        "sharpen",
        "rewrite a draft into a deeper version to edit; /sharpen undo",
    ),
    ("init", "write or refresh AGENTS.md for this repository"),
    ("sessions", "switch to any open conversation"),
    ("resume", "pick up an earlier conversation"),
    ("projects", "switch to another project"),
    ("agents", "see which agents are ready"),
    ("settings", "change how Jackalope behaves"),
    (
        "status",
        "show this project, the work, what needs you and the agents",
    ),
    ("agent", "choose the agent for your next conversation"),
    ("model", "choose the model for your next conversation"),
    ("usage", "show account quota and when it resets"),
    ("theme", "set this project's colour here and in the app"),
    (
        "learn",
        "save learnings from this session to project context",
    ),
    (
        "learnings",
        "see, archive or restore what this project has learned",
    ),
    ("files", "show or hide the files this work changed (Ctrl+O)"),
    (
        "review",
        "open this work's changes in the app to review and commit",
    ),
    (
        "merge",
        "merge this work into the project's branch, after a check",
    ),
    ("pr", "push this work and open a pull request"),
    ("stop", "stop the work that is running"),
    ("retry", "relaunch work that failed to start"),
    ("answer", "choose an answer to the agent's question"),
    ("finish", "mark this conversation done"),
    ("pause", "hold queued messages"),
    ("unqueue", "take back your last queued message to edit it"),
    ("unpause", "send held messages"),
    ("copy", "copy the latest reply"),
    ("history", "search what you have typed before"),
    ("kill", "stop running ! commands"),
    ("clear", "start fresh (Ctrl+L clears notes instead)"),
    (
        "plan",
        "plan with me first: explore, ask, then draft a plan",
    ),
    ("plans", "pick one of this project's plans to open"),
    ("revise", "keep planning: send comments for a revised plan"),
    (
        "approve",
        "approve the plan and run it: single, subtasks or swarm",
    ),
    ("replan", "revise a running plan from what is done"),
    ("export", "save the plan into the repository, uncommitted"),
    (
        "deviation",
        "decide on a plan deviation: accept, redo or replan",
    ),
    (
        "browser",
        "show the project browser; /browser open [url] to sign in",
    ),
    (
        "computer",
        "show this conversation's computer; /computer start or stop",
    ),
    ("open", "show Jackalope's app window"),
    ("help", "show these commands"),
    ("quit", "leave (work keeps running)"),
];

/// Named accents `/theme` accepts besides any `#rrggbb`.
pub const THEMES: &[(&str, &str)] = &[
    ("orange", "#f97316"),
    ("red", "#ef4444"),
    ("pink", "#ec4899"),
    ("purple", "#8b5cf6"),
    ("blue", "#3b82f6"),
    ("teal", "#14b8a6"),
    ("green", "#22c55e"),
    ("yellow", "#eab308"),
];

/// The `#rrggbb` a `/theme` argument names, if any.
fn theme_hex(argument: &str) -> Option<String> {
    let argument = argument.trim().to_ascii_lowercase();
    if let Some((_, hex)) = THEMES.iter().find(|(name, _)| *name == argument) {
        return Some((*hex).into());
    }
    let digits = argument.strip_prefix('#').unwrap_or(&argument);
    let expanded: String = match digits.len() {
        3 => digits.chars().flat_map(|c| [c, c]).collect(),
        6 => digits.into(),
        _ => return None,
    };
    expanded
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit())
        .then(|| format!("#{expanded}"))
}

/// Commands whose names start with what follows the `/`, while the input is
/// still a bare command.
pub fn slash_matches(input: &str) -> Vec<(&'static str, &'static str)> {
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

/// What `/init` asks for, matching the instruction files other agent CLIs write.
const INIT_PROMPT: &str =
    "Create or update AGENTS.md at the repository root so coding agents can work \
here effectively. Inspect the repository first. Cover the build, test, lint and format commands; \
the architecture and where things live; code conventions; and anything non-obvious a new \
contributor would get wrong. Keep existing guidance that is still accurate, stay concise, and \
do not invent commands you have not confirmed.";

/// One quota window: how much is used and when it resets.
fn usage_line(window: &crate::protocol::UsageWindow, now: i64) -> String {
    let used = window
        .used_percent
        .map(|used| format!("{}% used", used.round() as i64))
        .unwrap_or_else(|| "usage unknown".into());
    let reset = window
        .resets_at
        .filter(|at| *at > now)
        .map(|at| {
            let minutes = (at - now) / 60;
            if minutes >= 60 * 24 {
                format!(" · resets in {}d {}h", minutes / 1440, minutes % 1440 / 60)
            } else if minutes >= 60 {
                format!(" · resets in {}h {}m", minutes / 60, minutes % 60)
            } else {
                format!(" · resets in {}m", minutes.max(1))
            }
        })
        .unwrap_or_default();
    format!("{}: {used}{reset}", window.name)
}

/// The command a mistyped name most likely meant: a unique prefix match, or
/// the nearest name within two single-character edits.
fn closest_command(typed: &str) -> Option<&'static str> {
    let prefixed: Vec<_> = COMMANDS
        .iter()
        .filter(|(name, _)| name.starts_with(typed))
        .collect();
    if let [(name, _)] = prefixed.as_slice() {
        return Some(name);
    }
    COMMANDS
        .iter()
        .map(|(name, _)| (edit_distance(typed, name), *name))
        .filter(|(distance, _)| *distance <= 2)
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, name)| name)
}

fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, left) in a.chars().enumerate() {
        let mut current = vec![i + 1];
        for (j, right) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(left != *right);
            current.push(substitution.min(previous[j + 1] + 1).min(current[j] + 1));
        }
        previous = current;
    }
    previous[b.len()]
}

impl App {
    pub(super) fn submit(&mut self) {
        let raw = self.editor.take();
        let text = raw.trim().to_string();
        self.history_index = None;
        self.scroll_top = None;
        if text.is_empty() {
            return;
        }
        if history::keep(&raw) {
            history::remember(&mut self.history, &text);
            history::append(&text);
        }
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
        if let Some(question) = self.question() {
            // A number, `1,3` or an option's name picks options, as `jackalope answer`
            // reads them.
            match crate::planning::checked_reply(question, &text) {
                Ok(answer) => self.answer(answer),
                Err(problem) => {
                    self.editor.set(text);
                    self.flash(problem, Tone::Warning);
                }
            }
            return;
        }
        let (agents, text) = self.take_agent_mentions(&text);
        if !agents.is_empty() {
            self.start_with_agents(agents, text);
            return;
        }
        match self.session.clone() {
            Some(id) => {
                let busy = self.working();
                let draft_revision = self.draft_revision(&id);
                if self
                    .request(Request::Send {
                        session_id: id,
                        text,
                        draft_revision,
                    })
                    .is_some()
                {
                    self.draft_sent();
                    if busy {
                        self.flash("Queued · runs after the current work", Tone::Muted);
                    } else if self.view.as_ref().is_some_and(|view| view.paused) {
                        self.flash("Held · /unpause to send", Tone::Warning);
                    }
                }
                self.refresh();
            }
            None => {
                if let Some(session_id) = self.start_conversation(text) {
                    self.show(Some(session_id));
                }
            }
        }
    }

    /// The agents a message names with `@id`, and the message without them.
    /// Unknown names are left in the text, where they read as files.
    fn take_agent_mentions(&self, text: &str) -> (Vec<String>, String) {
        match &self.overview {
            Some(Ok(overview)) => split_agent_mentions(text, &overview.agents),
            _ => (Vec::new(), text.to_string()),
        }
    }

    /// Starts the message with each named agent, one conversation apiece, and
    /// shows the first; the rest wait in the tabs.
    fn start_with_agents(&mut self, agents: Vec<String>, text: String) {
        if text.is_empty() {
            self.flash("Add a message after the agent", Tone::Warning);
            return;
        }
        let mut started = Vec::new();
        for agent in &agents {
            let model = (self.next_agent.as_ref() == Some(agent))
                .then(|| self.next_model.clone())
                .flatten();
            if let Some(Response::Started { session_id }) = self.request(Request::StartSession {
                project_path: self.project.path.clone(),
                text: text.clone(),
                agent: Some(agent.clone()),
                model,
            }) {
                started.push(session_id);
            }
        }
        let Some(first) = started.first().cloned() else {
            return;
        };
        self.show(Some(first));
        if started.len() > 1 {
            self.flash(
                format!("Started with {} agents · Alt+1–9 switches", started.len()),
                Tone::Success,
            );
        }
    }

    fn start_conversation(&mut self, text: String) -> Option<String> {
        match self.request(Request::StartSession {
            project_path: self.project.path.clone(),
            text,
            agent: self.next_agent.clone(),
            model: self.next_model.clone(),
        }) {
            Some(Response::Started { session_id }) => Some(session_id),
            _ => None,
        }
    }

    /// An action on the open conversation, noting when there is none.
    /// Takes back the newest message not yet sent to an agent and puts it in
    /// the input, as cancelling a queued message does in the app.
    fn unqueue(&mut self) {
        let queued = self.view.as_ref().and_then(|view| {
            view.messages
                .iter()
                .rev()
                .find(|message| message.role == "you" && !message.sent)
                .and_then(|message| Some((message.id.clone()?, message.text.clone())))
        });
        let (Some(session_id), Some((message_id, text))) = (self.session.clone(), queued) else {
            self.flash("No queued message to take back", Tone::Muted);
            return;
        };
        if self
            .request(Request::SessionAction {
                session_id,
                action: "cancel-message".into(),
                message_id: Some(message_id),
            })
            .is_some()
        {
            if self.editor.text().trim().is_empty() {
                self.editor.set(text);
                self.flash("Took back your message · edit and press Enter", Tone::Muted);
            } else {
                self.note(format!("Took back your message: {text}"));
            }
        }
    }

    /// Prints where this terminal stands, without leaving the conversation.
    fn status(&mut self) {
        let branch = self.branch.clone().unwrap_or_else(|| "no branch".into());
        self.note(format!(
            "Project  {} · {branch} · {}",
            self.project.name, self.project.path
        ));
        if let Some(view) = self.view.clone() {
            let (state, _) = self.work_state(&view);
            let agent = view
                .agent
                .as_deref()
                .map(|agent| self.agent_name(agent))
                .unwrap_or_else(|| "not chosen yet".into());
            let model = view.model.unwrap_or_else(|| "default model".into());
            self.note(format!(
                "Work     {} · {state} · {agent} · {model}",
                view.title
            ));
        }
        let needing: Vec<String> = self
            .sessions
            .iter()
            .filter(|session| super::conversation::needs_you(session))
            .map(|session| session.title.clone())
            .collect();
        if !needing.is_empty() {
            self.note(format!("Needs you  {}", needing.join(" · ")));
        }
        let agents = match &self.overview {
            Some(Ok(overview)) => overview
                .agents
                .iter()
                .map(|agent| format!("{} {}", agent.name, agent.state))
                .collect::<Vec<_>>()
                .join(" · "),
            Some(Err(error)) => format!("could not be read: {error}"),
            None => "still loading".into(),
        };
        self.note(format!("Agents   {agents}"));
        self.note(format!(
            "App      {} · process {}",
            if self.handshake.windowed {
                "window open"
            } else {
                "running in the background"
            },
            self.handshake.pid
        ));
    }

    fn session_action(&mut self, action: &str, done: &str, tone: Tone) {
        let Some(session_id) = self.session.clone() else {
            self.note("Start a conversation first.");
            return;
        };
        if self
            .request(Request::SessionAction {
                session_id,
                action: action.into(),
                message_id: None,
            })
            .is_some()
        {
            self.flash(done.to_string(), tone);
        }
    }

    fn help(&mut self) {
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
            "Ctrl+G edit the open plan in $EDITOR",
            "Start a line with a space to keep it out of history",
        ] {
            self.note(format!("  {keys}"));
        }
    }

    pub(super) fn command(&mut self, line: &str) {
        let (command, argument) = line
            .split_once(char::is_whitespace)
            .map(|(command, argument)| (command, argument.trim()))
            .unwrap_or((line, ""));
        match command {
            "new" if !argument.is_empty() => {
                if let Some(id) = self.start_conversation(argument.into()) {
                    self.show(Some(id));
                }
            }
            "new" | "clear" => {
                self.show(None);
                self.note("New conversation. Type a message to begin.");
            }
            "init" => {
                if let Some(id) = self.start_conversation(INIT_PROMPT.into()) {
                    self.show(Some(id));
                }
            }
            "bg" if argument.is_empty() => self.note("Add the message: /bg <what to do>"),
            "bg" => {
                if let Some(id) = self.start_conversation(argument.into()) {
                    self.note_tone(
                        format!(
                            "Started in the background · {} · Ctrl+N to visit",
                            short(&id)
                        ),
                        Tone::Success,
                    );
                    self.refresh();
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
            "help" | "?" => self.help(),
            "quit" | "exit" | "q" => self.quit = true,
            "sessions" | "resume" => self.open_picker(PickerKind::Sessions),
            "history" => self.open_picker(PickerKind::History),
            "projects" => self.open_picker(PickerKind::Projects),
            "agents" => self.open_picker(PickerKind::Agents),
            "settings" | "config" => self.open_picker(PickerKind::Settings),
            "status" => self.status(),
            "agent" => self.open_picker(PickerKind::NextAgent),
            "model" if !argument.is_empty() => self.choose_model(Some(argument.into())),
            "model" => {
                if self.model_agent().is_some() {
                    self.open_picker(PickerKind::NextModel);
                } else {
                    self.note("Jackalope chooses the agent, so pick one with /agent first. Or type /model <name>.");
                }
            }
            "usage" | "cost" => self.usage(),
            "theme" | "color" | "colour" => self.theme(argument),
            "files" => self.toggle_panel(),
            "answer" => match self.question().map(|question| question.options.is_empty()) {
                Some(false) => self.open_picker(PickerKind::Question),
                Some(true) => {
                    self.note("This question has no options; type your answer and press Enter.")
                }
                None => self.note("Nothing is waiting on an answer."),
            },
            "sharpen" => self.sharpen(argument),
            "learn" => self.learn(),
            "learnings" | "lessons" => self.open_picker(PickerKind::Learnings),
            "review" | "diff" | "changes" => {
                if self
                    .request(Request::ShowChanges {
                        path: self.workspace(),
                    })
                    .is_some()
                {
                    let shots = self
                        .view
                        .as_ref()
                        .and_then(|view| view.review_screenshots)
                        .unwrap_or(0);
                    match shots {
                        0 => self.flash("Opened Changes in Jackalope", Tone::Muted),
                        1 => self.flash(
                            "Opened Changes in Jackalope · 1 review screenshot there",
                            Tone::Muted,
                        ),
                        n => self.flash(
                            format!("Opened Changes in Jackalope · {n} review screenshots there"),
                            Tone::Muted,
                        ),
                    }
                }
            }
            "unqueue" => self.unqueue(),
            "merge" => self.merge(argument),
            "pr" => self.pull_request(argument),
            "retry" => self.session_action("retry", "Relaunching", Tone::Muted),
            "finish" => self.session_action("finish", "Marked done", Tone::Success),
            "pause" => self.session_action("pause", "Paused", Tone::Muted),
            "unpause" => self.session_action("resume", "Resumed", Tone::Muted),
            "stop" => {
                let run = self
                    .view
                    .as_ref()
                    .and_then(|view| view.run_id.clone())
                    .filter(|_| self.working());
                match run {
                    Some(run_id) => {
                        if self.request(Request::Stop { run_id }).is_some() {
                            self.flash("Stopping", Tone::Warning);
                        }
                    }
                    None => self.flash("Nothing is running", Tone::Muted),
                }
            }
            "open" => self.open_app(),
            "browser" => self.browser(argument),
            "computer" => self.computer(argument),
            name if super::plan::COMMANDS.contains(&name) => {
                self.plan_command(name, argument);
            }
            other => match closest_command(other) {
                Some(name) => self.note(format!("Unknown command /{other}. Did you mean /{name}?")),
                None => self.note(format!("Unknown command /{other}. Type / to see the list.")),
            },
        }
        self.refresh();
    }

    fn browser(&mut self, argument: &str) {
        let (action, url) = argument
            .split_once(char::is_whitespace)
            .map(|(action, url)| (action, url.trim()))
            .unwrap_or((argument, ""));
        let action = match action {
            "" | "status" => "",
            "open" | "signin" | "sign-in" => "open",
            "done" | "close" => "done",
            other => {
                self.note(format!(
                    "/browser {other} is not a choice. Use /browser, /browser open [url] or /browser done."
                ));
                return;
            }
        };
        let request = Request::BrowserProfile {
            project_id: self.project.id.clone(),
            action: action.into(),
            url: (!url.is_empty()).then(|| url.to_string()),
        };
        let Some(Response::BrowserProfile { profile }) = self.request(request) else {
            return;
        };
        let Some(profile) = profile else {
            self.note("This project has no browser profile yet. /browser open creates it and opens a window to sign in.");
            return;
        };
        for line in browser_lines(&profile) {
            self.note(line);
        }
        match action {
            "open" => self.flash(
                "Sign in in the browser window, then close it or type /browser done",
                Tone::Success,
            ),
            "done" => self.flash("Closed the project browser", Tone::Muted),
            _ => {}
        }
    }

    fn computer(&mut self, argument: &str) {
        let action = match argument.trim() {
            "" | "status" => "",
            "start" => "start",
            "stop" => "stop",
            other => {
                self.note(format!(
                    "/computer {other} is not a choice. Use /computer, /computer start or /computer stop."
                ));
                return;
            }
        };
        let Some(session_id) = self.session.clone() else {
            self.note(
                "Open a conversation first. A bot's computer is set up in its settings in the app.",
            );
            return;
        };
        let request = Request::Computer {
            session_id,
            action: action.into(),
        };
        let Some(Response::Computer { computer }) = self.request(request) else {
            return;
        };
        let Some(computer) = computer else {
            self.note("This conversation has no computer. Give its bot one in the app, or the agent can ask for one with computer_request.");
            return;
        };
        self.note(computer_line(&computer));
        match action {
            "start" => self.flash(format!("Starting {}", computer.name), Tone::Success),
            "stop" => self.flash(format!("Stopped {}", computer.name), Tone::Muted),
            _ => {}
        }
    }

    fn usage(&mut self) {
        let Some(Response::Usage { accounts }) = self.request(Request::Usage) else {
            return;
        };
        if accounts.is_empty() {
            self.note("No account quota is available yet.");
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs() as i64)
            .unwrap_or_default();
        for account in accounts {
            let who = if account.account.is_empty() {
                account.agent.clone()
            } else {
                format!("{} · {}", account.agent, account.account)
            };
            if account.windows.is_empty() {
                let detail = if account.detail.is_empty() {
                    account.status.clone()
                } else {
                    account.detail.clone()
                };
                self.note_tone(format!("{who}: {detail}"), Tone::Muted);
                continue;
            }
            self.note(who);
            for window in &account.windows {
                self.note(format!("  {}", usage_line(window, now)));
            }
        }
    }

    fn learn(&mut self) {
        let Some(session_id) = self.session.clone() else {
            self.note("Start a conversation first.");
            return;
        };
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
}

impl App {
    fn theme(&mut self, argument: &str) {
        if argument.is_empty() {
            let names: Vec<&str> = THEMES.iter().map(|(name, _)| *name).collect();
            self.note(format!(
                "/theme <colour>: {} or any #rrggbb. It changes this project in the app too.",
                names.join(", ")
            ));
            return;
        }
        let Some(accent) = theme_hex(argument) else {
            self.note(format!(
                "'{argument}' is not a colour /theme knows. Try purple or #8b5cf6."
            ));
            return;
        };
        let request = Request::SetAccent {
            project_id: self.project.id.clone(),
            accent: accent.clone(),
        };
        if self.request(request).is_some() {
            crate::brand::set_accent(Some(&accent));
            self.project.accent = Some(accent.clone());
            self.flash(format!("Theme set to {accent}"), Tone::Success);
        }
    }
}

/// What `/computer` shows about a conversation's computer.
fn computer_line(computer: &crate::protocol::ComputerView) -> String {
    let provider = match computer.provider.as_str() {
        "local-docker" => "local sandbox",
        "remote-machine" => "cloud machine",
        other => other,
    };
    let mut line = format!(
        "{} · {provider} · {}",
        computer.name,
        computer.state.replace('-', " ")
    );
    if computer.stopped_idle {
        line.push_str(" (idle)");
    } else if let Some(usage) = &computer.usage {
        line.push_str(&format!(" · {usage}"));
    }
    if let Some(detail) = computer.phase.as_ref().or(computer.error.as_ref()) {
        line.push_str(&format!(" · {detail}"));
    }
    line
}

/// What `/browser` shows about a project's persistent browser profile.
fn browser_lines(profile: &crate::protocol::BrowserProfileView) -> Vec<String> {
    let megabytes = profile.size_bytes as f64 / 1_048_576.0;
    let state = match (&profile.in_use, profile.window_open) {
        (_, true) => "open for signing in".to_string(),
        (Some(holder), false) => format!("in use by {holder}"),
        (None, false) => "idle".to_string(),
    };
    let mut lines = vec![format!(
        "{} · {state} · {megabytes:.1} MB · last used {}",
        profile.name,
        profile
            .last_used_at
            .as_deref()
            .and_then(|at| at.get(..10))
            .unwrap_or("never")
    )];
    lines.push(if profile.sites.is_empty() {
        "  No saved sign-ins yet.".to_string()
    } else {
        format!("  Sites with saved data: {}", profile.sites.join(", "))
    });
    lines
}

/// The usable agents `text` names with `@id`, in order and once each, and
/// the text without those names.
fn split_agent_mentions(text: &str, agents: &[AgentStatus]) -> (Vec<String>, String) {
    let mut named = Vec::new();
    let mut kept = Vec::new();
    for word in text.split(' ') {
        let agent = word.strip_prefix('@').and_then(|name| {
            agents
                .iter()
                .find(|agent| super::pickers::usable(agent) && agent.id.eq_ignore_ascii_case(name))
        });
        match agent {
            Some(agent) => {
                if !named.contains(&agent.id) {
                    named.push(agent.id.clone());
                }
            }
            None => kept.push(word),
        }
    }
    (named, kept.join(" ").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(input: &str) -> Vec<&str> {
        slash_matches(input)
            .into_iter()
            .map(|(name, _)| name)
            .collect()
    }

    #[test]
    fn slash_menu_filters_bare_commands_only() {
        assert_eq!(names("/se"), ["sessions", "settings"]);
        assert_eq!(names("/le"), ["learn", "learnings"]);
        assert_eq!(names("/learni"), ["learnings"]);
        assert_eq!(names("/").len(), COMMANDS.len());
        assert!(names("/stop now").is_empty(), "arguments close the menu");
        assert!(names("hello").is_empty());
    }

    #[test]
    fn command_lines_split_their_argument() {
        assert!(COMMANDS.iter().any(|(name, _)| *name == "bg"));
        assert!(names("/bg fix it").is_empty());
        assert_eq!(names("/co"), ["copy", "computer"]);
        assert_eq!(names("/cop"), ["copy"]);
    }

    #[test]
    fn familiar_commands_follow_other_agent_clis() {
        assert_eq!(names("/res"), ["resume"]);
        assert_eq!(names("/unp"), ["unpause"]);
        assert_eq!(names("/th"), ["theme"]);
        assert_eq!(names("/sh"), ["sharpen"]);
    }

    #[test]
    fn theme_accepts_names_and_hex() {
        assert_eq!(theme_hex("Purple").as_deref(), Some("#8b5cf6"));
        assert_eq!(theme_hex("#abc").as_deref(), Some("#aabbcc"));
        assert_eq!(theme_hex("12ab34").as_deref(), Some("#12ab34"));
        assert_eq!(theme_hex("mauve"), None);
        assert_eq!(theme_hex("#12345g"), None);
        assert!(COMMANDS.iter().any(|(name, _)| *name == "clear"));
    }

    #[test]
    fn usage_lines_read_briefly() {
        let window = |used, resets_at| crate::protocol::UsageWindow {
            name: "5h".into(),
            used_percent: used,
            resets_at,
        };
        assert_eq!(
            usage_line(&window(Some(42.4), Some(1000 + 90 * 60)), 1000),
            "5h: 42% used · resets in 1h 30m"
        );
        assert_eq!(usage_line(&window(None, None), 0), "5h: usage unknown");
        assert_eq!(
            usage_line(&window(Some(10.0), Some(100)), 1000),
            "5h: 10% used",
            "a reset in the past is stale"
        );
    }

    #[test]
    fn unknown_commands_suggest_the_closest_name() {
        assert_eq!(closest_command("sesions"), Some("sessions"));
        assert_eq!(closest_command("stpo"), Some("stop"));
        assert_eq!(closest_command("hist"), Some("history"));
        assert_eq!(closest_command("deploy"), None);
    }

    #[test]
    fn agent_mentions_pick_usable_agents_and_leave_files_in_the_text() {
        let agent = |id: &str, state: &str| AgentStatus {
            id: id.into(),
            name: id.into(),
            state: state.into(),
            account: String::new(),
            detail: String::new(),
            models: Vec::new(),
            default_model: String::new(),
        };
        let agents = [
            agent("codex", "ready"),
            agent("claude", "installed"),
            agent("gemini", "missing"),
        ];
        assert_eq!(
            split_agent_mentions("@Codex @claude fix @src/app.ts @codex", &agents),
            (
                vec!["codex".to_string(), "claude".to_string()],
                "fix @src/app.ts".to_string()
            )
        );
        // An agent that is not set up reads as an ordinary mention.
        assert_eq!(
            split_agent_mentions("@gemini look", &agents),
            (Vec::new(), "@gemini look".to_string())
        );
    }

    #[test]
    fn computer_status_names_provider_state_and_detail() {
        let mut computer = crate::protocol::ComputerView {
            name: "Scout computer".into(),
            provider: "local-docker".into(),
            state: "not-created".into(),
            ..Default::default()
        };
        assert_eq!(
            computer_line(&computer),
            "Scout computer · local sandbox · not created"
        );
        computer.error = Some("Docker is not installed.".into());
        assert!(computer_line(&computer).ends_with("· Docker is not installed."));
        computer.error = None;
        computer.state = "running".into();
        computer.usage = Some("idle 3 min · stops in 7 min".into());
        assert_eq!(
            computer_line(&computer),
            "Scout computer · local sandbox · running · idle 3 min · stops in 7 min"
        );
        computer.state = "stopped".into();
        computer.stopped_idle = true;
        assert_eq!(
            computer_line(&computer),
            "Scout computer · local sandbox · stopped (idle)"
        );
        assert!(COMMANDS.iter().any(|(name, _)| *name == "computer"));
    }

    #[test]
    fn browser_status_lists_state_size_and_sites() {
        let mut profile = crate::protocol::BrowserProfileView {
            name: "Project browser".into(),
            size_bytes: 3 * 1_048_576,
            ..Default::default()
        };
        let lines = browser_lines(&profile);
        assert_eq!(
            lines[0],
            "Project browser · idle · 3.0 MB · last used never"
        );
        assert!(lines[1].contains("No saved sign-ins"));
        profile.window_open = true;
        profile.in_use = Some("the sign-in window".into());
        profile.last_used_at = Some("2026-10-28T10:00:00Z".into());
        profile.sites = vec!["example.com".into(), "github.com".into()];
        let lines = browser_lines(&profile);
        assert!(lines[0].contains("open for signing in") && lines[0].ends_with("2026-10-28"));
        assert_eq!(lines[1], "  Sites with saved data: example.com, github.com");
        assert!(COMMANDS.iter().any(|(name, _)| *name == "browser"));
    }
}
