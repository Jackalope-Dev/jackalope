//! Plan mode in the conversation view: `/plan <goal>` starts a read-only
//! planning interview, its questions use the usual question card, and the
//! pinned plan panel shows the draft, the approval gate and live progress.

use super::feed::Tone;
use super::App;
use crate::connection::short;
use crate::protocol::{PlanView, Question, Request, Response};
use std::time::{Duration, Instant};

/// Plans re-read at most this often while work is moving.
const REFRESH_EVERY: Duration = Duration::from_millis(700);

pub struct PlanPane {
    pub id: String,
    pub view: Option<PlanView>,
    pub open: bool,
    read_at: Option<Instant>,
    /// Plans listed by `/plans`, so `/plans 2` can open one.
    pub listed: Vec<String>,
}

impl PlanPane {
    fn new(id: String, view: Option<PlanView>) -> Self {
        Self {
            id,
            view,
            open: true,
            read_at: Some(Instant::now()),
            listed: Vec::new(),
        }
    }
}

/// The `/` commands plan mode handles.
pub const COMMANDS: &[&str] = &[
    "plan",
    "plans",
    "revise",
    "approve",
    "replan",
    "export",
    "deviation",
];

impl App {
    pub(super) fn plan_shown(&self) -> bool {
        self.plan.as_ref().is_some_and(|plan| plan.open)
    }

    pub(super) fn plan_view(&self) -> Option<&PlanView> {
        self.plan.as_ref()?.view.as_ref()
    }

    /// The planner's pending question, answered like any agent question.
    pub(super) fn plan_question(&self) -> Option<&Question> {
        self.plan_view()?.questions.first()
    }

    fn set_plan(&mut self, view: PlanView) {
        match &mut self.plan {
            Some(pane) if pane.id == view.id => {
                pane.view = Some(view);
                pane.read_at = Some(Instant::now());
                pane.open = true;
            }
            _ => self.plan = Some(PlanPane::new(view.id.clone(), Some(view))),
        }
    }

    fn plan_request(&mut self, request: Request) -> Option<PlanView> {
        match self.request(request)? {
            Response::Plan { plan } => {
                let view = *plan;
                self.set_plan(view.clone());
                Some(view)
            }
            Response::Exported { path } => {
                self.flash(format!("Saved to {path} · not committed"), Tone::Success);
                None
            }
            _ => None,
        }
    }

    /// Re-reads the open plan after work changed. Returns whether it changed.
    pub(super) fn refresh_plan(&mut self) -> bool {
        let Some(pane) = self.plan.as_ref() else {
            return false;
        };
        if pane.read_at.is_some_and(|at| at.elapsed() < REFRESH_EVERY) {
            return false;
        }
        let id = pane.id.clone();
        let before = pane.view.as_ref().map(|view| {
            (
                view.status.clone(),
                view.revision,
                view.questions.len(),
                view.progress.clone(),
            )
        });
        if let Ok(Response::Plan { plan }) =
            self.connection.send(&Request::PlanDetail { plan_id: id })
        {
            let after = (
                plan.status.clone(),
                plan.revision,
                plan.questions.len(),
                plan.progress.clone(),
            );
            let drafted = before
                .as_ref()
                .is_some_and(|before| before.1 != plan.revision && plan.revision.is_some());
            self.set_plan(*plan);
            if drafted {
                self.note_tone(
                    "Plan ready · /approve to run it, /revise <comments> to keep planning, Ctrl+G to edit",
                    Tone::Success,
                );
            }
            self.offer_question();
            return before.as_ref() != Some(&after);
        }
        false
    }

    fn current_plan(&mut self) -> Option<PlanView> {
        let view = self.plan_view().cloned();
        if view.is_none() {
            self.note("No plan is open. Start one with /plan <goal> or open one with /plans.");
        }
        view
    }

    /// Handles plan commands; false when `command` is not one of them.
    pub(super) fn plan_command(&mut self, command: &str, argument: &str) -> bool {
        match command {
            "plan" if argument.is_empty() => match &mut self.plan {
                Some(pane) => pane.open = !pane.open,
                None => self.note("Plan before changing code: /plan <what you want>."),
            },
            "plan" => {
                if let Some(view) = self.plan_request(Request::PlanStart {
                    project_path: self.project.path.clone(),
                    goal: argument.into(),
                    agent: self.next_agent.clone(),
                }) {
                    self.note_tone(
                        format!(
                            "Planning {} · read-only · the planner asks a few questions, then drafts a plan",
                            short(&view.id)
                        ),
                        Tone::Muted,
                    );
                }
            }
            "plans" => self.list_plans(argument),
            "revise" if argument.is_empty() => {
                self.note("Add your comments: /revise <what to change>")
            }
            "revise" => self.plan_action("keep", argument, "Planning again with your comments"),
            "replan" => self.plan_action("replan", argument, "Re-planning from what is done"),
            "export" => {
                if let Some(view) = self.current_plan() {
                    let _ = self.plan_request(Request::PlanAction {
                        plan_id: view.id,
                        action: "export".into(),
                        text: argument.into(),
                        revision: None,
                        hash: None,
                    });
                }
            }
            "approve" => self.approve(argument),
            "deviation" => self.deviation(argument),
            _ => return false,
        }
        true
    }

    fn plan_action(&mut self, action: &str, text: &str, done: &str) {
        let Some(view) = self.current_plan() else {
            return;
        };
        if self
            .plan_request(Request::PlanAction {
                plan_id: view.id,
                action: action.into(),
                text: text.into(),
                revision: None,
                hash: None,
            })
            .is_some()
        {
            self.flash(done.to_string(), Tone::Muted);
        }
    }

    fn approve(&mut self, argument: &str) {
        let Some(view) = self.current_plan() else {
            return;
        };
        let shape = if argument.is_empty() {
            view.shape.clone()
        } else {
            argument.to_ascii_lowercase()
        };
        if !["single", "subtasks", "swarm"].contains(&shape.as_str()) {
            self.note("Approve as single, subtasks or swarm: /approve subtasks");
            return;
        }
        if view.planning || view.revision.is_none() {
            self.note("There is no draft to approve yet.");
            return;
        }
        if let Some(view) = self.plan_request(Request::PlanAction {
            plan_id: view.id.clone(),
            action: "approve".into(),
            text: shape.clone(),
            revision: view.revision,
            hash: view.hash.clone(),
        }) {
            self.flash(
                format!(
                    "Approved revision {} · running as {shape}",
                    view.revision.unwrap_or_default()
                ),
                Tone::Success,
            );
        }
    }

    fn deviation(&mut self, argument: &str) {
        let Some(view) = self.current_plan() else {
            return;
        };
        let Some(deviation) = view
            .deviations
            .iter()
            .find(|deviation| deviation.status == "pending")
            .cloned()
        else {
            self.note("No deviation is waiting on you.");
            return;
        };
        let action = match argument {
            "accept" => "accept",
            "redo" => "redo",
            "replan" => "replan-deviation",
            _ => {
                self.note(format!(
                    "{} · /deviation accept (amend the plan), redo or replan",
                    deviation.summary
                ));
                return;
            }
        };
        let _ = self.plan_request(Request::PlanAction {
            plan_id: view.id,
            action: action.into(),
            text: deviation.id,
            revision: None,
            hash: None,
        });
    }

    fn list_plans(&mut self, argument: &str) {
        if let Ok(number) = argument.parse::<usize>() {
            let id = self
                .plan
                .as_ref()
                .and_then(|pane| pane.listed.get(number.wrapping_sub(1)).cloned());
            match id {
                Some(id) => {
                    let _ = self.plan_request(Request::PlanDetail { plan_id: id });
                }
                None => self.note("Run /plans first, then /plans <number>."),
            }
            return;
        }
        let Some(Response::Plans { plans }) = self.request(Request::Plans {
            project_path: self.project.path.clone(),
        }) else {
            return;
        };
        if plans.is_empty() {
            self.note("No plans in this project yet. Start one with /plan <goal>.");
            return;
        }
        for (index, plan) in plans.iter().enumerate().take(20) {
            self.note(format!(
                "{:>2}. {:<9} r{:<3} {}",
                index + 1,
                plan.status,
                plan.revision.unwrap_or_default(),
                plan.title
            ));
        }
        self.note("Open one with /plans <number>.");
        let listed = plans.into_iter().take(20).map(|plan| plan.id).collect();
        match &mut self.plan {
            Some(pane) => pane.listed = listed,
            None => {
                let mut pane = PlanPane::new(String::new(), None);
                pane.open = false;
                pane.listed = listed;
                self.plan = Some(pane);
            }
        }
    }

    /// Ctrl+G: edit the plan in `$VISUAL` or `$EDITOR`, then save it as a
    /// new revision when it changed.
    pub(super) fn request_plan_edit(&mut self) {
        match self.plan_view() {
            Some(view) if view.markdown.is_some() && !view.planning => self.plan_edit = true,
            Some(_) => self.flash("The plan is still being drafted", Tone::Muted),
            None => self.flash("No plan is open", Tone::Muted),
        }
    }

    pub(super) fn edit_plan_externally(
        &mut self,
        terminal: &mut ratatui::DefaultTerminal,
        enhanced: bool,
    ) -> Result<(), String> {
        let Some(view) = self.plan_view().cloned() else {
            return Ok(());
        };
        let (Some(markdown), Some(revision)) = (view.markdown.clone(), view.revision) else {
            return Ok(());
        };
        let path = std::env::temp_dir().join(format!("jackalope-plan-{}.md", short(&view.id)));
        std::fs::write(&path, &markdown).map_err(|error| error.to_string())?;
        super::leave_modes(enhanced);
        ratatui::restore();
        let status = editor_command(&path).status();
        crossterm::terminal::enable_raw_mode().map_err(|error| error.to_string())?;
        crossterm::execute!(std::io::stdout(), crossterm::terminal::EnterAlternateScreen)
            .map_err(|error| error.to_string())?;
        super::enter_modes();
        terminal.clear().map_err(|error| error.to_string())?;
        let edited = std::fs::read_to_string(&path).map_err(|error| error.to_string());
        let _ = std::fs::remove_file(&path);
        match (status, edited) {
            (Ok(status), Ok(edited)) if status.success() => {
                if edited.replace("\r\n", "\n") == markdown {
                    self.flash("Plan unchanged", Tone::Muted);
                } else if self
                    .plan_request(Request::PlanAction {
                        plan_id: view.id,
                        action: "save".into(),
                        text: edited,
                        revision: Some(revision),
                        hash: None,
                    })
                    .is_some()
                {
                    self.flash("Saved your edit as a new revision", Tone::Success);
                }
            }
            (Ok(_), _) => self.flash(
                "The editor exited with an error; nothing saved",
                Tone::Warning,
            ),
            (Err(error), _) => {
                self.note(format!("Could not open an editor: {error}. Set $EDITOR."))
            }
        }
        Ok(())
    }
}

fn editor_command(path: &std::path::Path) -> std::process::Command {
    let configured = std::env::var("VISUAL")
        .ok()
        .or_else(|| std::env::var("EDITOR").ok())
        .filter(|editor| !editor.trim().is_empty());
    let editor = configured.unwrap_or_else(|| {
        if cfg!(windows) {
            "notepad".into()
        } else {
            "vi".into()
        }
    });
    // Editors are often configured with arguments, such as `code --wait`.
    let mut parts = editor.split_whitespace();
    let mut command = std::process::Command::new(parts.next().unwrap_or("vi"));
    command.args(parts).arg(path);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_commands_appear_in_the_slash_menu() {
        for name in COMMANDS {
            assert!(
                super::super::commands::COMMANDS
                    .iter()
                    .any(|(listed, _)| listed == name),
                "/{name} is missing from the menu"
            );
        }
    }

    #[test]
    fn editors_with_arguments_split_into_a_command() {
        std::env::set_var("VISUAL", "code --wait");
        let command = editor_command(std::path::Path::new("plan.md"));
        assert_eq!(command.get_program(), "code");
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args, ["--wait", "plan.md"]);
        std::env::remove_var("VISUAL");
    }
}
