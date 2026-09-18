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
    commands::platform::initialize_environment();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows[0].user_agent =
        Some(format!("Jackalope/{}", env!("CARGO_PKG_VERSION")));
    let profile = std::env::var_os("JACKALOPE_PROFILE_DIR").map(std::path::PathBuf::from);
    context.config_mut().app.windows[0].create = false;
    if let Some(path) = &profile {
        assert!(path.is_absolute(), "JACKALOPE_PROFILE_DIR must be absolute");
        context.config_mut().app.windows[0].create = false;
    }
    let builder = tauri::Builder::default();
    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .manage(SignInService::default())
        .manage(commands::local_ai::LocalAi::default())
        .manage(commands::managed_runtime::ManagedRuntime::default())
        .manage(CapacityService::default())
        .manage(commands::agent_models::ModelCatalogService::default())
        .setup(move |app| {
            commands::browser::set_resource_directory(app.path().resource_dir()?);
            commands::desktop_control::platform::set_resource_directory(app.path().resource_dir()?);
            let directory = profile
                .clone()
                .unwrap_or(app.path().app_data_dir()?)
                .join("task-runs-v1");
            #[cfg(debug_assertions)]
            let directory = std::env::var_os("JACKALOPE_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(directory);
            let resetting = reset_on_startup(&directory)?;
            commands::managed_runtime::initialize(directory.join("agent-runtimes"));
            let runtime = TaskRuntime::new(directory.clone())?;
            runtime.observe_changes(app.handle().clone());
            let helper = commands::helper::Helper::new(directory.clone(), runtime.clone());
            helper.launch();
            app.manage(helper);
            let preferences = directory.join("preferences");
            std::fs::create_dir_all(&preferences)?;
            app.manage(commands::account::AccountService::new(preferences.join("account.bin"), runtime.access.clone()));
            commands::account::launch_refresh(app.handle().clone());
            app.manage(WindowBehavior::load(preferences.join("desktop.json")));
            app.manage(commands::notifications::Notifications::load(preferences.join("notifications.json")));
            app.manage(commands::community::Community::load(preferences.join("community.json")));
            let coordinator = Coordinator::new(directory.join("coordination"), runtime.clone())?;
            coordinator.launch();
            let sessions = commands::live_sessions::LiveSessions::new(directory.join("live-sessions/sessions.json"), runtime.clone(), coordinator.clone());
            sessions.launch(app.handle().clone());
            let remote = commands::remote::RemoteAccess::new(preferences.join("remote-access.bin"), runtime.clone(), coordinator.clone(), sessions.clone(), app.handle().clone());
            remote.launch();
            app.manage(remote);
            app.manage(sessions);
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
            commands::live_sessions::live_session_snapshot,
            commands::live_sessions::live_session_create,
            commands::live_sessions::live_session_send,
            commands::live_sessions::live_session_draft,
            commands::live_sessions::live_session_action,
            commands::live_sessions::live_session_window,
            commands::live_sessions::live_session_topics,
            commands::live_sessions::live_session_window_pin,
            commands::live_sessions::live_session_review,
            commands::live_sessions::live_session_recover,
            commands::helper::helper_snapshot,
            commands::helper::helper_sync,
            commands::helper::helper_send,
            commands::helper::helper_stop,
            commands::helper::helper_new_conversation,
            commands::helper::helper_action,
            commands::helper::helper_connection,
            commands::execution_access::app_execution_access,
            commands::account::app_account_status,
            commands::account::settings_sync::app_settings_sync,
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
            commands::worktree_cleanup::git_list_worktree_orphans,
            commands::worktree_cleanup::git_remove_worktree_orphan,
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
            commands::desktop_control::platform::desktop_control_request_permissions,
            commands::local_ai::local_ai_inspect,
            commands::local_ai::local_ai_install,
            commands::local_ai::local_ai_pull,
            commands::local_ai::local_ai_verify,
            commands::local_ai::local_ai_connect,
            commands::local_ai::local_ai_cancel,
            commands::managed_runtime::managed_runtime_status,
            commands::managed_runtime::managed_runtime_cleanup,
            commands::managed_runtime::managed_runtime_prepare,
            commands::managed_runtime::managed_runtime_cancel,
            pty_spawn,
            commands::work_terminal::task_terminal_start,
            commands::work_windows::task_work_window,
            commands::work_windows::task_open_editor,
            commands::work_terminal::task_terminal_status,
            commands::work_terminal::task_terminal_write,
            commands::work_terminal::task_terminal_resize,
            commands::work_terminal::task_terminal_stop,
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
            task_changes,
            task_history_recovery,
            task_retry,
            task_retry_save,
            task_export_recovery,
            task_archived_runs,
            task_set_archived,
            task_restore_archived,
            task_import_recovery,
            task_screenshot,
            task_start,
            commands::coordination::followups::task_followup_queue,
            commands::coordination::followups::task_followup_snapshot,
            commands::coordination::followups::task_followup_action,
            task_stop,
            commands::desktop_control::indicator::desktop_control_theme,
            task_mark_reviewed,
            commands::outcomes::task_outcome_snapshot,
            commands::readiness::project_readiness,
            commands::readiness::project_defaults,
            commands::previews::task_preview_start,
            commands::previews::task_preview_status,
            commands::previews::task_preview_stop,
            commands::previews::task_preview_inspect,
            commands::previews::task_preview_inspect_cancel,
            commands::previews::design::task_preview_design_open,
            commands::previews::design::task_preview_design_capture,
            commands::delivery::task_delivery_status,
            commands::outcomes::task_outcome_review,
            task_review,
            commands::live_sessions::live_session_limits,
            commands::workflow_feedback::task_usefulness,
            commands::workflow_feedback::workflow_report,
            commands::github_workflows::project_github_context,
            commands::issues::project_issues,
            commands::issues::issue_connections,
            commands::issues::issue_connection_save,
            commands::issues::issue_connection_remove,
            commands::remote::remote_status,
            commands::remote::remote_configure,
            commands::remote::remote_pairing,
            commands::remote::remote_revoke,
            commands::remote::remote_private_https,
            commands::remote::remote_hosts,
            commands::remote::remote_host_pair,
            commands::remote::remote_host_request,
            commands::remote::remote_host_remove,
            commands::review_progress::task_review_progress,
            commands::verification::task_verify,
            task_respond_prompt,
            queue_snapshot,
            queue_add,
            queue_import,
            queue_dispatch,
            queue_cancel,
            queue_release,
            queue_cancel_agreement,
            queue_reconcile_scope,
            queue_assist_policy,
            queue_retry_reconciliation,
            commands::project_git::project_git_policy,
            integration_prepare,
            integration_apply,
            integration_plans,
            capacity_snapshot,
            commands::agent_models::agent_models,
            mcp_authenticate,
            mcp_list_servers,
            mcp_save_server,
            mcp_delete_server,
            mcp_probe_server,
            agent_profile_list,
            agent_profile_create,
            agent_profile_save_key,
            agent_profile_complete_provider,
            commands::jev::routing_settings,
            commands::jev::checks::routing_connection_usage,
            commands::jev::routing_connect,
            commands::jev::routing_set_mode,
            commands::jev::routing_disconnect,
            commands::task_strategy::task_strategy_assess,
            commands::task_strategy::task_strategy_cancel,
            commands::task_strategy::task_strategy_history,
            commands::decisions::options::decision_options,
            commands::decisions::options::decision_options_save,
            commands::decisions::evaluation::decision_history,
            commands::coordination::managed::task_plan_create,
            commands::coordination::managed::task_plan_preview,
            commands::coordination::managed::task_plan_start,
            commands::coordination::managed::task_plan_action,
            commands::coordination::managed::task_plan_review_time,
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
            commands::local_detection::system_detect_local_llms,
            commands::local_detection::system_detect_env_keys,
            commands::local_detection::agent_import_detected_key,
        ])
        .build(context)
        .expect("error while building jackalope application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { has_visible_windows: false, .. }) {
                window_behavior::show_main_window(app);
            }
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app.state::<commands::helper::Helper>().stop();
                app.state::<commands::remote::RemoteAccess>().shutdown();
                commands::remote::close_tunnels();
                app.state::<Scheduler>().shutdown();
                app.state::<commands::notifications::Notifications>().shutdown();
                app.state::<commands::live_sessions::LiveSessions>().shutdown();
                commands::browser::close_all();
                commands::previews::close_all();
                commands::work_terminal::close_all();
                app.state::<Coordinator>().shutdown();
                app.state::<TaskRuntime>().stop_all();
                app.state::<AppState>().kill_all_pty_sessions();
                app.state::<SignInService>().stop_all();
            }
        });
}
