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

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JevFallback {
    #[default]
    Local,
    Agent,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct DecisionPolicy {
    pub mode: DecisionMode,
    #[serde(default)]
    pub jev_fallback: JevFallback,
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
    ContextSelection,
    ToolDiscovery,
    AgentQuestions,
    TaskPreparation,
    TaskReview,
    MonitorRelevance,
    AssignmentMatching,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionProvider {
    LocalRules,
    Agent,
    Jev,
}

impl DecisionPolicy {
    pub fn needs_agent(self, jev_usable: bool, canceled: bool) -> bool {
        !canceled
            && (self.mode == DecisionMode::Agent
                || (self.mode == DecisionMode::Jev
                    && !jev_usable
                    && self.jev_fallback == JevFallback::Agent))
    }

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
pub struct DecisionAttempt {
    pub provider: DecisionProvider,
    pub usage: Usage,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionReceipt {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<serde_json::Value>,
    pub version: u32,
    pub kind: DecisionKind,
    pub requested_mode: DecisionMode,
    pub provider: DecisionProvider,
    pub policy_revision: u64,
    #[serde(default)]
    pub model_call_attempted: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attempts: Vec<DecisionAttempt>,
    pub concentration: Option<f64>,
    pub fallback_reason: Option<String>,
    pub usage: Usage,
}

pub fn combined_usage(attempts: &[DecisionAttempt]) -> Usage {
    let mut total = Usage {
        reported: true,
        estimated_cost_usd: Some(0.0),
        ..Default::default()
    };
    for attempt in attempts {
        let usage = &attempt.usage;
        total.input = total.input.saturating_add(usage.input);
        total.output = total.output.saturating_add(usage.output);
        total.cache_read = total.cache_read.saturating_add(usage.cache_read);
        total.cache_write = total.cache_write.saturating_add(usage.cache_write);
        total.reported &= usage.reported;
        total.estimated_cost_usd = total
            .estimated_cost_usd
            .zip(usage.estimated_cost_usd)
            .filter(|_| usage.reported)
            .map(|(sum, cost)| sum + cost);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jev_fallback_is_explicit_and_never_runs_after_success_or_cancellation() {
        let mut policy: DecisionPolicy =
            serde_json::from_str(r#"{"mode":"jev","revision":1}"#).unwrap();
        assert_eq!(policy.jev_fallback, JevFallback::Local);
        assert!(!policy.needs_agent(false, false));
        policy.jev_fallback = JevFallback::Agent;
        assert!(policy.needs_agent(false, false));
        assert!(!policy.needs_agent(true, false));
        assert!(!policy.needs_agent(false, true));
        policy.mode = DecisionMode::Deterministic;
        assert!(!policy.needs_agent(false, false));
    }

    #[test]
    fn fallback_keeps_both_reports_without_claiming_unknown_usage_is_free() {
        let mut attempts = vec![
            DecisionAttempt {
                provider: DecisionProvider::Jev,
                usage: Usage {
                    input: 100,
                    reported: true,
                    estimated_cost_usd: Some(0.01),
                    ..Default::default()
                },
            },
            DecisionAttempt {
                provider: DecisionProvider::Agent,
                usage: Usage::default(),
            },
        ];
        let total = combined_usage(&attempts);
        assert_eq!(total.input, 100);
        assert!(!total.reported);
        assert_eq!(total.estimated_cost_usd, None);
        attempts[1].usage = Usage {
            input: 200,
            reported: true,
            estimated_cost_usd: Some(0.02),
            ..Default::default()
        };
        assert_eq!(combined_usage(&attempts).input, 300);
        assert_eq!(combined_usage(&attempts).estimated_cost_usd, Some(0.03));
    }
}
