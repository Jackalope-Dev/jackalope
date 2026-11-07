//! Browser tools on a computer's own Chromium. The task's browser connects to
//! the computer's DevTools endpoint instead of starting a local browser, and
//! each website asks before first use with the computer owner's saved
//! decisions (`bot:<id>` for bots, the project for task computers). Sign-ins
//! happen in the computer itself through Watch / take over.

use super::{Computer, TaskRuntime};
use crate::commands::{
    browser::{ProfileGuard, Verdict},
    desktop_control::grant,
    harness::{PendingUserPrompt, QuestionPresentation},
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const SIGNED_IN: &str = "I signed in";
const SKIP: &str = "Skip sign-in";

#[derive(Default)]
struct State {
    allowed: HashSet<String>,
    denied: HashSet<String>,
    site_prompt: Option<(String, String)>,
    sign_in: Option<(String, String)>,
    skipped: HashSet<String>,
}

struct ComputerGuard {
    runtime: TaskRuntime,
    run_id: String,
    computer: Computer,
    /// The computer's DevTools endpoint, for a task browser on this device
    /// that drives it; none when the runner asks through a policy callback.
    endpoint: Option<String>,
    directory: PathBuf,
    state: Mutex<State>,
}

/// The browser guard for a run whose computer exposes its browser. Errors
/// while that computer is starting so the agent retries rather than silently
/// using a local browser.
pub(super) fn guard(
    runtime: &TaskRuntime,
    run_id: &str,
) -> Result<Option<Arc<dyn ProfileGuard>>, String> {
    let Some(computer) = super::for_run_id(runtime, run_id) else {
        return Ok(None);
    };
    let root = runtime.computers_root();
    if computer.provider != super::LOCAL_DOCKER || !computer.settings.network {
        return Ok(None);
    }
    super::ready(&root, &computer)?;
    let Some(endpoint) = super::provider(&computer.provider)?.devtools(&root, &computer) else {
        return Ok(None);
    };
    runtime.update(run_id, |run| {
        run.activity.push(format!(
            "Browser tools are using the browser in {}. Each site asks before first use.",
            computer.name
        ))
    });
    Ok(Some(Arc::new(ComputerGuard {
        runtime: runtime.clone(),
        run_id: run_id.into(),
        directory: root.join(&computer.id),
        computer,
        endpoint: Some(endpoint),
        state: Mutex::default(),
    })))
}

type Guards = Mutex<std::collections::HashMap<String, Arc<ComputerGuard>>>;
/// One guard per run whose runner asks about websites, so per-task answers and
/// pending questions carry across its calls.
static POLICY_GUARDS: std::sync::OnceLock<Guards> = std::sync::OnceLock::new();

/// Decides whether the runner of a run's computer may let its agent read and
/// act on the page at `url` (`login` reports a visible password field), with
/// the same questions and saved decisions as a task browser driving that
/// computer from here. A question to the person is asked once and answered
/// on a later call, so the answer is a denial that says to call again.
pub(crate) fn site_policy(
    runtime: &TaskRuntime,
    run_id: &str,
    url: &str,
    login: bool,
) -> serde_json::Value {
    let Some(computer) = super::for_run_id(runtime, run_id) else {
        return super::policy::deny("This attempt has no computer.");
    };
    let guard = {
        let mut guards = POLICY_GUARDS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guards.retain(|id, _| id == run_id || runtime.is_running(id));
        guards
            .entry(run_id.to_string())
            .or_insert_with(|| {
                Arc::new(ComputerGuard {
                    runtime: runtime.clone(),
                    run_id: run_id.into(),
                    directory: runtime.computers_root().join(&computer.id),
                    computer,
                    endpoint: None,
                    state: Mutex::default(),
                })
            })
            .clone()
    };
    match guard.before().and_then(|()| guard.page(url, login)) {
        Ok(Verdict::Proceed) => super::policy::allow(),
        Ok(Verdict::SignIn) => super::policy::deny(guard.sign_in(url)),
        Err(message) => super::policy::deny(message),
    }
}

fn options(host: &str, owner: &str) -> Vec<(String, (bool, bool))> {
    vec![
        (format!("Allow {host} for this task"), (true, false)),
        (format!("Always allow {host} for {owner}"), (true, true)),
        (format!("Not {host}"), (false, false)),
        (format!("Never allow {host} for {owner}"), (false, true)),
    ]
}

impl ComputerGuard {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn store(&self) -> PathBuf {
        grant::store_path(&self.runtime.preferences_directory())
    }

    fn ask(&self, header: &str, question: String, options: Vec<String>) -> Result<String, String> {
        let prompt = PendingUserPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: self.run_id.clone(),
            question,
            input_type: "choice".into(),
            options,
            default_value: None,
            status: "pending".into(),
            answer: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            answered_at: None,
            presentation: QuestionPresentation {
                header: Some(header.into()),
                allow_other: Some(false),
                ..Default::default()
            },
            autonomy: Default::default(),
        };
        let mut pushed = false;
        self.runtime.update_checked(&self.run_id, |run| {
            if run.status.is_running() {
                run.prompts.push(prompt.clone());
                pushed = true;
            }
        })?;
        if !pushed {
            return Err("This attempt has ended.".into());
        }
        Ok(prompt.id)
    }

    fn answer(&self, prompt_id: &str) -> Result<Option<String>, String> {
        let run = self
            .runtime
            .run_snapshot(&self.run_id)
            .filter(|run| run.status.is_running())
            .ok_or("This attempt has ended.")?;
        let prompt = run
            .prompts
            .iter()
            .find(|prompt| prompt.id == prompt_id)
            .ok_or("The browser question is no longer available.")?;
        Ok(match prompt.status.as_str() {
            "pending" => None,
            "answered" => Some(prompt.answer.clone().unwrap_or_default()),
            _ => Some(String::new()),
        })
    }

    fn owner(&self) -> &str {
        &self.computer.name
    }
}

impl ProfileGuard for ComputerGuard {
    fn directory(&self) -> &Path {
        &self.directory
    }

    fn remote_devtools(&self) -> Option<String> {
        self.endpoint.clone()
    }

    fn before(&self) -> Result<(), String> {
        let mut state = self.lock();
        if let Some((prompt, host)) = state.site_prompt.clone() {
            let Some(answer) = self.answer(&prompt)? else {
                return Err(format!("Waiting for the person to decide whether you may use {host} in {}. Call the browser tool again after they answer.", self.owner()));
            };
            state.site_prompt = None;
            let (allow, remember) = options(&host, self.owner())
                .into_iter()
                .find(|(label, _)| *label == answer)
                .map_or((false, false), |(_, choice)| choice);
            if remember {
                grant::decide_site(&self.store(), &self.computer.decisions, &host, allow)?;
            }
            if allow {
                state.allowed.insert(host);
            } else {
                state.denied.insert(host);
            }
        }
        if let Some((prompt, host)) = state.sign_in.clone() {
            let Some(answer) = self.answer(&prompt)? else {
                return Err(format!("Waiting for the person to sign in to {host} in {}. Never ask for or type passwords.", self.owner()));
            };
            state.sign_in = None;
            if answer != SIGNED_IN {
                state.skipped.insert(host);
            }
        }
        Ok(())
    }

    fn page(&self, url: &str, login: bool) -> Result<Verdict, String> {
        let Some(host) = grant::site_host(url)
            .filter(|_| url.starts_with("http://") || url.starts_with("https://"))
        else {
            return Ok(Verdict::Proceed);
        };
        if matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
            return Ok(Verdict::Proceed);
        }
        let mut state = self.lock();
        if state.denied.contains(&host) {
            return Err(format!("The person declined {host} for this task."));
        }
        if !state.allowed.contains(&host) {
            match grant::site_decision(
                &grant::sites(&self.store(), &self.computer.decisions),
                &host,
            ) {
                Some(true) => {
                    state.allowed.insert(host.clone());
                }
                Some(false) => {
                    state.denied.insert(host.clone());
                    return Err(format!(
                        "{host} is blocked for {} in its settings.",
                        self.owner()
                    ));
                }
                None => {
                    let prompt = self.ask(
                        "Website access",
                        format!("An agent wants to use {host} in {}. Allow it to read and act on this site there?", self.owner()),
                        options(&host, self.owner()).into_iter().map(|(label, _)| label).collect(),
                    )?;
                    state.site_prompt = Some((prompt, host.clone()));
                    return Err(format!("Asked the person whether you may use {host}. Wait, then call the browser tool again; page content is withheld until they allow it."));
                }
            }
        }
        if login && !state.skipped.contains(&host) && state.sign_in.is_none() {
            return Ok(Verdict::SignIn);
        }
        Ok(Verdict::Proceed)
    }

    fn sign_in(&self, url: &str) -> String {
        let host = grant::site_host(url).unwrap_or_else(|| "this site".into());
        let question = format!("Sign in to {host} in {}. Open it with Watch / take over in Jackalope, sign in there, then choose I signed in. The agent never sees your password.", self.owner());
        match self.ask(
            "Sign in needed",
            question,
            vec![SIGNED_IN.into(), SKIP.into()],
        ) {
            Ok(prompt) => {
                self.lock().sign_in = Some((prompt, host.clone()));
                format!("The page asks to sign in. The person was asked to sign in to {host} in {} themselves. Wait, call a browser tool again after they confirm, then navigate back. Never ask for or type passwords.", self.owner())
            }
            Err(error) => error,
        }
    }

    fn observed(&self, _: Vec<String>) {}
}
