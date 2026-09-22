use super::*;
use crate::commands::work_terminal;

#[test]
fn task_terminal_reconnects_and_reserves_its_workspace_until_stopped() {
    let root = std::env::temp_dir().join(format!("jackalope-terminal-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let mut run = sample("codex");
    run.id = uuid::Uuid::new_v4().to_string();
    run.task_id = uuid::Uuid::new_v4().to_string();
    run.workspace = workspace.to_string_lossy().into_owned();
    run.project_path = run.workspace.clone();
    run.status = "review".into();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    runtime.save(&run).unwrap();
    drop(runtime);
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    work_terminal::start(&runtime, &run.id).unwrap();
    struct Stop(String, String);
    impl Drop for Stop {
        fn drop(&mut self) {
            let _ = tauri::async_runtime::block_on(work_terminal::task_terminal_stop(
                self.0.clone(),
                self.1.clone(),
            ));
        }
    }
    let status = || {
        serde_json::to_value(
            work_terminal::task_terminal_status(run.task_id.clone(), 0, String::new())
                .unwrap()
                .unwrap(),
        )
        .unwrap()
    };
    let first = status();
    let generation = first["generation"].as_str().unwrap().to_string();
    let cleanup = Stop(run.task_id.clone(), generation.clone());
    assert_eq!(
        first["workspace"],
        dunce::canonicalize(&workspace)
            .unwrap()
            .to_string_lossy()
            .as_ref()
    );
    work_terminal::start(&runtime, &run.id).unwrap();
    assert_eq!(first["generation"], status()["generation"]);
    assert!(work_terminal::ensure_idle(&run.workspace).is_err());
    assert!(crate::commands::previews::ensure_idle(&run.workspace).is_err());
    work_terminal::start_with_shell(&runtime, &run.id, "default", "split", true).unwrap();
    let split_id = format!("{}::split", run.task_id);
    let split = serde_json::to_value(
        work_terminal::task_terminal_status(split_id.clone(), 0, String::new())
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert!(split["running"].as_bool().unwrap());
    let split_generation = split["generation"].as_str().unwrap().to_string();
    let split_cleanup = Stop(split_id.clone(), split_generation.clone());
    assert!(work_terminal::start_with_shell(&runtime, &run.id, "default", "third", false).is_err());
    assert!(work_terminal::task_terminal_write(
        split_id.clone(),
        generation.clone(),
        "must not write".into()
    )
    .is_err());
    work_terminal::task_terminal_write(split_id.clone(), split_generation.clone(), "exit\r".into())
        .unwrap();
    let saved_output = runtime.integration_directory().join("terminal-output");
    let started = std::time::Instant::now();
    loop {
        let split = serde_json::to_value(
            work_terminal::task_terminal_status(split_id.clone(), 0, String::new())
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if split["output"].as_str().unwrap().contains("\u{1b}[6n") {
            let _ = work_terminal::task_terminal_write(
                split_id.clone(),
                split_generation.clone(),
                "\u{1b}[1;1R".into(),
            );
        }
        if split["running"] == false && saved_output.read_dir().unwrap().next().is_some() {
            break;
        }
        assert!(
            started.elapsed().as_secs() < 15,
            "Exited shell output was not saved"
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    drop(split_cleanup);
    assert!(work_terminal::ensure_idle(&run.workspace).is_err());
    assert!(runtime
        .integration_directory()
        .join("terminal-output")
        .read_dir()
        .unwrap()
        .next()
        .is_some());
    work_terminal::task_terminal_resize(run.task_id.clone(), generation.clone(), 100, 28).unwrap();
    work_terminal::task_terminal_write(
        run.task_id.clone(),
        generation.clone(),
        "echo JACKALOPE_TERMINAL_RECEIPT > terminal-receipt.txt\r".into(),
    )
    .unwrap();
    let started = std::time::Instant::now();
    loop {
        let current = status();
        let output = current["output"].as_str().unwrap();
        if output.contains("\u{1b}[6n") {
            let _ = work_terminal::task_terminal_write(
                run.task_id.clone(),
                generation.clone(),
                "\u{1b}[1;1R".into(),
            );
        }
        if workspace.join("terminal-receipt.txt").exists() {
            break;
        }
        assert!(
            started.elapsed().as_secs() < 15,
            "Shell output was not replayed"
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    drop(cleanup);
    assert!(work_terminal::ensure_idle(&run.workspace).is_ok());
    assert_eq!(status()["running"], false);
    assert!(work_terminal::task_terminal_write(
        run.task_id.clone(),
        generation.clone(),
        "must not write".into()
    )
    .is_err());
    work_terminal::start(&runtime, &run.id).unwrap();
    let replacement = status()["generation"].as_str().unwrap().to_string();
    let cleanup = Stop(run.task_id.clone(), replacement.clone());
    assert_ne!(replacement, generation);
    assert!(work_terminal::task_terminal_write(
        run.task_id.clone(),
        generation.clone(),
        "must not write".into()
    )
    .unwrap_err()
    .contains("another window"));
    assert!(
        work_terminal::task_terminal_resize(run.task_id.clone(), generation.clone(), 100, 28)
            .is_err()
    );
    assert!(
        tauri::async_runtime::block_on(work_terminal::task_terminal_stop(
            run.task_id.clone(),
            generation
        ))
        .is_err()
    );
    assert_eq!(status()["running"], true);
    drop(cleanup);
    runtime
        .update_checked(&run.id, |run| run.status = "interrupted".into())
        .unwrap();
    assert!(work_terminal::start(&runtime, &run.id).is_err());
}
