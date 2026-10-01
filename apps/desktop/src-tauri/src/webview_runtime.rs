//! Windows builds use the system WebView2 Runtime instead of bundling one, so a
//! machine without it gets an explanation instead of a window that never opens.

const DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

/// Returns `false` after telling the user the runtime is missing; the caller
/// should exit without starting Tauri.
pub fn ensure_available() -> bool {
    if tauri::webview_version().is_ok() {
        return true;
    }
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO};
    let wide = |text: &str| text.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let title = wide("Jackalope");
    let message = wide(
        "Jackalope needs the Microsoft Edge WebView2 Runtime, which is not installed on this PC.\n\n\
         Open Microsoft's download page now?",
    );
    // SAFETY: both strings are NUL-terminated and outlive the modal call.
    let choice = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONERROR,
        )
    };
    if choice == IDYES {
        let _ = tauri_plugin_opener::open_url(DOWNLOAD_URL, None::<&str>);
    }
    false
}
