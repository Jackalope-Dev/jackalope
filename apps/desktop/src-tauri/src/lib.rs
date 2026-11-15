#![recursion_limit = "256"]

pub mod commands;
mod services;
#[cfg(windows)]
mod webview_runtime;
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

/// Each module below lists its Tauri commands in its own `tauri_commands!`
/// macro, which appends their paths (written from the crate root) to `[$done]`
/// and calls `$next!` with the remaining modules. `generate_handler!` only
/// accepts literal paths, so the lists are chained into one before reaching it.
macro_rules! collect_commands {
    ($finish:ident [$($done:tt)*]) => {
        $finish!($($done)*)
    };
    ($finish:ident [$($done:tt)*] $($module:ident)::+ $(, $($rest:tt)*)?) => {
        crate::$($module)::+::tauri_commands!(collect_commands $finish [$($done)*] $($($rest)*)?)
    };
}

/// Hands every registered command path to `$finish`.
macro_rules! with_commands {
    ($finish:ident) => {
        collect_commands!($finish []
            commands::account,
            commands::agent_decider,
            commands::agent_install,
            commands::agent_models,
            commands::agent_policy,
            commands::agent_profiles,
            commands::agent_screen,
            commands::agent_sign_in,
            commands::attachments,
            commands::bot_hub,
            commands::browser_profiles,
            commands::capacity,
            commands::challenge_review,
            commands::change_stats,
            commands::cli_install,
            commands::cli_terminal,
            commands::cloudflare,
            commands::cloudflare_artifacts,
            commands::cloudflare_resources,
            commands::codebase,
            commands::codebase_watch,
            commands::commit_graph,
            commands::commit_review,
            commands::community,
            commands::composio,
            commands::computers,
            commands::coordination,
            commands::decisions,
            commands::delivery,
            commands::desktop_control,
            commands::desktop_integration,
            commands::dictation,
            commands::execution_access,
            commands::external_sessions,
            commands::first_commit,
            commands::git,
            commands::github_workflows,
            commands::helper,
            commands::integration,
            commands::issues,
            commands::jev,
            commands::knowledge,
            commands::live_sessions,
            commands::local_ai,
            commands::local_detection,
            commands::managed_runtime,
            commands::mcp,
            commands::notifications,
            commands::openai_endpoint,
            commands::outcomes,
            commands::planning,
            commands::previews,
            commands::project_favicon,
            commands::project_files,
            commands::project_git,
            commands::project_registry,
            commands::project_secrets,
            commands::readiness,
            commands::release,
            commands::remote,
            commands::repo_todos,
            commands::reset,
            commands::review_progress,
            commands::schedules,
            commands::system,
            commands::task_strategy,
            commands::tasks,
            commands::verification,
            commands::work_terminal,
            commands::work_windows,
            commands::workflow_feedback,
            commands::worktree_cleanup,
            commands::worktree_usage,
            window_behavior,
        )
    };
}

macro_rules! handler {
    ($($command:tt)*) => {
        tauri::generate_handler![$($command)*]
    };
}

#[cfg(test)]
mod command_registration_tests {
    use std::path::Path;

    macro_rules! command_names {
        ($($($segment:ident)::+,)*) => {
            [$(stringify!($($segment)::+)),*]
        };
    }

    fn declared(directory: &Path, names: &mut Vec<String>) {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                declared(&path, names);
                continue;
            }
            if path.extension().is_none_or(|extension| extension != "rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).unwrap();
            let mut lines = source.lines();
            while let Some(line) = lines.next() {
                if !line.trim_start().starts_with("#[tauri::command") {
                    continue;
                }
                let signature = lines
                    .by_ref()
                    .find(|line| line.contains("fn "))
                    .unwrap_or_else(|| panic!("command without a function in {}", path.display()));
                let name = signature.split("fn ").nth(1).unwrap();
                let end = name
                    .find(|character: char| !(character.is_alphanumeric() || character == '_'))
                    .unwrap_or(name.len());
                names.push(name[..end].to_string());
            }
        }
    }

    /// A module that forgets to list a command leaves it unreachable from the
    /// webview, which only fails at runtime.
    #[test]
    fn every_command_is_registered_once() {
        let mut registered: Vec<String> = with_commands!(command_names)
            .iter()
            .map(|path| path.rsplit("::").next().unwrap().trim().to_string())
            .collect();
        registered.sort();
        let count = registered.len();
        registered.dedup();
        assert_eq!(count, registered.len(), "a command is registered twice");
        let mut names = Vec::new();
        declared(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut names,
        );
        names.sort();
        assert_eq!(registered, names);
    }
}

use commands::{
    agent_sign_in::SignInService,
    capacity::CapacityService,
    coordination::Coordinator,
    reset::{reset_on_startup, RESET_MARKER},
    schedules::Scheduler,
    tasks::TaskRuntime,
};
use tauri::Manager;
use window_behavior::{setup_tray, WindowBehavior};

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
    #[cfg(windows)]
    if !launch.headless && !webview_runtime::ensure_available() {
        return;
    }
    commands::platform::initialize_environment();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows[0].user_agent =
        Some(format!("Jackalope/{}", env!("CARGO_PKG_VERSION")));
    let profile = cli_protocol::profile::explicit_root();
    context.config_mut().app.windows[0].create = false;
    if let Some(path) = &profile {
        assert!(path.is_absolute(), "JACKALOPE_PROFILE_DIR must be absolute");
    }
    let builder = tauri::Builder::default();
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(SignInService::default())
        .manage(commands::local_ai::LocalAi::default())
        .manage(commands::managed_runtime::ManagedRuntime::default())
        .manage(CapacityService::default())
        .manage(commands::agent_models::ModelCatalogService::default())
        .setup(move |app| {
            commands::release::register_update_restart();
            commands::resources::set_directory(app.path().resource_dir()?);
            let paths = cli_protocol::ProfilePaths::new(
                &profile.clone().unwrap_or(app.path().app_data_dir()?),
            );
            let directory = paths.data().to_path_buf();
            let resetting = reset_on_startup(&directory)?;
            commands::managed_runtime::initialize(directory.join("agent-runtimes"));
            let runtime = TaskRuntime::new(directory.clone())?;
            runtime.observe_changes(app.handle().clone());
            commands::computers::pool::restore_health(&runtime.computers_root());
            runtime.launch_lost_host_recovery();
            commands::computers::launch_idle_stop(runtime.clone());
            let helper = commands::helper::Helper::new(directory.clone(), runtime.clone());
            helper.launch();
            app.manage(helper);
            let preferences = paths.preferences();
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
            let coordinator = Coordinator::new(paths.coordination(), runtime.clone())?;
            coordinator.launch();
            commands::coordination::cloud::launch(coordinator.clone());
            commands::coordination::deploy::launch(coordinator.clone());
            let sessions = commands::live_sessions::LiveSessions::new(
                directory.join("live-sessions/sessions.json"),
                runtime.clone(),
                coordinator.clone(),
            );
            sessions.launch(app.handle().clone());
            commands::knowledge::learning::watcher::launch(runtime.clone(), sessions.clone());
            let remote = commands::remote::RemoteAccess::new(
                preferences.join("remote-access.bin"),
                runtime.clone(),
                coordinator.clone(),
                sessions.clone(),
                app.handle().clone(),
            );
            remote.launch();
            app.manage(remote);
            let bot_hub = commands::bot_hub::BotHub::new(
                directory.join("bots/hub.json"),
                runtime.clone(),
                sessions.clone(),
            );
            bot_hub.launch(app.handle().clone());
            app.manage(bot_hub);
            let external = commands::external_sessions::ExternalSessions::new(
                runtime.clone(),
                sessions.clone(),
            );
            external.launch(app.handle().clone());
            app.manage(external);
            app.manage(sessions);
            let scheduler = Scheduler::new(paths.schedules(), coordinator.clone());
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
            match commands::cli_host::launch(app.handle().clone(), &paths, !launch.headless) {
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && window.state::<WindowBehavior>().should_hide()
                    && window.hide().is_ok()
                {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(with_commands!(handler))
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
                services::shutdown(app);
            }
        });
}
