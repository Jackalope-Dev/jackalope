//! Pickers: filterable lists over conversations, projects, agents, settings,
//! history, learned lessons and an agent's question.

use super::feed::Tone;
use super::App;
use crate::brand;
use crate::connection::short;
use crate::files;
use crate::host::{self, ColdStart};
use crate::protocol::{self, AgentStatus, Learning, Project, Request, Response, SessionSummary};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// What choosing a picker row does.
#[derive(Clone)]
pub enum Action {
    NewConversation,
    Session(String),
    Project(Project),
    Agent(String),
    ColdStart,
    Attribution,
    AutoApprove,
    WorkspaceMode,
    LearnAutomatically,
    SyncLessons,
    AgentReflection,
    ExportLessons,
    OpenApp,
    /// Offer what can be done with a learned lesson.
    Learning(Learning),
    /// Show a learned lesson and its recent history in the feed.
    ShowLearning(String),
    /// Archive (`true`) or restore a learned lesson.
    ArchiveLearning(String, bool),
    /// Route the next new conversation to this agent; `None` lets Jackalope choose.
    NextAgent(Option<String>),
    /// Use this model for the next new conversation; `None` uses the default.
    NextModel(Option<String>),
    /// Answer the pending question with this option.
    Answer(String),
    /// Type a free-form answer instead of choosing an option.
    TypeAnswer,
    /// Put an earlier input back in the composer.
    Recall(String),
}

pub struct Item {
    pub label: String,
    pub detail: String,
    pub action: Action,
}

#[derive(Clone, Copy, PartialEq)]
pub enum PickerKind {
    Sessions,
    Projects,
    Agents,
    Settings,
    NextAgent,
    NextModel,
    Question,
    History,
    Learnings,
    LearningActions,
}

pub struct Picker {
    pub kind: PickerKind,
    pub title: String,
    pub items: Vec<Item>,
    /// Typed to narrow the rows, matched fuzzily against label and detail.
    pub filter: String,
    /// An index into `shown()`.
    pub selected: usize,
}

impl Picker {
    /// Indexes of the rows matching the filter, best match first; every row,
    /// in order, when there is no filter.
    pub fn shown(&self) -> Vec<usize> {
        if self.filter.is_empty() {
            return (0..self.items.len()).collect();
        }
        let mut scored: Vec<(i64, usize)> = self
            .items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                let label = files::score(&item.label, &self.filter);
                let detail = files::score(&item.detail, &self.filter).map(|score| score - 1000);
                label.max(detail).map(|score| (score, index))
            })
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        scored.into_iter().map(|(_, index)| index).collect()
    }

    fn chosen(&self) -> Option<&Item> {
        self.shown()
            .get(self.selected)
            .map(|index| &self.items[*index])
    }

    pub fn step(&mut self, down: bool) {
        let last = self.shown().len().saturating_sub(1);
        self.selected = if down {
            (self.selected + 1).min(last)
        } else {
            self.selected.saturating_sub(1)
        };
    }
}

fn cold_start_label(choice: Option<ColdStart>) -> &'static str {
    match choice {
        None => "Ask each time",
        Some(ColdStart::Open) => "Open the app",
        Some(ColdStart::Background) => "Run in the background",
    }
}

fn workspace_mode_label(mode: Option<&str>) -> &'static str {
    match mode {
        Some("branch") => "new branch in the checkout",
        Some("current") => "current branch, directly",
        Some("ask") => "ask each time",
        _ => "isolated worktree",
    }
}

fn attribution_label(attribution: Option<&str>) -> &'static str {
    match attribution {
        Some("user") => "You",
        Some("coAuthor") => "You, with agents as co-authors",
        Some("agent") => "The agents",
        _ => "Loading…",
    }
}

pub fn agent_glyph(state: &str) -> &'static str {
    brand::mark_glyph(match state {
        "ready" => brand::Mark::Full,
        "installed" => brand::Mark::Partial,
        "sign-in" => brand::Mark::Attention,
        _ => brand::Mark::Empty,
    })
}

pub fn agent_state_label(agent: &AgentStatus) -> String {
    match agent.state.as_str() {
        "ready" => agent.account.clone(),
        "installed" => "installed".into(),
        "sign-in" => "sign-in needed".into(),
        "disabled" => "disabled".into(),
        _ => "not installed".into(),
    }
}

/// A learned lesson's status and use count, as a picker shows it.
pub fn learning_detail(learning: &Learning) -> String {
    let status = match learning.status.as_str() {
        "probation" => "new",
        "archived" => "archived",
        _ => "active",
    };
    let uses = match learning.uses {
        1 => "used once".to_string(),
        uses => format!("used {uses} times"),
    };
    let edited = if learning.managed { "" } else { " · edited" };
    format!("{status} · {uses}{edited}")
}

/// Agents that can take work or need only a sign-in.
pub fn usable(agent: &AgentStatus) -> bool {
    matches!(agent.state.as_str(), "ready" | "installed" | "sign-in")
}

impl App {
    pub(super) fn picker_key(&mut self, key: KeyEvent) {
        let Some(picker) = self.picker.as_mut() else {
            return;
        };
        let control = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            // Esc clears a filter before it closes the list.
            KeyCode::Esc if !picker.filter.is_empty() => {
                picker.filter.clear();
                picker.selected = 0;
            }
            KeyCode::Esc => self.picker = None,
            KeyCode::Up => picker.step(false),
            KeyCode::Down | KeyCode::Tab => picker.step(true),
            KeyCode::Char('p') if control => picker.step(false),
            KeyCode::Char('n') if control => picker.step(true),
            // Ctrl+R again steps to the next older match, as in a shell.
            KeyCode::Char('r') if control => picker.step(true),
            KeyCode::PageUp => (0..10).for_each(|_| picker.step(false)),
            KeyCode::PageDown => (0..10).for_each(|_| picker.step(true)),
            KeyCode::Enter => {
                if let Some(action) = picker.chosen().map(|item| item.action.clone()) {
                    self.choose(action);
                }
            }
            KeyCode::Backspace => {
                picker.filter.pop();
                picker.selected = 0;
            }
            KeyCode::Char('u') if control => {
                picker.filter.clear();
                picker.selected = 0;
            }
            KeyCode::Char(character) if !control => {
                picker.filter.push(character);
                picker.selected = 0;
            }
            _ => {}
        }
    }

    fn choose(&mut self, action: Action) {
        // Settings rows change in place; everything else closes the list.
        if !matches!(
            action,
            Action::ColdStart
                | Action::Attribution
                | Action::AutoApprove
                | Action::WorkspaceMode
                | Action::LearnAutomatically
                | Action::SyncLessons
                | Action::AgentReflection
                | Action::ExportLessons
        ) {
            self.picker = None;
        }
        match action {
            Action::NewConversation => self.command("new"),
            Action::Session(id) => self.show(Some(id)),
            Action::Project(project) => {
                self.note(format!(
                    "Switched to {}. Type a message to begin.",
                    project.name
                ));
                self.switch_project(project);
            }
            Action::Agent(id) => {
                let agent = self
                    .overview
                    .as_ref()
                    .and_then(|overview| overview.as_ref().ok())
                    .and_then(|overview| overview.agents.iter().find(|agent| agent.id == id));
                if let Some(agent) = agent {
                    self.note(format!("{}: {}", agent.name, agent.detail));
                }
            }
            Action::ColdStart => {
                match host::remembered_choice() {
                    None => host::remember_choice(ColdStart::Open),
                    Some(ColdStart::Open) => host::remember_choice(ColdStart::Background),
                    Some(ColdStart::Background) => host::forget_choice(),
                }
                self.open_picker(PickerKind::Settings);
            }
            Action::AutoApprove => {
                let next = !self.project.auto_approve.unwrap_or(true);
                self.save_project_settings(ProjectChange {
                    auto_approve: Some(next),
                    ..Default::default()
                });
                self.open_picker(PickerKind::Settings);
            }
            Action::LearnAutomatically => {
                let next = !self.project.learn_automatically.unwrap_or(true);
                self.save_project_settings(ProjectChange {
                    learn_automatically: Some(next),
                    ..Default::default()
                });
                self.open_picker(PickerKind::Settings);
            }
            Action::SyncLessons => {
                let next = !self.project.sync_lessons.unwrap_or(true);
                self.save_project_settings(ProjectChange {
                    sync_lessons: Some(next),
                    ..Default::default()
                });
                self.open_picker(PickerKind::Settings);
            }
            Action::AgentReflection => {
                let next = !self.project.agent_reflection.unwrap_or(false);
                self.save_project_settings(ProjectChange {
                    agent_reflection: Some(next),
                    ..Default::default()
                });
                self.open_picker(PickerKind::Settings);
            }
            Action::ExportLessons => {
                let next = !self.project.export_lessons.unwrap_or(false);
                self.save_project_settings(ProjectChange {
                    export_lessons: Some(next),
                    ..Default::default()
                });
                self.open_picker(PickerKind::Settings);
            }
            Action::Learning(learning) => self.open_learning_actions(learning),
            Action::ShowLearning(id) => self.show_learning(&id),
            Action::ArchiveLearning(id, archived) => self.archive_learning(&id, archived),
            Action::WorkspaceMode => {
                let next = match self.project.workspace_mode.as_deref() {
                    None | Some("worktree") => "branch",
                    Some("branch") => "current",
                    Some("current") => "ask",
                    _ => "worktree",
                };
                self.save_project_settings(ProjectChange {
                    workspace_mode: Some(next.into()),
                    ..Default::default()
                });
                self.open_picker(PickerKind::Settings);
            }
            Action::Attribution => {
                let next = match self.attribution.as_deref() {
                    Some("user") => "coAuthor",
                    Some("coAuthor") => "agent",
                    _ => "user",
                };
                if let Some(Response::CommitPolicy { attribution, .. }) =
                    self.request(Request::SetCommitAttribution {
                        project_path: self.project.path.clone(),
                        attribution: next.into(),
                    })
                {
                    self.attribution = Some(attribution);
                }
                self.open_picker(PickerKind::Settings);
            }
            Action::NextAgent(agent) => {
                let name = agent
                    .as_ref()
                    .map(|id| self.agent_name(id))
                    .unwrap_or_else(|| "Jackalope's choice".into());
                if self.next_agent != agent {
                    // Models belong to an agent.
                    self.next_model = None;
                }
                self.next_agent = agent;
                self.note(if self.session.is_some() {
                    format!("{name} will take your next new conversation (/new). This one stays with its agent.")
                } else {
                    format!("{name} will take this conversation.")
                });
            }
            Action::NextModel(model) => self.choose_model(model),
            Action::Answer(option) => self.answer(option),
            Action::TypeAnswer => self.note("Type your answer and press Enter."),
            Action::Recall(entry) => {
                self.editor.set(entry);
                self.history_index = None;
            }
            Action::OpenApp => self.open_app(),
        }
    }

    pub(super) fn open_app(&mut self) {
        if self.request(Request::ShowWindow).is_some() {
            self.handshake.windowed = true;
            self.flash("Opened Jackalope", Tone::Muted);
        }
    }

    fn session_item(&self, session: &SessionSummary) -> Item {
        let project = if session.project_id == self.project.id {
            String::new()
        } else {
            format!("{} · ", self.project_name(&session.project_id))
        };
        let state = if protocol::present(session.error.as_deref()).is_some() {
            "needs you"
        } else if session.paused {
            "paused"
        } else if Some(&session.id) == self.session.as_ref() {
            "showing"
        } else {
            "open"
        };
        let queued = if session.pending > 0 {
            format!(" · {} queued", session.pending)
        } else {
            String::new()
        };
        Item {
            label: session.title.clone(),
            detail: format!("{project}{state}{queued} · {}", short(&session.id)),
            action: Action::Session(session.id.clone()),
        }
    }

    fn agent_items(&self) -> Vec<Item> {
        let mut items = Vec::new();
        if let Some(Ok(overview)) = &self.overview {
            let mut agents = overview.agents.clone();
            // Usable agents first; the order is otherwise the host's.
            agents.sort_by_key(|agent| {
                ["ready", "installed", "sign-in", "disabled", "missing"]
                    .iter()
                    .position(|state| *state == agent.state)
            });
            for agent in agents {
                let default = if agent.id == overview.default_agent {
                    " · default"
                } else {
                    ""
                };
                items.push(Item {
                    label: format!("{} {}", agent_glyph(&agent.state), agent.name),
                    detail: format!("{}{default}", agent_state_label(&agent)),
                    action: Action::Agent(agent.id),
                });
            }
        }
        items.push(Item {
            label: "Manage agents in the app".into(),
            detail: "sign in, accounts, models".into(),
            action: Action::OpenApp,
        });
        items
    }

    /// Saves this project's approval, workspace or learning setting in the
    /// host, which the app and every terminal then share.
    fn save_project_settings(&mut self, change: ProjectChange) {
        if let Some(Response::Project { project }) = self.request(Request::SetProjectSettings {
            project_id: self.project.id.clone(),
            auto_approve: change.auto_approve,
            workspace_mode: change.workspace_mode,
            learn_automatically: change.learn_automatically,
            learning_cadence: None,
            sync_lessons: change.sync_lessons,
            agent_reflection: change.agent_reflection,
            export_lessons: change.export_lessons,
        }) {
            self.project.auto_approve = project.auto_approve;
            self.project.workspace_mode = project.workspace_mode;
            self.project.learn_automatically = project.learn_automatically;
            self.project.learning_cadence = project.learning_cadence;
            self.project.sync_lessons = project.sync_lessons;
            self.project.agent_reflection = project.agent_reflection;
            self.project.export_lessons = project.export_lessons;
        }
    }

    fn learning_items(&mut self) -> Vec<Item> {
        let learnings = match self.request(Request::Learnings {
            project_id: self.project.id.clone(),
        }) {
            Some(Response::Learnings { learnings }) => learnings,
            _ => Vec::new(),
        };
        learnings
            .into_iter()
            .map(|learning| Item {
                label: learning.title.clone(),
                detail: learning_detail(&learning),
                action: Action::Learning(learning),
            })
            .collect()
    }

    fn open_learning_actions(&mut self, learning: Learning) {
        let archived = learning.status == "archived";
        let items = vec![
            Item {
                label: "Show lesson and history".into(),
                detail: learning_detail(&learning),
                action: Action::ShowLearning(learning.id.clone()),
            },
            Item {
                label: if archived { "Restore" } else { "Archive" }.into(),
                detail: if archived {
                    "supply it to matching tasks again".into()
                } else {
                    "stop supplying it; restore any time".into()
                },
                action: Action::ArchiveLearning(learning.id.clone(), !archived),
            },
            Item {
                label: "Edit or delete in the app".into(),
                detail: "Project, then Context".into(),
                action: Action::OpenApp,
            },
        ];
        self.picker = Some(Picker {
            kind: PickerKind::LearningActions,
            title: learning.title,
            items,
            filter: String::new(),
            selected: 0,
        });
    }

    fn show_learning(&mut self, id: &str) {
        if let Some(Response::Learning { learning, history }) = self.request(Request::Learning {
            project_id: self.project.id.clone(),
            entry_id: id.into(),
        }) {
            self.note_learning(&learning, &history);
        }
    }

    fn archive_learning(&mut self, id: &str, archived: bool) {
        if let Some(Response::Learning { learning, .. }) =
            self.request(Request::SetLearningArchived {
                project_id: self.project.id.clone(),
                entry_id: id.into(),
                archived,
            })
        {
            let done = if archived { "Archived" } else { "Restored" };
            self.flash(format!("{done} {}", learning.title), Tone::Success);
        }
    }

    fn note_learning(&mut self, learning: &Learning, history: &[protocol::LearningEvent]) {
        self.note_tone(
            format!("{} · {}", learning.title, learning_detail(learning)),
            Tone::Success,
        );
        for line in learning.content.lines() {
            self.note(format!("  {line}"));
        }
        let recent = &history[history.len().saturating_sub(5)..];
        if !recent.is_empty() {
            self.note_tone("  History", Tone::Muted);
        }
        for event in recent {
            let day = event.at.get(..10).unwrap_or(&event.at);
            self.note_tone(
                format!("  {day} {} · {}", event.action, event.reason),
                Tone::Muted,
            );
            if let Some(evidence) = event.evidence.first() {
                self.note_tone(
                    format!("    {}", brand::ellipsize(evidence, 100)),
                    Tone::Muted,
                );
            }
        }
    }

    fn settings_items(&mut self) -> Vec<Item> {
        if self.attribution.is_none() {
            if let Some(Response::CommitPolicy { attribution, .. }) =
                self.request(Request::CommitPolicy {
                    project_path: self.project.path.clone(),
                })
            {
                self.attribution = Some(attribution);
            }
        }
        let default_agent = self
            .overview
            .as_ref()
            .and_then(|overview| overview.as_ref().ok())
            .map(|overview| self.agent_name(&overview.default_agent))
            .unwrap_or_else(|| "Checking…".into());
        vec![
            Item {
                label: "When Jackalope isn't running".into(),
                detail: cold_start_label(host::remembered_choice()).into(),
                action: Action::ColdStart,
            },
            Item {
                label: format!("Auto-approve agent requests in {}", self.project.name),
                detail: if self.project.auto_approve.unwrap_or(true) {
                    "on · asks only for risky actions".into()
                } else {
                    "off · asks for every request".into()
                },
                action: Action::AutoApprove,
            },
            Item {
                label: format!("Where tasks work in {}", self.project.name),
                detail: workspace_mode_label(self.project.workspace_mode.as_deref()).into(),
                action: Action::WorkspaceMode,
            },
            Item {
                label: format!("Learn automatically in {}", self.project.name),
                detail: if self.project.learn_automatically.unwrap_or(true) {
                    format!(
                        "on · reflects every {} tool calls and when work ends",
                        self.project.learning_cadence.unwrap_or(50)
                    )
                } else {
                    "off · /learn still saves lessons on request".into()
                },
                action: Action::LearnAutomatically,
            },
            Item {
                label: format!("Reflect with an agent in {}", self.project.name),
                detail: if self.project.agent_reflection.unwrap_or(false) {
                    "on · uses your default agent's quota when work ends".into()
                } else {
                    "off · reflection makes no model calls".into()
                },
                action: Action::AgentReflection,
            },
            Item {
                label: format!("Sync learned lessons from {}", self.project.name),
                detail: if self.project.sync_lessons.unwrap_or(true) {
                    "included · when lesson sync is on in the app".into()
                } else {
                    "excluded · lessons stay on this computer".into()
                },
                action: Action::SyncLessons,
            },
            Item {
                label: format!("Write lessons to AGENTS.md in {}", self.project.name),
                detail: if self.project.export_lessons.unwrap_or(false) {
                    "on · managed AGENTS.md section and Claude Code skill".into()
                } else {
                    "off · lessons stay in Jackalope".into()
                },
                action: Action::ExportLessons,
            },
            Item {
                label: format!("Commit author in {}", self.project.name),
                detail: attribution_label(self.attribution.as_deref()).into(),
                action: Action::Attribution,
            },
            Item {
                label: "Default agent".into(),
                detail: format!("{default_agent} · change in the app"),
                action: Action::OpenApp,
            },
            Item {
                label: "Open Jackalope".into(),
                detail: "every other setting".into(),
                action: Action::OpenApp,
            },
        ]
    }

    /// The agent the next conversation will use, when one is chosen or set as
    /// the default; routing ("auto") has no single model list.
    pub(super) fn model_agent(&self) -> Option<&AgentStatus> {
        let Some(Ok(overview)) = &self.overview else {
            return None;
        };
        let id = self
            .next_agent
            .as_deref()
            .unwrap_or(overview.default_agent.as_str());
        overview.agents.iter().find(|agent| agent.id == id)
    }

    fn next_model_items(&self) -> Vec<Item> {
        let default = self
            .model_agent()
            .map(|agent| agent.default_model.trim())
            .filter(|model| !model.is_empty())
            .map(|model| format!("uses {model}"))
            .unwrap_or_else(|| "the agent decides".into());
        let mut items = vec![Item {
            label: "Agent default".into(),
            detail: if self.next_model.is_none() {
                "current".into()
            } else {
                default
            },
            action: Action::NextModel(None),
        }];
        if let Some(agent) = self.model_agent() {
            for model in &agent.models {
                items.push(Item {
                    label: model.clone(),
                    detail: if self.next_model.as_deref() == Some(model.as_str()) {
                        "current".into()
                    } else {
                        agent.name.clone()
                    },
                    action: Action::NextModel(Some(model.clone())),
                });
            }
        }
        items
    }

    pub(super) fn choose_model(&mut self, model: Option<String>) {
        let agent = self
            .model_agent()
            .map(|agent| agent.name.clone())
            .unwrap_or_else(|| "the agent".into());
        let name = model
            .clone()
            .unwrap_or_else(|| format!("{agent}'s default model"));
        self.next_model = model;
        self.note(if self.session.is_some() {
            format!("{name} will run your next new conversation (/new). This one keeps its model.")
        } else {
            format!("{name} will run this conversation.")
        });
    }

    fn next_agent_items(&self) -> Vec<Item> {
        let mut items = vec![Item {
            label: "Let Jackalope choose".into(),
            detail: if self.next_agent.is_none() {
                "current".into()
            } else {
                "routes each conversation".into()
            },
            action: Action::NextAgent(None),
        }];
        if let Some(Ok(overview)) = &self.overview {
            for agent in overview
                .agents
                .iter()
                .filter(|agent| matches!(agent.state.as_str(), "ready" | "installed"))
            {
                items.push(Item {
                    label: format!("{} {}", agent_glyph(&agent.state), agent.name),
                    detail: if self.next_agent.as_deref() == Some(agent.id.as_str()) {
                        "current".into()
                    } else {
                        agent_state_label(agent)
                    },
                    action: Action::NextAgent(Some(agent.id.clone())),
                });
            }
        }
        items
    }

    /// Builds (or rebuilds, keeping the highlighted row and filter) a picker.
    pub(super) fn open_picker(&mut self, kind: PickerKind) {
        let rebuilding = self
            .picker
            .as_ref()
            .is_some_and(|picker| picker.kind == kind);
        let (selected, filter) = self
            .picker
            .as_ref()
            .filter(|_| rebuilding)
            .map(|picker| (picker.selected, picker.filter.clone()))
            .unwrap_or_default();
        let (title, items) = match kind {
            PickerKind::Sessions => {
                // The list shows what is known now and updates when the
                // refresh lands, which rebuilds it.
                if !rebuilding {
                    self.refresh();
                }
                let mut items = vec![Item {
                    label: "+ New conversation".into(),
                    detail: String::new(),
                    action: Action::NewConversation,
                }];
                for id in self.session_order() {
                    if let Some(session) = self.sessions.iter().find(|session| session.id == id) {
                        items.push(self.session_item(session));
                    }
                }
                ("Conversations · Ctrl+N/P to step".to_string(), items)
            }
            PickerKind::Projects => {
                let projects = match self.request(Request::Projects) {
                    Some(Response::Projects { projects }) => projects,
                    _ => Vec::new(),
                };
                let items = projects
                    .into_iter()
                    .map(|project| Item {
                        detail: if project.id == self.project.id {
                            format!("current · {}", project.path)
                        } else {
                            project.path.clone()
                        },
                        label: project.name.clone(),
                        action: Action::Project(project),
                    })
                    .collect();
                ("Projects".to_string(), items)
            }
            PickerKind::Agents => ("Agents".to_string(), self.agent_items()),
            PickerKind::Learnings => (
                format!("Learned in {}", self.project.name),
                self.learning_items(),
            ),
            // Built by `open_learning_actions`, which knows the lesson.
            PickerKind::LearningActions => return,
            PickerKind::Settings => ("Settings".to_string(), self.settings_items()),
            PickerKind::NextAgent => (
                "Agent for the next conversation".to_string(),
                self.next_agent_items(),
            ),
            PickerKind::NextModel => (
                "Model for the next conversation".to_string(),
                self.next_model_items(),
            ),
            PickerKind::History => {
                // Newest first.
                let items = self
                    .history
                    .iter()
                    .rev()
                    .map(|entry| Item {
                        label: entry.replace('\n', " ⏎ "),
                        detail: String::new(),
                        action: Action::Recall(entry.clone()),
                    })
                    .collect();
                ("History · type to search".to_string(), items)
            }
            PickerKind::Question => {
                let question = self.question().cloned();
                let mut items: Vec<Item> = question
                    .iter()
                    .flat_map(|question| question.options.clone())
                    .map(|option| Item {
                        label: option.clone(),
                        detail: String::new(),
                        action: Action::Answer(option),
                    })
                    .collect();
                items.push(Item {
                    label: "Type a different answer…".into(),
                    detail: String::new(),
                    action: Action::TypeAnswer,
                });
                (
                    question
                        .map(|question| question.question)
                        .unwrap_or_else(|| "Question".into()),
                    items,
                )
            }
        };
        let mut picker = Picker {
            kind,
            title,
            items,
            filter,
            selected: 0,
        };
        picker.selected = selected.min(picker.shown().len().saturating_sub(1));
        self.picker = Some(picker);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_in_a_picker_narrows_and_ranks_its_rows() {
        let item = |label: &str, detail: &str| Item {
            label: label.into(),
            detail: detail.into(),
            action: Action::TypeAnswer,
        };
        let mut picker = Picker {
            kind: PickerKind::Sessions,
            title: String::new(),
            items: vec![
                item("Fix login redirect", "web"),
                item("Refactor billing", "api"),
                item("Update docs", "web"),
            ],
            filter: String::new(),
            selected: 0,
        };
        assert_eq!(picker.shown(), [0, 1, 2]);
        picker.filter = "bill".into();
        assert_eq!(picker.shown(), [1]);
        // Labels outrank details.
        picker.filter = "web".into();
        assert_eq!(picker.shown(), [0, 2]);
        picker.step(true);
        assert_eq!(picker.chosen().unwrap().label, "Update docs");
        picker.step(true);
        assert_eq!(picker.selected, 1, "stops at the last match");
    }
}

/// One settings change for the current project; `None` keeps a value.
#[derive(Default)]
struct ProjectChange {
    auto_approve: Option<bool>,
    workspace_mode: Option<String>,
    learn_automatically: Option<bool>,
    sync_lessons: Option<bool>,
    agent_reflection: Option<bool>,
    export_lessons: Option<bool>,
}
