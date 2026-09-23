use super::tasks::TaskRuntime;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{Manager, State};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AwakeMode {
    #[default]
    Off,
    Working,
    Always,
}

impl AwakeMode {
    fn needed(self, active: usize) -> bool {
        self == Self::Always || (self == Self::Working && active > 0)
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    mode: AwakeMode,
    awake: bool,
    active_work: usize,
    error: Option<String>,
    terminals: usize,
    previews: Vec<(String, u16)>,
}

pub struct DesktopIntegration {
    path: PathBuf,
    status: Mutex<DesktopStatus>,
    stop: Mutex<Option<mpsc::Sender<()>>>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl DesktopIntegration {
    pub fn load(path: PathBuf) -> Self {
        let mode = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            status: Mutex::new(DesktopStatus {
                mode,
                ..Default::default()
            }),
            stop: Mutex::new(None),
            worker: Mutex::new(None),
        }
    }
    pub fn shutdown(&self) {
        if let Some(stop) = self.stop.lock().unwrap().take() {
            let _ = stop.send(());
        }
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}

pub fn launch(app: tauri::AppHandle) {
    let (send, receive) = mpsc::channel();
    *app.state::<DesktopIntegration>().stop.lock().unwrap() = Some(send);
    let handle = app.clone();
    let worker = std::thread::spawn(move || {
        let mut lease: Option<Inhibitor> = None;
        loop {
            let service = handle.state::<DesktopIntegration>();
            let active = handle.state::<TaskRuntime>().active_work_count();
            let mode = service.status.lock().unwrap().mode;
            let mut error = None;
            if mode.needed(active) {
                if lease.is_none() {
                    match Inhibitor::acquire() {
                        Ok(value) => lease = Some(value),
                        Err(reason) => error = Some(reason),
                    }
                }
            } else {
                lease = None;
            }
            {
                let mut status = service.status.lock().unwrap();
                status.awake = lease.is_some();
                status.active_work = active;
                status.error = error;
            }
            if receive.recv_timeout(Duration::from_secs(2)) != Err(mpsc::RecvTimeoutError::Timeout)
            {
                break;
            }
        }
    });
    *app.state::<DesktopIntegration>().worker.lock().unwrap() = Some(worker);
}

#[tauri::command]
pub fn desktop_activity(service: State<'_, DesktopIntegration>) -> DesktopStatus {
    let mut status = service.status.lock().unwrap().clone();
    status.terminals = super::work_terminal::active_count();
    status.previews = super::previews::active_ports();
    status
}

#[tauri::command]
pub fn desktop_keep_awake(
    mode: AwakeMode,
    service: State<'_, DesktopIntegration>,
) -> Result<(), String> {
    let mut status = service.status.lock().map_err(|e| e.to_string())?;
    super::history::write_atomic(
        &service.path,
        &serde_json::to_vec(&mode).map_err(|e| e.to_string())?,
    )?;
    status.mode = mode;
    Ok(())
}

#[tauri::command]
pub fn desktop_zoom(window: tauri::WebviewWindow, zoom: f64) -> Result<(), String> {
    if !zoom.is_finite() || !(0.8..=1.5).contains(&zoom) {
        return Err("Zoom must be between 80% and 150%.".into());
    }
    window.set_zoom(zoom).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_unread_badge(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    crate::window_behavior::set_unread_badge(&app, count)?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, count);
    Ok(())
}

#[cfg(windows)]
struct Inhibitor;
#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn SetThreadExecutionState(flags: u32) -> u32;
}
#[cfg(windows)]
impl Inhibitor {
    fn acquire() -> Result<Self, String> {
        if unsafe { SetThreadExecutionState(0x80000001) } == 0 {
            Err("Windows could not prevent idle sleep.".into())
        } else {
            Ok(Self)
        }
    }
}
#[cfg(windows)]
impl Drop for Inhibitor {
    fn drop(&mut self) {
        unsafe {
            SetThreadExecutionState(0x80000000);
        }
    }
}

#[cfg(target_os = "macos")]
struct Inhibitor(u32);
#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        kind: *const std::ffi::c_void,
        level: u32,
        name: *const std::ffi::c_void,
        id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(id: u32) -> i32;
}
#[cfg(target_os = "macos")]
impl Inhibitor {
    fn acquire() -> Result<Self, String> {
        let kind = objc2_foundation::NSString::from_str("PreventUserIdleSystemSleep");
        let name = objc2_foundation::NSString::from_str("Jackalope is working");
        let mut id = 0;
        let result = unsafe {
            IOPMAssertionCreateWithName(
                (&*kind as *const objc2_foundation::NSString).cast(),
                255,
                (&*name as *const objc2_foundation::NSString).cast(),
                &mut id,
            )
        };
        if result == 0 {
            Ok(Self(id))
        } else {
            Err(format!("macOS could not prevent idle sleep ({result})."))
        }
    }
}
#[cfg(target_os = "macos")]
impl Drop for Inhibitor {
    fn drop(&mut self) {
        unsafe {
            IOPMAssertionRelease(self.0);
        }
    }
}

#[cfg(target_os = "linux")]
struct Inhibitor {
    _connection: zbus::Connection,
    _fd: zbus::zvariant::OwnedFd,
}
#[cfg(target_os = "linux")]
impl Inhibitor {
    fn acquire() -> Result<Self, String> {
        tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(2), async {
                let connection = zbus::Connection::system()
                    .await
                    .map_err(|e| e.to_string())?;
                let proxy = zbus::Proxy::new(
                    &connection,
                    "org.freedesktop.login1",
                    "/org/freedesktop/login1",
                    "org.freedesktop.login1.Manager",
                )
                .await
                .map_err(|e| e.to_string())?;
                let fd: zbus::zvariant::OwnedFd = proxy
                    .call(
                        "Inhibit",
                        &("idle:sleep", "Jackalope", "Work is running", "block"),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                drop(proxy);
                Ok(Self {
                    _connection: connection,
                    _fd: fd,
                })
            })
            .await
            .map_err(|_| "The sleep inhibitor did not respond.".to_string())?
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn awake_policy_releases_when_idle() {
        assert!(!AwakeMode::Off.needed(5));
        assert!(!AwakeMode::Working.needed(0));
        assert!(AwakeMode::Working.needed(1));
        assert!(AwakeMode::Always.needed(0));
        assert!(serde_json::from_str::<AwakeMode>("\"unknown\"").is_err());
    }
}
