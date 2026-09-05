pub mod commands;
pub mod state;

use commands::{agent::*, git::*, pty::*, system::*};
use state::AppState;
use commands::tasks::*;
use commands::coordination::*;
use commands::integration::*;
use commands::capacity::*;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(CapacityService::default())
        .setup(|app| {
            let directory = app.path().app_data_dir()?.join("task-runs-v1");
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("JACKALOPE_TEST_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(directory);
            let runtime = TaskRuntime::new(directory.clone())?;
            let coordinator = Coordinator::new(directory.join("coordination"), runtime.clone())?;
            coordinator.launch();
            app.manage(runtime);
            app.manage(coordinator);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git_list_worktrees,
            git_create_worktree,
            agent_spawn_process,
            system_get_info,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            task_runners,
            task_pick_project,
            task_validate_project,
            task_runs,
            task_start,
            task_stop,
            task_mark_reviewed,
            task_review,
            queue_snapshot,
            queue_add,
            queue_import,
            queue_dispatch,
            queue_cancel,
            queue_release,
            integration_prepare,
            integration_apply,
            integration_plans,
            capacity_snapshot,
        ])
        .build(tauri::generate_context!())
        .expect("error while building jackalope application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app.state::<Coordinator>().shutdown();
                app.state::<TaskRuntime>().stop_all();
                app.state::<AppState>().kill_all_pty_sessions();
            }
        });
}
