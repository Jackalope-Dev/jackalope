//! Grant levels, the access question, remembered per-project grants and
//! per-site browser decisions. Window and app grants can be remembered for a
//! project; full-desktop grants are asked for every task and never stored.

use super::Window;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Window,
    App,
    Desktop,
    /// A scope written by a newer app; never matches a request.
    #[serde(other)]
    Unknown,
}

impl Scope {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("window") {
            "window" => Ok(Self::Window),
            "app" => Ok(Self::App),
            "desktop" => Ok(Self::Desktop),
            _ => Err("Use scope window, app or desktop.".into()),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Window => "window",
            Self::App => "app",
            Self::Desktop => "desktop",
            Self::Unknown => "unknown",
        }
    }
}

/// Stable key for an app: process image name on Windows, bundle ID on macOS,
/// window class elsewhere. Lowercase so remembered grants survive casing changes.
pub fn app_key(window: &Window) -> String {
    if window.app.is_empty() {
        window.class.to_lowercase()
    } else {
        window.app.to_lowercase()
    }
}

pub fn app_label(window: &Window) -> String {
    let label = if !window.app_name.is_empty() {
        &window.app_name
    } else if !window.app.is_empty() {
        &window.app
    } else {
        &window.class
    };
    label.chars().take(80).collect()
}

#[derive(Clone, Debug, PartialEq)]
pub enum Choice {
    Window(Window),
    App {
        key: String,
        label: String,
        primary: Window,
        remember: bool,
    },
    Desktop,
}

#[derive(Clone, Debug)]
pub struct Grant {
    pub scope: Scope,
    /// The app key for app grants and the granted window's app otherwise.
    pub app: String,
    pub label: String,
    /// The granted window for window grants; the first window for app grants.
    pub window: Option<Window>,
    /// Remembered grant used instead of asking, if any.
    pub remembered: Option<String>,
}

impl Grant {
    pub fn from_choice(choice: Choice) -> Self {
        match choice {
            Choice::Window(window) => Self {
                scope: Scope::Window,
                app: app_key(&window),
                label: app_label(&window),
                window: Some(window),
                remembered: None,
            },
            Choice::App {
                key,
                label,
                primary,
                ..
            } => Self {
                scope: Scope::App,
                app: key,
                label,
                window: Some(primary),
                remembered: None,
            },
            Choice::Desktop => Self {
                scope: Scope::Desktop,
                app: String::new(),
                label: "your computer".into(),
                window: None,
                remembered: None,
            },
        }
    }

    /// Whether a window is inside this grant. Jackalope's own processes never are.
    pub fn allows(&self, window: &Window, denied: &[u32]) -> bool {
        if denied.contains(&window.pid) {
            return false;
        }
        match self.scope {
            Scope::Window => self.window.as_ref().is_some_and(|granted| {
                granted.handle == window.handle
                    && granted.pid == window.pid
                    && granted.started == window.started
            }),
            Scope::App => app_key(window) == self.app,
            Scope::Desktop => true,
            Scope::Unknown => false,
        }
    }

    pub fn describe(&self) -> String {
        match self.scope {
            Scope::Window => format!("one {} window", self.label),
            Scope::App => format!("all {} windows", self.label),
            _ => "the full desktop".into(),
        }
    }
}

pub fn question(scope: Scope, project: &str, reason: Option<&str>) -> String {
    let what = match scope {
        Scope::Window => "Choose one window the agent may read, capture, focus, click and type into. Other windows and popups need separate access.",
        Scope::App => "Choose one app. The agent may read and control all of its windows, including new ones, but no other app.",
        _ => "The agent asks to read and control your whole desktop, every app and screen, for this task only. Jackalope's own windows stay off limits. This is never remembered.",
    };
    let reason = reason
        .filter(|text| !text.trim().is_empty())
        .map(|text| format!(" The agent says: \u{201c}{}\u{201d}.", text.trim()))
        .unwrap_or_default();
    format!("Allow desktop control in {project}?{reason} {what} A frame and bar show while control is active. Escape, Stop or Revoke ends access at once; moving the mouse or typing pauses it until you click Resume. Input can change files or send data, so do not choose anything showing secrets.")
}

/// Builds the answer options for a request. Choices are matched by label.
pub fn options(
    scope: Scope,
    windows: &[Window],
    project: &str,
    hint: Option<&str>,
) -> Vec<(String, Choice)> {
    let hint = hint.map(str::to_lowercase).filter(|h| !h.is_empty());
    let matches = |window: &Window| {
        hint.as_ref().is_some_and(|hint| {
            app_key(window).contains(hint.as_str())
                || app_label(window).to_lowercase().contains(hint.as_str())
        })
    };
    let mut ordered: Vec<&Window> = windows.iter().collect();
    ordered.sort_by_key(|window| !matches(window));
    match scope {
        Scope::Window => ordered
            .into_iter()
            .take(20)
            .enumerate()
            .map(|(index, window)| {
                let title: String = window.title.chars().take(120).collect();
                (
                    format!("{}: {} \u{2014} {}", index + 1, title, app_label(window)),
                    Choice::Window(window.clone()),
                )
            })
            .collect(),
        Scope::App => {
            let mut apps: Vec<(String, String, Window, usize)> = Vec::new();
            for window in ordered {
                let key = app_key(window);
                if let Some(entry) = apps.iter_mut().find(|entry| entry.0 == key) {
                    entry.3 += 1;
                } else if apps.len() < 10 {
                    apps.push((key, app_label(window), window.clone(), 1));
                }
            }
            let mut result = Vec::new();
            for (index, (key, label, primary, count)) in apps.into_iter().enumerate() {
                let windows = if count == 1 {
                    "1 window".to_owned()
                } else {
                    format!("{count} windows")
                };
                result.push((
                    format!("{}: {label} ({windows}) for this task", index + 1),
                    Choice::App {
                        key: key.clone(),
                        label: label.clone(),
                        primary: primary.clone(),
                        remember: false,
                    },
                ));
                result.push((
                    format!("{}: Always allow {label} in {project}", index + 1),
                    Choice::App {
                        key,
                        label,
                        primary,
                        remember: true,
                    },
                ));
            }
            result
        }
        _ => vec![(
            "Allow full desktop control for this task".into(),
            Choice::Desktop,
        )],
    }
}

// ---- remembered grants and site decisions ----

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedGrant {
    pub id: String,
    pub project_id: String,
    pub scope: Scope,
    pub app: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteDecision {
    pub id: String,
    pub project_id: String,
    pub host: String,
    pub allow: bool,
    pub created_at: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    #[serde(default)]
    grants: Vec<RememberedGrant>,
    #[serde(default)]
    sites: Vec<SiteDecision>,
}

pub fn store_path(preferences: &Path) -> PathBuf {
    preferences.join("desktop-grants.json")
}

fn lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn read(path: &Path) -> Store {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write(path: &Path, store: &Store) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    super::super::history::write_atomic(path, &bytes)
}

pub fn remembered(path: &Path, project_id: &str) -> Vec<RememberedGrant> {
    let _guard = lock().lock();
    read(path)
        .grants
        .into_iter()
        .filter(|grant| grant.project_id == project_id)
        .collect()
}

pub fn sites(path: &Path, project_id: &str) -> Vec<SiteDecision> {
    let _guard = lock().lock();
    read(path)
        .sites
        .into_iter()
        .filter(|site| site.project_id == project_id)
        .collect()
}

pub fn remember(
    path: &Path,
    project_id: &str,
    scope: Scope,
    app: &str,
    label: &str,
) -> Result<RememberedGrant, String> {
    if !matches!(scope, Scope::Window | Scope::App) {
        return Err(
            "Full desktop control is asked for every task and cannot be remembered.".into(),
        );
    }
    if project_id.is_empty() || app.is_empty() {
        return Err("A project and app are required to remember desktop access.".into());
    }
    let _guard = lock().lock();
    let mut store = read(path);
    if let Some(existing) = store
        .grants
        .iter_mut()
        .find(|grant| grant.project_id == project_id && grant.app == app)
    {
        if scope == Scope::App {
            existing.scope = Scope::App;
        }
        let result = existing.clone();
        write(path, &store)?;
        return Ok(result);
    }
    let grant = RememberedGrant {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.into(),
        scope,
        app: app.into(),
        label: label.chars().take(80).collect(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store.grants.push(grant.clone());
    write(path, &store)?;
    Ok(grant)
}

/// Removes a remembered grant or site decision by ID within one project.
pub fn forget(path: &Path, project_id: &str, id: &str) -> Result<(), String> {
    let _guard = lock().lock();
    let mut store = read(path);
    let before = store.grants.len() + store.sites.len();
    store
        .grants
        .retain(|grant| !(grant.project_id == project_id && grant.id == id));
    store
        .sites
        .retain(|site| !(site.project_id == project_id && site.id == id));
    if before == store.grants.len() + store.sites.len() {
        return Err("That remembered desktop permission no longer exists.".into());
    }
    write(path, &store)
}

pub fn decide_site(path: &Path, project_id: &str, host: &str, allow: bool) -> Result<(), String> {
    let _guard = lock().lock();
    let mut store = read(path);
    store
        .sites
        .retain(|site| !(site.project_id == project_id && site.host == host));
    store.sites.push(SiteDecision {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.into(),
        host: host.into(),
        allow,
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    write(path, &store)
}

/// A remembered grant that answers this request without asking. The agent must
/// name the app; a window request is answered only when that app has exactly
/// one window, and an app request only by a remembered app grant.
pub fn remembered_choice(
    grants: &[RememberedGrant],
    scope: Scope,
    hint: Option<&str>,
    windows: &[Window],
) -> Option<(RememberedGrant, Choice)> {
    let hint = hint?.trim().to_lowercase();
    if hint.is_empty() || !matches!(scope, Scope::Window | Scope::App) {
        return None;
    }
    let grant = grants.iter().find(|grant| {
        (grant.app == hint || grant.label.to_lowercase() == hint)
            && match scope {
                Scope::Window => matches!(grant.scope, Scope::Window | Scope::App),
                _ => grant.scope == Scope::App,
            }
    })?;
    let candidates: Vec<&Window> = windows
        .iter()
        .filter(|window| app_key(window) == grant.app)
        .collect();
    let primary = (*candidates.first()?).clone();
    let choice = match scope {
        Scope::Window if candidates.len() == 1 => Choice::Window(primary),
        Scope::Window => return None,
        _ => Choice::App {
            key: grant.app.clone(),
            label: grant.label.clone(),
            primary,
            remember: false,
        },
    };
    Some((grant.clone(), choice))
}

// ---- browsers and sites ----

const BROWSERS: &[&str] = &[
    "chrome",
    "msedge",
    "firefox",
    "zen",
    "brave",
    "opera",
    "vivaldi",
    "arc",
    "librewolf",
    "waterfox",
    "floorp",
    "chromium",
    "com.google.chrome",
    "com.apple.safari",
    "org.mozilla.firefox",
    "app.zen-browser.zen",
    "com.microsoft.edgemac",
    "com.brave.browser",
    "company.thebrowser.browser",
    "com.operasoftware.opera",
    "com.vivaldi.vivaldi",
    "org.chromium.chromium",
];

pub fn is_browser(app: &str) -> bool {
    BROWSERS.contains(&app.to_lowercase().as_str())
}

/// The host a site decision applies to, from a URL or bare address-bar text.
/// Internal pages (about:, chrome://) and unreadable addresses return None.
pub fn site_host(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = match url.split_once("://") {
        Some((scheme, rest)) if ["http", "https"].contains(&scheme.to_lowercase().as_str()) => rest,
        Some(_) => return None,
        None if url.contains(':') && !url.contains('.') => return None,
        None => url,
    };
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    let host = if host.starts_with('[') {
        host.split(']').next()?.trim_start_matches('[')
    } else {
        host.split(':').next()?
    };
    let host = host.trim_end_matches('.').to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_owned();
    (!host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':')))
    .then_some(host)
}

/// Saved decision for a host: exact match first, then the closest parent domain.
pub fn site_decision(decisions: &[SiteDecision], host: &str) -> Option<bool> {
    let mut candidate = host;
    loop {
        if let Some(decision) = decisions.iter().find(|site| site.host == candidate) {
            return Some(decision.allow);
        }
        candidate = candidate.split_once('.')?.1;
        if !candidate.contains('.') {
            return None;
        }
    }
}
