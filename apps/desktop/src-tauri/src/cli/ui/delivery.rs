//! Delivering finished work from the terminal: `/merge` and `/pr`, with the
//! same preparation and confirmation as `jackalope merge` and `jackalope pr`.

use super::feed::Tone;
use super::pickers::{Action, Item, Picker, PickerKind};
use super::App;
use crate::protocol::{self, Request, Response};

impl App {
    /// `/merge [message]`: pauses the conversation, which the host requires
    /// before it prepares a merge, prepares the merge of its latest attempt and
    /// asks before applying it, as the app's merge review does. A merge that
    /// does not go ahead resumes what this paused.
    pub(super) fn merge(&mut self, message: &str) {
        let (Some(session_id), Some(view)) = (self.session.clone(), self.view.clone()) else {
            self.flash("Open a conversation to merge its work", Tone::Muted);
            return;
        };
        if self.working() {
            self.flash(
                "The agent is still working. Merge once it finishes",
                Tone::Muted,
            );
            return;
        }
        if !view.paused {
            let paused = self.request(Request::SessionAction {
                session_id: session_id.clone(),
                action: "pause".into(),
                message_id: None,
            });
            if paused.is_none() {
                return;
            }
            self.merge_paused = Some(session_id.clone());
        }
        let plan = match self.request(Request::MergePrepare {
            session_id,
            message: Some(message.trim().to_string()).filter(|text| !text.is_empty()),
        }) {
            Some(Response::Merge { plan }) => plan,
            _ => {
                self.release_merge_pause();
                return;
            }
        };
        if !plan.conflicts.is_empty() {
            self.note(format!(
                "This work conflicts with {}: {}. Resolve them in the app's merge review (/review).",
                plan.target_branch,
                plan.conflicts.join(", ")
            ));
            self.release_merge_pause();
            return;
        }
        if plan.files.is_empty() {
            self.flash("There are no changes to merge", Tone::Muted);
            self.release_merge_pause();
            return;
        }
        let count = plan.files.len();
        for file in plan.files.iter().take(12) {
            self.note(format!("  {file}"));
        }
        if count > 12 {
            self.note(format!("  … and {} more", count - 12));
        }
        let cleanup = if plan.cleanup {
            " · the worktree is removed afterwards"
        } else {
            ""
        };
        self.picker = Some(Picker {
            kind: PickerKind::Delivery,
            title: format!("Merge {} into {}?{cleanup}", view.title, plan.target_branch),
            items: vec![
                Item {
                    label: format!(
                        "Merge {count} {} into {}",
                        if count == 1 { "file" } else { "files" },
                        plan.target_branch
                    ),
                    detail: format!(
                        "commit: {}",
                        plan.commit_message.lines().next().unwrap_or_default()
                    ),
                    action: Action::ApplyMerge {
                        plan_id: plan.id.clone(),
                        cleanup: plan.cleanup,
                    },
                },
                Item {
                    label: "Not now".into(),
                    detail: "nothing changes".into(),
                    action: Action::CancelMerge,
                },
            ],
            filter: String::new(),
            selected: 0,
            subject: view.run_id.clone(),
            checked: Vec::new(),
        });
    }

    /// Resumes a conversation `/merge` paused, when the merge does not go ahead.
    pub(super) fn release_merge_pause(&mut self) {
        if let Some(session_id) = self.merge_paused.take() {
            self.request(Request::SessionAction {
                session_id,
                action: "resume".into(),
                message_id: None,
            });
        }
    }

    /// Merges a prepared plan; `/merge` already paused the conversation so no
    /// new message starts mid-merge. A merge that fails resumes what it paused.
    pub(super) fn apply_merge(&mut self, plan_id: String, cleanup: bool) {
        if self.session.is_none() {
            return;
        }
        match self.request(Request::MergeApply { plan_id, cleanup }) {
            Some(Response::Merge { plan }) => {
                self.note_tone(
                    format!(
                        "Merged into {} · the conversation is paused; /unpause to keep working",
                        plan.target_branch
                    ),
                    Tone::Success,
                );
                for error in plan.cleanup_errors {
                    self.note(format!("Could not remove the worktree: {error}"));
                }
                self.merge_paused = None;
            }
            _ => self.release_merge_pause(),
        }
        self.refresh();
    }

    /// `/pr [title]`: commits what is left with the project's commit settings,
    /// pushes the branch and opens a draft pull request after asking.
    pub(super) fn pull_request(&mut self, title: &str) {
        let Some(view) = self.view.clone().filter(|_| self.session.is_some()) else {
            self.flash(
                "Open a conversation to open a pull request for its work",
                Tone::Muted,
            );
            return;
        };
        if self.working() {
            self.flash(
                "The agent is still working. Open a pull request once it finishes",
                Tone::Muted,
            );
            return;
        }
        let title = Some(title.trim())
            .filter(|title| !title.is_empty())
            .unwrap_or(view.title.trim())
            .to_string();
        let branch = protocol::present(view.branch.as_deref())
            .unwrap_or("the branch")
            .to_string();
        let item = |label: &str, detail: &str, draft: bool| Item {
            label: label.into(),
            detail: detail.into(),
            action: Action::OpenPullRequest {
                title: title.clone(),
                draft,
            },
        };
        self.picker = Some(Picker {
            kind: PickerKind::Delivery,
            title: format!("Push {branch} and open a pull request · {title}"),
            items: vec![
                item(
                    "Open a draft pull request",
                    "commits what is left first",
                    true,
                ),
                item(
                    "Open it ready for review",
                    "commits what is left first",
                    false,
                ),
                Item {
                    label: "Not now".into(),
                    detail: String::new(),
                    action: Action::Dismiss,
                },
            ],
            filter: String::new(),
            selected: 0,
            subject: view.run_id.clone(),
            checked: Vec::new(),
        });
    }

    pub(super) fn open_pull_request(&mut self, title: String, draft: bool) {
        let Some((session_id, view)) = self.session.clone().zip(self.view.clone()) else {
            return;
        };
        let body: String = view.result.trim().chars().take(4000).collect();
        if let Some(Response::PullRequest { url }) = self.request(Request::PullRequest {
            session_id,
            title,
            body,
            draft,
        }) {
            self.note_tone(format!("Opened {url}"), Tone::Success);
        }
        self.refresh();
    }
}
