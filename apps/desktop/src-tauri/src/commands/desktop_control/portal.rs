//! Generic Wayland backend through the XDG desktop portals. Backend selection,
//! the portal session sequence, grant state, restore tokens, key symbols and
//! capture geometry live here so every platform can test them; the D-Bus
//! client is `portal_linux.rs`.
//!
//! The portal session is the in-control indicator: the compositor shows its
//! own sharing indicator and owns the approval dialog. Physical input cannot
//! be observed through the portals, so it does not pause control.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use super::grant::Scope;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(crate) const DEVICE_KEYBOARD: u32 = 1;
pub(crate) const DEVICE_POINTER: u32 = 2;
pub(crate) const SOURCE_MONITOR: u32 = 1;

/// What the session bus offers, read from the portal and accessibility buses.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct PortalInfo {
    /// RemoteDesktop interface version; 0 when absent.
    pub remote_desktop: u32,
    pub device_types: u32,
    /// ScreenCast interface version; 0 when absent.
    pub screencast: u32,
    pub source_types: u32,
    /// Screenshot interface version; 0 when absent.
    pub screenshot: u32,
    /// The AT-SPI accessibility bus answered.
    pub accessibility: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Probe {
    pub wayland: bool,
    /// An X11 display is set and the session is not Wayland.
    pub x11: bool,
    /// The bundled GNOME extension answered with a supported protocol.
    pub gnome_extension: bool,
    pub portal: Option<PortalInfo>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PortalScopes {
    /// Accessibility and keyboard control of one app's windows.
    pub app: bool,
    /// Keyboard, pointer and monitor captures across shared monitors.
    pub desktop: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Selection {
    X11,
    GnomeExtension,
    Portal(PortalScopes),
    Unavailable(String),
}

pub(crate) fn scopes(info: &PortalInfo) -> PortalScopes {
    let remote = info.remote_desktop > 0;
    PortalScopes {
        app: remote && info.device_types & DEVICE_KEYBOARD != 0 && info.accessibility,
        desktop: remote
            && info.device_types & (DEVICE_KEYBOARD | DEVICE_POINTER)
                == DEVICE_KEYBOARD | DEVICE_POINTER
            && info.screencast > 0
            && info.source_types & SOURCE_MONITOR != 0
            && info.screenshot > 0,
    }
}

/// X11 sessions use the X11 helper, GNOME with the bundled extension uses it,
/// and any other Wayland session with a usable RemoteDesktop portal uses the
/// portal. XWayland is never accepted as control of a Wayland desktop.
pub(crate) fn select(probe: &Probe) -> Selection {
    if !probe.wayland {
        return if probe.x11 {
            Selection::X11
        } else {
            Selection::Unavailable("Native window control needs a graphical desktop session. Task browser automation is available separately.".into())
        };
    }
    if probe.gnome_extension {
        return Selection::GnomeExtension;
    }
    let Some(info) = &probe.portal else {
        return Selection::Unavailable("This Wayland desktop offers no remote desktop portal. Install xdg-desktop-portal with your desktop's backend (KDE Plasma 5.27 or later, GNOME 44 or later), or enable the Jackalope GNOME extension on GNOME 46.".into());
    };
    let scopes = scopes(info);
    if scopes.app || scopes.desktop {
        return Selection::Portal(scopes);
    }
    Selection::Unavailable(if info.remote_desktop == 0 {
        "This desktop's portal does not implement remote desktop control. KDE Plasma 5.27 or later and GNOME 44 or later do.".into()
    } else if !info.accessibility {
        "The accessibility service is unavailable, and this desktop's portal cannot share a monitor with keyboard and pointer control. Enable assistive technologies or install at-spi2-core.".into()
    } else {
        "This desktop's remote desktop portal offers no keyboard control.".into()
    })
}

// ---- session sequence ----

/// One portal request in the session sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    CreateSession,
    SelectDevices,
    SelectSources,
    Start,
}

impl Step {
    pub fn method(self) -> &'static str {
        match self {
            Self::CreateSession => "CreateSession",
            Self::SelectDevices => "SelectDevices",
            Self::SelectSources => "SelectSources",
            Self::Start => "Start",
        }
    }
}

/// App grants use keyboard control without a screen share; desktop grants
/// also share monitors for absolute pointer input.
pub(crate) fn steps(scope: Scope) -> &'static [Step] {
    match scope {
        Scope::Desktop => &[
            Step::CreateSession,
            Step::SelectDevices,
            Step::SelectSources,
            Step::Start,
        ],
        _ => &[Step::CreateSession, Step::SelectDevices, Step::Start],
    }
}

pub(crate) fn devices(scope: Scope) -> u32 {
    if scope == Scope::Desktop {
        DEVICE_KEYBOARD | DEVICE_POINTER
    } else {
        DEVICE_KEYBOARD
    }
}

/// Interprets a portal Request.Response code for one step.
pub(crate) fn response(step: Step, code: u32) -> Result<(), String> {
    match code {
        0 => Ok(()),
        1 if step == Step::Start => {
            Err("You declined remote control in the system dialog. Nothing was granted.".into())
        }
        1 => Err("The desktop portal canceled the remote control request.".into()),
        _ => Err(format!(
            "The desktop portal ended the remote control request during {}.",
            step.method()
        )),
    }
}

// ---- grant state ----

pub(crate) const WAITING: &str = "Approve remote control in your desktop's system dialog to begin.";

struct GrantState {
    status: &'static str,
    epoch: u64,
    reason: String,
}

/// Grant status shared by the portal session and Jackalope's indicator. A
/// grant waits for the system dialog, becomes active once the portal starts,
/// and cancellation is final.
pub(crate) struct Shared {
    state: Mutex<GrantState>,
}

impl Shared {
    pub fn waiting() -> Self {
        Self {
            state: Mutex::new(GrantState {
                status: "paused",
                epoch: 0,
                reason: WAITING.into(),
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, GrantState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn activate(&self) {
        let mut state = self.lock();
        if state.status != "canceled" {
            state.status = "active";
            state.epoch += 1;
            state.reason.clear();
        }
    }

    pub fn cancel(&self, reason: &str) {
        let mut state = self.lock();
        if state.status != "canceled" {
            state.status = "canceled";
            state.epoch += 1;
            state.reason = reason.into();
        }
    }

    /// (status, epoch, reason)
    pub fn current(&self) -> (String, u64, String) {
        let state = self.lock();
        (state.status.into(), state.epoch, state.reason.clone())
    }

    /// Input and captures run only while active and unchanged since the snapshot.
    pub fn check(&self, epoch: Option<u64>) -> Result<(), String> {
        let state = self.lock();
        if state.status != "active" {
            return Err(if state.status == "canceled" {
                "Desktop control ended. Request access again.".into()
            } else {
                state.reason.clone()
            });
        }
        if epoch.is_some_and(|epoch| epoch != state.epoch) {
            return Err("Desktop control changed. Take a fresh snapshot.".into());
        }
        Ok(())
    }
}

// ---- restore tokens ----

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenEntry {
    project_id: String,
    /// Kept as text so entries written by a newer app survive a rewrite.
    scope: String,
    token: String,
    saved_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Tokens {
    #[serde(default)]
    tokens: Vec<TokenEntry>,
}

pub(crate) fn token_path(preferences: &Path) -> PathBuf {
    preferences.join("desktop-portal-tokens.json")
}

fn token_lock() -> &'static Mutex<()> {
    static LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn valid_token(token: &str) -> bool {
    !token.is_empty() && token.len() <= 512 && token.chars().all(|c| c.is_ascii_graphic())
}

fn read_tokens(path: &Path) -> Tokens {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// The portal's restore token for this project and scope. It lets the portal
/// reuse the earlier device and monitor choice; Jackalope still asks its own
/// access question for every task.
pub(crate) fn restore_token(path: &Path, project_id: &str, scope: Scope) -> Option<String> {
    let _guard = token_lock().lock();
    read_tokens(path)
        .tokens
        .into_iter()
        .find(|entry| entry.project_id == project_id && entry.scope == scope.as_str())
        .map(|entry| entry.token)
        .filter(|token| valid_token(token))
}

/// Replaces this project's token for a scope, or removes it with `None`.
pub(crate) fn save_token(
    path: &Path,
    project_id: &str,
    scope: Scope,
    token: Option<&str>,
) -> Result<(), String> {
    if project_id.is_empty() || matches!(scope, Scope::Unknown) {
        return Ok(());
    }
    let _guard = token_lock().lock();
    let mut store = read_tokens(path);
    store
        .tokens
        .retain(|entry| !(entry.project_id == project_id && entry.scope == scope.as_str()));
    if let Some(token) = token.filter(|token| valid_token(token)) {
        store.tokens.push(TokenEntry {
            project_id: project_id.into(),
            scope: scope.as_str().into(),
            token: token.into(),
            saved_at: chrono::Utc::now().to_rfc3339(),
        });
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&store).map_err(|e| e.to_string())?;
    super::super::history::write_atomic(path, &bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---- keys ----

/// X keysym for a named key, function key or single character.
pub(crate) fn keysym(key: &str) -> Option<u32> {
    let named = match key {
        "Tab" => 0xff09,
        "Enter" => 0xff0d,
        "Escape" => 0xff1b,
        "Space" => 0x20,
        "Backspace" => 0xff08,
        "Delete" => 0xffff,
        "Insert" => 0xff63,
        "ArrowUp" => 0xff52,
        "ArrowDown" => 0xff54,
        "ArrowLeft" => 0xff51,
        "ArrowRight" => 0xff53,
        "Home" => 0xff50,
        "End" => 0xff57,
        "PageUp" => 0xff55,
        "PageDown" => 0xff56,
        "Control" => 0xffe3,
        "Shift" => 0xffe1,
        "Alt" => 0xffe9,
        "Command" => 0xffeb,
        _ => 0,
    };
    if named != 0 {
        return Some(named);
    }
    if let Some(number) = key.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()) {
        return (1..=12).contains(&number).then_some(0xffbe + number - 1);
    }
    let mut chars = key.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => char_keysym(c),
        _ => None,
    }
}

/// Keysym for one literal character; Unicode beyond Latin-1 uses the
/// 0x01000000 range. Control characters other than newline and tab have none.
pub(crate) fn char_keysym(c: char) -> Option<u32> {
    let code = c as u32;
    match c {
        '\n' | '\r' => Some(0xff0d),
        '\t' => Some(0xff09),
        _ if c.is_control() => None,
        _ if (0x20..=0x7e).contains(&code) || (0xa0..=0xff).contains(&code) => Some(code),
        _ => Some(0x0100_0000 | code),
    }
}

// ---- accessibility ----

const STATES: &[(u32, &str)] = &[
    (1, "active"),
    (4, "checked"),
    (7, "editable"),
    (8, "enabled"),
    (10, "expanded"),
    (11, "focusable"),
    (12, "focused"),
    (15, "minimized"),
    (20, "pressed"),
    (22, "selectable"),
    (23, "selected"),
    (25, "showing"),
    (30, "visible"),
];

pub(crate) const STATE_ACTIVE: u32 = 1;
pub(crate) const STATE_FOCUSED: u32 = 12;
pub(crate) const STATE_ICONIFIED: u32 = 15;
pub(crate) const STATE_SHOWING: u32 = 25;

/// Whether an AT-SPI state bit set (two 32-bit words) contains a state.
pub(crate) fn has_state(bits: &[u32], state: u32) -> bool {
    bits.get((state / 32) as usize)
        .is_some_and(|word| word & (1 << (state % 32)) != 0)
}

pub(crate) fn state_names(bits: &[u32]) -> Vec<&'static str> {
    STATES
        .iter()
        .filter(|(state, _)| has_state(bits, *state))
        .map(|(_, name)| *name)
        .collect()
}

/// The AT-SPI action that performs a desktop action, by action name.
pub(crate) fn pick_action(names: &[String], action: &str) -> Option<usize> {
    let preferred: &[&str] = match action {
        "click" | "invoke" => &["click", "press", "activate", "jump", "toggle", "open"],
        "double_click" => &["activate", "open"],
        "right_click" => &["showmenu", "show menu", "menu", "context menu"],
        _ => &[],
    };
    preferred.iter().find_map(|wanted| {
        names
            .iter()
            .position(|name| name.trim().eq_ignore_ascii_case(wanted))
    })
}

pub(crate) fn is_password_role(role: &str) -> bool {
    role.eq_ignore_ascii_case("password text")
}

/// Short window handle for an accessible object, stable while it exists.
pub(crate) fn handle(bus: &str, path: &str) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(format!("{bus}\n{path}").as_bytes());
    let hex: String = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("a{hex}")
}

/// Process start ticks (field 22) from /proc/<pid>/stat.
pub(crate) fn process_start(stat: &str) -> Option<String> {
    let rest = &stat[stat.rfind(')')? + 1..];
    let field = rest.split_whitespace().nth(19)?;
    field.parse::<u64>().ok().map(|ticks| ticks.to_string())
}

/// App key from an accessible application name.
pub(crate) fn app_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Local path from the file URI a portal returns.
pub(crate) fn file_uri_path(uri: &str) -> Option<PathBuf> {
    let encoded = uri.strip_prefix("file://")?;
    let encoded = encoded.strip_prefix("localhost").unwrap_or(encoded);
    if !encoded.starts_with('/') {
        return None;
    }
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let text = String::from_utf8(decoded).ok()?;
    (!text.contains('\0')).then(|| PathBuf::from(text))
}

// ---- capture geometry ----

/// One shared monitor from the portal's Start response, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Stream {
    pub node: u32,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// The region of a full-desktop screenshot covering one shared monitor. The
/// screenshot portal captures every monitor; the shared monitors must span
/// the whole image (at one uniform scale) or the crop would be a guess.
pub(crate) fn crop(
    streams: &[Stream],
    index: usize,
    image_width: u32,
    image_height: u32,
) -> Result<Crop, String> {
    let stream = streams
        .get(index)
        .ok_or("That monitor is not shared. Call list_windows for shared monitors.")?;
    let left = streams.iter().map(|s| s.x).min().unwrap_or(0);
    let top = streams.iter().map(|s| s.y).min().unwrap_or(0);
    let right = streams.iter().map(|s| s.x + s.width).max().unwrap_or(0);
    let bottom = streams.iter().map(|s| s.y + s.height).max().unwrap_or(0);
    let (width, height) = ((right - left) as f64, (bottom - top) as f64);
    if width <= 0.0 || height <= 0.0 || image_width == 0 || image_height == 0 {
        return Err("The shared monitor has no size.".into());
    }
    let (sx, sy) = (image_width as f64 / width, image_height as f64 / height);
    if (sx - sy).abs() > 0.01 * sx.max(sy) || !(0.5..=4.0).contains(&sx) {
        return Err("The desktop screenshot does not match the shared monitors. Share every monitor in the system dialog to capture on this desktop.".into());
    }
    let x = ((stream.x - left) as f64 * sx).round() as u32;
    let y = ((stream.y - top) as f64 * sy).round() as u32;
    let w = (stream.width as f64 * sx).round() as u32;
    let h = (stream.height as f64 * sy).round() as u32;
    Ok(Crop {
        x,
        y,
        width: w.min(image_width.saturating_sub(x)),
        height: h.min(image_height.saturating_sub(y)),
    })
}

/// Copies a region out of an RGBA image.
pub(crate) fn crop_rgba(pixels: &[u8], width: u32, region: Crop) -> Vec<u8> {
    let mut out = Vec::with_capacity((region.width * region.height * 4) as usize);
    for row in region.y..region.y + region.height {
        let start = ((row * width + region.x) * 4) as usize;
        out.extend_from_slice(&pixels[start..start + (region.width * 4) as usize]);
    }
    out
}

/// Area-averaged resize of an RGBA image, used to downscale captures to
/// logical monitor size and thumbnails.
pub(crate) fn resize_rgba(
    pixels: &[u8],
    width: u32,
    height: u32,
    to_width: u32,
    to_height: u32,
) -> Vec<u8> {
    if (width, height) == (to_width, to_height) {
        return pixels.to_vec();
    }
    let mut out = vec![0u8; (to_width * to_height * 4) as usize];
    for ty in 0..to_height {
        let y0 = ty * height / to_height;
        let y1 = ((ty + 1) * height / to_height).max(y0 + 1).min(height);
        for tx in 0..to_width {
            let x0 = tx * width / to_width;
            let x1 = ((tx + 1) * width / to_width).max(x0 + 1).min(width);
            let mut sum = [0u64; 4];
            for y in y0..y1 {
                for x in x0..x1 {
                    let index = ((y * width + x) * 4) as usize;
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total += pixels[index + channel] as u64;
                    }
                }
            }
            let count = ((y1 - y0) * (x1 - x0)) as u64;
            let index = ((ty * to_width + tx) * 4) as usize;
            for channel in 0..4 {
                out[index + channel] = (sum[channel] / count) as u8;
            }
        }
    }
    out
}

/// Thumbnail size no wider than `limit`, keeping the aspect ratio.
pub(crate) fn fit(width: u32, height: u32, limit: Option<u32>) -> (u32, u32) {
    match limit {
        Some(limit) if limit > 0 && width > limit => (
            limit,
            ((height as u64 * limit as u64) / width as u64).max(1) as u32,
        ),
        _ => (width, height),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full() -> PortalInfo {
        PortalInfo {
            remote_desktop: 2,
            device_types: 7,
            screencast: 5,
            source_types: 7,
            screenshot: 2,
            accessibility: true,
        }
    }

    #[test]
    fn desktop_control_selects_x11_gnome_extension_then_portal() {
        let x11 = Probe {
            x11: true,
            portal: Some(full()),
            ..Default::default()
        };
        assert_eq!(select(&x11), Selection::X11);
        assert!(matches!(
            select(&Probe::default()),
            Selection::Unavailable(_)
        ));
        let gnome = Probe {
            wayland: true,
            x11: false,
            gnome_extension: true,
            portal: Some(full()),
        };
        assert_eq!(select(&gnome), Selection::GnomeExtension);
        let kde = Probe {
            wayland: true,
            portal: Some(full()),
            ..Default::default()
        };
        assert_eq!(
            select(&kde),
            Selection::Portal(PortalScopes {
                app: true,
                desktop: true
            })
        );
        let missing = Probe {
            wayland: true,
            ..Default::default()
        };
        assert!(
            matches!(select(&missing), Selection::Unavailable(message) if message.contains("portal"))
        );
    }

    #[test]
    fn desktop_control_portal_scopes_report_only_what_the_portal_offers() {
        let no_screenshot = PortalInfo {
            screenshot: 0,
            ..full()
        };
        assert_eq!(
            scopes(&no_screenshot),
            PortalScopes {
                app: true,
                desktop: false
            }
        );
        let no_accessibility = PortalInfo {
            accessibility: false,
            ..full()
        };
        assert_eq!(
            scopes(&no_accessibility),
            PortalScopes {
                app: false,
                desktop: true
            }
        );
        let keyboard_only = PortalInfo {
            device_types: DEVICE_KEYBOARD,
            ..full()
        };
        assert!(!scopes(&keyboard_only).desktop);
        let windows_only = PortalInfo {
            source_types: 2,
            ..full()
        };
        assert!(!scopes(&windows_only).desktop);
        let none = PortalInfo {
            remote_desktop: 0,
            ..full()
        };
        let probe = Probe {
            wayland: true,
            portal: Some(none),
            ..Default::default()
        };
        assert!(
            matches!(select(&probe), Selection::Unavailable(message) if message.contains("remote desktop"))
        );
    }

    #[test]
    fn desktop_control_portal_session_sequence_and_responses() {
        assert_eq!(
            steps(Scope::App),
            &[Step::CreateSession, Step::SelectDevices, Step::Start]
        );
        assert_eq!(
            steps(Scope::Desktop),
            &[
                Step::CreateSession,
                Step::SelectDevices,
                Step::SelectSources,
                Step::Start
            ]
        );
        assert_eq!(devices(Scope::App), DEVICE_KEYBOARD);
        assert_eq!(devices(Scope::Desktop), DEVICE_KEYBOARD | DEVICE_POINTER);
        assert!(response(Step::Start, 0).is_ok());
        assert!(response(Step::Start, 1).unwrap_err().contains("declined"));
        assert!(response(Step::SelectSources, 2)
            .unwrap_err()
            .contains("SelectSources"));
    }

    #[test]
    fn desktop_control_portal_grant_waits_activates_and_cancels_for_good() {
        let shared = Shared::waiting();
        let (status, epoch, reason) = shared.current();
        assert_eq!((status.as_str(), epoch), ("paused", 0));
        assert_eq!(reason, WAITING);
        assert_eq!(shared.check(None).unwrap_err(), WAITING);
        shared.activate();
        let (status, epoch, _) = shared.current();
        assert_eq!((status.as_str(), epoch), ("active", 1));
        assert!(shared.check(Some(1)).is_ok());
        assert!(
            shared.check(Some(0)).is_err(),
            "stale snapshots are rejected"
        );
        shared.cancel("Sharing stopped.");
        shared.activate();
        let (status, epoch, reason) = shared.current();
        assert_eq!(
            (status.as_str(), epoch, reason.as_str()),
            ("canceled", 2, "Sharing stopped.")
        );
        assert!(shared.check(Some(2)).is_err());
    }

    #[test]
    fn desktop_control_portal_restore_tokens_persist_per_project_and_scope() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-portal-tokens-{}", uuid::Uuid::new_v4()));
        let path = token_path(&directory);
        assert_eq!(restore_token(&path, "p1", Scope::App), None);
        save_token(&path, "p1", Scope::App, Some("token-app")).unwrap();
        save_token(&path, "p1", Scope::Desktop, Some("token-desktop")).unwrap();
        save_token(&path, "p2", Scope::App, Some("other")).unwrap();
        save_token(&path, "p1", Scope::App, Some("token-app-2")).unwrap();
        assert_eq!(
            restore_token(&path, "p1", Scope::App).as_deref(),
            Some("token-app-2")
        );
        assert_eq!(
            restore_token(&path, "p1", Scope::Desktop).as_deref(),
            Some("token-desktop")
        );
        assert_eq!(
            restore_token(&path, "p2", Scope::App).as_deref(),
            Some("other")
        );
        save_token(&path, "p1", Scope::Desktop, None).unwrap();
        assert_eq!(restore_token(&path, "p1", Scope::Desktop), None);
        save_token(&path, "p1", Scope::Window, Some("bad token\n")).unwrap();
        assert_eq!(restore_token(&path, "p1", Scope::Window), None);
        // Entries for scopes written by a newer app survive a rewrite.
        std::fs::write(
            &path,
            r#"{"tokens":[{"projectId":"p1","scope":"region","token":"keep","savedAt":"x","extra":1}],"future":true}"#,
        )
        .unwrap();
        save_token(&path, "p1", Scope::App, Some("fresh")).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"region\"") && text.contains("keep"));
        assert_eq!(
            restore_token(&path, "p1", Scope::App).as_deref(),
            Some("fresh")
        );
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(restore_token(&path, "p1", Scope::App), None);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn desktop_control_portal_keysyms_and_states() {
        assert_eq!(keysym("Enter"), Some(0xff0d));
        assert_eq!(keysym("F1"), Some(0xffbe));
        assert_eq!(keysym("F12"), Some(0xffc9));
        assert_eq!(keysym("F13"), None);
        assert_eq!(keysym("t"), Some(b't' as u32));
        assert_eq!(keysym("Control"), Some(0xffe3));
        assert_eq!(keysym("ab"), None);
        assert_eq!(char_keysym('é'), Some(0xe9));
        assert_eq!(char_keysym('€'), Some(0x0100_20ac));
        assert_eq!(char_keysym('\u{7}'), None);
        let bits = [(1 << STATE_FOCUSED) | (1 << STATE_SHOWING), 0];
        assert!(has_state(&bits, STATE_FOCUSED));
        assert!(!has_state(&bits, STATE_ACTIVE));
        assert!(has_state(&[0, 1 << 0], 32));
        assert!(!has_state(&[], STATE_FOCUSED));
        assert_eq!(state_names(&[1 << STATE_FOCUSED]), vec!["focused"]);
        let names: Vec<String> = ["focus", "Press", "showMenu"].map(String::from).to_vec();
        assert_eq!(pick_action(&names, "invoke"), Some(1));
        assert_eq!(pick_action(&names, "right_click"), Some(2));
        assert_eq!(pick_action(&names, "double_click"), None);
        assert!(is_password_role("password text"));
    }

    #[test]
    fn desktop_control_portal_identity_helpers() {
        let a = handle(":1.42", "/org/a11y/atspi/accessible/7");
        assert_eq!(a, handle(":1.42", "/org/a11y/atspi/accessible/7"));
        assert_ne!(a, handle(":1.42", "/org/a11y/atspi/accessible/8"));
        assert!(a.len() <= 40);
        let stat = "1234 (my (odd) app) S 1 1234 1234 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 4 0 987654 1000 200";
        assert_eq!(process_start(stat).as_deref(), Some("987654"));
        assert_eq!(process_start("garbage"), None);
        assert_eq!(
            file_uri_path("file:///home/u/Pictures/Screenshot%20from%202026.png"),
            Some(PathBuf::from("/home/u/Pictures/Screenshot from 2026.png"))
        );
        assert_eq!(file_uri_path("https://example.com/x.png"), None);
        assert_eq!(file_uri_path("file://relative"), None);
        assert_eq!(file_uri_path("file:///bad%2"), None);
    }

    #[test]
    fn desktop_control_portal_capture_geometry() {
        let streams = [
            Stream {
                node: 40,
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            Stream {
                node: 41,
                x: 1920,
                y: 0,
                width: 1280,
                height: 1024,
            },
        ];
        let second = crop(&streams, 1, 3200, 1080).unwrap();
        assert_eq!(
            second,
            Crop {
                x: 1920,
                y: 0,
                width: 1280,
                height: 1024
            }
        );
        let scaled = crop(&streams[..1], 0, 3840, 2160).unwrap();
        assert_eq!(
            scaled,
            Crop {
                x: 0,
                y: 0,
                width: 3840,
                height: 2160
            }
        );
        assert!(crop(&streams, 2, 3200, 1080).is_err());
        assert!(
            crop(&streams[..1], 0, 3200, 1080).is_err(),
            "an unshared monitor in the screenshot makes the crop a guess"
        );
        let pixels: Vec<u8> = (0..4 * 4 * 4).map(|i| i as u8).collect();
        let region = crop_rgba(
            &pixels,
            4,
            Crop {
                x: 1,
                y: 2,
                width: 2,
                height: 1,
            },
        );
        assert_eq!(region, pixels[36..44].to_vec());
        let flat = vec![200u8; 4 * 4 * 4];
        assert_eq!(resize_rgba(&flat, 4, 4, 2, 2), vec![200u8; 16]);
        assert_eq!(fit(1920, 1080, Some(480)), (480, 270));
        assert_eq!(fit(400, 300, Some(480)), (400, 300));
        assert_eq!(fit(400, 300, None), (400, 300));
    }
}
