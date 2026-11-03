//! What Jackalope itself shows below the conversation — notes, `!` command
//! output — and brief confirmations in the status line.

use super::{App, Event};
use crate::brand;
use crate::clipboard;
use crate::shell::{self, Update};
use ratatui::style::Color;
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tone {
    Muted,
    Success,
    Warning,
    Danger,
}

impl Tone {
    pub fn color(self) -> Color {
        match self {
            Tone::Muted => brand::muted(),
            Tone::Success => brand::success(),
            Tone::Warning => brand::warning(),
            Tone::Danger => brand::danger(),
        }
    }
}

/// One item of the feed.
pub enum Entry {
    Note(String, Tone),
    /// An index into `App::shells`.
    Shell(usize),
}

/// A feed item and where it belongs: the conversation open when it was added
/// and how many of that conversation's messages came before it, so it stays
/// at that point in the history instead of trailing whatever arrives later.
pub struct Placed {
    pub entry: Entry,
    pub session: Option<String>,
    /// `None` until the conversation's messages have been read.
    pub after: Option<usize>,
}

/// Where the terminal's own view choices are kept, apart from `cli.json`,
/// which is rewritten whole when the start choice is remembered.
const VIEW: &str = "cli-view.json";

pub(super) fn top_bar_hidden() -> bool {
    crate::prefs::read_json::<serde_json::Value>(VIEW)
        .and_then(|value| value["hideTopBar"].as_bool())
        .unwrap_or(false)
}

impl App {
    /// Hides or shows the top bar, and remembers it for later sessions.
    pub(super) fn toggle_top_bar(&mut self) {
        self.top_bar_hidden = !self.top_bar_hidden;
        let _ = crate::prefs::write_json(
            VIEW,
            &serde_json::json!({ "hideTopBar": self.top_bar_hidden }),
        );
        self.flash(
            if self.top_bar_hidden {
                "Top bar hidden · Ctrl+T or /tabs shows it"
            } else {
                "Top bar shown"
            },
            Tone::Muted,
        );
    }

    pub(super) fn note(&mut self, text: impl Into<String>) {
        self.place(Entry::Note(text.into(), Tone::Muted));
    }

    pub(super) fn note_tone(&mut self, text: impl Into<String>, tone: Tone) {
        self.place(Entry::Note(text.into(), tone));
    }

    fn place(&mut self, entry: Entry) {
        let after = self
            .view
            .as_ref()
            .filter(|view| self.session.as_ref() == Some(&view.id))
            .map(|view| view.messages.len());
        self.feed.push(Placed {
            entry,
            session: self.session.clone(),
            after,
        });
    }

    /// Places items added before the open conversation was read at its end.
    pub(super) fn settle_feed(&mut self) {
        let Some(view) = self
            .view
            .as_ref()
            .filter(|view| self.session.as_ref() == Some(&view.id))
        else {
            return;
        };
        for placed in &mut self.feed {
            if placed.after.is_none() && placed.session == self.session {
                placed.after = Some(view.messages.len());
            }
        }
    }

    pub(super) fn flash(&mut self, text: impl Into<String>, tone: Tone) {
        self.flash = Some((text.into(), tone, Instant::now()));
    }

    /// Clears notes and finished command output; running commands stay.
    pub(super) fn clear_feed(&mut self) {
        let shells = &self.shells;
        self.feed
            .retain(|placed| matches!(placed.entry, Entry::Shell(run) if shells[run].running()));
    }

    pub(super) fn shells_running(&self) -> usize {
        self.shells.iter().filter(|run| run.running()).count()
    }

    /// Whether anything on screen moves: agent work or a running command.
    pub(super) fn animating(&self) -> bool {
        self.working()
            || self.shells_running() > 0
            || super::render::intro_sweep(self).is_some()
            || super::render::wordmark_glitch(self).is_some()
            || super::render::card_revealing(self)
            || (self
                .picker
                .as_ref()
                .is_some_and(|picker| picker.kind == super::pickers::PickerKind::Board)
                && self
                    .sessions
                    .iter()
                    .any(|session| crate::protocol::working(session.status.as_deref())))
    }

    pub(super) fn run_shell(&mut self, command: &str) {
        let index = self.shells.len();
        let events = self.events.clone();
        let run = shell::start(index, command, &self.workspace(), move |update| {
            let _ = events.send(Event::Shell(update));
        });
        self.shells.push(run);
        self.place(Entry::Shell(index));
    }

    pub(super) fn shell_update(&mut self, update: Update) {
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
    pub(super) fn interrupt_shells(&mut self) -> usize {
        let running: Vec<_> = self.shells.iter().filter(|run| run.running()).collect();
        for run in &running {
            run.interrupt();
        }
        running.len()
    }

    pub(super) fn copy(&mut self, text: &str) {
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
}
