//! The open conversation: its work state, questions, and moving between
//! conversations.

use super::feed::Tone;
use super::pickers::PickerKind;
use super::{App, Signal};
use crate::prefs;
use crate::protocol::{self, Question, Request, SessionSummary, SessionView};
use crossterm::terminal::SetTitle;
use std::io::Write;
use std::time::Duration;

/// Silence from running work worth pointing out in the status line.
const QUIET_AFTER: Duration = Duration::from_secs(45);

impl App {
    /// Whether an agent is working, so the status line animates.
    pub(super) fn working(&self) -> bool {
        self.view.as_ref().is_some_and(|view| {
            protocol::present(view.error.as_deref()).is_none()
                && view.questions.is_empty()
                && protocol::working(view.status.as_deref())
        })
    }

    /// How long running work has reported nothing new, once that is long
    /// enough to mention.
    pub(super) fn quiet(&self) -> Option<Duration> {
        self.last_progress
            .as_ref()
            .filter(|_| self.working())
            .map(|(_, at)| at.elapsed())
            .filter(|quiet| *quiet >= QUIET_AFTER)
    }

    /// How long the current run has been working, as the terminal saw it.
    pub(super) fn elapsed(&self) -> Option<Duration> {
        let run = self.view.as_ref()?.run_id.as_ref()?;
        self.work_started
            .as_ref()
            .filter(|(started, _)| started == run && self.working())
            .map(|(_, at)| at.elapsed())
    }

    /// The state of the conversation's work and the tone that carries it.
    pub(super) fn work_state(&self, view: &SessionView) -> (String, Tone) {
        if protocol::present(view.error.as_deref()).is_some() {
            // Amber, not red: the work is waiting on a decision, not broken.
            return ("needs you".into(), Tone::Warning);
        }
        if !view.questions.is_empty() {
            return ("waiting on your answer".into(), Tone::Warning);
        }
        if view.paused {
            return ("paused".into(), Tone::Warning);
        }
        if view.merged && !self.working() {
            return ("done · merged".into(), Tone::Success);
        }
        let state = view
            .step
            .clone()
            .or_else(|| view.status.as_deref().map(status_label))
            .unwrap_or_else(|| "ready".into());
        let status = view.status.as_deref().unwrap_or_default();
        let tone = if self.working() {
            Tone::Muted
        } else if protocol::FAILED.contains(&status) || protocol::STOPPED.contains(&status) {
            Tone::Danger
        } else {
            Tone::Success
        };
        (state, tone)
    }

    /// Keeps the window title on the conversation's state and rings the
    /// bell when work finishes or needs an answer, so a terminal in the
    /// background still says when to come back. `JACKALOPE_BELL=0` silences it.
    pub(super) fn signal(&mut self) {
        let Some(view) = &self.view else {
            if self.signalled.take().is_some() {
                let _ = crossterm::execute!(std::io::stdout(), SetTitle("jackalope"));
            }
            return;
        };
        let (_, tone) = self.work_state(view);
        let signal = if self.pending_deviation().is_some() {
            Signal::NeedsYou
        } else if self.working() {
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
        let bell = prefs::env_flag("JACKALOPE_BELL") != Some(false);
        if bell && (finished || (previous.is_some() && signal == Signal::NeedsYou)) {
            let _ = stdout.write_all(b"\x07");
            let _ = stdout.flush();
        }
    }

    /// The question an agent is waiting on, if any. Answers go to the oldest.
    pub(super) fn question(&self) -> Option<&Question> {
        self.view
            .as_ref()
            .and_then(|view| view.questions.first())
            .or_else(|| self.plan_question())
    }

    /// The conversation to continue when `question` belongs to an attempt that
    /// has already ended, so the run itself can no longer take an answer.
    pub(super) fn ended_on(&self, question: &Question) -> Option<String> {
        let view = self.view.as_ref()?;
        (view.run_id.as_deref() == Some(question.run_id.as_str())
            && !protocol::working(view.status.as_deref()))
        .then(|| self.session.clone())
        .flatten()
    }

    /// Opens a question with options as a picker, once, so answering is one
    /// keypress. Open questions are answered by typing into the input.
    pub(super) fn offer_question(&mut self) {
        let current = self.question().map(|question| question.id.clone());
        if let Some(picker) = self
            .picker
            .as_ref()
            .filter(|picker| picker.kind == PickerKind::Question)
        {
            if picker.subject == current {
                return;
            }
            // Answered elsewhere, such as in the app: a stale list would send
            // its choice to whichever question is waiting now.
            self.picker = None;
        }
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

    /// Answers the question with this id, unless it is no longer the one
    /// waiting, so a choice never lands on a different question.
    pub(super) fn answer_to(&mut self, prompt: &str, text: String) {
        if self
            .question()
            .is_some_and(|question| question.id == prompt)
        {
            self.answer(text);
        } else {
            self.note("That question was already answered.");
            self.refresh();
        }
    }

    pub(super) fn answer(&mut self, text: String) {
        let Some(question) = self.question().cloned() else {
            return;
        };
        if let Some(session_id) = self.ended_on(&question) {
            // The attempt stopped before the answer: continue the conversation
            // with it, as the app does, since the run can no longer take one.
            let chosen = serde_json::from_str::<Vec<String>>(&text)
                .map(|chosen| chosen.join(", "))
                .unwrap_or(text);
            let message = format!("You asked: {}\nMy answer: {chosen}", question.question);
            if self
                .request(Request::Send {
                    session_id,
                    text: message,
                    draft_revision: None,
                })
                .is_some()
            {
                self.flash("Answered · continuing the conversation", Tone::Success);
            }
            self.refresh();
            return;
        }
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

    /// Where `!` commands run and `@` mentions list: the conversation's own
    /// worktree when it has one, so they see what the agent sees.
    pub(super) fn workspace(&self) -> String {
        self.view
            .as_ref()
            .and_then(|view| view.workspace.clone())
            .filter(|path| !path.is_empty() && std::path::Path::new(path).is_dir())
            .unwrap_or_else(|| self.project.path.clone())
    }

    pub(super) fn sessions_here(&self) -> Vec<&SessionSummary> {
        self.sessions
            .iter()
            .filter(|session| session.project_id == self.project.id)
            .collect()
    }

    /// This project's conversations first, then the rest, each newest first.
    pub(super) fn session_order(&self) -> Vec<String> {
        let (here, elsewhere): (Vec<_>, Vec<_>) = self
            .sessions
            .iter()
            .partition(|session| session.project_id == self.project.id);
        here.into_iter()
            .chain(elsewhere)
            .map(|session| session.id.clone())
            .collect()
    }

    /// The conversations shown as tabs, in `session_order`: those that need
    /// you, the open one and any opened in this terminal. The rest stay in
    /// `/sessions`, so a new terminal does not fill with past conversations.
    pub(super) fn tab_order(&self) -> Vec<String> {
        self.session_order()
            .into_iter()
            .filter(|id| {
                self.session.as_ref() == Some(id)
                    || self.opened.contains(id)
                    || self
                        .sessions
                        .iter()
                        .find(|session| &session.id == id)
                        .is_some_and(needs_you)
            })
            .collect()
    }

    /// Shows the conversation at `index` in the tabs (Alt+1 to Alt+9).
    pub(super) fn jump_session(&mut self, index: usize) {
        let order = self.tab_order();
        match order.get(index) {
            Some(id) if Some(id) != self.session.as_ref() => self.show(Some(id.clone())),
            Some(_) => {}
            None => self.flash(format!("No conversation {}", index + 1), Tone::Muted),
        }
    }

    /// Moves to the next (`1`) or previous (`-1`) tab, across projects.
    pub(super) fn step_session(&mut self, direction: isize) {
        let order = self.tab_order();
        if order.is_empty() {
            self.flash(
                "No conversations need you · /sessions lists them all",
                Tone::Muted,
            );
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
        let id = order[next].clone();
        let title = self
            .sessions
            .iter()
            .find(|session| session.id == id)
            .map(|session| session.title.clone())
            .unwrap_or_default();
        self.show(Some(id));
        self.flash(
            format!("{}/{} · {title}", next + 1, order.len()),
            Tone::Muted,
        );
    }

    pub(super) fn project_name(&self, id: &str) -> String {
        self.projects
            .iter()
            .find(|project| project.id == id)
            .map(|project| project.name.clone())
            .unwrap_or_else(|| "another project".into())
    }

    pub(super) fn agent_name(&self, id: &str) -> String {
        self.overview
            .as_ref()
            .and_then(|overview| overview.as_ref().ok())
            .and_then(|overview| overview.agents.iter().find(|agent| agent.id == id))
            .map(|agent| agent.name.clone())
            .unwrap_or_else(|| id.to_string())
    }
}

/// A run status in words for the status line.
fn status_label(status: &str) -> String {
    match status {
        "review" => "done · ready to review",
        "reviewed" => "done · reviewed",
        "running" => "working",
        "starting" => "starting",
        "routing" => "choosing an agent",
        "queued" => "queued",
        "stopping" => "stopping",
        "stopped" | "cancelled" | "canceled" => "stopped",
        "interrupted" => "interrupted",
        "failed" | "error" => "failed",
        other => other,
    }
    .into()
}

/// An agent is waiting on an answer, or the work failed.
pub(super) fn needs_you(session: &SessionSummary) -> bool {
    session.asking || protocol::present(session.error.as_deref()).is_some()
}
