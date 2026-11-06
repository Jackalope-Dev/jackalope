//! What a computer's runner (`resources/computer/agent.py`) supports, from the
//! `runs` protocol and `capabilities` its `hello` and `run_status` report.
//! A runner that reports no capabilities keeps the tar upload and patch.

use serde_json::Value;

/// Content-addressed, chunked and resumable transfers (`artifact_*`).
pub(crate) const ARTIFACTS: &str = "artifacts";
/// Workspaces travel as Git bundles against a per-project repository (`sync_*`).
pub(crate) const GIT_SYNC: &str = "git-sync";

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct RunnerCapabilities {
    pub protocol: u64,
    pub capabilities: Vec<String>,
}

impl RunnerCapabilities {
    pub fn from_status(status: Option<&Value>) -> Self {
        let Some(status) = status else {
            return Self::default();
        };
        Self {
            protocol: status["runs"].as_u64().unwrap_or(0),
            capabilities: status["capabilities"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect(),
        }
    }

    pub fn has(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|known| known == capability)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capabilities_come_from_the_run_status() {
        let current = json!({"runs": 4, "capabilities": ["git-sync", "artifacts", "later"]});
        let caps = RunnerCapabilities::from_status(Some(&current));
        assert_eq!(caps.protocol, 4);
        assert!(caps.has(GIT_SYNC) && caps.has(ARTIFACTS));
        assert!(!caps.has("missing"));
        for old in [
            json!({"runs": 3}),
            json!({"exists": false}),
            json!({"capabilities": "x"}),
        ] {
            assert!(!RunnerCapabilities::from_status(Some(&old)).has(GIT_SYNC));
        }
        assert_eq!(
            RunnerCapabilities::from_status(None),
            RunnerCapabilities::default()
        );
    }
}
