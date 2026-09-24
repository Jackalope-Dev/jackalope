pub mod commands;
pub mod state;
mod window_behavior;

/// Shared with the `jackalope` binary from one source file so the two ends of
/// the CLI protocol cannot drift apart.
#[path = "cli/protocol.rs"]
pub mod cli_protocol;

#[cfg(test)]
mod cli_protocol_tests {
    /// The CLI resolves the default profile without loading Tauri's config, so
    /// its copy of the bundle identifier has to track the real one.
    #[test]
    fn identifier_matches_the_bundle_configuration() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["identifier"].as_str(),
            Some(super::cli_protocol::IDENTIFIER)
        );
    }
}

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
use window_behavior::{
    desktop_set_close_to_tray, desktop_set_launch_at_login, desktop_settings, setup_tray,
    WindowBehavior,
};

/// How this process was started. A headless host owns the profile and serves
/// CLI clients without showing a window; launching the app again promotes that
/// same process rather than starting a second one, which the exclusive profile
/// lock would refuse anyway.
#[derive(Clone, Copy, Default)]
pub struct Launch {
    pub headless: bool,
}

/// Everything needed to build the main window after startup. Held as managed
/// state so a headless host can raise its window on demand instead of only at
/// setup time.
pub(crate) struct MainWindow {
    profile: Option<std::path::PathBuf>,
    directory: std::path::PathBuf,
    resetting: bool,
}

impl MainWindow {
    fn build<M: tauri::Manager<tauri::Wry>>(
        &self,
        manager: &M,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut window =
            tauri::WebviewWindowBuilder::from_config(manager, &manager.config().app.windows[0])?;
        #[cfg(target_os = "macos")]
        {
            window = window
                .decorations(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
        }
        if let Some(profile) = &self.profile {
            window = window.data_directory(profile.join("webview"));
        }
        if self.resetting {
            let token = std::fs::read_to_string(self.directory.join(RESET_MARKER))?;
            let token = serde_json::to_string(&token)?;
            window = window.initialization_script(format!("if (localStorage.getItem('jackalope-reset-receipt') !== {token}) {{ for (const key of Object.keys(localStorage)) {{ if (key.startsWith('jackalope-')) localStorage.removeItem(key); }} sessionStorage.clear(); localStorage.setItem('jackalope-reset-receipt', {token}); }} window.__JACKALOPE_RESET__ = true;"));
        }
        window.build()?;
        Ok(())
    }

    /// Raises the main window, building it first when a headless host has none.
    pub(crate) fn show(&self, app: &tauri::AppHandle) -> Result<(), String> {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            return Ok(());
        }
        self.build(app).map_err(|error| error.to_string())?;
        // A headless host runs as an accessory with no Dock icon; showing its
        // first window makes it an ordinary foreground app again.
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        Ok(())
    }
}

pub fn run(launch: Launch) {
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            app.manage(commands::account::AccountService::new(
                preferences.join("account.bin"),
                runtime.access.clone(),
            ));
            commands::account::launch_refresh(app.handle().clone());
            app.manage(WindowBehavior::load(preferences.join("desktop.json")));
            app.manage(commands::desktop_integration::DesktopIntegration::load(
                preferences.join("awake.json"),
            ));
            app.manage(commands::notifications::Notifications::load(
                preferences.join("notifications.json"),
            ));
            app.manage(commands::community::Community::load(
                preferences.join("community.json"),
            ));
            let coordinator = Coordinator::new(directory.join("coordination"), runtime.clone())?;
            coordinator.launch();
            let sessions = commands::live_sessions::LiveSessions::new(
                directory.join("live-sessions/sessions.json"),
                runtime.clone(),
                coordinator.clone(),
            );
            sessions.launch(app.handle().clone());
            let remote = commands::remote::RemoteAccess::new(
                preferences.join("remote-access.bin"),
                runtime.clone(),
                coordinator.clone(),
                sessions.clone(),
                app.handle().clone(),
            );
            remote.launch();
            app.manage(remote);
            app.manage(sessions);
            let scheduler = Scheduler::new(directory.join("schedules.json"), coordinator.clone());
            scheduler.launch();
            app.manage(scheduler);
            app.manage(runtime);
            app.manage(coordinator);
            commands::desktop_integration::launch(app.handle().clone());
            let main_window = MainWindow {
                profile: profile.clone(),
                directory: directory.clone(),
                resetting,
            };
            if launch.headless {
                // No window, and on macOS no Dock icon, until someone asks for one.
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            } else {
                main_window.build(app)?;
            }
            app.manage(main_window);
            commands::cli_install::launch(preferences.clone());
            // The CLI is a convenience; losing it must not stop the app.
            match commands::cli_host::launch(app.handle().clone(), &preferences, !launch.headless) {
                Ok(host) => {
                    app.manage(host);
                }
                Err(error) => eprintln!("The jackalope command cannot reach this app: {error}"),
            }
            #[cfg(target_os = "macos")]
            window_behavior::setup_app_menu(app)?;
            commands::notifications::launch(app.handle().clone());
            if let Err(error) = setup_tray(app) {
                eprintln!("System tray unavailable; closing will quit Jackalope: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                commands::cli_terminal::window_destroyed(window.label());
            }
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
            commands::desktop_integration::desktop_activity,
            commands::desktop_integration::desktop_keep_awake,
            commands::desktop_integration::desktop_unread_badge,
            commands::desktop_integration::desktop_zoom,
            commands::remote::wsl::wsl_distributions,
            commands::dictation::desktop_transcribe,
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
            desktop_set_launch_at_login,
            app_reset,
            app_finish_reset,
            git_list_worktrees,
            commands::worktree_usage::git_worktree_usage,
            commands::commit_review::git_working_changes,
            commands::commit_review::git_working_file_diff,
            commands::commit_review::git_generate_commit_message,
            commands::commit_review::git_commit_changes,
            commands::commit_review::git_discard_changes,
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
            commands::desktop_control::platform::desktop_control_open_settings,
            commands::desktop_control::platform::desktop_control_restart,
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
            commands::work_terminal::task_terminal_restore,
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
            commands::cli_install::cli_install_status,
            commands::cli_terminal::cli_terminal_window,
            commands::cli_terminal::cli_terminal_start,
            commands::cli_terminal::cli_terminal_close,
            commands::cli_terminal::cli_terminal_popout,
            commands::cli_install::cli_install_system,
            commands::project_registry::project_registry_list,
            commands::project_registry::project_registry_save,
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
            if matches!(
                event,
                tauri::RunEvent::Reopen {
                    has_visible_windows: false,
                    ..
                }
            ) {
                window_behavior::show_main_window(app);
            }
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                if let Some(host) = app.try_state::<commands::cli_host::CliHost>() {
                    host.shutdown();
                }
                app.state::<commands::desktop_integration::DesktopIntegration>()
                    .shutdown();
                app.state::<commands::helper::Helper>().stop();
                app.state::<commands::remote::RemoteAccess>().shutdown();
                commands::remote::close_tunnels();
                app.state::<Scheduler>().shutdown();
                app.state::<commands::notifications::Notifications>()
                    .shutdown();
                app.state::<commands::live_sessions::LiveSessions>()
                    .shutdown();
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
