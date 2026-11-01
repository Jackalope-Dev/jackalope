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

/// Where to pair and with which one-time code: either a pairing link
/// (`https://host/#pair=CODE`) or a computer's address with the code shown beside it,
/// which is all Remote access offers before an HTTPS address is set up. Hosts are reached
/// over HTTPS; debug builds also accept a loopback address so the app can be tried
/// against a local desktop.
fn pairing_target(address: &str, code: Option<&str>) -> Result<(String, String), String> {
    let invalid = || "Paste the pairing link, or the computer's address and code.".to_string();
    let url = url::Url::parse(address.trim()).map_err(|_| invalid())?;
    let host = url.host_str().ok_or_else(invalid)?;
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "[::1]");
    let allowed = url.scheme() == "https" || (cfg!(debug_assertions) && loopback);
    if !allowed || !url.username().is_empty() || url.password().is_some() {
        return Err("Computers are reached over HTTPS. Use the https:// address.".into());
    }
    let code = match code.map(str::trim).filter(|code| !code.is_empty()) {
        Some(code) => Some(code.to_string()),
        None => url.fragment().and_then(|fragment| {
            url::form_urlencoded::parse(fragment.as_bytes())
                .find(|(key, _)| key == "pair")
                .map(|(_, value)| value.into_owned())
        }),
    }
    .filter(|code| code.len() == 64 && code.chars().all(|c| c.is_ascii_hexdigit()))
    .ok_or("Use the whole 64-character pairing code from Settings → Remote access.")?;
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

/// Names a host after the computer it reports, else its address: an IP stays whole and a
/// domain keeps its first label, like "studio" for studio.tailnet.ts.net.
fn host_label(origin: &str, computer: Option<&str>) -> String {
    if let Some(name) = computer.map(str::trim).filter(|name| !name.is_empty()) {
        return name.chars().take(80).collect();
    }
    match url::Url::parse(origin)
        .ok()
        .and_then(|url| url.host().map(|host| host.to_owned()))
    {
        Some(url::Host::Domain(domain)) => domain.split('.').next().unwrap_or(&domain).into(),
        Some(host) => host.to_string(),
        None => origin.into(),
    }
}

#[tauri::command]
async fn companion_pair(
    link: String,
    code: Option<String>,
    name: String,
    state: State<'_, Companion>,
) -> Result<PublicHost, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Use a device name up to 80 characters.".into());
    }
    let (origin, code) = pairing_target(&link, code.as_deref())?;
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
    let label = host_label(&origin, response["computer"].as_str());
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
    let builder = tauri::Builder::default();
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    builder
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
    use super::{host_label, pairing_target};

    const CODE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn pairing_links_give_the_origin_and_code() {
        let (origin, code) =
            pairing_target(&format!("https://host.example:8443/#pair={CODE}"), None).unwrap();
        assert_eq!(origin, "https://host.example:8443");
        assert_eq!(code, CODE);
    }

    #[test]
    fn an_address_pairs_with_a_separate_code() {
        let (origin, code) = pairing_target("https://host.example/", Some(CODE)).unwrap();
        assert_eq!(origin, "https://host.example");
        assert_eq!(code, CODE);
    }

    #[test]
    fn pairing_needs_https_and_a_whole_code() {
        assert!(pairing_target(&format!("http://host.example/#pair={CODE}"), None).is_err());
        assert!(pairing_target("https://host.example/#pair=short", None).is_err());
        assert!(pairing_target("https://host.example/", None).is_err());
        assert!(pairing_target("https://host.example/", Some("short")).is_err());
        assert!(pairing_target(&format!("https://user@host.example/#pair={CODE}"), None).is_err());
        assert!(pairing_target("not a link", Some(CODE)).is_err());
    }

    #[test]
    fn host_labels_prefer_the_computer_name() {
        assert_eq!(
            host_label("https://studio.tailnet.ts.net", Some(" DESKTOP-7 ")),
            "DESKTOP-7"
        );
        assert_eq!(host_label("https://studio.tailnet.ts.net", None), "studio");
        assert_eq!(host_label("http://127.0.0.1:9472", Some("")), "127.0.0.1");
    }
}
