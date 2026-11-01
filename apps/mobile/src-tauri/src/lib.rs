//! Jackalope's companion app: pairs with a desktop host's remote access and relays the
//! companion screens' actions to it. Requests leave from here, not the webview, so the
//! host sees an ordinary authenticated client rather than a cross-site browser request.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Manager, State};

/// A paired host: where it is, the token it issued and how the app names it.
#[derive(Clone, Deserialize, Serialize)]
struct Host {
    id: String,
    origin: String,
    token: String,
    label: String,
}

/// What the screens see of a host: never its token.
#[derive(Serialize)]
struct PublicHost {
    id: String,
    origin: String,
    label: String,
}

impl From<&Host> for PublicHost {
    fn from(host: &Host) -> Self {
        Self {
            id: host.id.clone(),
            origin: host.origin.clone(),
            label: host.label.clone(),
        }
    }
}

const MAX_HOSTS: usize = 10;

struct Companion {
    path: PathBuf,
    hosts: Mutex<Vec<Host>>,
}

impl Companion {
    fn load(path: PathBuf) -> Self {
        let hosts = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<Host>>(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            hosts: Mutex::new(hosts),
        }
    }

    /// Writes the host list. The app's data folder is private to it on Android and iOS.
    fn save(&self, hosts: &[Host]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = serde_json::to_vec(hosts).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, bytes).map_err(|e| e.to_string())
    }

    fn host(&self, id: &str) -> Result<Host, String> {
        self.hosts
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .find(|host| host.id == id)
            .cloned()
            .ok_or_else(|| "This host was removed from the app. Pair it again.".into())
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
fn companion_hosts(state: State<'_, Companion>) -> Result<Vec<PublicHost>, String> {
    let hosts = state.hosts.lock().map_err(|e| e.to_string())?;
    Ok(hosts.iter().map(PublicHost::from).collect())
}

#[tauri::command]
async fn companion_pair(
    link: String,
    name: String,
    state: State<'_, Companion>,
) -> Result<PublicHost, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Use a device name up to 80 characters.".into());
    }
    let (origin, code) = parse_link(&link)?;
    {
        let hosts = state.hosts.lock().map_err(|e| e.to_string())?;
        if hosts.len() >= MAX_HOSTS && !hosts.iter().any(|host| host.origin == origin) {
            return Err("Remove a host before pairing another.".into());
        }
    }
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
    let label = url::Url::parse(&origin)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host.split('.').next().unwrap_or(host).into())
        })
        .unwrap_or_else(|| origin.clone());
    let host = Host {
        id: response["id"]
            .as_str()
            .unwrap_or(token)
            .chars()
            .take(64)
            .collect(),
        origin: origin.clone(),
        token: token.into(),
        label,
    };
    let mut hosts = state.hosts.lock().map_err(|e| e.to_string())?;
    let mut next = hosts.clone();
    // Pairing the same host again replaces its old entry rather than listing it twice.
    next.retain(|saved| saved.origin != origin);
    next.push(host.clone());
    state.save(&next).map_err(|error| {
        format!("{error} Pair again with a new link; remove the unused device on the host.")
    })?;
    *hosts = next;
    Ok(PublicHost::from(&host))
}

#[tauri::command]
async fn companion_request(
    host: String,
    action: Value,
    state: State<'_, Companion>,
) -> Result<Value, String> {
    let host = state.host(&host)?;
    post(&host.origin, "/api/request", Some(&host.token), &action).await
}

/// Forgets a host on this phone. The host keeps the device until it is removed there.
#[tauri::command]
fn companion_forget(host: String, state: State<'_, Companion>) -> Result<(), String> {
    let mut hosts = state.hosts.lock().map_err(|e| e.to_string())?;
    let next: Vec<Host> = hosts
        .iter()
        .filter(|saved| saved.id != host)
        .cloned()
        .collect();
    state.save(&next)?;
    *hosts = next;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("hosts.json");
            app.manage(Companion::load(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            companion_hosts,
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
