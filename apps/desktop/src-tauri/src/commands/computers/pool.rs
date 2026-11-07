//! The capacity pool: the execution hosts a project's planned and swarm work
//! may use, and the placer that picks one for each fork.
//!
//! The hosts are this device and the computers that support runs: the
//! project's own computer (the one **Agents run on** names, which it pins) and
//! any other computers the person adds for the project's swarms. Each host has
//! a concurrency limit, how many attempts run there now and its health (when
//! it was last reached and whether contact was lost). A project chooses where
//! its swarms may run ([`SwarmHosts`]); without a choice it runs anywhere,
//! which with no added computers is exactly where its agents ran before the
//! pool existed.
//!
//! [`place`] is deterministic: the same hosts, loads and needs give the same
//! host, and the reason it gives is recorded in the attempt's activity.

use super::runner::RunnerCapabilities;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// The host id of this device.
pub(crate) const DEVICE: &str = "device";
pub(crate) const DEVICE_NAME: &str = "This device";
/// Runs a computer the person added takes at once, unless its runner reports
/// more.
pub(crate) const DEFAULT_COMPUTER_SLOTS: usize = 2;
/// The most runs a runner may report it takes.
const MAX_SLOTS: u64 = 32;
/// The most computers a project may add to its pool.
const MAX_ADDED: usize = 16;
/// How long a computer that lost contact gets no new work, unless it is
/// reached again first.
const LOST_COOLDOWN: Duration = Duration::from_secs(10 * 60);

/// Where a project's swarm forks and planned attempts may run.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SwarmHosts {
    /// Only this device.
    Device,
    /// Only computers.
    Computers,
    /// This device and the project's computers.
    #[default]
    Anywhere,
}

impl SwarmHosts {
    pub fn allows(self, device: bool) -> bool {
        match self {
            Self::Device => device,
            Self::Computers => !device,
            Self::Anywhere => true,
        }
    }
}

/// A project's saved pool choices.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHosts {
    /// Absent until the person chooses, which runs anywhere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swarm_hosts: Option<SwarmHosts>,
    /// Computers besides the project's own that its swarms may use.
    #[serde(default)]
    pub computers: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    projects: BTreeMap<String, ProjectHosts>,
}

fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn read(root: &Path) -> Result<Saved, String> {
    let path = root.join("pool.json");
    if !path.exists() {
        return Ok(Saved::default());
    }
    let bytes = crate::commands::history::read_bounded(&path, 1_000_000)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "Saved swarm hosts could not be read. The file was left unchanged.".into())
}

/// The project's choices; a missing or unreadable file reads as no choice.
pub(crate) fn settings(root: &Path, project: &str) -> ProjectHosts {
    let _guard = lock().lock();
    read(root)
        .ok()
        .and_then(|saved| saved.projects.get(project).cloned())
        .unwrap_or_default()
}

/// Every project's choices.
pub(crate) fn all_settings(root: &Path) -> HashMap<String, ProjectHosts> {
    let _guard = lock().lock();
    read(root)
        .map(|saved| saved.projects.into_iter().collect())
        .unwrap_or_default()
}

pub(crate) fn save(root: &Path, project: &str, hosts: ProjectHosts) -> Result<(), String> {
    if project.is_empty() || project.len() > 200 {
        return Err("Choose a saved project.".into());
    }
    if hosts.computers.len() > MAX_ADDED
        || hosts.computers.iter().any(|id| {
            id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric())
        })
    {
        return Err(format!("Add up to {MAX_ADDED} saved computers."));
    }
    let _guard = lock().lock().map_err(|e| e.to_string())?;
    let mut saved = read(root)?;
    let mut hosts = hosts;
    hosts.computers.sort();
    hosts.computers.dedup();
    saved.projects.insert(project.into(), hosts);
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&saved).map_err(|e| e.to_string())?;
    crate::commands::history::write_atomic(&root.join("pool.json"), &bytes)
}

// ---- health ----

/// What this device knows of a computer from its runs.
#[derive(Clone, Debug, Default)]
pub(crate) struct Health {
    pub last_seen: Option<String>,
    /// Why contact was lost, until the computer is reached again.
    pub lost: Option<String>,
    lost_at: Option<Instant>,
    /// Whether its runner has the browser tools, once a run has asked.
    pub browser: Option<bool>,
    /// Runs its runner reports it takes at once.
    pub slots: Option<usize>,
}

impl Health {
    /// Lost recently enough that new work goes elsewhere.
    pub fn unavailable(&self) -> bool {
        self.lost_at.is_some_and(|at| at.elapsed() < LOST_COOLDOWN)
    }
}

fn health_map() -> &'static Mutex<HashMap<String, Health>> {
    static HEALTH: OnceLock<Mutex<HashMap<String, Health>>> = OnceLock::new();
    HEALTH.get_or_init(Default::default)
}

/// Records that a computer answered, with what its runner reported when a
/// run asked.
pub(crate) fn seen(id: &str, capabilities: Option<&RunnerCapabilities>) {
    let mut map = health_map().lock().unwrap();
    let health = map.entry(id.into()).or_default();
    health.last_seen = Some(chrono::Utc::now().to_rfc3339());
    health.lost = None;
    health.lost_at = None;
    if let Some(capabilities) = capabilities {
        health.browser = Some(capabilities.has(super::runner::BROWSER));
        health.slots = capabilities.slots;
    }
}

/// Records that contact with a computer was lost.
pub(crate) fn lost(id: &str, reason: &str) {
    let mut map = health_map().lock().unwrap();
    let health = map.entry(id.into()).or_default();
    health.lost = Some(reason.chars().take(300).collect());
    health.lost_at = Some(Instant::now());
}

pub(crate) fn health(id: &str) -> Health {
    health_map()
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .unwrap_or_default()
}

/// Runs a runner reports it takes at once, from `slots` in `hello` or
/// `run_status`.
pub(crate) fn reported_slots(status: Option<&serde_json::Value>) -> Option<usize> {
    status
        .and_then(|status| status["slots"].as_u64())
        .filter(|slots| (1..=MAX_SLOTS).contains(slots))
        .map(|slots| slots as usize)
}

// ---- placement ----

/// One execution host as the placer sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Host {
    pub id: String,
    pub name: String,
    pub device: bool,
    /// The project's own computer: its forks prefer it.
    pub pinned: bool,
    pub limit: usize,
    pub running: usize,
    /// Lost contact recently.
    pub lost: Option<String>,
    /// Whether it has the browser tools, when known.
    pub browser: Option<bool>,
}

impl Host {
    pub fn device(limit: usize, running: usize) -> Self {
        Self {
            id: DEVICE.into(),
            name: DEVICE_NAME.into(),
            device: true,
            pinned: false,
            limit,
            running,
            lost: None,
            browser: Some(true),
        }
    }

    fn label(&self) -> String {
        if self.device {
            "this device".into()
        } else {
            self.name.clone()
        }
    }

    fn usage(&self) -> String {
        format!("{} of {} in use", self.running, self.limit)
    }

    fn free(&self) -> usize {
        self.limit.saturating_sub(self.running)
    }
}

/// What a fork needs from its host, from what it declares: its agent, the
/// project secrets its instructions name, the connections selected for it
/// and its browser-checked criteria.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Needs {
    /// Why it can only run on this device.
    pub device_only: Option<String>,
    /// Why it can only run on a computer.
    pub computer_only: Option<String>,
    pub browser: bool,
}

/// Where an attempt runs and why, saved on the attempt.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHost {
    /// [`DEVICE`] or a computer's id.
    pub id: String,
    pub name: String,
    pub reason: String,
    /// Why the host was lost during this attempt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lost: Option<String>,
    /// The host this attempt replaced after that host was lost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retried_from: Option<String>,
    /// What became of a lost host's attempt: retried elsewhere, or why not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry: Option<String>,
}

impl RunHost {
    pub fn device(reason: String) -> Self {
        Self {
            id: DEVICE.into(),
            name: DEVICE_NAME.into(),
            reason,
            ..Default::default()
        }
    }

    pub fn is_device(&self) -> bool {
        self.id == DEVICE
    }
}

/// What the placer decided for one fork.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Decision {
    Place(RunHost),
    /// Every host it may use is full or out of contact; try again later.
    Wait(String),
    /// No host it may use can take it.
    Refuse(String),
}

/// Picks a host for one fork.
///
/// 1. Hard boundaries first: the project's choice of hosts, a fork that can
///    only run on this device or only on a computer, the browser tools, and
///    `exclude` (the host a retry leaves). None left refuses the fork.
/// 2. Hosts out of contact are skipped; if that leaves none, the fork waits.
/// 3. The home host takes it while it has a free slot: the project's
///    computer when it pins one, otherwise this device.
/// 4. Otherwise the host with the most free slots takes it (fewest running,
///    then this device, then by name and id). A project that pins a computer
///    keeps forks that could run there off this device unless its computer is
///    out of contact or a retry is leaving it, so adding computers is what
///    spreads its work.
/// 5. With no free slot anywhere the fork waits.
///
/// Computers also share `remote_free`, the slots left in the limit on agents
/// running on computers.
pub(crate) fn place(
    policy: SwarmHosts,
    hosts: &[Host],
    needs: &Needs,
    remote_free: usize,
    exclude: Option<&str>,
) -> Decision {
    let fits = |host: &&Host| {
        policy.allows(host.device)
            && (needs.device_only.is_none() || host.device)
            && (needs.computer_only.is_none() || !host.device)
            && (!needs.browser
                || host.browser == Some(true)
                || (host.pinned && host.browser.is_none()))
            && Some(host.id.as_str()) != exclude
    };
    let candidates: Vec<&Host> = hosts.iter().filter(fits).collect();
    if candidates.is_empty() {
        return Decision::Refuse(refusal(policy, hosts, needs, exclude));
    }
    let healthy: Vec<&Host> = candidates
        .iter()
        .copied()
        .filter(|host| host.lost.is_none())
        .collect();
    if healthy.is_empty() {
        let names: Vec<String> = candidates.iter().map(|host| host.label()).collect();
        return Decision::Wait(format!(
            "Waiting for {} to be reached again.",
            names.join(" or ")
        ));
    }
    let free = |host: &Host| host.free() > 0 && (host.device || remote_free > 0);
    let note = needs_note(needs);
    let home = healthy
        .iter()
        .copied()
        .find(|host| host.pinned)
        .or_else(|| healthy.iter().copied().find(|host| host.device));
    if let Some(home) = home.filter(|home| free(home)) {
        let lost_pin = hosts
            .iter()
            .find(|host| host.pinned && !home.pinned)
            .and_then(|pin| {
                pin.lost
                    .as_ref()
                    .map(|reason| format!("{} is out of contact ({reason}). ", pin.name))
            })
            .unwrap_or_default();
        let what = if home.pinned {
            format!("{}, the project's computer", home.name)
        } else {
            home.label()
        };
        return Decision::Place(run_host(
            home,
            format!("{note}{lost_pin}Placed on {what} ({}).", home.usage()),
        ));
    }
    let pins_computer = hosts.iter().any(|host| host.pinned && host.lost.is_none());
    let mut overflow: Vec<&Host> = healthy
        .iter()
        .copied()
        .filter(|host| Some(*host) != home && free(host))
        .filter(|host| !(host.device && pins_computer && exclude.is_none()))
        .collect();
    overflow.sort_by(|a, b| {
        b.free()
            .cmp(&a.free())
            .then(a.running.cmp(&b.running))
            .then(b.device.cmp(&a.device))
            .then(a.name.cmp(&b.name))
            .then(a.id.cmp(&b.id))
    });
    match (overflow.first(), home) {
        (Some(host), Some(home)) => Decision::Place(run_host(
            host,
            format!(
                "{note}{} was full ({}), so it went to {}, the least busy host with room ({}).",
                capitalize_first(&home.label()),
                home.usage(),
                host.label(),
                host.usage()
            ),
        )),
        (Some(host), None) => Decision::Place(run_host(
            host,
            format!(
                "{note}Placed on {}, the least busy host it may use ({}).",
                host.label(),
                host.usage()
            ),
        )),
        (None, Some(home)) => Decision::Wait(format!(
            "Waiting for a free slot on {} ({}).",
            home.label(),
            home.usage()
        )),
        (None, None) => Decision::Wait("Waiting for a free slot.".into()),
    }
}

fn run_host(host: &Host, reason: String) -> RunHost {
    RunHost {
        id: host.id.clone(),
        name: host.name.clone(),
        reason,
        ..Default::default()
    }
}

fn capitalize_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn needs_note(needs: &Needs) -> String {
    let mut note = String::new();
    if let Some(why) = &needs.device_only {
        note.push_str(&format!("Needs this device: {why}. "));
    }
    if let Some(why) = &needs.computer_only {
        note.push_str(&format!("Needs a computer: {why}. "));
    }
    if needs.browser && needs.device_only.is_none() {
        note.push_str("Needs the browser tools. ");
    }
    note
}

fn refusal(policy: SwarmHosts, hosts: &[Host], needs: &Needs, exclude: Option<&str>) -> String {
    let computers = hosts.iter().any(|host| !host.device);
    if let Some(why) = &needs.device_only {
        if policy == SwarmHosts::Computers {
            return format!("This work can only run on this device ({why}), and this project's swarms run only on computers. Change Swarms run on in Project settings.");
        }
    }
    if let Some(why) = &needs.computer_only {
        if policy == SwarmHosts::Device {
            return format!("This work can only run on a computer ({why}), and this project's swarms run only on this device. Change Swarms run on in Project settings.");
        }
        if !computers {
            return format!("This work can only run on a computer ({why}), and this project has no computer. Choose one under Agents run on in Project settings.");
        }
    }
    if needs.device_only.is_some() && needs.computer_only.is_some() {
        return "This work names a secret available only to this device and one available only to computers, so no host can take it. Change where those secrets are available.".into();
    }
    if policy == SwarmHosts::Computers && !computers {
        return "This project's swarms run only on computers, and it has none. Choose one under Agents run on in Project settings.".into();
    }
    if needs.browser {
        return "This work needs the browser tools, and none of the computers it may use reports them. Update their image or let swarms run on this device.".into();
    }
    if exclude.is_some() {
        return "No other host this project may use can take this work.".into();
    }
    "No host this project may use can take this work.".into()
}

// ---- the pool a dispatch tick works from ----

/// A computer that supports runs, as one dispatch tick sees it.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct PoolComputer {
    pub id: String,
    pub name: String,
    /// The project whose own computer this is, if any.
    pub pinned_by: Option<String>,
    pub health: PoolHealth,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct PoolHealth {
    pub lost: Option<String>,
    pub browser: Option<bool>,
    pub slots: Option<usize>,
}

/// The pool for every project, refreshed each dispatch tick. Empty until the
/// first tick, when the placer keeps to the project computers the
/// coordinator already knows.
#[derive(Clone, Debug, Default)]
pub(crate) struct Pool {
    pub loaded: bool,
    pub computers: Vec<PoolComputer>,
    pub projects: HashMap<String, ProjectHosts>,
    /// What each waiting planned fork needs, by queue item id.
    pub needs: HashMap<String, Needs>,
}

impl Pool {
    pub fn load(root: &Path) -> Self {
        let computers = super::list(root)
            .unwrap_or_default()
            .into_iter()
            .filter(super::runs::supports_runs)
            .map(|computer| {
                let health = health(&computer.id);
                PoolComputer {
                    pinned_by: (computer.owner_kind == super::PROJECT)
                        .then(|| computer.owner_id.clone()),
                    id: computer.id,
                    name: computer.name,
                    health: PoolHealth {
                        lost: health.unavailable().then(|| health.lost.clone()).flatten(),
                        browser: health.browser,
                        slots: health.slots,
                    },
                }
            })
            .collect();
        Self {
            loaded: true,
            computers,
            projects: all_settings(root),
            needs: HashMap::new(),
        }
    }

    /// The project's own computer, or a stand-in for one the coordinator
    /// knows of before the pool has loaded.
    pub fn pinned(&self, project: &str, legacy: bool) -> Option<(String, String)> {
        self.computers
            .iter()
            .find(|computer| computer.pinned_by.as_deref() == Some(project))
            .map(|computer| (computer.id.clone(), computer.name.clone()))
            .or_else(|| {
                (legacy && !self.loaded)
                    .then(|| (format!("project:{project}"), "Project computer".into()))
            })
    }

    pub fn policy(&self, project: &str) -> SwarmHosts {
        self.projects
            .get(project)
            .and_then(|hosts| hosts.swarm_hosts)
            .unwrap_or_default()
    }

    /// The hosts `project`'s work may use with their current loads. Planned
    /// work (`swarm`) also gets the computers the person added; other queued
    /// work keeps to its project's computer or this device.
    pub fn hosts(
        &self,
        project: &str,
        swarm: bool,
        legacy_remote: bool,
        limits: Limits,
        load: &HashMap<String, usize>,
    ) -> Vec<Host> {
        let running = |id: &str| load.get(id).copied().unwrap_or(0);
        let mut hosts = vec![Host::device(limits.device, running(DEVICE))];
        if let Some((id, name)) = self.pinned(project, legacy_remote) {
            let computer = self.computers.iter().find(|computer| computer.id == id);
            hosts.push(Host {
                // The project's own computer takes up to the shared limit on
                // agents on computers; reported `slots` size added computers only.
                limit: limits.remote,
                running: running(&id),
                lost: computer.and_then(|computer| computer.health.lost.clone()),
                browser: computer.and_then(|computer| computer.health.browser),
                id,
                name,
                device: false,
                pinned: true,
            });
        }
        if swarm {
            let added = self
                .projects
                .get(project)
                .map(|hosts| hosts.computers.as_slice())
                .unwrap_or_default();
            for computer in self.computers.iter().filter(|computer| {
                added.contains(&computer.id) && computer.pinned_by.as_deref() != Some(project)
            }) {
                hosts.push(Host {
                    id: computer.id.clone(),
                    name: computer.name.clone(),
                    device: false,
                    pinned: false,
                    limit: computer.health.slots.unwrap_or(DEFAULT_COMPUTER_SLOTS),
                    running: running(&computer.id),
                    lost: computer.health.lost.clone(),
                    browser: computer.health.browser,
                });
            }
        }
        hosts
    }

    /// How many forks of one swarm round the project's hosts can run at once,
    /// counted the way [`place`] spreads them: computers share the limit on
    /// agents running on computers, and this device counts when the project
    /// does not pin a computer of its own.
    pub fn slots(&self, project: &str, legacy_remote: bool, limits: Limits) -> usize {
        let hosts = self.hosts(project, true, legacy_remote, limits, &HashMap::new());
        let policy = self.policy(project);
        let pins = hosts.iter().any(|host| host.pinned);
        let computers: usize = hosts
            .iter()
            .filter(|host| !host.device)
            .map(|host| host.limit)
            .sum::<usize>()
            .min(limits.remote);
        let device = if pins { 0 } else { limits.device };
        match policy {
            SwarmHosts::Device => limits.device,
            SwarmHosts::Computers => computers,
            SwarmHosts::Anywhere => device + computers,
        }
    }
}

/// Concurrency limits from the project queue.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    /// Agents at once on this device.
    pub device: usize,
    /// Agents at once on computers, shared by all of them.
    pub remote: usize,
}

// ---- hosts chosen at dispatch, handed to the attempt ----

fn assigned() -> &'static Mutex<HashMap<String, RunHost>> {
    static ASSIGNED: OnceLock<Mutex<HashMap<String, RunHost>>> = OnceLock::new();
    ASSIGNED.get_or_init(Default::default)
}

/// Hands the host the placer chose to the attempt `run_id` about to start.
pub(crate) fn assign(run_id: &str, host: RunHost) {
    assigned().lock().unwrap().insert(run_id.into(), host);
}

/// The host chosen for `run_id`, without handing it over.
pub(crate) fn peek(run_id: &str) -> Option<RunHost> {
    assigned().lock().unwrap().get(run_id).cloned()
}

/// The host chosen for `run_id`, once.
pub(crate) fn take(run_id: &str) -> Option<RunHost> {
    assigned().lock().unwrap().remove(run_id)
}

/// Words in `text` shaped like an environment variable name.
pub(crate) fn named_variables(text: &str) -> std::collections::HashSet<&str> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|word| {
            word.len() >= 2
                && word.chars().any(|c| c.is_ascii_uppercase())
                && !word.chars().any(|c| c.is_ascii_lowercase())
        })
        .collect()
}

#[cfg(test)]
mod tests;
