use super::UpdateProgress;
use tauri::{AppHandle, Manager};
use windows::{
    core::Interface,
    ApplicationModel::Package,
    Services::Store::{StoreContext, StorePackageUpdateState},
    Win32::UI::Shell::IInitializeWithWindow,
};

pub fn configured() -> bool {
    Package::Current().is_ok()
}

async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    action: impl FnOnce(StoreContext) -> windows::core::Result<T> + Send + 'static,
) -> Result<T, String> {
    let owner = app.clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            let window = owner
                .get_webview_window("main")
                .ok_or_else(|| "Open the main Jackalope window before updating.".to_string())?;
            let context = StoreContext::GetDefault().map_err(store_error)?;
            let initialize: IInitializeWithWindow = context.cast().map_err(store_error)?;
            let hwnd = window.hwnd().map_err(|error| error.to_string())?;
            unsafe { initialize.Initialize(windows::Win32::Foundation::HWND(hwnd.0)) }
                .map_err(store_error)?;
            action(context).map_err(store_error)
        })();
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "Store update request was interrupted.".to_string())?
}

fn store_error(error: windows::core::Error) -> String {
    format!(
        "Microsoft Store could not complete the request ({}). Check your connection and Store sign-in, then retry or open Microsoft Store → Library.",
        error.code()
    )
}

pub async fn available(app: &AppHandle) -> Result<bool, String> {
    let request = on_main(app, |context| {
        context.GetAppAndOptionalStorePackageUpdatesAsync()
    })
    .await?;
    let updates = tokio::time::timeout(std::time::Duration::from_secs(45), async { request.await })
        .await
        .map_err(|_| "Microsoft Store took too long to respond. Try again.".to_string())?
        .map_err(store_error)?;
    Ok(updates.Size().map_err(store_error)? > 0)
}

pub async fn install(
    app: &AppHandle,
    progress: tauri::ipc::Channel<UpdateProgress>,
) -> Result<(), String> {
    let request = on_main(app, |context| {
        context.GetAppAndOptionalStorePackageUpdatesAsync()
    })
    .await?;
    let packages = {
        let updates =
            tokio::time::timeout(std::time::Duration::from_secs(45), async { request.await })
                .await
                .map_err(|_| "Microsoft Store took too long to respond. Try again.".to_string())?
                .map_err(store_error)?;
        let count = updates.Size().map_err(store_error)?;
        if count == 0 {
            return Err("The Store update is no longer available. Check again.".into());
        }
        let mut packages = Vec::new();
        for index in 0..count {
            packages.push(Some(updates.GetAt(index).map_err(store_error)?));
        }
        packages
    };
    let request = on_main(app, move |context| {
        let updates: windows_collections::IIterable<windows::Services::Store::StorePackageUpdate> =
            packages.into();
        let request = context.RequestDownloadAndInstallStorePackageUpdatesAsync(&updates)?;
        request.SetProgress(&windows_future::AsyncOperationProgressHandler::new(
            move |_,
                  status: windows::core::Ref<
                '_,
                windows::Services::Store::StorePackageUpdateStatus,
            >| {
                let percent = (status.TotalDownloadProgress.clamp(0.0, 1.0) * 100.0) as u64;
                let _ = progress.send(UpdateProgress {
                    phase: if percent < 100 {
                        "downloading"
                    } else {
                        "installing"
                    },
                    downloaded: percent,
                    total: Some(100),
                });
                Ok(())
            },
        ))?;
        Ok(request)
    })
    .await?;
    let result = request.await.map_err(store_error)?;
    completion(result.OverallState().map_err(store_error)?.0)
}

fn completion(state: i32) -> Result<(), String> {
    match StorePackageUpdateState(state) {
        StorePackageUpdateState::Completed => Ok(()),
        StorePackageUpdateState::Canceled => Err("Microsoft Store update was canceled. You can try again.".into()),
        StorePackageUpdateState::ErrorLowBattery => Err("Connect your device to power and try the Store update again.".into()),
        StorePackageUpdateState::ErrorWiFiRecommended | StorePackageUpdateState::ErrorWiFiRequired => Err("Connect to Wi-Fi and try the Store update again.".into()),
        _ => Err("Microsoft Store could not finish the update. Open Microsoft Store → Library for details, then check again.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_completed_store_operations_succeed() {
        assert!(completion(StorePackageUpdateState::Completed.0).is_ok());
        for state in [
            StorePackageUpdateState::Pending,
            StorePackageUpdateState::Downloading,
            StorePackageUpdateState::Deploying,
            StorePackageUpdateState::Canceled,
            StorePackageUpdateState::OtherError,
        ] {
            assert!(completion(state.0).is_err());
        }
        assert!(completion(StorePackageUpdateState::ErrorLowBattery.0)
            .unwrap_err()
            .contains("power"));
    }
}
