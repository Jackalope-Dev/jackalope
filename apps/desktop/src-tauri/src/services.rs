//! Managed services that own background work, and the order the app stops them in.

use crate::commands::{
    agent_sign_in::SignInService, bot_hub::BotHub, browser, cli_host::CliHost, computers,
    coordination::Coordinator, desktop_integration::DesktopIntegration, helper::Helper,
    live_sessions::LiveSessions, notifications::Notifications, previews, remote,
    remote::RemoteAccess, schedules::Scheduler, tasks::TaskRuntime, work_terminal,
};
use tauri::{AppHandle, Manager};

/// Managed state whose threads, processes or connections must end before exit.
pub(crate) trait Service: Send + Sync + 'static {
    fn shutdown(&self);
}

fn stop<T: Service>(app: &AppHandle) {
    if let Some(service) = app.try_state::<T>() {
        service.shutdown();
    }
}

fn close_tunnels(_: &AppHandle) {
    remote::close_tunnels();
}

fn close_browsers(_: &AppHandle) {
    browser::close_all();
}

fn close_previews(_: &AppHandle) {
    previews::close_all();
}

fn close_terminals(_: &AppHandle) {
    work_terminal::close_all();
}

fn stop_computers(app: &AppHandle) {
    if let Some(runtime) = app.try_state::<TaskRuntime>() {
        computers::shutdown(&runtime.computers_root());
    }
}

/// Entry points that accept new work stop first. The coordinator stops before
/// the runtime it drives (lock order: coordinator, execution guard, runtime),
/// and computers stop once no run can use them.
const SHUTDOWN: &[fn(&AppHandle)] = &[
    stop::<CliHost>,
    stop::<DesktopIntegration>,
    stop::<Helper>,
    stop::<RemoteAccess>,
    close_tunnels,
    stop::<Scheduler>,
    stop::<BotHub>,
    stop::<Notifications>,
    stop::<LiveSessions>,
    close_browsers,
    close_previews,
    close_terminals,
    stop::<Coordinator>,
    stop::<TaskRuntime>,
    stop_computers,
    stop::<SignInService>,
];

pub(crate) fn shutdown(app: &AppHandle) {
    for step in SHUTDOWN {
        step(app);
    }
}
