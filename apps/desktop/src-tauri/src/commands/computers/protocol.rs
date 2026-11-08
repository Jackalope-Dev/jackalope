//! The computer protocol values this device shares with a computer's runner.
//! `resources/computer/protocol.json` ships in the image beside `agent.py`,
//! which reads the same file, so neither side keeps its own copy. Values Rust
//! must hold as constants are checked against the file by the tests below.

use serde::Deserialize;
use std::sync::OnceLock;

const SOURCE: &str = include_str!("../../../resources/computer/protocol.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Protocol {
    /// What `hello` reports as `protocol`.
    pub hello: u64,
    /// The most runs a runner may report it takes at once.
    pub slots_max: u64,
    pub transfer: Transfer,
    pub relay: Relay,
    pub git_identity: GitIdentity,
    pub sync: GitSync,
    pub search: Search,
    pub browser: Browser,
    pub screenshots: Screenshots,
    /// Keys an action may name, beside single characters and punctuation.
    pub named_keys: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct Transfer {
    /// Raw bytes per upload or download chunk; base64 keeps a request under the
    /// runner's 1 MB body limit.
    pub chunk: usize,
    pub upload: u64,
    pub patch: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Relay {
    /// Stand-ins the runner replaces with its bridge relay's address and secret
    /// when a run starts with `relay`.
    pub url: String,
    pub token: String,
    pub request_limit: usize,
    pub pending_limit: usize,
    /// Told to an agent whose call is too large to relay; nothing was forwarded.
    pub too_large: String,
    /// Request headers forwarded to the bridge.
    pub headers: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct GitIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitSync {
    /// Commits a project's repository on the runner reports as present, at most.
    pub known_bases: usize,
    pub result_artifacts: usize,
    pub result_artifact_bytes: u64,
}

/// The bounds of a repository scan, here and on the runner.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Search {
    /// Folder names never descended into.
    pub skip: Vec<String>,
    pub files: usize,
    pub bytes: u64,
    pub seconds: u64,
    /// Words retrieval ranking ignores.
    pub stop_words: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct Screenshots {
    /// Where screenshot evidence is saved, relative to the workspace.
    pub folder: String,
    pub limit: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Browser {
    /// Characters of page text returned at once.
    pub text_limit: usize,
    /// Script that reads the current address and whether a password field is visible.
    pub page_state: String,
    /// Hosts that address this machine.
    pub loopback_hosts: Vec<String>,
}

pub(crate) fn protocol() -> &'static Protocol {
    static PARSED: OnceLock<Protocol> = OnceLock::new();
    PARSED.get_or_init(|| {
        serde_json::from_str(SOURCE).expect("the bundled computer protocol is valid")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::Value;
    use std::collections::BTreeMap;

    fn source() -> Value {
        serde_json::from_str(SOURCE).unwrap()
    }

    #[test]
    fn the_bundled_protocol_parses() {
        let protocol = protocol();
        assert_eq!(protocol.hello, 1);
        // Base64 keeps a chunk inside the runner's 1 MB request body.
        assert!(protocol.transfer.chunk * 4 / 3 < 1024 * 1024);
        assert!(protocol.relay.too_large.contains("64 KB"));
        assert_eq!(protocol.relay.request_limit, 64 * 1024);
    }

    #[test]
    fn rust_constants_agree_with_the_protocol() {
        use super::super::{relay, runner};
        let source = source();
        assert_eq!(source["relay"]["answerLimit"], relay::ANSWER_LIMIT);
        assert_eq!(source["relay"]["artifactLimit"], relay::LARGE_ANSWER_LIMIT);
        assert!(source["runs"].as_u64().unwrap() >= runner::CAPABILITIES_PROTOCOL);
        let codes = source["errorCodes"].as_array().unwrap();
        for code in [super::super::UNSUPPORTED, super::super::PERMANENT] {
            assert!(codes.iter().any(|known| known == code), "{code}");
        }
        let mut capabilities: Vec<String> =
            serde_json::from_value(source["capabilities"].clone()).unwrap();
        capabilities.sort();
        let mut known = [
            runner::LOCAL_BRIDGE,
            runner::BROWSER,
            runner::WORKSPACE_TOOLS,
            runner::POLICY_CALLBACKS,
            runner::GIT_SYNC,
            runner::ARTIFACTS,
        ];
        known.sort();
        assert_eq!(capabilities, known);
    }

    #[test]
    fn the_runner_serves_exactly_the_tools_placed_in_its_workspace() {
        use super::super::runner::Placement;
        let mut placed: BTreeMap<String, BTreeMap<String, Option<String>>> = BTreeMap::new();
        for tool in crate::commands::bridge::tools() {
            if let Placement::Workspace(capability) = tool.placement {
                placed.entry(capability.to_owned()).or_default().insert(
                    tool.name.to_owned(),
                    tool.route.map(|route| route.path.to_owned()),
                );
            }
        }
        let served: BTreeMap<String, BTreeMap<String, Option<String>>> =
            serde_json::from_value(source()["localTools"].clone()).unwrap();
        assert_eq!(placed, served);
    }
}
