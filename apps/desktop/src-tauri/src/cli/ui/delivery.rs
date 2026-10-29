//! Delivering finished work from the terminal: `/merge` and `/pr`, with the
//! same preparation and confirmation as `jackalope merge` and `jackalope pr`.

use super::feed::Tone;
use super::pickers::{Action, Item, Picker, PickerKind};
use super::App;
use crate::protocol::{self, Request, Response};

impl App {
    /// `/merge [message]`: prepares the merge of this conversation's latest
    /// attempt and asks before applying it, as the app's merge review does.
    pub(super) fn merge(&mut self, message: &str) {
        let (Some(session_id), Some(view)) = (self.session.clone(), self.view.clone()) else {
            self.note("Open a conversation to merge its work.");
            return;
        };
        if self.working() {
            self.note("The agent is still working. Merge once it finishes.");
            return;
        }
        let plan = match self.request(Request::MergePrepare {
            session_id,
            message: Some(message.trim().to_string()).filter(|text| !text.is_empty()),
        }) {
            Some(Response::Merge { plan }) => plan,
            _ => return,
        };
        if !plan.conflicts.is_empty() {
            self.note(format!(
                "This work conflicts with {}: {}. Resolve them in the app's merge review (/review).",
                plan.target_branch,
                plan.conflicts.join(", ")
            ));
            return;
        }
        if plan.files.is_empty() {
            self.note("There are no changes to merge.");
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
                    action: Action::Dismiss,
                },
            ],
            filter: String::new(),
            selected: 0,
            subject: view.run_id.clone(),
            checked: Vec::new(),
        });
    }

    /// Pauses the conversation so no new message starts mid-merge, then
    /// merges. A merge that fails resumes what this paused.
    pub(super) fn apply_merge(&mut self, plan_id: String, cleanup: bool) {
        let Some((session_id, view)) = self.session.clone().zip(self.view.clone()) else {
            return;
        };
        let pause = |app: &mut Self, action: &str| {
            app.request(Request::SessionAction {
                session_id: session_id.clone(),
                action: action.into(),
                message_id: None,
            })
            .is_some()
        };
        if !view.paused && !pause(self, "pause") {
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
            }
            _ if !view.paused => {
                pause(self, "resume");
            }
            _ => {}
        }
        self.refresh();
    }

    /// `/pr [title]`: commits what is left with the project's commit settings,
    /// pushes the branch and opens a draft pull request after asking.
    pub(super) fn pull_request(&mut self, title: &str) {
        let Some(view) = self.view.clone().filter(|_| self.session.is_some()) else {
            self.note("Open a conversation to open a pull request for its work.");
            return;
        };
        if self.working() {
            self.note("The agent is still working. Open a pull request once it finishes.");
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
