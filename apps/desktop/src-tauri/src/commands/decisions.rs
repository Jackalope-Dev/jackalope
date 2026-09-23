use super::tasks::TaskRuntime;
pub mod agent_questions;
pub mod assistance;
#[cfg(test)]
mod assistance_trial;
pub mod context;
mod contracts;
pub mod discovery;
pub mod evaluation;
pub mod options;
pub(crate) mod settings;
mod strategy;
pub use contracts::*;
pub use strategy::{assess_strategy, StrategyEvaluation};

pub fn policy(runtime: &TaskRuntime, project_id: &str) -> Result<DecisionPolicy, String> {
    let _guard = settings::LOCK
        .lock()
        .map_err(|_| "Decision settings are unavailable.")?;
    let value = settings::read(&settings::directory(runtime))?;
    Ok(DecisionPolicy {
        mode: value.effective(Some(project_id)),
        jev_fallback: value.effective_fallback(Some(project_id)),
        revision: value.revision,
    })
}
