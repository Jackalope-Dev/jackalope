use super::super::tasks::Usage;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DecisionMode {
    Deterministic,
    #[default]
    Agent,
    Jev,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct DecisionPolicy {
    pub mode: DecisionMode,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StrategyChoice {
    Single,
    Investigate,
    Parallel,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionKind {
    WorkerSelection,
    TaskStrategy,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionProvider {
    LocalRules,
    Agent,
    Jev,
}

impl DecisionPolicy {
    pub fn provider(self) -> DecisionProvider {
        match self.mode {
            DecisionMode::Deterministic => DecisionProvider::LocalRules,
            DecisionMode::Agent => DecisionProvider::Agent,
            DecisionMode::Jev => DecisionProvider::Jev,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionReceipt {
    pub version: u32,
    pub kind: DecisionKind,
    pub requested_mode: DecisionMode,
    pub provider: DecisionProvider,
    pub policy_revision: u64,
    pub concentration: Option<f64>,
    pub fallback_reason: Option<String>,
    pub usage: Usage,
}
