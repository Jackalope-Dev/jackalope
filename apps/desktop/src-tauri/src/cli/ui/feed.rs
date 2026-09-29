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

/// One item of the feed, oldest first.
pub enum Entry {
    Note(String, Tone),
    /// An index into `App::shells`.
    Shell(usize),
}

impl App {
    pub(super) fn note(&mut self, text: impl Into<String>) {
        self.feed.push(Entry::Note(text.into(), Tone::Muted));
    }

    pub(super) fn note_tone(&mut self, text: impl Into<String>, tone: Tone) {
        self.feed.push(Entry::Note(text.into(), tone));
    }

    pub(super) fn flash(&mut self, text: impl Into<String>, tone: Tone) {
        self.flash = Some((text.into(), tone, Instant::now()));
    }

    /// Clears notes and finished command output; running commands stay.
    pub(super) fn clear_feed(&mut self) {
        let shells = &self.shells;
        self.feed
            .retain(|entry| matches!(entry, Entry::Shell(run) if shells[*run].running()));
    }

    pub(super) fn shells_running(&self) -> usize {
        self.shells.iter().filter(|run| run.running()).count()
    }

    /// Whether anything on screen moves: agent work or a running command.
    pub(super) fn animating(&self) -> bool {
        self.working() || self.shells_running() > 0
    }

    pub(super) fn run_shell(&mut self, command: &str) {
        let index = self.shells.len();
        let events = self.events.clone();
        let run = shell::start(index, command, &self.workspace(), move |update| {
            let _ = events.send(Event::Shell(update));
        });
        self.shells.push(run);
        self.feed.push(Entry::Shell(index));
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
