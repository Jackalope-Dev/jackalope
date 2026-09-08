pub mod commands;
pub mod state;
mod window_behavior;

use commands::agent_policy::*;
use commands::agent_profiles::*;
use commands::agent_sign_in::*;
use commands::capacity::*;
use commands::coordination::*;
use commands::integration::*;
use commands::mcp::*;
use commands::reset::*;
use commands::schedules::*;
use commands::tasks::*;
use commands::{git::*, pty::*, system::*};
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .manage(SignInService::default())
        .manage(CapacityService::default())
        .setup(move |app| {
            commands::browser::set_resource_directory(app.path().resource_dir()?);
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
            app.manage(commands::account::AccountService::new(preferences.join("account.bin"), runtime.access.clone()));
            commands::account::launch_refresh(app.handle().clone());
            app.manage(WindowBehavior::load(preferences.join("desktop.json")));
            app.manage(commands::notifications::Notifications::load(preferences.join("notifications.json")));
            app.manage(commands::community::Community::load(preferences.join("community.json")));
            let coordinator = Coordinator::new(directory.join("coordination"), runtime.clone())?;
            coordinator.launch();
            let scheduler = Scheduler::new(directory.join("schedules.json"), coordinator.clone());
            scheduler.launch();
            app.manage(scheduler);
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
            commands::notifications::launch(app.handle().clone());
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
            commands::execution_access::app_execution_access,
            commands::account::app_account_status,
            commands::account::app_account_connect,
            commands::account::app_account_open_browser,
            commands::account::app_account_referrals,
            commands::account::app_account_open_referrals,
            commands::account::app_account_poll,
            commands::account::app_account_disconnect,
            desktop_settings,
            commands::notifications::notification_status,
            commands::notifications::notification_configure,
            commands::notifications::notification_test,
            commands::notifications::notification_take_open,
            commands::knowledge::knowledge_list,
            commands::knowledge::knowledge_save,
            commands::knowledge::knowledge_remove,
            commands::knowledge::knowledge_preview,
            commands::knowledge::knowledge_search,
            commands::codebase::codebase_scan,
            commands::codebase_watch::codebase_watch,
            commands::codebase_watch::codebase_unwatch,
            desktop_set_close_to_tray,
            app_reset,
            app_finish_reset,
            git_list_worktrees,
            git_create_worktree,
            commands::worktree_cleanup::git_cleanup_worktree,
            commands::worktree_cleanup::git_archive_worktree,
            commands::worktree_cleanup::git_prune_worktrees,
            commands::release::app_diagnostics,
            commands::community::app_community_settings,
            commands::community::app_community_configure,
            commands::community::app_release_channel,
            commands::community::app_telemetry,
            commands::community::app_submit_feedback,
            commands::account::feedback::app_account_feedback,
            commands::release::app_release_status,
            commands::release::app_install_update,
            system_get_info,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            schedule_list,
            schedule_inspect_change,
            schedule_save,
            schedule_remove,
            schedule_set_enabled,
            task_runners,
            agent_save_policy,
            task_read_context,
            commands::repo_todos::repo_todos_read,
            commands::repo_todos::repo_todos_save,
            task_pick_project,
            task_validate_project,
            task_project_directory,
            task_create_project,
            task_runs,
            task_history_recovery,
            task_retry_save,
            task_export_recovery,
            task_archived_runs,
            task_restore_archived,
            task_import_recovery,
            task_screenshot,
            task_start,
            task_stop,
            task_mark_reviewed,
            commands::outcomes::task_outcome_snapshot,
            commands::readiness::project_readiness,
            commands::previews::task_preview_start,
            commands::previews::task_preview_status,
            commands::previews::task_preview_stop,
            commands::outcomes::task_outcome_review,
            task_review,
            commands::verification::task_verify,
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
            mcp_authenticate,
            mcp_list_servers,
            mcp_save_server,
            mcp_delete_server,
            mcp_probe_server,
            agent_profile_list,
            agent_profile_create,
            agent_profile_rename,
            agent_profile_delete,
            agent_profile_set_active,
            agent_profile_set_group,
            agent_profile_set_tag,
            agent_profile_sign_in,
            agent_profile_sign_in_poll,
            agent_profile_sign_in_input,
            agent_profile_sign_in_resize,
            agent_profile_sign_in_stop,
            agent_profile_status,
        ])
        .build(context)
        .expect("error while building jackalope application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app.state::<Scheduler>().shutdown();
                app.state::<commands::notifications::Notifications>().shutdown();
                commands::browser::close_all();
                commands::previews::close_all();
                app.state::<Coordinator>().shutdown();
                app.state::<TaskRuntime>().stop_all();
                app.state::<AppState>().kill_all_pty_sessions();
                app.state::<SignInService>().stop_all();
            }
        });
}
