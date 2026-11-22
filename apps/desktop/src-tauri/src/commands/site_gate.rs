//! Asking the person once per website before an agent reads or acts on it, in
//! every browser an agent drives: the person's own windows, a computer's desktop
//! and browser, and a saved browser profile. Decisions last for the attempt, or
//! are saved under a project, computer or bot when the person says always/never.

use super::{
    computers::protocol::protocol, desktop_control::grant, harness::PendingUserPrompt,
    tasks::TaskRuntime,
};
use std::{collections::HashSet, path::PathBuf};

const HEADER: &str = "Website access";

/// Whether a host addresses this machine. Such pages are never asked about.
pub(crate) fn loopback(host: &str) -> bool {
    protocol()
        .browser
        .loopback_hosts
        .iter()
        .any(|known| known == host)
}

/// Whether a gate asks about this machine's own pages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Loopback {
    /// Never asked about: the browser runs on a computer or in a profile, where
    /// loopback pages are that machine's own services.
    Exempt,
    /// Asked about like any other site: the person's own browser, where loopback
    /// pages are the person's local services.
    Asked,
}

/// Why a site may not be used.
#[derive(Debug, PartialEq)]
pub(crate) enum Refused {
    /// The person declined it during this attempt.
    Declined,
    /// A saved decision blocks it.
    Blocked,
}

/// What [`SiteGate::check`] found for a host.
#[derive(Debug, PartialEq)]
pub(crate) enum Check {
    Allowed,
    /// No decision yet: ask the person with [`SiteGate::ask`].
    Ask,
}

/// The person's answer to a site question.
#[derive(Debug, PartialEq)]
pub(crate) struct Decision {
    pub host: String,
    pub allow: bool,
    /// Saved for the gate's owner, not only this attempt.
    pub remember: bool,
}

pub(crate) struct SiteGate {
    store: PathBuf,
    /// Key of the saved decisions: a project ID, a computer's decisions key or `bot:<id>`.
    decisions: String,
    /// Where a remembered decision applies, as the options say it: "in <project>"
    /// or "for <computer>".
    scope: String,
    loopback: Loopback,
    allowed: HashSet<String>,
    denied: HashSet<String>,
    /// The open question: (prompt ID, host).
    pending: Option<(String, String)>,
    /// The site open in a window the person attached to the conversation. It and its
    /// subdomains count as allowed for this attempt unless a saved decision blocks them.
    attached: Option<String>,
}

impl SiteGate {
    pub fn new(runtime: &TaskRuntime, decisions: &str, scope: String, loopback: Loopback) -> Self {
        Self::at(
            grant::store_path(&runtime.preferences_directory()),
            decisions,
            scope,
            loopback,
        )
    }

    fn at(store: PathBuf, decisions: &str, scope: String, loopback: Loopback) -> Self {
        Self {
            store,
            decisions: decisions.into(),
            scope,
            loopback,
            allowed: HashSet::new(),
            denied: HashSet::new(),
            pending: None,
            attached: None,
        }
    }

    /// Allows the site of an attached window, and its subdomains, for this attempt only.
    /// Nothing is saved, and a saved "never" still refuses it: then this returns false.
    pub fn allow_attached(&mut self, host: &str) -> bool {
        if grant::site_decision(&grant::sites(&self.store, &self.decisions), host) == Some(false) {
            return false;
        }
        self.attached = Some(host.into());
        true
    }

    /// The question about an attached window's site, already answered: attaching it was the
    /// person's answer, so the attempt's questions show it like any other.
    pub fn attached_prompt(&self, run_id: &str, host: &str) -> PendingUserPrompt {
        let options = self.options(host).into_iter().map(|(label, _)| label);
        let mut prompt = PendingUserPrompt::choice(
            run_id,
            HEADER,
            format!("You attached this window on {host}. The agent may read and act on {host} in it for this task."),
            options.collect(),
        );
        prompt.status = "answered".into();
        prompt.answer = Some(format!("Allow {host} for this task"));
        prompt.answered_at = Some(chrono::Utc::now().to_rfc3339());
        prompt
    }

    fn within_attached(&self, host: &str) -> bool {
        self.attached.as_deref().is_some_and(|site| {
            host == site
                || host
                    .strip_suffix(site)
                    .is_some_and(|rest| rest.ends_with('.'))
        })
    }

    fn options(&self, host: &str) -> Vec<(String, (bool, bool))> {
        let scope = &self.scope;
        vec![
            (format!("Allow {host} for this task"), (true, false)),
            (format!("Always allow {host} {scope}"), (true, true)),
            (format!("Not {host}"), (false, false)),
            (format!("Never allow {host} {scope}"), (false, true)),
        ]
    }

    /// Whether `host` may be used now, from this attempt's answers, then saved decisions.
    pub fn check(&mut self, host: &str) -> Result<Check, Refused> {
        if (self.loopback == Loopback::Exempt && loopback(host)) || self.allowed.contains(host) {
            return Ok(Check::Allowed);
        }
        if self.denied.contains(host) {
            return Err(Refused::Declined);
        }
        match grant::site_decision(&grant::sites(&self.store, &self.decisions), host) {
            Some(true) => {
                self.allowed.insert(host.into());
                Ok(Check::Allowed)
            }
            Some(false) => {
                self.denied.insert(host.into());
                Err(Refused::Blocked)
            }
            None if self.within_attached(host) => {
                self.allowed.insert(host.into());
                Ok(Check::Allowed)
            }
            None => Ok(Check::Ask),
        }
    }

    /// Builds the question about `host`, hands it to `push` and, once pushed,
    /// waits for its answer. Returns the question's ID.
    pub fn ask(
        &mut self,
        run_id: &str,
        host: &str,
        question: String,
        push: impl FnOnce(&PendingUserPrompt) -> Result<(), String>,
    ) -> Result<String, String> {
        let options = self.options(host).into_iter().map(|(label, _)| label);
        let prompt = PendingUserPrompt::choice(run_id, HEADER, question, options.collect());
        push(&prompt)?;
        self.pending = Some((prompt.id.clone(), host.into()));
        Ok(prompt.id)
    }

    /// The open question: (prompt ID, host).
    pub fn pending(&self) -> Option<(&str, &str)> {
        self.pending
            .as_ref()
            .map(|(id, host)| (id.as_str(), host.as_str()))
    }

    /// Settles the open question from its prompt. `None` while the person has not
    /// answered; an answer that is not one of the options declines.
    pub fn settle(&mut self, prompt: &PendingUserPrompt) -> Result<Option<Decision>, String> {
        let Some((id, host)) = self.pending.clone() else {
            return Ok(None);
        };
        if prompt.id != id {
            return Err("The website question is no longer available.".into());
        }
        let answer = match prompt.status.as_str() {
            "pending" | "deciding" => return Ok(None),
            "answered" => prompt.answer.as_deref().unwrap_or_default(),
            _ => "",
        };
        self.pending = None;
        let (allow, remember) = self
            .options(&host)
            .into_iter()
            .find(|(label, _)| label == answer)
            .map_or((false, false), |(_, choice)| choice);
        if remember {
            grant::decide_site(&self.store, &self.decisions, &host, allow)?;
        }
        if allow {
            self.allowed.insert(host.clone());
        } else {
            self.denied.insert(host.clone());
        }
        Ok(Some(Decision {
            host,
            allow,
            remember,
        }))
    }
}

/// Adds a question to a running attempt. `false` when the attempt has ended.
pub(crate) fn push_if_running(
    runtime: &TaskRuntime,
    run_id: &str,
    prompt: &PendingUserPrompt,
) -> Result<bool, String> {
    let mut pushed = false;
    runtime.update_checked(run_id, |run| {
        if run.status.is_running() {
            run.prompts.push(prompt.clone());
            pushed = true;
        }
    })?;
    Ok(pushed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate(store: &std::path::Path) -> SiteGate {
        SiteGate::at(
            store.join("sites.json"),
            "project-1",
            "in Shop".into(),
            Loopback::Exempt,
        )
    }

    fn store() -> PathBuf {
        let path = std::env::temp_dir().join(format!("jackalope-sites-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn answered(prompt_id: &str, status: &str, answer: Option<&str>) -> PendingUserPrompt {
        let mut prompt = PendingUserPrompt::choice("run", HEADER, String::new(), Vec::new());
        prompt.id = prompt_id.into();
        prompt.status = status.into();
        prompt.answer = answer.map(str::to_owned);
        prompt
    }

    #[test]
    fn a_gate_that_asks_about_loopback_asks_like_any_site() {
        let store = store();
        let mut gate = SiteGate::at(
            store.join("sites.json"),
            "project-1",
            "in Shop".into(),
            Loopback::Asked,
        );
        for host in ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"] {
            assert_eq!(gate.check(host), Ok(Check::Ask), "{host}");
        }
        let _ = std::fs::remove_dir_all(store);
    }

    #[test]
    fn exempt_gates_never_ask_about_loopback_hosts() {
        let store = store();
        let mut gate = gate(&store);
        for host in ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"] {
            assert_eq!(gate.check(host), Ok(Check::Allowed), "{host}");
        }
        assert_eq!(gate.check("example.com"), Ok(Check::Ask));
        let _ = std::fs::remove_dir_all(store);
    }

    #[test]
    fn answers_decide_for_the_attempt_or_are_saved() {
        let store = store();
        let mut gate = gate(&store);
        let mut asked = None;
        let id = gate
            .ask("run", "example.com", "May it?".into(), |prompt| {
                asked = Some(prompt.clone());
                Ok(())
            })
            .unwrap();
        let asked = asked.unwrap();
        assert_eq!(
            asked.options,
            [
                "Allow example.com for this task",
                "Always allow example.com in Shop",
                "Not example.com",
                "Never allow example.com in Shop"
            ]
        );
        assert_eq!(gate.pending(), Some((id.as_str(), "example.com")));
        assert_eq!(gate.settle(&answered(&id, "deciding", None)), Ok(None));
        let decision = gate
            .settle(&answered(&id, "answered", Some("Not example.com")))
            .unwrap()
            .unwrap();
        assert!(!decision.allow && !decision.remember);
        assert_eq!(gate.check("example.com"), Err(Refused::Declined));

        let id = gate
            .ask("run", "docs.rs", "May it?".into(), |_| Ok(()))
            .unwrap();
        let decision = gate
            .settle(&answered(
                &id,
                "answered",
                Some("Always allow docs.rs in Shop"),
            ))
            .unwrap()
            .unwrap();
        assert!(decision.allow && decision.remember);
        let mut fresh = self::gate(&store);
        assert_eq!(fresh.check("api.docs.rs"), Ok(Check::Allowed));

        let id = gate
            .ask("run", "other.com", "May it?".into(), |_| Ok(()))
            .unwrap();
        let decision = gate
            .settle(&answered(&id, "expired", None))
            .unwrap()
            .unwrap();
        assert!(!decision.allow);
        let _ = std::fs::remove_dir_all(store);
    }

    #[test]
    fn an_attached_site_is_allowed_for_the_attempt_only_and_a_saved_never_wins() {
        let store = store();
        grant::decide_site(
            &store.join("sites.json"),
            "project-1",
            "ads.allmcps.com",
            false,
        )
        .unwrap();
        let mut gate = gate(&store);
        assert!(gate.allow_attached("allmcps.com"));
        assert_eq!(gate.check("allmcps.com"), Ok(Check::Allowed));
        assert_eq!(gate.check("docs.allmcps.com"), Ok(Check::Allowed));
        assert_eq!(gate.check("notallmcps.com"), Ok(Check::Ask));
        assert_eq!(gate.check("example.com"), Ok(Check::Ask));
        assert_eq!(gate.check("ads.allmcps.com"), Err(Refused::Blocked));
        assert!(gate.pending().is_none(), "nothing was asked");

        let prompt = gate.attached_prompt("run", "allmcps.com");
        assert_eq!(prompt.status, "answered");
        assert_eq!(
            prompt.answer.as_deref(),
            Some("Allow allmcps.com for this task")
        );
        assert!(prompt
            .question
            .contains("You attached this window on allmcps.com"));

        let mut fresh = self::gate(&store);
        assert_eq!(
            fresh.check("allmcps.com"),
            Ok(Check::Ask),
            "nothing was saved"
        );
        assert_eq!(
            grant::sites(&store.join("sites.json"), "project-1").len(),
            1,
            "only the earlier never is saved"
        );

        grant::decide_site(&store.join("sites.json"), "project-1", "blocked.com", false).unwrap();
        let mut gate = self::gate(&store);
        assert!(!gate.allow_attached("blocked.com"));
        assert_eq!(gate.check("blocked.com"), Err(Refused::Blocked));
        let _ = std::fs::remove_dir_all(store);
    }
}
