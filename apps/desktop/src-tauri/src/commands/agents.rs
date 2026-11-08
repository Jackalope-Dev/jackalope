//! The agent catalog: the facts Jackalope keeps about each agent it can run.
//!
//! It is read from `src/lib/agents.json`, which the app reads too, so both
//! sides name, install, sign in and route agents from the same data. Behavior
//! that differs per agent (launch flags, output parsing, quota reading) stays
//! in code and is chosen by agent id or by [`Protocol`].

use serde::{de, Deserialize, Serialize};
use std::{
    fmt,
    path::{Path, PathBuf},
    sync::OnceLock,
};

/// The stream an agent's process speaks on stdout.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Protocol {
    /// Codex `exec --json` events.
    Codex,
    /// Claude Code's `stream-json` messages, which Grok also emits.
    ClaudeStream,
    /// Agent Client Protocol JSON-RPC over stdio.
    Acp,
    Opencode,
    Antigravity,
    Gemini,
}

/// How a task's prompt reaches the agent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Prompt {
    Stdin,
    /// A file named on the command line, removed when the attempt ends.
    File,
    /// A protocol message after the session starts.
    Protocol,
}

/// How an agent reaches Jackalope's bridge tools.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Bridge {
    /// As an MCP server the agent connects to.
    Mcp,
    /// Through authenticated HTTP requests the prompt describes.
    Http,
}

/// What an agent supports, as the router and the connection settings see it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Capabilities {
    pub bridge: Bridge,
    /// MCP transports the agent accepts directly, without on-demand discovery.
    pub direct: Vec<String>,
    pub discovery: bool,
    pub accounts: bool,
    pub capacity: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpec {
    #[serde(skip)]
    pub id: String,
    pub name: String,
    /// The brand name alone, as in "Answered by Claude".
    pub short_name: String,
    pub npm_package: Option<String>,
    /// The executable's name. The generic ACP adapter has none: each custom
    /// agent names its own.
    pub binary: Option<String>,
    /// The model family for cross-family review, or none for multi-provider agents.
    pub family: Option<String>,
    /// `HOME` stands for the platform's home variable (`USERPROFILE` on Windows).
    account_env: Option<String>,
    /// The agent's own sign-in directory relative to home (empty for home
    /// itself), used when its account variable is unset.
    default_config_dir: String,
    pub login_args: Vec<String>,
    /// Variables that carry credentials, cleared so a managed account cannot
    /// inherit the person's own sign-in.
    pub credential_env: Vec<String>,
    pub protocol: Protocol,
    pub prompt: Prompt,
    /// Whether an attempt is stopped after [`ATTEMPT_LIMIT`].
    pub attempt_limit: bool,
    /// Whether the agent can route work and answer helper requests.
    pub orchestrates: bool,
    /// Whether the agent runs on computers.
    pub remote: bool,
    pub model_catalog: bool,
    pub quota_source: Option<String>,
    /// Where the agent keeps its MCP servers: relative to its account
    /// directory, or to home when it starts with `~/`.
    mcp_config: Option<String>,
    /// Whether the agent can sign in to an HTTP connection interactively.
    pub mcp_sign_in: bool,
    #[serde(flatten)]
    pub capabilities: Capabilities,
}

/// How long an attempt of an agent with `attemptLimit` may run.
pub const ATTEMPT_LIMIT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

struct Catalog(Vec<AgentSpec>);

impl<'de> Deserialize<'de> for Catalog {
    fn deserialize<D: de::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Entries;
        impl<'de> de::Visitor<'de> for Entries {
            type Value = Catalog;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("agents keyed by id")
            }
            // Document order is the order agents are listed in.
            fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<Catalog, A::Error> {
                let mut agents = Vec::new();
                while let Some((id, mut spec)) = map.next_entry::<String, AgentSpec>()? {
                    spec.id = id;
                    agents.push(spec);
                }
                Ok(Catalog(agents))
            }
        }
        deserializer.deserialize_map(Entries)
    }
}

/// Every catalog agent, in display order.
pub fn all() -> &'static [AgentSpec] {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    &CATALOG
        .get_or_init(|| {
            serde_json::from_str(include_str!("../../../src/lib/agents.json"))
                .expect("src/lib/agents.json is a valid agent catalog")
        })
        .0
}

pub fn find(id: &str) -> Option<&'static AgentSpec> {
    all().iter().find(|agent| agent.id == id)
}

/// Agents Jackalope finds by their own executable: all but the generic ACP
/// adapter, which runs whatever command a custom agent names.
pub fn builtin() -> impl Iterator<Item = &'static AgentSpec> {
    all().iter().filter(|agent| agent.binary.is_some())
}

pub fn builtin_ids() -> impl Iterator<Item = &'static str> {
    builtin().map(|agent| agent.id.as_str())
}

pub fn is_builtin(id: &str) -> bool {
    builtin().any(|agent| agent.id == id)
}

/// Whether Jackalope can launch an agent on `adapter`.
pub fn is_executable(adapter: &str) -> bool {
    find(adapter).is_some()
}

/// Whether an agent on `adapter` can route work and answer helper requests.
pub fn orchestrates(adapter: &str) -> bool {
    find(adapter).is_some_and(|agent| agent.orchestrates)
}

/// Whether an agent on `adapter` can run on a computer.
pub fn runs_on_computers(adapter: &str) -> bool {
    find(adapter).is_some_and(|agent| agent.remote)
}

/// The orchestrating agents as prose, for messages that ask to choose one.
pub fn orchestrator_names() -> String {
    names(all().iter().filter(|agent| agent.orchestrates), "or")
}

/// `id`'s display name, or `id` itself for an agent outside the catalog.
pub fn name(id: &str) -> &str {
    find(id).map_or(id, |agent| agent.name.as_str())
}

/// The display names of `agents` as prose: "A, B or C".
pub fn names<'a>(agents: impl Iterator<Item = &'a AgentSpec>, last: &str) -> String {
    let names: Vec<&str> = agents.map(|agent| agent.name.as_str()).collect();
    match names.split_last() {
        None => String::new(),
        Some((only, [])) => only.to_string(),
        Some((final_name, rest)) => format!("{} {last} {final_name}", rest.join(", ")),
    }
}

impl AgentSpec {
    /// The variable that points this agent at an account directory.
    pub fn account_env(&self) -> Option<&str> {
        match self.account_env.as_deref()? {
            "HOME" if cfg!(windows) => Some("USERPROFILE"),
            name => Some(name),
        }
    }

    /// The agent's own sign-in directory under `home`.
    pub fn default_directory(&self, home: &Path) -> PathBuf {
        if self.default_config_dir.is_empty() {
            home.to_path_buf()
        } else {
            home.join(&self.default_config_dir)
        }
    }

    pub fn bridge(&self) -> Bridge {
        self.capabilities.bridge
    }

    pub fn has_mcp_config(&self) -> bool {
        self.mcp_config.is_some()
    }

    /// The agent's MCP configuration file for this device's own sign-in.
    pub fn mcp_config(&self, home: &Path) -> Option<PathBuf> {
        let file = self.mcp_config.as_deref()?;
        if let Some(file) = file.strip_prefix("~/") {
            return Some(home.join(file));
        }
        let directory = self
            .account_env()
            .and_then(std::env::var_os)
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_directory(home));
        Some(directory.join(file))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_is_consistent() {
        for agent in all() {
            assert_eq!(
                agent.capabilities.capacity,
                agent.quota_source.is_some(),
                "{}",
                agent.id
            );
            assert!(
                agent.npm_package.is_none() || agent.binary.is_some(),
                "{}",
                agent.id
            );
            assert!(!agent.mcp_sign_in || agent.has_mcp_config(), "{}", agent.id);
            assert_eq!(
                agent.protocol == Protocol::Acp,
                agent.prompt == Prompt::Protocol
            );
        }
        assert!(!is_builtin("acp") && is_executable("acp"));
        assert_eq!(
            names(all().iter().filter(|agent| agent.remote), "and"),
            "Codex and Claude Code"
        );
    }

    #[test]
    fn account_variables_follow_the_platform_home() {
        assert_eq!(find("codex").unwrap().account_env(), Some("CODEX_HOME"));
        assert_eq!(
            find("antigravity").unwrap().account_env(),
            Some(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        );
        assert_eq!(find("acp").unwrap().account_env(), None);
    }

    #[test]
    fn mcp_configuration_lives_in_the_account_directory_or_home() {
        let home = Path::new("/home/person");
        assert_eq!(
            find("claude").unwrap().mcp_config(home),
            Some(home.join(".claude.json"))
        );
        if std::env::var_os("GROK_HOME").is_none() {
            assert_eq!(
                find("grok").unwrap().mcp_config(home),
                Some(home.join(".grok").join("config.toml"))
            );
        }
        assert_eq!(find("kimi").unwrap().mcp_config(home), None);
    }
}
