use super::{activate, responses::LIFETIME, Notifications};
use notify_rust::{Hint, Notification, NotificationResponse};
use std::time::Duration;
use tauri::Manager;

pub async fn show(
    app: &tauri::AppHandle,
    title: &str,
    run_id: Option<String>,
) -> Result<(), String> {
    let handle = tokio::time::timeout(
        Duration::from_secs(10),
        Notification::new()
            .appname("Jackalope")
            .summary("Jackalope")
            .body(title)
            .icon("Jackalope")
            .hint(Hint::DesktopEntry("Jackalope".into()))
            .hint(Hint::SuppressSound(true))
            .action("default", "Open Jackalope")
            .show_async(),
    )
    .await
    .map_err(|_| "The desktop notification service did not respond.")?
    .map_err(|_| {
        "Could not deliver a notification. Check your desktop's notification service and settings."
    })?;
    let canceled = app.state::<Notifications>().responses.register();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = handle.wait_for_action_async(|response| {
                if matches!(response, NotificationResponse::Default) {
                    activate(&app, run_id);
                }
            }) => {},
            _ = tokio::time::sleep(LIFETIME) => {},
            _ = canceled => {},
        }
        let _ = tokio::time::timeout(Duration::from_secs(3), handle.close_async()).await;
    });
    Ok(())
}
