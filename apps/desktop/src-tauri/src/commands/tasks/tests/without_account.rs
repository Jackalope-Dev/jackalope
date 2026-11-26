//! Local work never needs a Jackalope account: a task runs to review and its
//! terminal opens whether the account was never connected, has expired, has
//! gone unverified past its offline lease or was revoked. Only account features
//! refuse, and they refuse before contacting the service.

use super::*;
use crate::commands::account::fixture::{Account, FEATURES, STATES};
use crate::commands::agent_policy::{AgentPolicy, CustomAgent};
use crate::commands::work_terminal;

fn fixture_agent(folder: &Path) -> PathBuf {
    std::fs::write(
        folder.join("agent.cjs"),
        r#"
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({type: 'thread.started', thread_id: 'local-session'}));
  console.log(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: 'Local work done'}}));
});
"#,
    )
    .unwrap();
    let executable = folder.join(if cfg!(windows) { "agent.cmd" } else { "agent" });
    #[cfg(windows)]
    std::fs::write(&executable, "@echo off\r\nnode \"%~dp0agent.cjs\" %*\r\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(
            &executable,
            "#!/bin/sh\nexec node \"$(dirname \"$0\")/agent.cjs\" \"$@\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    executable
}

#[test]
fn local_tasks_and_terminals_run_without_a_current_jackalope_account() {
    let root = std::env::temp_dir().join(format!("jackalope-no-account-{}", uuid::Uuid::new_v4()));
    let repo = trial_repository(&root);
    let executable = fixture_agent(&root);
    let runtime = TaskRuntime::new(root.join("history")).unwrap();
    let mut policy = AgentPolicy::default();
    policy.default_meta_agent = "local-fixture".into();
    policy.custom_agents.push(CustomAgent {
        id: "local-fixture".into(),
        name: "Local fixture".into(),
        command: executable.to_string_lossy().into(),
        adapter: Some("codex".into()),
        args: Vec::new(),
    });
    std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
    std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();

    for state in STATES {
        let account = Account::new(state);
        for feature in FEATURES {
            assert!(account.admit(feature).is_err(), "{state:?} {feature:?}");
        }
        let mut request = trial_request(&repo, "default", None, "Local only");
        request.isolated = false;
        runtime.start(request.clone()).unwrap();
        let run = trial_settled(&runtime, &request.id, Duration::from_secs(30))
            .unwrap_or_else(|| panic!("{state:?}: the local task did not finish"));
        assert_eq!(run.status, RunStatus::Review, "{state:?}: {:?}", run.error);
        assert_eq!(run.result, "Local work done");

        work_terminal::start(&runtime, &run.id).unwrap();
        let view = serde_json::to_value(
            work_terminal::task_terminal_status(run.task_id.clone(), 0, String::new())
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        tauri::async_runtime::block_on(work_terminal::task_terminal_stop(
            run.task_id.clone(),
            view["generation"].as_str().unwrap().into(),
        ))
        .unwrap();
    }
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}
