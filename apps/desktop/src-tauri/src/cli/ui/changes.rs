//! The changes panel: files the conversation's checkout changed and the diff
//! of the one selected. It opens by itself the first time work changes a
//! file, and stays closed for that conversation once the user hides it.

use super::feed::Tone;
use super::App;
use crate::git::{self, FileChange};
use std::cell::RefCell;

#[derive(Default)]
pub struct Panel {
    pub open: bool,
    /// The user hid the panel in this conversation, so it no longer opens by itself.
    dismissed: bool,
    /// The selected file's path, kept by name so it survives the list changing.
    selected: Option<String>,
    /// The selected file's diff, and the list version it was read for.
    diff: RefCell<Option<(String, u64, Vec<String>)>>,
}

impl App {
    pub(super) fn set_changes(&mut self, changes: Vec<FileChange>) {
        if changes == self.changes {
            return;
        }
        if self.changes.is_empty() && !changes.is_empty() && !self.panel.dismissed {
            self.panel.open = true;
        }
        self.changes = changes;
        self.changes_version += 1;
    }

    /// Forgets the panel's state, for a different conversation.
    pub(super) fn reset_panel(&mut self) {
        self.panel = Panel::default();
        self.changes = Vec::new();
        self.changes_version += 1;
    }

    pub(super) fn toggle_panel(&mut self) {
        if self.panel.open {
            self.panel.open = false;
            self.panel.dismissed = true;
        } else if self.changes.is_empty() {
            self.flash("No changed files yet", Tone::Muted);
        } else {
            self.panel.open = true;
        }
    }

    /// Whether the panel is showing.
    pub(super) fn panel_shown(&self) -> bool {
        self.panel.open && !self.changes.is_empty()
    }

    pub(super) fn selected_index(&self) -> usize {
        self.panel
            .selected
            .as_ref()
            .and_then(|path| self.changes.iter().position(|change| &change.path == path))
            .unwrap_or(0)
    }

    /// Moves the selection `delta` rows, stopping at either end.
    pub(super) fn step_change(&mut self, delta: isize) {
        if self.changes.is_empty() {
            return;
        }
        let last = self.changes.len() as isize - 1;
        let index = (self.selected_index() as isize + delta).clamp(0, last) as usize;
        self.panel.selected = Some(self.changes[index].path.clone());
    }

    /// The selected file's diff, read again only when it or the list changes.
    pub(super) fn selected_diff(&self) -> Vec<String> {
        let Some(change) = self.changes.get(self.selected_index()) else {
            return Vec::new();
        };
        let mut cache = self.panel.diff.borrow_mut();
        if let Some((path, version, lines)) = cache.as_ref() {
            if *path == change.path && *version == self.changes_version {
                return lines.clone();
            }
        }
        let lines = git::file_diff(&self.workspace(), &self.project.path, change);
        *cache = Some((change.path.clone(), self.changes_version, lines.clone()));
        lines
    }
}
