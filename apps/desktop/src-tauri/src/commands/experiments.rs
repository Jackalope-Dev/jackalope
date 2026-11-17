//! Experiment switches from `experiments.json`, each set by its environment
//! variable within the values the registry allows.

use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};

macro_rules! experiments {
    ($($variant:ident = $id:literal,)*) => {
        /// An experiment in `experiments.json`, named by its field id. Every
        /// field has one, though some are read only outside the app.
        #[allow(dead_code)]
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub(crate) enum Experiment {
            $($variant,)*
        }

        impl Experiment {
            #[cfg(test)]
            const ALL: &[Experiment] = &[$(Self::$variant,)*];

            fn id(self) -> &'static str {
                match self {
                    $(Self::$variant => $id,)*
                }
            }
        }
    };
}

experiments! {
    VerificationOutput = "verification-output",
    ScopeGuard = "scope-guard",
    InstructionChannel = "instruction-channel",
    NativeTools = "native-tools",
    OpencodeTransport = "opencode-transport",
    ProviderEffort = "provider-effort",
    Learning = "learning",
    TaskApproach = "task-approach",
    ToolSurface = "tool-surface",
    ResultQueries = "result-queries",
    ResultPreview = "result-preview",
    InitialTools = "initial-tools",
    RepoMap = "repo-map",
    ContextRead = "context-read",
    JevAssistance = "jev-assistance",
    JevQuestions = "jev-questions",
    WarmOpencode = "warm-opencode",
    WarmApiHelpers = "warm-api-helpers",
    ClaudeSession = "claude-session",
    ClaudeIsolation = "claude-isolation",
    ClaudePartials = "claude-partials",
    ClaudeFallback = "claude-fallback",
    ClaudePromptCache = "claude-prompt-cache",
    ClaudeEditCheck = "claude-edit-check",
    ClaudeStopCheck = "claude-stop-check",
    ClaudeContextHook = "claude-context-hook",
    ClaudePermissionHook = "claude-permission-hook",
    ClaudeToolTiming = "claude-tool-timing",
}

#[derive(Deserialize)]
struct Registry {
    fields: BTreeMap<String, Field>,
}

#[derive(Deserialize)]
struct Field {
    values: Vec<String>,
    default: String,
    environment: Option<String>,
    /// For a value, the values other fields must resolve to for it to apply.
    #[serde(default)]
    requires: BTreeMap<String, BTreeMap<String, String>>,
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        serde_json::from_str(include_str!("experiments.json")).expect("checked experiment registry")
    })
}

/// `id`'s value: its environment variable when that names an allowed value,
/// else the default. A value whose requirements do not hold falls back to the
/// first value without requirements.
fn resolved(id: &str) -> &'static str {
    let field = &registry().fields[id];
    let chosen = field
        .environment
        .as_ref()
        .and_then(|name| std::env::var(name).ok())
        .and_then(|value| field.values.iter().find(|allowed| **allowed == value))
        .unwrap_or(&field.default);
    let satisfied = field.requires.get(chosen).is_none_or(|requirements| {
        requirements
            .iter()
            .all(|(other, value)| resolved(other) == value)
    });
    if satisfied {
        return chosen;
    }
    field
        .values
        .iter()
        .find(|value| !field.requires.contains_key(*value))
        .unwrap_or(&field.default)
}

/// Whether `experiment` resolves to `value`, which must be one of its values.
pub(crate) fn is(experiment: Experiment, value: &str) -> bool {
    let id = experiment.id();
    debug_assert!(
        registry().fields[id]
            .values
            .iter()
            .any(|allowed| allowed == value),
        "{value} is not a value of the {id} experiment"
    );
    resolved(id) == value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_experiments_have_valid_defaults_and_unique_environment_names() {
        let mut names = std::collections::HashSet::new();
        for field in registry().fields.values() {
            assert!(field.values.contains(&field.default));
            if let Some(name) = &field.environment {
                assert!(names.insert(name));
            }
            for (value, requirements) in &field.requires {
                assert!(field.values.contains(value));
                for (other, required) in requirements {
                    assert!(registry().fields[other].values.contains(required));
                }
            }
        }
    }

    #[test]
    fn every_registered_field_has_exactly_one_experiment() {
        let ids: Vec<_> = Experiment::ALL
            .iter()
            .map(|experiment| experiment.id())
            .collect();
        let fields: Vec<_> = registry().fields.keys().map(String::as_str).collect();
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
        assert_eq!(sorted, fields);
    }
}
