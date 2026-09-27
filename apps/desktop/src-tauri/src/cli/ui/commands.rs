//! Submitting the draft: messages, answers, `!` commands and `/` commands.

use super::feed::Tone;
use super::pickers::PickerKind;
use super::App;
use crate::connection::short;
use crate::history;
use crate::protocol::{Request, Response};

pub const COMMANDS: &[(&str, &str)] = &[
    (
        "new",
        "start a fresh conversation, optionally with a message",
    ),
    ("bg", "start another conversation and stay on this one"),
    ("init", "write or refresh AGENTS.md for this repository"),
    ("sessions", "switch to any open conversation"),
    ("resume", "pick up an earlier conversation"),
    ("projects", "switch to another project"),
    ("agents", "see which agents are ready"),
    ("settings", "change how Jackalope behaves"),
    ("status", "show the project, host and agents"),
    ("agent", "choose the agent for your next conversation"),
    ("model", "choose the model for your next conversation"),
    ("usage", "show account quota and when it resets"),
    (
        "learn",
        "save learnings from this session to project context",
    ),
    ("diff", "review and commit this work in the app"),
    ("stop", "stop the work that is running"),
    ("retry", "run the last message again"),
    ("finish", "mark this conversation done"),
    ("pause", "hold queued messages"),
    ("unpause", "send held messages"),
    ("copy", "copy the latest reply"),
    ("history", "search what you have typed before"),
    ("kill", "stop running ! commands"),
    ("clear", "start fresh (Ctrl+L clears notes instead)"),
    ("open", "show Jackalope's app window"),
    ("help", "show these commands"),
    ("quit", "leave (work keeps running)"),
];

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
    fn session_action(&mut self, action: &str, done: &str, tone: Tone) {
        let Some(session_id) = self.session.clone() else {
            self.note("Start a conversation first.");
            return;
        };
        if self
            .request(Request::SessionAction {
                session_id,
                action: action.into(),
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
            "status" => {
                self.show(None);
                self.note("Your conversation is still open; /sessions to go back.");
            }
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
            "learn" => self.learn(),
            "diff" | "changes" => {
                if self
                    .request(Request::ShowChanges {
                        path: self.workspace(),
                    })
                    .is_some()
                {
                    self.flash("Opened Changes in Jackalope", Tone::Muted);
                }
            }
            "retry" => self.session_action("retry", "Retrying", Tone::Muted),
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
            other => match closest_command(other) {
                Some(name) => self.note(format!("Unknown command /{other}. Did you mean /{name}?")),
                None => self.note(format!("Unknown command /{other}. Type / to see the list.")),
            },
        }
        self.refresh();
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
        assert_eq!(names("/le"), ["learn"]);
        assert_eq!(names("/").len(), COMMANDS.len());
        assert!(names("/stop now").is_empty(), "arguments close the menu");
        assert!(names("hello").is_empty());
    }

    #[test]
    fn command_lines_split_their_argument() {
        assert!(COMMANDS.iter().any(|(name, _)| *name == "bg"));
        assert!(names("/bg fix it").is_empty());
        assert_eq!(names("/co"), ["copy"]);
    }

    #[test]
    fn familiar_commands_follow_other_agent_clis() {
        assert_eq!(names("/res"), ["resume"]);
        assert_eq!(names("/unp"), ["unpause"]);
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
}
