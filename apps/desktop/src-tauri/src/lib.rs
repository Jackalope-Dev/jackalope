pub mod commands;
pub mod state;

use commands::agent_policy::*;
use commands::capacity::*;
use commands::coordination::*;
use commands::integration::*;
use commands::mcp::*;
use commands::tasks::*;
use commands::{agent::*, git::*, pty::*, system::*};
use state::AppState;
use tauri::Manager;

pub fn run() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows[0].user_agent =
        Some(format!("Jackalope/{}", env!("CARGO_PKG_VERSION")));
    let profile = std::env::var_os("JACKALOPE_PROFILE_DIR").map(std::path::PathBuf::from);
    if let Some(path) = &profile {
        assert!(path.is_absolute(), "JACKALOPE_PROFILE_DIR must be absolute");
        context.config_mut().app.windows[0].create = false;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(CapacityService::default())
        .setup(move |app| {
            let directory = profile
                .clone()
                .unwrap_or(app.path().app_data_dir()?)
                .join("task-runs-v1");
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("JACKALOPE_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            let runtime = TaskRuntime::new(directory.clone())?;
            let coordinator = Coordinator::new(directory.join("coordination"), runtime.clone())?;
            coordinator.launch();
            app.manage(runtime);
            app.manage(coordinator);
            if let Some(profile) = &profile {
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .data_directory(profile.join("webview"))
                    .build()?;
            }
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
            agent_save_policy,
            task_read_context,
            task_pick_project,
            task_validate_project,
            task_runs,
            task_start,
            task_stop,
            task_mark_reviewed,
            task_review,
            task_respond_prompt,
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
            mcp_list_servers,
            mcp_save_server,
            mcp_delete_server,
            mcp_probe_server,
        ])
        .build(context)
        .expect("error while building jackalope application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app.state::<Coordinator>().shutdown();
                app.state::<TaskRuntime>().stop_all();
                app.state::<AppState>().kill_all_pty_sessions();
            }
        });
}
