//! The runner: the computer's half of an agent run.
//!
//! This device is the control plane. It keeps identity and credentials,
//! approvals and policy, orchestration, history and review, and the final Git
//! integration. The computer's agent (`resources/computer/agent.py`) is the
//! runner, the execution plane: it owns the uploaded workspace and, from runs
//! protocol 4, the tools that touch it. The two negotiate what the runner can
//! do through `capabilities` in `hello` and `run_status`; every behaviour
//! beyond protocol 3 is enabled only by a listed capability, so a runner on an
//! older image keeps the earlier behaviour exactly.
//!
//! [`TOOLS`] is where each bridge tool executes. [`Access`] combines it with
//! the runner's capabilities to decide, per run, which tools the runner
//! serves, which are forwarded to this device through the relay
//! ([`super::relay`]), and which are unavailable.
//!
//! An attempt whose agent runs on this device has a runner too: the task
//! runtime's local runner (`tasks::runner`), which reports [`DEVICE`] and
//! every workspace capability, so the same table and the same [`Access`]
//! decide its tools. Each running attempt's [`Access`] is registered
//! ([`attach`]), and the bridge offers each attempt the tools it allows.

use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{Mutex, OnceLock},
};

/// The runs protocol from which a runner reports capabilities.
pub(crate) const CAPABILITIES_PROTOCOL: u64 = 4;
/// The runner serves the run's Jackalope MCP server on the computer's
/// loopback, answering the tools placed there itself and forwarding the rest.
pub(crate) const LOCAL_BRIDGE: &str = "local-bridge";
/// The browser tools run through agent-browser on the computer's Chromium.
pub(crate) const BROWSER: &str = "browser";
/// The saved check and source reads run in the computer's workspace.
pub(crate) const WORKSPACE_TOOLS: &str = "workspace-tools";
/// The runner asks this device before opening a website (`POST /v1/policy`).
pub(crate) const POLICY_CALLBACKS: &str = "policy-callbacks";
/// Workspaces travel as Git bundles against a per-project repository on the
/// computer (`sync_*`, see [`super::sync`]).
pub(crate) const GIT_SYNC: &str = "git-sync";
/// Content-addressed, chunked and resumable transfers (`artifact_*`, see
/// [`super::artifacts`]).
pub(crate) const ARTIFACTS: &str = "artifacts";
/// The runner is this device: the workspace, account profiles and sign-ins
/// are this device's own, so tools placed [`Placement::DeviceOnly`] are
/// available. Only the local runner has it; a computer cannot claim it.
pub(crate) const DEVICE: &str = "device";

/// What a computer's runner reported it can do.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct RunnerCapabilities {
    /// The runs protocol, 0 for an agent from before runs.
    pub protocol: u64,
    names: BTreeSet<String>,
}

impl RunnerCapabilities {
    /// Reads a `run_status` or `hello` answer. Capabilities count only from
    /// [`CAPABILITIES_PROTOCOL`]; an older runner has none, whatever it sends.
    pub fn from_status(status: Option<&Value>) -> Self {
        let protocol = status
            .and_then(|status| status["runs"].as_u64())
            .unwrap_or(0);
        let names = if protocol >= CAPABILITIES_PROTOCOL {
            status
                .and_then(|status| status["capabilities"].as_array())
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|name| name.len() <= 64 && *name != DEVICE)
                .map(str::to_string)
                .collect()
        } else {
            BTreeSet::new()
        };
        Self { protocol, names }
    }

    /// The local runner: this device, with every workspace capability.
    pub fn device() -> Self {
        Self {
            protocol: CAPABILITIES_PROTOCOL,
            names: [
                DEVICE,
                LOCAL_BRIDGE,
                WORKSPACE_TOOLS,
                BROWSER,
                POLICY_CALLBACKS,
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        }
    }

    pub fn has(&self, name: &str) -> bool {
        self.names.contains(name)
    }

    /// The listed capability names, for the attempt's activity.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.names.iter().map(String::as_str)
    }
}

/// Where a bridge tool executes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Placement {
    /// It reads or acts on the workspace, or on pages served from it, so it
    /// belongs with the workspace: on the runner when it has the capability.
    Workspace(&'static str),
    /// It needs this device: the person, credentials, coordination, history
    /// or approvals. Forwarded through the relay.
    Control,
    /// It needs this device's own copy of the workspace or its sign-ins, so
    /// it is never available to an agent on a computer.
    DeviceOnly,
}

/// One bridge tool, with its REST route when it has one.
pub(crate) struct Tool {
    pub name: &'static str,
    pub placement: Placement,
    pub route: Option<&'static str>,
}

const fn tool(name: &'static str, placement: Placement, route: Option<&'static str>) -> Tool {
    Tool {
        name,
        placement,
        route,
    }
}

use Placement::{Control, DeviceOnly, Workspace};

/// Every bridge tool and where it executes. A tool missing here is treated as
/// [`Placement::Control`]; `coordination_mcp`'s tests keep the table complete.
pub(crate) const TOOLS: &[Tool] = &[
    tool(
        "computer_verify",
        Workspace(WORKSPACE_TOOLS),
        Some("/v1/computer/verify"),
    ),
    tool(
        "verification_output",
        Workspace(WORKSPACE_TOOLS),
        Some("/v1/computer/output"),
    ),
    tool("read_context", Workspace(WORKSPACE_TOOLS), None),
    tool(
        "browser_navigate",
        Workspace(BROWSER),
        Some("/v1/browser/navigate"),
    ),
    tool(
        "browser_screenshot",
        Workspace(BROWSER),
        Some("/v1/browser/screenshot"),
    ),
    tool(
        "browser_snapshot",
        Workspace(BROWSER),
        Some("/v1/browser/snapshot"),
    ),
    tool(
        "browser_interact",
        Workspace(BROWSER),
        Some("/v1/browser/interact"),
    ),
    tool(
        "browser_configure",
        Workspace(BROWSER),
        Some("/v1/browser/configure"),
    ),
    tool(
        "browser_inspect",
        Workspace(BROWSER),
        Some("/v1/browser/inspect"),
    ),
    tool("browser_tabs", Workspace(BROWSER), Some("/v1/browser/tabs")),
    tool(
        "browser_open_profile",
        DeviceOnly,
        Some("/v1/browser/profile"),
    ),
    tool("peer_adopt", DeviceOnly, Some("/v1/peers/adopt")),
    tool("permission_prompt", DeviceOnly, None),
    tool("desktop_control", Control, Some("/v1/desktop/control")),
    tool(
        "computer_request",
        Control,
        Some("/v1/bot-computer/request"),
    ),
    tool("computer_exec", Control, Some("/v1/bot-computer/exec")),
    tool("ask_jev", Control, Some("/v1/jev/questions")),
    tool("discover_harness_tools", Control, None),
    tool("inbox", Control, None),
    tool("acknowledge_message", Control, Some("/v1/messages/ack")),
    tool("message", Control, Some("/v1/messages")),
    tool("search_tools", Control, Some("/v1/tools/search")),
    tool("read_tool", Control, Some("/v1/tools/read")),
    tool("read_tool_result", Control, Some("/v1/tools/result")),
    tool("execute_tool", Control, Some("/v1/tools/execute")),
    tool("project", Control, Some("/v1/project")),
    tool("peers", Control, Some("/v1/peers")),
    tool("peer_read", Control, Some("/v1/peers/read")),
    tool("propose_subtask", Control, Some("/v1/subtasks")),
    tool("plan_deviation", Control, Some("/v1/plan-deviation")),
    tool("agreement", Control, Some("/v1/agreements")),
    tool("bots", Control, None),
    tool("bot_message", Control, None),
    tool("present", Control, None),
    tool("suggest_bot", Control, None),
    tool("remember", Control, None),
    tool("recall", Control, None),
    tool("ask_user", Control, Some("/v1/user-prompt")),
    tool("user_response", Control, Some("/v1/user-prompt/poll")),
    tool("request_human_action", Control, Some("/v1/human-action")),
    tool(
        "record_validation_step",
        Control,
        Some("/v1/validation-step"),
    ),
    tool("restate_goal", Control, Some("/v1/goal-restatement")),
    tool("record_decision", Control, Some("/v1/decisions")),
];

/// Bridge routes without a tool that belong to a local agent process.
const DEVICE_ONLY_ROUTES: &[&str] = &["/v1/native/output"];

fn placement(name: &str) -> Placement {
    TOOLS
        .iter()
        .find(|tool| tool.name == name)
        .map_or(Control, |tool| tool.placement)
}

/// Where a tool runs for one run.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Where {
    /// Served by the runner, next to the workspace.
    Runner,
    /// Forwarded through the relay to this device.
    Device,
    Unavailable,
}

/// Where each tool of one run on a computer executes.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Access {
    pub runner: RunnerCapabilities,
    /// The computer's Chromium is reachable from this device (a local sandbox
    /// with networking), so a runner without the browser capability can still
    /// have the browser tools driven from here.
    pub devtools: bool,
    /// The attempt is read-only (planning). This device's copy of the
    /// workspace then matches the computer's, and its saved-check results feed
    /// the planning round, so workspace tools keep running here.
    pub read_only: bool,
}

impl Access {
    /// An attempt whose runner is this device.
    pub fn device(read_only: bool) -> Self {
        Self {
            runner: RunnerCapabilities::device(),
            devtools: false,
            read_only,
        }
    }

    /// Whether the runner is this device.
    pub fn on_device(&self) -> bool {
        self.runner.has(DEVICE)
    }

    /// Whether the runner serves tools itself for this run.
    fn local_bridge(&self) -> bool {
        self.runner.has(LOCAL_BRIDGE)
    }

    pub fn tool(&self, name: &str) -> Where {
        match placement(name) {
            Control => Where::Device,
            DeviceOnly if self.on_device() => Where::Runner,
            DeviceOnly => Where::Unavailable,
            // The runner asks about each website, so it drives the browser
            // only when it can ask.
            Workspace(BROWSER) => {
                if self.local_bridge()
                    && self.runner.has(BROWSER)
                    && self.runner.has(POLICY_CALLBACKS)
                {
                    Where::Runner
                } else if self.devtools {
                    Where::Device
                } else {
                    Where::Unavailable
                }
            }
            Workspace(capability) => {
                if self.read_only {
                    Where::Device
                } else if self.local_bridge() && self.runner.has(capability) {
                    Where::Runner
                } else {
                    Where::Unavailable
                }
            }
        }
    }

    /// Where a bridge REST route runs, by the tool it belongs to. Other
    /// routes (policy callbacks, runner events, approvals) are the control
    /// plane's.
    pub fn route(&self, route: &str) -> Where {
        let under = |prefix: &str| route == prefix || route.starts_with(&format!("{prefix}/"));
        if DEVICE_ONLY_ROUTES.iter().any(|prefix| under(prefix)) {
            return if self.on_device() {
                Where::Runner
            } else {
                Where::Unavailable
            };
        }
        TOOLS
            .iter()
            .filter_map(|tool| Some((tool.route?, tool.name)))
            .filter(|(prefix, _)| under(prefix))
            .max_by_key(|(prefix, _)| prefix.len())
            .map_or(Where::Device, |(_, name)| self.tool(name))
    }

    pub fn tool_unavailable(&self, name: &str) -> bool {
        self.tool(name) == Where::Unavailable
    }

    /// Tools the runner serves, in table order.
    pub fn local_tools(&self) -> Vec<&'static str> {
        TOOLS
            .iter()
            .filter(|tool| self.tool(tool.name) == Where::Runner)
            .map(|tool| tool.name)
            .collect()
    }

    /// The `local` part of `run_start`, when the runner serves tools. `check`
    /// is the attempt's saved project check.
    pub fn local_request(&self, check: Option<&str>) -> Option<Value> {
        let tools = self.local_tools();
        (!tools.is_empty()).then(|| {
            json!({
                "tools": tools,
                "check": check.map(str::trim).filter(|check| !check.is_empty()),
            })
        })
    }

    /// What the agent is told about where its tools act. An agent on this
    /// device is told nothing: its tools act where it runs.
    pub fn instructions(&self) -> String {
        if self.on_device() {
            return String::new();
        }
        let browser = self.tool("browser_navigate");
        let verify = self.tool("computer_verify");
        let mut text = String::from("\nYou run on a separate computer, not on the person's device. Jackalope's coordination, question and planning tools work as usual and reach the person's device. desktop_control acts on this computer's own screen.");
        text.push_str(match browser {
            Where::Runner => " The browser tools run on this computer and drive its own Chromium, so a server you start here is reachable at localhost; browser_screenshot saves under .jackalope/artifacts/screenshots in your workspace, where you can open it. Jackalope asks the person before you use each website other than this computer's own.",
            Where::Device => " The browser tools drive this computer's own Chromium, so a server you start here is reachable at localhost.",
            Where::Unavailable => " The browser tools are not available here.",
        });
        text.push_str(match verify {
            Where::Runner => " computer_verify and verification_output run the project's saved check in your workspace on this computer",
            Where::Device => " computer_verify runs the saved check on Jackalope's identical copy of this read-only workspace",
            Where::Unavailable => " computer_verify, verification_output and read_context are not available: use your own shell and file tools, and run checks in the shell",
        });
        if verify == Where::Runner {
            text.push_str(", and read_context reads this computer's copy");
        }
        text.push_str(". peer_adopt and browser_open_profile are not available.\n");
        text
    }

    /// The attempt's activity line naming where the tools run. `local` is
    /// what the runner reported it serves.
    pub fn activity(&self, computer: &str, local: &[&str]) -> String {
        let mut text = if local.is_empty() {
            format!("Jackalope's tools reach this device from {computer}.")
        } else {
            format!(
                "Run on {computer}: {}. Other Jackalope tools reach this device.",
                local.join(", ")
            )
        };
        let unavailable: Vec<&str> = TOOLS
            .iter()
            .filter(|tool| {
                matches!(tool.placement, Workspace(_)) && self.tool_unavailable(tool.name)
            })
            .map(|tool| tool.name)
            .collect();
        if !unavailable.is_empty() {
            text.push_str(&format!(
                " Not available there: {}.",
                unavailable.join(", ")
            ));
        }
        if self.tool("browser_navigate") == Where::Device {
            text.push_str(" The browser tools drive that computer's Chromium from here.");
        }
        text
    }
}

type Attached = Mutex<HashMap<String, Access>>;
static ATTACHED: OnceLock<Attached> = OnceLock::new();

fn attached() -> std::sync::MutexGuard<'static, HashMap<String, Access>> {
    ATTACHED
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Records where a running attempt's tools run, before its agent starts.
pub(crate) fn attach(run_id: &str, access: Access) {
    attached().insert(run_id.to_string(), access);
}

/// Forgets a finished attempt's placement.
pub(crate) fn detach(run_id: &str) {
    attached().remove(run_id);
}

/// Where a running attempt's tools run. An attempt that is not attached, such
/// as a bot conversation or a helper, runs on this device.
pub(crate) fn for_run(run_id: &str) -> Access {
    attached()
        .get(run_id)
        .cloned()
        .unwrap_or_else(|| Access::device(false))
}

/// The tools among `names` an attempt with `access` is offered, in order.
pub(crate) fn offered<'a>(
    access: &Access,
    names: impl IntoIterator<Item = &'a str>,
) -> Vec<&'a str> {
    names
        .into_iter()
        .filter(|name| !access.tool_unavailable(name))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runner(protocol: u64, names: &[&str]) -> RunnerCapabilities {
        RunnerCapabilities::from_status(Some(&json!({"runs": protocol, "capabilities": names})))
    }

    const ALL: &[&str] = &[LOCAL_BRIDGE, BROWSER, WORKSPACE_TOOLS, POLICY_CALLBACKS];

    #[test]
    fn capabilities_count_only_from_protocol_four() {
        let current = runner(4, ALL);
        assert_eq!(current.protocol, 4);
        for name in ALL {
            assert!(current.has(name), "{name}");
        }
        // A protocol 3 runner keeps today's behaviour even if it lists names.
        let older = runner(3, ALL);
        assert_eq!(older.protocol, 3);
        assert!(!older.has(LOCAL_BRIDGE));
        assert_eq!(older.names().count(), 0);
        assert_eq!(RunnerCapabilities::from_status(None).protocol, 0);
        let missing = RunnerCapabilities::from_status(Some(&json!({"exists": false})));
        assert_eq!(missing, RunnerCapabilities::default());
        // Unknown names from a newer runner are kept and ignored.
        let newer = runner(5, &[LOCAL_BRIDGE, "later"]);
        assert!(newer.has("later") && newer.has(LOCAL_BRIDGE) && !newer.has(BROWSER));
        let sync = runner(4, &[GIT_SYNC, ARTIFACTS]);
        assert!(sync.has(GIT_SYNC) && sync.has(ARTIFACTS));
        assert!(!runner(3, &[GIT_SYNC, ARTIFACTS]).has(GIT_SYNC));
    }

    #[test]
    fn a_protocol_three_runner_keeps_the_earlier_tool_list() {
        let writer = Access {
            runner: runner(3, ALL),
            devtools: false,
            read_only: false,
        };
        assert!(writer.local_tools().is_empty());
        assert!(writer.local_request(Some("pnpm test")).is_none());
        for name in [
            "browser_navigate",
            "computer_verify",
            "verification_output",
            "read_context",
            "browser_open_profile",
            "peer_adopt",
            "permission_prompt",
        ] {
            assert!(writer.tool_unavailable(name), "{name}");
        }
        for name in [
            "desktop_control",
            "ask_user",
            "execute_tool",
            "some_new_tool",
        ] {
            assert_eq!(writer.tool(name), Where::Device, "{name}");
        }
        let sandbox = Access {
            devtools: true,
            read_only: true,
            ..writer.clone()
        };
        for name in ["browser_tabs", "computer_verify", "read_context"] {
            assert_eq!(sandbox.tool(name), Where::Device, "{name}");
        }
        assert!(writer
            .instructions()
            .contains("browser tools are not available"));
        assert!(sandbox.instructions().contains("read-only workspace"));
    }

    #[test]
    fn a_current_runner_serves_workspace_tools_for_writers() {
        let writer = Access {
            runner: runner(4, ALL),
            devtools: false,
            read_only: false,
        };
        assert_eq!(
            writer.local_tools(),
            [
                "computer_verify",
                "verification_output",
                "read_context",
                "browser_navigate",
                "browser_screenshot",
                "browser_snapshot",
                "browser_interact",
                "browser_configure",
                "browser_inspect",
                "browser_tabs",
            ]
        );
        for name in ["browser_open_profile", "peer_adopt"] {
            assert!(writer.tool_unavailable(name), "{name}");
        }
        assert_eq!(writer.tool("ask_user"), Where::Device);
        let request = writer.local_request(Some(" pnpm test ")).unwrap();
        assert_eq!(request["check"], "pnpm test");
        assert_eq!(request["tools"][0], "computer_verify");
        assert!(writer.local_request(Some("  ")).unwrap()["check"].is_null());
        let text = writer.instructions();
        assert!(
            text.contains("run on this computer")
                && text.contains(".jackalope/artifacts/screenshots")
        );
        assert!(text.contains("read_context reads this computer's copy"));
        assert!(writer
            .activity("Box", &writer.local_tools())
            .contains("Run on Box: computer_verify"));

        // A read-only attempt keeps the saved check on this device's identical copy.
        let planner = Access {
            read_only: true,
            ..writer.clone()
        };
        assert_eq!(planner.tool("computer_verify"), Where::Device);
        assert_eq!(planner.tool("browser_snapshot"), Where::Runner);

        // Each capability is needed on its own.
        let no_browser = Access {
            runner: runner(4, &[LOCAL_BRIDGE, WORKSPACE_TOOLS]),
            devtools: true,
            read_only: false,
        };
        assert_eq!(no_browser.tool("browser_tabs"), Where::Device);
        assert_eq!(no_browser.tool("computer_verify"), Where::Runner);
        let cannot_ask = Access {
            runner: runner(4, &[LOCAL_BRIDGE, BROWSER, WORKSPACE_TOOLS]),
            devtools: false,
            read_only: false,
        };
        assert!(cannot_ask.tool_unavailable("browser_navigate"));
        let no_bridge = Access {
            runner: runner(4, &[BROWSER, WORKSPACE_TOOLS]),
            devtools: false,
            read_only: false,
        };
        assert!(no_bridge.local_tools().is_empty());
        assert!(no_bridge.tool_unavailable("computer_verify"));
        assert!(no_bridge
            .activity("Box", &[])
            .contains("Not available there"));
    }

    #[test]
    fn routes_follow_their_tools() {
        let legacy = Access::default();
        let current = Access {
            runner: runner(4, ALL),
            ..Access::default()
        };
        for (route, before, now) in [
            ("/v1/browser/navigate", Where::Unavailable, Where::Runner),
            (
                "/v1/browser/profile",
                Where::Unavailable,
                Where::Unavailable,
            ),
            ("/v1/computer/verify", Where::Unavailable, Where::Runner),
            ("/v1/computer/output", Where::Unavailable, Where::Runner),
            ("/v1/peers/adopt", Where::Unavailable, Where::Unavailable),
            ("/v1/native/output", Where::Unavailable, Where::Unavailable),
            ("/v1/peers", Where::Device, Where::Device),
            ("/v1/desktop/control", Where::Device, Where::Device),
            ("/v1/policy", Where::Device, Where::Device),
            ("/v1/runner/event", Where::Device, Where::Device),
            ("/v1/tools/approve", Where::Device, Where::Device),
        ] {
            assert_eq!(legacy.route(route), before, "{route}");
            assert_eq!(current.route(route), now, "{route}");
        }
    }

    #[test]
    fn the_device_runner_offers_every_tool_and_adds_no_instructions() {
        for read_only in [false, true] {
            let device = Access::device(read_only);
            assert!(device.on_device());
            for tool in TOOLS {
                assert!(!device.tool_unavailable(tool.name), "{}", tool.name);
            }
            for name in ["browser_open_profile", "peer_adopt", "permission_prompt"] {
                assert_eq!(device.tool(name), Where::Runner, "{name}");
            }
            assert_eq!(device.tool("ask_user"), Where::Device);
            assert!(device.instructions().is_empty());
            assert_eq!(device.route("/v1/peers/adopt"), Where::Runner);
            assert_eq!(device.route("/v1/native/output"), Where::Runner);
        }
        // A computer cannot claim to be this device.
        let claimed = runner(4, &[DEVICE, LOCAL_BRIDGE, BROWSER]);
        assert!(!claimed.has(DEVICE));
        let access = Access {
            runner: claimed,
            ..Access::default()
        };
        assert!(!access.on_device());
        assert!(access.tool_unavailable("peer_adopt"));
    }

    #[test]
    fn attached_attempts_keep_their_placement_until_detached() {
        let id = format!("attached-{}", uuid::Uuid::new_v4());
        assert!(for_run(&id).on_device());
        attach(&id, Access::default());
        assert!(!for_run(&id).on_device());
        assert!(for_run(&id).tool_unavailable("browser_navigate"));
        detach(&id);
        assert!(for_run(&id).on_device());
    }

    #[test]
    fn the_table_names_each_tool_once() {
        let mut names: Vec<&str> = TOOLS.iter().map(|tool| tool.name).collect();
        let count = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), count);
    }
}
