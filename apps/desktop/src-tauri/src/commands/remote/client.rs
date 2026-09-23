use super::super::tasks::TaskRuntime;
use super::*;
static CLIENT_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    id: String,
    name: String,
    address: String,
    ssh: bool,
    port: u16,
    token: String,
    #[serde(default)]
    wsl: bool,
}
fn path(runtime: &TaskRuntime) -> PathBuf {
    runtime.integration_directory().join("remote-hosts.bin")
}
fn hosts(runtime: &TaskRuntime) -> Result<Vec<Host>, String> {
    account_storage::read(&path(runtime))?
        .map(|bytes| {
            serde_json::from_slice(&bytes)
                .map_err(|_| "Saved hosts could not be read. The record was preserved.".into())
        })
        .unwrap_or(Ok(Vec::new()))
}
fn public(host: &Host) -> Value {
    json!({"id":host.id,"name":host.name,"address":host.address,"ssh":host.ssh,"port":host.port,"wsl":host.wsl})
}
async fn endpoint(host: &Host) -> Result<(String, Option<String>), String> {
    if !host.ssh {
        return Ok((origin(&host.address)?, None));
    }
    let saved = host.clone();
    let port = tauri::async_runtime::spawn_blocking(move || {
        transport::tunnel(&saved.id, &saved.address, saved.port)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok((
        format!("http://127.0.0.1:{port}"),
        Some(format!("127.0.0.1:{}", host.port)),
    ))
}
async fn request(host: &Host, route: &str, value: Value) -> Result<Value, String> {
    if host.wsl {
        return super::wsl::request(
            host.address.clone(),
            host.port,
            host.token.clone(),
            route.into(),
            value,
        )
        .await;
    }
    let (base, authority) = endpoint(host).await?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.post(format!("{base}{route}")).json(&value);
    if let Some(authority) = authority {
        request = request.header("Host", authority);
    }
    if !host.token.is_empty() {
        request = request.bearer_auth(&host.token);
    }
    let mut response = request.send().await.map_err(|_| "The host is unreachable. Work continues there; reconnect to check whether your last action completed.")?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Connection interrupted. Refresh the host before retrying.")?
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
pub fn remote_hosts(state: State<'_, TaskRuntime>) -> Result<Vec<Value>, String> {
    Ok(hosts(&state)?.iter().map(public).collect())
}
#[tauri::command]
pub async fn remote_host_pair(
    name: String,
    address: String,
    ssh: bool,
    wsl: Option<bool>,
    port: u16,
    code: String,
    state: State<'_, TaskRuntime>,
) -> Result<Value, String> {
    if name.trim().is_empty() || name.chars().count() > 80 || port < 1024 || code.len() != 64 {
        return Err("Enter a name, host and current pairing code.".into());
    }
    let wsl = wsl.unwrap_or(false);
    if wsl && ssh {
        return Err("Choose one host connection method.".into());
    }
    let address = if wsl {
        super::wsl::distribution(address.trim())?.into()
    } else if ssh {
        transport::ssh_alias(address.trim())?;
        address.trim().to_string()
    } else {
        origin(address.trim())?
    };
    if hosts(&state)?.len() >= 20 {
        return Err("Remove an unused host before adding another.".into());
    }
    let mut host = Host {
        id: Uuid::new_v4().to_string(),
        name: name.trim().into(),
        address,
        ssh,
        port,
        token: String::new(),
        wsl,
    };
    let device = super::super::system::device_name()
        .chars()
        .take(80)
        .collect::<String>();
    let response = match request(&host, "/api/pair", json!({"code":code,"name":device})).await {
        Ok(response) => response,
        Err(error) => {
            transport::close_tunnel(&host.id);
            return Err(error);
        }
    };
    let mut save = || -> Result<Value, String> {
        host.token = response["token"]
            .as_str()
            .filter(|token| token.len() == 64)
            .ok_or("The host did not return a device token.")?
            .into();
        let _guard = CLIENT_LOCK.lock().map_err(|e| e.to_string())?;
        let mut saved = hosts(&state)?;
        if saved.len() >= 20 {
            return Err("Remove an unused host before adding another.".into());
        }
        saved.push(host.clone());
        account_storage::write(
            &path(&state),
            &serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
        )?;
        Ok(public(&host))
    };
    let result = save();
    if result.is_err() {
        transport::close_tunnel(&host.id);
    }
    result.map_err(|error| {
        format!("{error} Pair again with a new code; remove the unused device on the host.")
    })
}
#[tauri::command]
pub async fn remote_host_request(
    id: String,
    action: api::Action,
    state: State<'_, TaskRuntime>,
) -> Result<Value, String> {
    let host = hosts(&state)?
        .into_iter()
        .find(|h| h.id == id)
        .ok_or("Connect this host again.")?;
    request(
        &host,
        "/api/request",
        serde_json::to_value(action).map_err(|e| e.to_string())?,
    )
    .await
}
#[tauri::command]
pub fn remote_host_remove(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let _guard = CLIENT_LOCK.lock().map_err(|e| e.to_string())?;
    let mut saved = hosts(&state)?;
    saved.retain(|h| h.id != id);
    account_storage::write(
        &path(&state),
        &serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
    )?;
    transport::close_tunnel(&id);
    Ok(())
}
