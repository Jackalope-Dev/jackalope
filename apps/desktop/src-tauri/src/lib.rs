pub mod commands;
pub mod state;
mod window_behavior;

use commands::agent_policy::*;
use commands::agent_profiles::*;
use commands::capacity::*;
use commands::coordination::*;
use commands::integration::*;
use commands::mcp::*;
use commands::reset::*;
use commands::tasks::*;
use commands::{agent::*, git::*, pty::*, system::*};
use state::AppState;
use tauri::Manager;
use window_behavior::{desktop_set_close_to_tray, desktop_settings, setup_tray, WindowBehavior};

pub fn run() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows[0].user_agent =
        Some(format!("Jackalope/{}", env!("CARGO_PKG_VERSION")));
    let profile = std::env::var_os("JACKALOPE_PROFILE_DIR").map(std::path::PathBuf::from);
    context.config_mut().app.windows[0].create = false;
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
            let resetting = reset_on_startup(&directory)?;
            let runtime = TaskRuntime::new(directory.clone())?;
            let preferences = directory.join("preferences");
            std::fs::create_dir_all(&preferences)?;
            app.manage(WindowBehavior::load(preferences.join("desktop.json")));
            let coordinator = Coordinator::new(directory.join("coordination"), runtime.clone())?;
            coordinator.launch();
            app.manage(runtime);
            app.manage(coordinator);
            let mut window = tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?;
            if let Some(profile) = &profile { window = window.data_directory(profile.join("webview")); }
            if resetting {
                let token = std::fs::read_to_string(directory.join(RESET_MARKER))?;
                let token = serde_json::to_string(&token)?;
                window = window.initialization_script(format!("if (localStorage.getItem('jackalope-reset-receipt') !== {token}) {{ for (const key of Object.keys(localStorage)) {{ if (key.startsWith('jackalope-')) localStorage.removeItem(key); }} sessionStorage.clear(); localStorage.setItem('jackalope-reset-receipt', {token}); }} window.__JACKALOPE_RESET__ = true;"));
            }
            window.build()?;
            if let Err(error) = setup_tray(app) {
                eprintln!("System tray unavailable; closing will quit Jackalope: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && window.state::<WindowBehavior>().should_hide()
                    && window.hide().is_ok()
                {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_settings,
            desktop_set_close_to_tray,
            app_reset,
            app_finish_reset,
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
            task_history_recovery,
            task_screenshot,
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
            agent_profile_list,
            agent_profile_create,
            agent_profile_rename,
            agent_profile_delete,
            agent_profile_set_active,
            agent_profile_sign_in,
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
