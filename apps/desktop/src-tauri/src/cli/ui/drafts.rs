//! The message being typed in a conversation, shared with the app's composer:
//! opening a conversation brings back what was typed for it in either place,
//! and typing here saves a moment after the keys stop.

use super::App;
use crate::protocol::{Request, Response};
use std::time::{Duration, Instant};

/// How long typing pauses before the draft is saved.
const SAVE_AFTER: Duration = Duration::from_millis(600);

/// The shared draft of the open conversation, as last saved or adopted.
pub struct DraftSync {
    session: String,
    revision: u64,
    saved: String,
    /// When the input first differed from `saved`, while unsaved.
    changed_at: Option<Instant>,
    /// Saves of this text failed in a row; an older app cannot take drafts.
    failures: (String, u8),
}

impl App {
    /// The draft revision a message sent now was typed in, so sending clears it.
    pub(super) fn draft_revision(&self, session: &str) -> Option<u64> {
        self.draft_sync
            .as_ref()
            .filter(|sync| sync.session == session)
            .map(|sync| sync.revision)
    }

    /// After a send: the host emptied the draft at the next revision.
    pub(super) fn draft_sent(&mut self) {
        if let Some(sync) = self.draft_sync.as_mut() {
            sync.revision += 1;
            sync.saved.clear();
            sync.changed_at = None;
        }
    }

    /// Takes the open conversation's saved draft into the input, unless this
    /// terminal holds text of its own that is not saved yet.
    pub(super) fn adopt_draft(&mut self) {
        let (Some(session), Some(view)) = (self.session.clone(), self.view.as_ref()) else {
            return;
        };
        let (text, revision) = (view.draft.clone(), view.draft_revision);
        match self.draft_sync.as_mut() {
            Some(sync) if sync.session == session => {
                if revision > sync.revision && self.editor.text() == sync.saved {
                    sync.revision = revision;
                    sync.saved = text.clone();
                    self.editor.set(text);
                }
            }
            _ => {
                if self.editor.text().trim().is_empty() && !text.is_empty() {
                    self.editor.set(text.clone());
                }
                self.draft_sync = Some(DraftSync {
                    session,
                    revision,
                    saved: text,
                    changed_at: None,
                    failures: (String::new(), 0),
                });
            }
        }
    }

    /// Before showing another conversation: saves this one's draft now and
    /// clears the input when it only held that draft.
    pub(super) fn leave_draft(&mut self) {
        self.save_draft(true);
        if let Some(sync) = self.draft_sync.take() {
            if self.editor.text() == sync.saved {
                self.editor.set(String::new());
            }
        }
    }

    /// Saves the input as the shared draft once typing has paused, or at once
    /// when `now`. Commands and answers to a question are not messages, so they
    /// are not saved. Returns nothing to draw: the input already shows the text.
    pub(super) fn save_draft(&mut self, now: bool) {
        let text = self.editor.text().to_string();
        let answering = self.question().is_some();
        let Some(sync) = self
            .draft_sync
            .as_mut()
            .filter(|sync| self.session.as_ref() == Some(&sync.session))
        else {
            return;
        };
        let given_up = sync.failures.0 == text && sync.failures.1 >= 3;
        if text == sync.saved || answering || given_up || text.starts_with(['/', '!']) {
            sync.changed_at = None;
            return;
        }
        let at = *sync.changed_at.get_or_insert_with(Instant::now);
        if !now && at.elapsed() < SAVE_AFTER {
            return;
        }
        let request = Request::Draft {
            session_id: sync.session.clone(),
            text: text.clone(),
            revision: sync.revision,
        };
        let latest = self.view.as_ref().map(|view| view.draft_revision);
        let saved = self.connection.send(&request);
        let Some(sync) = self.draft_sync.as_mut() else {
            return;
        };
        match saved {
            Ok(Response::Draft { revision }) => {
                sync.revision = revision;
                sync.saved = text;
                sync.changed_at = None;
                sync.failures = (String::new(), 0);
            }
            // Saved elsewhere first: this terminal's newer typing wins on the
            // next try. Failures stay quiet; the input keeps the text.
            _ => {
                if let Some(latest) = latest.filter(|latest| *latest > sync.revision) {
                    sync.revision = latest;
                }
                let count = if sync.failures.0 == text {
                    sync.failures.1
                } else {
                    0
                };
                sync.failures = (text, count.saturating_add(1));
                sync.changed_at = Some(Instant::now());
            }
        }
    }
}
