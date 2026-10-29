//! Request validation and key chords. Checks here run before any grant or
//! helper work, so malformed or system-wide input never reaches the desktop.

use super::{elements::valid_ref, DesktopRequest};
use serde_json::{json, Value};

pub(crate) const ACTIONS: &[&str] = &[
    "request_access",
    "release",
    "snapshot",
    "screenshot",
    "wait_for",
    "focus",
    "list_windows",
    "switch_window",
    "open_app",
    "clipboard_read",
    "clipboard_write",
    "click",
    "double_click",
    "right_click",
    "drag",
    "type",
    "set_value",
    "press",
    "scroll",
    "invoke",
    "select",
];

/// Actions that change the app and consume the latest snapshot.
pub(crate) const INPUT: &[&str] = &[
    "click",
    "double_click",
    "right_click",
    "drag",
    "type",
    "set_value",
    "press",
    "scroll",
    "invoke",
    "select",
];

/// Actions that read the window and return a new snapshot ID.
pub(crate) const OBSERVE: &[&str] = &["snapshot", "screenshot", "wait_for"];

pub(crate) fn is_input(request: &DesktopRequest) -> bool {
    INPUT.contains(&request.action.as_str())
        || (request.action == "focus" && request.element.is_some())
}

const NAMED: &[&str] = &[
    "Tab",
    "Enter",
    "Escape",
    "Space",
    "Backspace",
    "Delete",
    "Insert",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
];
const PUNCTUATION: &str = "-=,./;'[]\\`";

/// Keys the original helpers understand; platforms without chord support accept only these.
pub(crate) const LEGACY_KEYS: &[&str] = &[
    "Tab",
    "Shift+Tab",
    "Enter",
    "Escape",
    "Space",
    "Backspace",
    "Delete",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Control+a",
    "Control+s",
    "Control+z",
    "Control+y",
    "Primary+a",
    "Primary+s",
    "Primary+z",
    "Primary+y",
];

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Chord {
    /// Control, Shift, Alt or Primary (Command on macOS, Control elsewhere), in that order.
    pub modifiers: Vec<String>,
    pub key: String,
}

impl Chord {
    /// Chord for the helper with Primary resolved for this platform.
    pub fn native(&self) -> Value {
        let primary = if cfg!(target_os = "macos") {
            "Command"
        } else {
            "Control"
        };
        let mut modifiers: Vec<&str> = Vec::new();
        for modifier in &self.modifiers {
            let resolved = if modifier == "Primary" {
                primary
            } else {
                modifier.as_str()
            };
            if !modifiers.contains(&resolved) {
                modifiers.push(resolved);
            }
        }
        json!({"modifiers": modifiers, "key": self.key})
    }
}

pub(crate) fn chord(text: &str) -> Result<Chord, String> {
    let unsupported = || {
        "Unsupported key. Use a named key (Enter, Tab, ArrowDown, F5…), or a letter, digit or punctuation with Control, Shift, Alt or Primary. Desktop switching and system-wide shortcuts are not exposed.".to_string()
    };
    let parts: Vec<&str> = text.split('+').collect();
    let (key, modifiers) = match parts.split_last() {
        Some((key, modifiers)) if !key.is_empty() => (*key, modifiers),
        _ => return Err(unsupported()),
    };
    let mut ordered = Vec::new();
    for name in ["Control", "Shift", "Alt", "Primary"] {
        let count = modifiers.iter().filter(|m| **m == name).count();
        if count > 1 {
            return Err(unsupported());
        }
        if count == 1 {
            ordered.push(name.to_string());
        }
    }
    if ordered.len() != modifiers.len() {
        return Err(unsupported());
    }
    let named = NAMED.contains(&key);
    let function = key.len() >= 2
        && key.len() <= 3
        && key.starts_with('F')
        && key[1..].parse::<u8>().is_ok_and(|n| (1..=12).contains(&n));
    let character = key.chars().count() == 1
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || PUNCTUATION.contains(c));
    if !(named || function || character) {
        return Err(unsupported());
    }
    let has = |name: &str| ordered.iter().any(|m| m == name);
    let command = has("Control") || has("Primary") || has("Alt");
    if character && !command {
        return Err("Use type for literal characters; press is for keys and shortcuts.".into());
    }
    let blocked = (key == "Tab" && (has("Alt") || has("Primary") || has("Control")))
        || (key == "Escape" && command)
        || (key == "Delete" && has("Alt"))
        || (key == "F4" && has("Alt"))
        || (key == "Space" && (has("Primary") || has("Alt")))
        || (key == "v" && (has("Control") || has("Primary")))
        || (key == "q" && has("Primary"));
    if blocked {
        return Err(unsupported());
    }
    Ok(Chord {
        modifiers: ordered,
        key: key.into(),
    })
}

fn text_ok(text: &str, limit: usize, newlines: bool) -> bool {
    text.chars().count() <= limit
        && !text
            .chars()
            .any(|c| c.is_control() && !(newlines && matches!(c, '\n' | '\t' | '\r')))
}

fn point(
    request: &DesktopRequest,
    element: &Option<String>,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<(), String> {
    match (element, x, y) {
        (Some(reference), None, None) if valid_ref(reference) => Ok(()),
        (Some(_), None, None) => {
            Err("Element refs look like e12. Use one from the latest snapshot.".into())
        }
        (None, Some(x), Some(y)) if x >= 0 && y >= 0 => Ok(()),
        (None, Some(_), Some(_)) => {
            Err("Supply nonnegative coordinates relative to the captured area.".into())
        }
        _ => Err(format!(
            "Target {} with element from the latest snapshot, or with x and y.",
            request.action
        )),
    }
}

pub(crate) fn validate(request: &DesktopRequest) -> Result<(), String> {
    let action = request.action.as_str();
    if !ACTIONS.contains(&action) {
        return Err("Unsupported desktop action.".into());
    }
    if let Some(text) = &request.text {
        let (limit, newlines) = match action {
            "clipboard_write" | "set_value" => (10_000, true),
            "wait_for" | "select" => (200, false),
            _ => (1000, false),
        };
        if !text_ok(text, limit, newlines) {
            return Err(if newlines {
                format!("Use at most {limit} characters without control characters other than newlines and tabs.")
            } else {
                format!("Use at most {limit} printable characters; use press for control keys.")
            });
        }
    }
    for (field, value) in [("app", &request.app), ("reason", &request.reason)] {
        if value
            .as_ref()
            .is_some_and(|text| !text_ok(text, if field == "app" { 80 } else { 300 }, false))
        {
            return Err(format!(
                "{field} is too long or contains control characters."
            ));
        }
    }
    if let Some(element) = &request.element {
        if !valid_ref(element) {
            return Err("Element refs look like e12. Use one from the latest snapshot.".into());
        }
    }
    match action {
        "request_access" => {
            super::grant::Scope::parse(request.scope.as_deref())?;
        }
        "type" if request.text.as_ref().is_none_or(String::is_empty) => {
            return Err("Supply text to type.".into())
        }
        "set_value" if request.element.is_none() || request.text.is_none() => {
            return Err("Supply element and the new text for set_value.".into())
        }
        "invoke" | "select" if request.element.is_none() => {
            return Err(format!("Supply an element ref for {action}."))
        }
        "click" | "double_click" | "right_click" => {
            point(request, &request.element, request.x, request.y)?
        }
        "scroll" => {
            point(request, &request.element, request.x, request.y)?;
            if request
                .wheel
                .is_none_or(|n| n == 0 || !(-10..=10).contains(&n))
            {
                return Err("Supply 1 to 10 wheel notches in either direction.".into());
            }
        }
        "drag" => {
            point(request, &request.element, request.x, request.y)?;
            let to = DesktopRequest {
                action: "drag destination".into(),
                ..request.clone()
            };
            point(&to, &request.to_element, request.to_x, request.to_y)?;
        }
        "press" => {
            chord(request.key.as_deref().unwrap_or(""))?;
        }
        "wait_for" => {
            if request.text.as_ref().is_none_or(|t| t.trim().is_empty()) {
                return Err("Supply the text to wait for.".into());
            }
            if request.timeout_ms.is_some_and(|ms| ms > 15_000) {
                return Err("Wait at most 15000 milliseconds.".into());
            }
        }
        "switch_window"
            if request
                .window
                .as_ref()
                .is_none_or(|w| w.is_empty() || w.len() > 40) =>
        {
            return Err("Supply a window ID from list_windows.".into())
        }
        "open_app" => {
            if let Some(app) = &request.app {
                if app.is_empty()
                    || !app
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
                    || app.starts_with(['-', '.'])
                {
                    return Err(
                        "Name the app by its program or app name only, without paths or arguments."
                            .into(),
                    );
                }
            }
        }
        "clipboard_write" if request.text.is_none() => {
            return Err("Supply text to put on the clipboard.".into())
        }
        _ => {}
    }
    Ok(())
}
