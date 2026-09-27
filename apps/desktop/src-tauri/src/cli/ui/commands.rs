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

fn capitalize(word: &str) -> String {
    let mut characters = word.chars();
    characters
        .next()
        .map(|first| first.to_uppercase().chain(characters).collect())
        .unwrap_or_default()
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
                        self.flash("Held · /resume to send", Tone::Warning);
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
            "new" => {
                self.show(None);
                self.note("New conversation. Type a message to begin.");
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
            "clear" => self.clear_feed(),
            "help" | "?" => self.help(),
            "quit" | "exit" | "q" => self.quit = true,
            "sessions" => self.open_picker(PickerKind::Sessions),
            "history" => self.open_picker(PickerKind::History),
            "projects" => self.open_picker(PickerKind::Projects),
            "agents" => self.open_picker(PickerKind::Agents),
            "settings" | "config" => self.open_picker(PickerKind::Settings),
            "status" => {
                self.show(None);
                self.note("Your conversation is still open; /sessions to go back.");
            }
            "agent" | "model" => self.open_picker(PickerKind::NextAgent),
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
            "pause" | "resume" => {
                let done = format!("{}d", capitalize(command));
                self.session_action(command, &done, Tone::Muted);
            }
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
            other => self.note(format!("Unknown command /{other}. Type / to see the list.")),
        }
        self.refresh();
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
        assert_eq!(capitalize("pause"), "Pause");
    }
}
