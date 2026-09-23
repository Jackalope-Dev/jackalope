use crate::commands::tasks::TaskRun;
use std::collections::BTreeSet;

const OPTIONAL: &[(&str, &str)] = &[
    ("browser_navigate", "browser"),
    ("browser_screenshot", "browser"),
    ("browser_snapshot", "browser"),
    ("browser_interact", "browser"),
    ("browser_configure", "browser"),
    ("browser_inspect", "browser"),
    ("browser_tabs", "browser"),
    ("desktop_control", "desktop"),
    ("message", "coordination"),
    ("inbox", "coordination"),
    ("acknowledge_message", "coordination"),
    ("agreement", "coordination"),
];

pub(super) fn deferred(run: &TaskRun) -> bool {
    run.account_binding
        .as_ref()
        .map_or(run.agent.as_str(), |binding| binding.adapter.as_str())
        == "opencode"
        && run.efficiency.execution_profile.as_deref() == Some("lean")
        && crate::commands::experiments::is("JACKALOPE_TOOL_SURFACE", "deferred")
}

pub(super) fn visible(name: &str, discovered: &BTreeSet<String>) -> bool {
    !OPTIONAL.iter().any(|(tool, _)| *tool == name) || discovered.contains(name)
}

pub(super) fn requested(names: &[String]) -> Result<BTreeSet<String>, &'static str> {
    if names.len() > OPTIONAL.len()
        || names.iter().any(|name| {
            !OPTIONAL
                .iter()
                .any(|(tool, group)| name == tool || name == group)
        })
    {
        return Err("Select optional tool names or browser, desktop and coordination groups.");
    }
    Ok(OPTIONAL
        .iter()
        .filter(|(tool, group)| {
            names.is_empty() || names.iter().any(|name| name == tool || name == group)
        })
        .map(|(tool, _)| (*tool).to_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_expands_only_requested_tools_without_hiding_core_capabilities() {
        let mut discovered = requested(&["browser".into()]).unwrap();
        assert_eq!(discovered.len(), 7);
        assert!(visible("browser_interact", &discovered));
        assert!(!visible("desktop_control", &discovered));
        assert!(!visible("message", &discovered));
        assert!(visible("ask_user", &discovered));
        assert!(visible("computer_verify", &discovered));
        discovered.extend(requested(&["message".into()]).unwrap());
        assert!(visible("message", &discovered));
        assert!(!visible("inbox", &discovered));
        assert!(requested(&["execute_tool".into()]).is_err());
        assert!(requested(&["browser".into(), "unknown".into()]).is_err());
        assert!(!visible("browser_interact", &BTreeSet::new()));
        assert_eq!(requested(&[]).unwrap().len(), OPTIONAL.len());
    }
}
