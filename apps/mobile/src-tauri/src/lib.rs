//! Jackalope's companion app: pairs with a desktop host's remote access and relays the
//! companion screens' actions to it. Requests leave from here, not the webview, so the
//! host sees an ordinary authenticated client rather than a cross-site browser request.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Manager, State};

/// What this phone keeps after pairing: where the host is and the token it issued.
#[derive(Clone, Deserialize, Serialize)]
struct Pairing {
    origin: String,
    token: String,
}

struct Companion {
    path: PathBuf,
    pairing: Mutex<Option<Pairing>>,
}

impl Companion {
    fn load(path: PathBuf) -> Self {
        let pairing = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Pairing>(&bytes).ok());
        Self {
            path,
            pairing: Mutex::new(pairing),
        }
    }

    fn save(&self, pairing: Option<&Pairing>) -> Result<(), String> {
        match pairing {
            Some(pairing) => {
                if let Some(parent) = self.path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let bytes = serde_json::to_vec(pairing).map_err(|e| e.to_string())?;
                // The app's data folder is private to it on Android and iOS.
                std::fs::write(&self.path, bytes).map_err(|e| e.to_string())
            }
            None => match std::fs::remove_file(&self.path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    Err(error.to_string())
                }
                _ => Ok(()),
            },
        }
    }
}

/// Splits a pairing link (`https://host/companion.html#pair=CODE`) into the host's
/// origin and the one-time code. Hosts are reached over HTTPS; debug builds also
/// accept a loopback address so the app can be tried against a local desktop.
fn parse_link(link: &str) -> Result<(String, String), String> {
    let invalid = || "Paste the whole pairing link from Settings → Remote access.".to_string();
    let url = url::Url::parse(link.trim()).map_err(|_| invalid())?;
    let host = url.host_str().ok_or_else(invalid)?;
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "[::1]");
    let allowed = url.scheme() == "https" || (cfg!(debug_assertions) && loopback);
    if !allowed || !url.username().is_empty() || url.password().is_some() {
        return Err("Pairing links must use HTTPS.".into());
    }
    let code = url
        .fragment()
        .and_then(|fragment| {
            url::form_urlencoded::parse(fragment.as_bytes())
                .find(|(key, _)| key == "pair")
                .map(|(_, value)| value.into_owned())
        })
        .filter(|code| code.len() == 64 && code.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or_else(invalid)?;
    Ok((url.origin().ascii_serialization(), code))
}

async fn post(
    origin: &str,
    route: &str,
    token: Option<&str>,
    body: &Value,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.post(format!("{origin}{route}")).json(body);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let mut response = request.send().await.map_err(|_| {
        "The host is unreachable. Work continues there; reconnect to check whether your last action completed."
    })?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Connection interrupted. Try again.")?
    {
        if bytes.len() + chunk.len() > 4_000_000 {
            return Err("The host response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "The host returned an unreadable response.")?;
    if !status.is_success() {
        return Err(value["error"]
            .as_str()
            .unwrap_or("The host declined this request.")
            .into());
    }
    Ok(value)
}

#[tauri::command]
fn companion_host(state: State<'_, Companion>) -> Result<Option<String>, String> {
    let pairing = state.pairing.lock().map_err(|e| e.to_string())?;
    Ok(pairing.as_ref().map(|pairing| pairing.origin.clone()))
}

#[tauri::command]
async fn companion_pair(
    link: String,
    name: String,
    state: State<'_, Companion>,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Use a device name up to 80 characters.".into());
    }
    let (origin, code) = parse_link(&link)?;
    let response = post(
        &origin,
        "/api/pair",
        None,
        &json!({"code": code, "name": name}),
    )
    .await?;
    let token = response["token"]
        .as_str()
        .filter(|token| token.len() == 64)
        .ok_or("The host did not return a device token.")?;
    let pairing = Pairing {
        origin: origin.clone(),
        token: token.into(),
    };
    state.save(Some(&pairing)).map_err(|error| {
        format!("{error} Pair again with a new link; remove the unused device on the host.")
    })?;
    *state.pairing.lock().map_err(|e| e.to_string())? = Some(pairing);
    Ok(origin)
}

#[tauri::command]
async fn companion_request(action: Value, state: State<'_, Companion>) -> Result<Value, String> {
    let pairing = state
        .pairing
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Connect to your host first.")?;
    post(
        &pairing.origin,
        "/api/request",
        Some(&pairing.token),
        &action,
    )
    .await
}

#[tauri::command]
fn companion_forget(state: State<'_, Companion>) -> Result<(), String> {
    state.save(None)?;
    *state.pairing.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("pairing.json");
            app.manage(Companion::load(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            companion_host,
            companion_pair,
            companion_request,
            companion_forget
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Jackalope companion");
}

#[cfg(test)]
mod tests {
    use super::parse_link;

    const CODE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn pairing_links_give_the_origin_and_code() {
        let (origin, code) = parse_link(&format!(
            "https://host.example:8443/companion.html#pair={CODE}"
        ))
        .unwrap();
        assert_eq!(origin, "https://host.example:8443");
        assert_eq!(code, CODE);
    }

    #[test]
    fn pairing_links_must_be_https_with_a_whole_code() {
        assert!(parse_link(&format!("http://host.example/companion.html#pair={CODE}")).is_err());
        assert!(parse_link("https://host.example/companion.html#pair=short").is_err());
        assert!(parse_link(&format!("https://user@host.example/#pair={CODE}")).is_err());
        assert!(parse_link("not a link").is_err());
    }
}
