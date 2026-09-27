//! Pickers: filterable lists over conversations, projects, agents, settings,
//! history and an agent's question.

use super::feed::Tone;
use super::App;
use crate::brand;
use crate::connection::short;
use crate::files;
use crate::host::{self, ColdStart};
use crate::protocol::{self, AgentStatus, Project, Request, Response, SessionSummary};
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
    OpenApp,
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
        if !matches!(action, Action::ColdStart | Action::Attribution) {
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
