use serde_json::{json, Value};

pub fn distribution(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 128
        || value.starts_with('-')
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "._- ".contains(ch))
    {
        return Err("Choose a WSL distribution installed on this computer.".into());
    }
    Ok(value)
}

#[tauri::command]
pub async fn wsl_distributions() -> Result<Vec<String>, String> {
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
    #[cfg(windows)]
    tauri::async_runtime::spawn_blocking(|| {
        let mut command = std::process::Command::new("wsl.exe");
        command.args(["--list", "--quiet"]);
        let result =
            super::super::process_control::run(command, std::time::Duration::from_secs(10))?;
        if !result.success {
            return Err(
                "WSL is unavailable. Install and configure a distribution in Windows first.".into(),
            );
        }
        Ok(result
            .stdout
            .replace('\0', "")
            .trim_start_matches('\u{feff}')
            .lines()
            .map(str::trim)
            .filter(|line| {
                !line.is_empty()
                    && !line.starts_with("docker-desktop")
                    && !line.starts_with("rancher-desktop")
            })
            .map(String::from)
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

const REQUEST: &str = r#"import json, sys, urllib.request, urllib.error
p = json.load(sys.stdin)
headers = {'Content-Type': 'application/json'}
if p['token']: headers['Authorization'] = 'Bearer ' + p['token']
request = urllib.request.Request('http://127.0.0.1:' + str(p['port']) + p['route'], data=json.dumps(p['body']).encode(), headers=headers, method='POST')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
try:
    response = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=30)
except urllib.error.HTTPError as error:
    response = error
except Exception:
    print(json.dumps({'error': 'Start Jackalope in this WSL distribution, enable Remote access and create a pairing code.'}))
    sys.exit(1)
data = response.read(128001)
if len(data) > 128000:
    print(json.dumps({'error': 'The WSL response is too large.'}))
    sys.exit(1)
sys.stdout.buffer.write(data)
sys.exit(0 if response.status < 300 else 1)
"#;

pub async fn request(
    distro: String,
    port: u16,
    token: String,
    route: String,
    body: Value,
) -> Result<Value, String> {
    distribution(&distro)?;
    if !["/api/pair", "/api/request"].contains(&route.as_str()) || port < 1024 {
        return Err("Invalid WSL host request.".into());
    }
    #[cfg(not(windows))]
    {
        let _ = (distro, port, token, route, body, REQUEST);
        Err("WSL hosts are available on Windows.".into())
    }
    #[cfg(windows)]
    tauri::async_runtime::spawn_blocking(move || {
        let input = serde_json::to_vec(&json!({"port":port,"token":token,"route":route,"body":body})).map_err(|e| e.to_string())?;
        let mut command = std::process::Command::new("wsl.exe");
        command.args(["--distribution", &distro, "--exec", "python3", "-c", REQUEST]);
        let result = super::super::process_control::run_with_input(command, std::time::Duration::from_secs(35), input)?;
        if result.timed_out { return Err("The WSL host did not respond. Work may continue there; refresh before retrying.".into()); }
        if result.truncated { return Err("The WSL response is too large.".into()); }
        let value: Value = serde_json::from_str(&result.stdout).map_err(|_| "WSL could not contact the Linux host. Install Python 3 and start Jackalope in the selected distribution.")?;
        if !result.success { return Err(value["error"].as_str().unwrap_or("The WSL host declined the request.").into()); }
        Ok(value)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distribution_is_a_literal_argument() {
        for value in [
            "",
            "--exec",
            "Ubuntu; touch /tmp/x",
            "../Ubuntu",
            "Ubuntu\n",
        ] {
            assert!(distribution(value).is_err());
        }
        assert!(distribution("Ubuntu-24.04").is_ok());
        assert!(distribution("My Ubuntu").is_ok());
    }
}
