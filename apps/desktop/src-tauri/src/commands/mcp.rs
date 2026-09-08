use rmcp::{
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    #[serde(default)]
    pub discovery: bool,
    #[serde(default)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResult {
    pub ok: bool,
    pub tools: Vec<McpToolInfo>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

fn config_path(scope: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .ok_or("Home directory unavailable")?;
    match scope {
        "global" => Ok(home.join(".jackalope/mcp_servers.json")),
        "claude" => Ok(home.join(".claude.json")),
        "claude-desktop" => {
            if cfg!(windows) {
                Ok(
                    PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA unavailable")?)
                        .join("Claude/claude_desktop_config.json"),
                )
            } else if cfg!(target_os = "macos") {
                Ok(home.join("Library/Application Support/Claude/claude_desktop_config.json"))
            } else {
                Ok(home.join(".config/Claude/claude_desktop_config.json"))
            }
        }
        "codex" => Ok(std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or(home.join(".codex"))
            .join("config.toml")),
        "grok" => Ok(home.join(".grok/config.toml")),
        scope if scope.starts_with("project:") => {
            let id = &scope[8..];
            if id.is_empty()
                || id.len() > 120
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                return Err("Invalid project scope.".into());
            }
            Ok(home
                .join(".jackalope/projects")
                .join(id)
                .join("mcp_servers.json"))
        }
        _ => Err("Unsupported MCP configuration scope.".into()),
    }
}

fn read_config(path: &Path) -> Result<(String, Value), String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let value = if text.is_empty() {
        json!({})
    } else if path.extension().is_some_and(|e| e == "toml") {
        let parsed: toml::Value =
            toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        serde_json::to_value(parsed).map_err(|e| e.to_string())?
    } else {
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?
    };
    if !value.is_object() {
        return Err(format!(
            "{} must contain a configuration object; it was left unchanged.",
            path.display()
        ));
    }
    Ok((text, value))
}

fn servers_key(path: &Path) -> &'static str {
    if path.extension().is_some_and(|e| e == "toml") {
        "mcp_servers"
    } else {
        "mcpServers"
    }
}

fn parse_server_spec(id: &str, spec: &Value, scope: &str) -> McpServerConfig {
    let mut extra = spec.as_object().cloned().unwrap_or_default();
    for key in [
        "command",
        "args",
        "env",
        "url",
        "description",
        "enabled",
        "type",
        "transport",
        "name",
        "jackalopeDiscovery",
    ] {
        extra.remove(key);
    }
    McpServerConfig {
        id: id.into(),
        name: spec["name"].as_str().unwrap_or(id).into(),
        scope: scope.into(),
        transport: spec["type"]
            .as_str()
            .or(spec["transport"].as_str())
            .unwrap_or(if spec["url"].is_string() {
                "http"
            } else {
                "stdio"
            })
            .into(),
        command: spec["command"].as_str().map(str::to_string),
        args: serde_json::from_value(spec["args"].clone()).unwrap_or_default(),
        env: serde_json::from_value(spec["env"].clone()).unwrap_or_default(),
        url: spec["url"].as_str().map(str::to_string),
        description: spec["description"].as_str().map(str::to_string),
        enabled: Some(spec["enabled"].as_bool().unwrap_or(true)),
        discovery: spec["jackalopeDiscovery"].as_bool().unwrap_or(false),
        extra,
    }
}

fn spec(server: &McpServerConfig, scope: &str) -> Value {
    let mut value = Value::Object(server.extra.clone());
    let headers = value
        .as_object_mut()
        .unwrap()
        .remove("headers")
        .or_else(|| value.as_object_mut().unwrap().remove("http_headers"));
    if let Some(headers) = headers {
        value[if scope == "codex" {
            "http_headers"
        } else {
            "headers"
        }] = headers;
    }
    if scope == "claude" {
        if let Some(variable) = value
            .as_object_mut()
            .unwrap()
            .remove("bearer_token_env_var")
            .and_then(|v| v.as_str().map(str::to_string))
        {
            if !value["headers"].is_object() {
                value["headers"] = json!({});
            }
            value["headers"]["Authorization"] = json!(format!("Bearer ${{{variable}}}"));
        }
    }
    if server.transport == "stdio" {
        value["command"] = json!(server.command);
        value["args"] = json!(server.args);
        value["env"] = json!(server.env);
    } else {
        value["url"] = json!(server.url);
        if scope != "codex" {
            value["type"] = json!(server.transport);
        }
    }
    if scope == "global" || scope.starts_with("project:") {
        value["name"] = json!(server.name);
        value["jackalopeDiscovery"] = json!(server.discovery);
        if let Some(desc) = &server.description {
            value["description"] = json!(desc);
        }
    }
    if ["global", "codex", "grok"].contains(&scope) || scope.starts_with("project:") {
        value["enabled"] = json!(server.enabled.unwrap_or(true));
    }
    value
}

fn edit_config(path: &Path, id: &str, value: Option<Value>) -> Result<String, String> {
    let (text, mut root) = read_config(path)?;
    let key = servers_key(path);
    if root.get(key).is_some_and(|v| !v.is_object()) {
        return Err(format!(
            "Invalid {key} in {}; configuration left unchanged.",
            path.display()
        ));
    }
    if key == "mcp_servers" {
        let mut doc = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| e.to_string())?;
        if doc.get(key).is_none() {
            doc[key] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        let table = doc[key].as_table_like_mut().ok_or("Invalid MCP table")?;
        if let Some(value) = value {
            let mut wrapper = serde_json::Map::new();
            wrapper.insert(id.into(), value);
            let fragment = toml::to_string(&wrapper)
                .map_err(|e| e.to_string())?
                .parse::<toml_edit::DocumentMut>()
                .map_err(|e| e.to_string())?;
            table.insert(id, fragment[id].clone());
        } else {
            table.remove(id);
        }
        Ok(doc.to_string())
    } else {
        if root.get(key).is_none() {
            root[key] = json!({});
        }
        if let Some(value) = value {
            root[key][id] = value;
        } else {
            root[key].as_object_mut().unwrap().remove(id);
        }
        serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
    }
}

fn write_config(path: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid config path")?).map_err(|e| e.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, text).map_err(|e| e.to_string())?;
    if path.exists() {
        fs::copy(path, path.with_extension("jackalope-backup")).map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

fn validate(server: &McpServerConfig) -> Result<(), String> {
    if server.discovery {
        super::mcp_broker::validate_connection(server)?;
    }
    if let Some(value) = server.extra.get("bearer_token_env_var") {
        let variable = value
            .as_str()
            .ok_or("The bearer token must reference an environment variable name.")?;
        if variable.is_empty()
            || variable.len() > 256
            || !variable
                .bytes()
                .enumerate()
                .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit()))
        {
            return Err("Provide a valid bearer-token environment variable name.".into());
        }
    }
    if server.id.trim().is_empty() || server.id.len() > 160 {
        return Err("Provide a server ID.".into());
    }
    if server.transport == "stdio" {
        if server.command.as_ref().is_none_or(|s| s.trim().is_empty()) {
            return Err(
                "Provide the executable command from the publisher's configuration.".into(),
            );
        }
    } else if ["http", "sse"].contains(&server.transport.as_str()) {
        if !server
            .url
            .as_ref()
            .is_some_and(|url| url.starts_with("http://") || url.starts_with("https://"))
        {
            return Err("Provide an HTTP or HTTPS endpoint.".into());
        }
    } else {
        return Err("Unsupported MCP transport.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_servers(project_id: Option<String>) -> Result<Vec<McpServerConfig>, String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    let mut scopes = vec![
        "global".to_string(),
        "claude".into(),
        "claude-desktop".into(),
        "codex".into(),
        "grok".into(),
    ];
    if let Some(id) = project_id {
        scopes.push(format!("project:{id}"));
    }
    for scope in scopes.iter().map(String::as_str) {
        let path = config_path(scope)?;
        let (_, root) = read_config(&path)?;
        if let Some(servers) = root[servers_key(&path)].as_object() {
            for (id, value) in servers {
                results.push(parse_server_spec(id, value, scope));
            }
        }
    }
    Ok(results)
}

fn apply_writes(writes: Vec<(PathBuf, Option<String>, String)>) -> Result<(), String> {
    for (index, (path, _, next)) in writes.iter().enumerate() {
        if let Err(error) = write_config(path, next) {
            let mut errors = vec![error];
            for (path, original, _) in writes[..index].iter().rev() {
                let result = match original {
                    Some(text) => fs::write(path, text),
                    None => fs::remove_file(path),
                };
                if let Err(e) = result {
                    errors.push(format!("Rollback failed for {}: {e}", path.display()));
                }
            }
            return Err(errors.join("; "));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_save_server(server: McpServerConfig) -> Result<(), String> {
    validate(&server)?;
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let scopes = if server.scope == "global" {
        vec!["global", "codex", "claude", "grok"]
    } else {
        vec![server.scope.as_str()]
    };
    let mut writes = Vec::new();
    let previous_global = if server.scope == "global" {
        Some(read_config(&config_path("global")?)?.1["mcpServers"][&server.id].clone())
    } else {
        None
    };
    for scope in scopes {
        if scope == "codex" && server.transport == "sse" {
            return Err("Codex requires Streamable HTTP. Choose a compatible endpoint or a different scope.".into());
        }
        let path = config_path(scope)?;
        if server.scope == "global" && scope != "global" {
            let (_, root) = read_config(&path)?;
            let existing = &root[servers_key(&path)][&server.id];
            if !existing.is_null() && *existing != spec(&server, scope) {
                let managed = previous_global
                    .as_ref()
                    .filter(|v| !v.is_null())
                    .map(|v| spec(&parse_server_spec(&server.id, v, "global"), scope));
                if managed.as_ref() != Some(existing) {
                    return Err(format!("{} already has a different {} configuration. Edit that agent's entry or choose a new server ID.", scope, server.id));
                }
            }
        }
        let original = if path.exists() {
            Some(fs::read_to_string(&path).map_err(|e| e.to_string())?)
        } else {
            None
        };
        let next = edit_config(&path, &server.id, Some(spec(&server, scope)))?;
        writes.push((path, original, next));
    }
    apply_writes(writes)
}

#[tauri::command]
pub async fn mcp_delete_server(id: String, scope: String) -> Result<(), String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let path = config_path(&scope)?;
    let (_, root) = read_config(&path)?;
    let original_spec = root[servers_key(&path)][&id].clone();
    let scopes = if scope == "global" {
        vec!["global", "codex", "claude", "grok"]
    } else {
        vec![scope.as_str()]
    };
    let mut writes = Vec::new();
    for target in scopes {
        let path = config_path(target)?;
        if !path.exists() {
            continue;
        }
        let (text, root) = read_config(&path)?;
        if scope == "global" && target != "global" {
            let managed = parse_server_spec(&id, &original_spec, "global");
            if root[servers_key(&path)][&id] != spec(&managed, target) {
                continue;
            }
        }
        let next = edit_config(&path, &id, None)?;
        writes.push((path, Some(text), next));
    }
    apply_writes(writes)
}

#[tauri::command]
pub async fn mcp_probe_server(server: McpServerConfig) -> Result<McpProbeResult, String> {
    validate(&server)?;
    let started = Instant::now();
    let future = async {
        let client = connect(&server, None, None).await?;
        let result = client.list_all_tools().await.map_err(|e| e.to_string());
        let _ = client.cancel().await;
        result.map(|tools| {
            tools
                .into_iter()
                .map(|tool| McpToolInfo {
                    name: tool.name.to_string(),
                    description: tool.description.map(|v| v.to_string()),
                    input_schema: Some(json!(tool.input_schema)),
                })
                .collect()
        })
    };
    let result = tokio::time::timeout(Duration::from_secs(15), future)
        .await
        .unwrap_or_else(|_| Err("MCP handshake/tool discovery timed out after 15 seconds.".into()));
    Ok(match result {
        Ok(tools) => McpProbeResult {
            ok: true,
            tools,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: None,
        },
        Err(error) => McpProbeResult {
            ok: false,
            tools: vec![],
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: Some(error),
        },
    })
}

pub(super) struct Connection {
    client: rmcp::service::RunningService<rmcp::RoleClient, ()>,
    _tree: Option<super::process_control::ProcessTree>,
}
impl std::ops::Deref for Connection {
    type Target = rmcp::service::RunningService<rmcp::RoleClient, ()>;
    fn deref(&self) -> &Self::Target {
        &self.client
    }
}
impl Connection {
    async fn cancel(self) {
        let _ = self.client.cancel().await;
    }
}

pub(super) async fn connect(
    server: &McpServerConfig,
    workspace: Option<&Path>,
    account: Option<(&str, &Path)>,
) -> Result<Connection, String> {
    validate(server)?;
    let mut tree = None;
    if server.transport == "sse" {
        return Err("Legacy SSE probing is unavailable. Use the agent's connection test or a Streamable HTTP endpoint.".into());
    }
    let client = if server.transport == "http" {
        let mut headers = HashMap::new();
        if let Some(values) = server
            .extra
            .get("http_headers")
            .or(server.extra.get("headers"))
            .and_then(Value::as_object)
        {
            for (name, value) in values {
                headers.insert(
                    name.parse().map_err(|_| "Invalid HTTP header name")?,
                    value
                        .as_str()
                        .ok_or("HTTP header values must be strings")?
                        .parse()
                        .map_err(|_| "Invalid HTTP header value")?,
                );
            }
        }
        let mut config =
            rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig::with_uri(
                server.url.clone().unwrap(),
            )
            .custom_headers(headers);
        if let Some(variable) = server
            .extra
            .get("bearer_token_env_var")
            .and_then(Value::as_str)
        {
            config = config.auth_header(
                std::env::var(variable)
                    .map_err(|_| format!("Set {variable} before probing this connection."))?,
            );
        }
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        ().serve(StreamableHttpClientTransport::with_client(http, config))
            .await
            .map_err(|e| e.to_string())?
    } else {
        let program = server.command.as_ref().unwrap();
        let mut executable = PathBuf::from(program);
        if cfg!(windows) && executable.extension().is_none() && !executable.is_absolute() {
            if let Some(found) =
                std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                    .flat_map(|dir| {
                        [
                            dir.join(format!("{program}.exe")),
                            dir.join(format!("{program}.cmd")),
                        ]
                    })
                    .find(|path| path.is_file())
            {
                executable = found;
            }
        }
        let mut command = tokio::process::Command::new(executable);
        command
            .args(&server.args)
            .envs(&server.env)
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        #[cfg(unix)]
        command.process_group(0);
        if let Some(workspace) = workspace {
            command.current_dir(workspace);
        }
        if let Some((name, directory)) = account {
            command.env(name, directory);
        }
        command
            .env_remove("JACKALOPE_BRIDGE_TOKEN")
            .env_remove("JACKALOPE_BRIDGE_URL");
        let (transport, _) = TokioChildProcess::builder(command)
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        tree = Some(super::process_control::ProcessTree::attach_pid(
            transport
                .id()
                .ok_or("MCP process exited before containment")?,
        )?);
        ().serve(transport).await.map_err(|e| e.to_string())?
    };
    Ok(Connection {
        client,
        _tree: tree,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_delivery_preserves_selection_and_adapter_authentication() {
        let id = uuid::Uuid::new_v4().to_string();
        let path = config_path(&format!("project:{id}")).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_vec(&json!({"mcpServers": {
            "test.server": {"url":"https://example.invalid/mcp", "bearer_token_env_var":"TEST_TOKEN"},
            "off": {"command":"unused", "enabled":false}
        }})).unwrap()).unwrap();
        let selected = vec!["test.server".to_string()];
        let codex = project_servers(&id, Some(&selected), "codex").unwrap();
        assert_eq!(codex["test.server"]["bearer_token_env_var"], "TEST_TOKEN");
        let overrides = codex_overrides(&codex).unwrap();
        assert_eq!(overrides.len(), 1);
        assert_eq!(overrides[0].split_once('=').unwrap().0, "mcp_servers");
        let parsed: toml::Value = toml::from_str(&overrides.join("\n")).unwrap();
        assert_eq!(
            parsed["mcp_servers"]["test.server"]["url"].as_str(),
            Some("https://example.invalid/mcp")
        );
        let claude = project_servers(&id, Some(&selected), "claude").unwrap();
        assert_eq!(
            claude["test.server"]["headers"]["Authorization"],
            "Bearer ${TEST_TOKEN}"
        );
        assert!(project_servers(&id, Some(&[]), "grok").unwrap().is_empty());
        assert!(project_servers(&id, Some(&selected), "grok").is_err());
        assert!(project_servers(&id, Some(&selected), "antigravity")
            .unwrap_err()
            .contains("on-demand discovery"));
        assert!(project_servers(&id, Some(&[]), "antigravity")
            .unwrap()
            .is_empty());
        assert!(project_servers(&id, Some(&["off".into()]), "codex").is_err());
        assert!(config_path("project:../escape").is_err());
        let invalid = parse_server_spec(
            "x",
            &json!({"url":"https://example.invalid", "bearer_token_env_var":"BAD}TOKEN"}),
            "codex",
        );
        assert!(validate(&invalid).is_err());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn discovery_is_native_only_and_rejects_unsupported_adapters() {
        let id = uuid::Uuid::new_v4().to_string();
        let scope = format!("project:{id}");
        let path = config_path(&scope).unwrap();
        let server = parse_server_spec(
            "tools",
            &json!({"command":"node","jackalopeDiscovery":true}),
            &scope,
        );
        assert!(server.discovery);
        assert_eq!(spec(&server, &scope)["jackalopeDiscovery"], true);
        assert!(spec(&server, "codex").get("jackalopeDiscovery").is_none());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            json!({"mcpServers":{"tools":spec(&server,&scope)}}).to_string(),
        )
        .unwrap();
        for adapter in ["codex", "claude", "grok", "antigravity"] {
            let (direct, optimized) =
                project_delivery(&id, Some(&["tools".into()]), adapter).unwrap();
            assert!(direct.is_empty());
            assert_eq!(optimized.len(), 1);
            assert!(project_delivery(&id, Some(&[]), adapter)
                .unwrap()
                .1
                .is_empty());
        }
        assert!(project_delivery(&id, Some(&["tools".into()]), "opencode").is_err());
        assert!(project_delivery(&id, Some(&[]), "opencode")
            .unwrap()
            .1
            .is_empty());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn preserves_toml_settings_and_exact_ids() {
        let dir = std::env::temp_dir().join(format!("jackalope-mcp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        fs::write(&path, "# keep this\nmodel = 'my-model'\n[mcp_servers.existing]\nurl = 'https://example.com/mcp'\n").unwrap();
        let edited = edit_config(
            &path,
            "new.server",
            Some(json!({"command":"test","args":["path with spaces"]})),
        )
        .unwrap();
        assert!(edited.contains("# keep this"));
        fs::write(&path, edited).unwrap();
        let (_, parsed) = read_config(&path).unwrap();
        assert_eq!(parsed["model"], "my-model");
        assert!(parsed["mcp_servers"]["existing"].is_object());
        assert_eq!(
            parsed["mcp_servers"]["new.server"]["args"][0],
            "path with spaces"
        );
        fs::write(&path, "invalid toml = [").unwrap();
        assert!(edit_config(&path, "x", None).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "invalid toml = [");
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn stdio_requires_handshake_and_lists_real_tools() {
        let script = r#"require('readline').createInterface({input:process.stdin}).on('line', line => { const q=JSON.parse(line); if(q.method==='initialize') console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}})); if(q.method==='tools/list') console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{tools:[{name:'fixture_tool',description:'Fixture',inputSchema:{type:'object'}}]}})); });"#;
        let server = parse_server_spec(
            "fixture",
            &json!({"command":"node", "args":["-e", script]}),
            "global",
        );
        let result = mcp_probe_server(server).await.unwrap();
        assert!(result.ok, "{:?}", result.error);
        assert_eq!(result.tools[0].name, "fixture_tool");
        let bad = parse_server_spec(
            "fixture",
            &json!({"command":"node", "args":["-e", "process.exit(0)"]}),
            "global",
        );
        assert!(!mcp_probe_server(bad).await.unwrap().ok);
    }

    #[tokio::test]
    async fn unreachable_http_is_not_connected() {
        let server = parse_server_spec("test", &json!({"url":"http://127.0.0.1:1/mcp"}), "global");
        assert!(!mcp_probe_server(server).await.unwrap().ok);
    }
}

pub(super) fn project_delivery(
    project_id: &str,
    selection: Option<&[String]>,
    adapter: &str,
) -> Result<(serde_json::Map<String, Value>, Vec<McpServerConfig>), String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let scope = format!("project:{project_id}");
    let path = config_path(&scope)?;
    let (_, root) = read_config(&path)?;
    let mut result = serde_json::Map::new();
    let mut optimized = Vec::new();
    let mut selected = std::collections::HashSet::new();
    if let Some(servers) = root["mcpServers"].as_object() {
        for (id, value) in servers {
            if selection.is_some_and(|ids| !ids.contains(id)) || value["enabled"] == false {
                continue;
            }
            if id == "jackalope" {
                return Err("The jackalope server name is reserved for task coordination.".into());
            }
            let server = parse_server_spec(id, value, &scope);
            validate(&server)?;
            selected.insert(id.clone());
            if adapter == "opencode" {
                return Err("OpenCode does not support project-selected MCP connections yet. Use its own CLI configuration or choose another agent.".into());
            }
            if server.discovery {
                optimized.push(server);
                continue;
            }
            if adapter == "antigravity" {
                return Err("Antigravity supports project connections through on-demand discovery. Enable on-demand discovery for this connection, use its own CLI MCP configuration, or choose another agent.".into());
            }
            if adapter == "grok" || (adapter == "codex" && server.transport == "sse") {
                return Err("This agent does not support the selected project MCP transport. Choose Claude or a compatible Codex connection.".into());
            }
            result.insert(id.clone(), spec(&server, adapter));
        }
    }
    if selection.is_some_and(|ids| ids.iter().any(|id| !selected.contains(id))) {
        return Err("A selected project connection is disabled or missing. Review the task's tools before starting.".into());
    }
    Ok((result, optimized))
}

#[cfg(test)]
fn project_servers(
    project_id: &str,
    selection: Option<&[String]>,
    adapter: &str,
) -> Result<serde_json::Map<String, Value>, String> {
    project_delivery(project_id, selection, adapter).map(|(direct, _)| direct)
}

pub(super) fn codex_overrides(
    servers: &serde_json::Map<String, Value>,
) -> Result<Vec<String>, String> {
    if servers.is_empty() {
        return Ok(vec![]);
    }
    // CLI override keys split on dots without TOML unquoting; quote IDs inside the value instead.
    let value = toml::Value::try_from(servers).map_err(|e| e.to_string())?;
    Ok(vec![format!("mcp_servers={value}")])
}

#[tauri::command]
pub async fn mcp_authenticate(
    id: String,
    scope: String,
    agent: String,
    profile_id: Option<String>,
    runtime: tauri::State<'_, super::tasks::TaskRuntime>,
) -> Result<(), String> {
    if !["codex", "claude"].contains(&agent.as_str()) {
        return Err("Choose Codex or Claude for connection sign-in.".into());
    }
    let server = {
        let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
        let path = config_path(&scope)?;
        let (_, root) = read_config(&path)?;
        let value = &root[servers_key(&path)][&id];
        if !value.is_object() {
            return Err("Save this connection before signing in.".into());
        }
        parse_server_spec(&id, value, &scope)
    };
    validate(&server)?;
    if server.transport != "http" {
        return Err("Interactive authorization requires a Streamable HTTP connection.".into());
    }
    let binding = super::agent_profiles::bind_account(
        &runtime.profiles_root(),
        &agent,
        profile_id.as_deref(),
    )?;
    let (_, executable) = runtime.policy()?.resolve(&agent)?;
    let mut command = std::process::Command::new(executable);
    command.env(
        super::agent_profiles::env_var_for(&agent).ok_or("Unsupported account profile")?,
        binding.directory,
    );
    let mut servers = serde_json::Map::new();
    servers.insert(id.clone(), spec(&server, &agent));
    if agent == "codex" {
        for value in codex_overrides(&servers)? {
            command.args(["-c", &value]);
        }
        command.args(["mcp", "login", &id]);
    } else {
        command.args([
            "--mcp-config",
            &json!({"mcpServers":servers}).to_string(),
            "/mcp",
        ]);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000010);
        command
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open connection sign-in: {e}"))
    }
    #[cfg(not(windows))]
    {
        Err("Open your agent CLI's MCP sign-in flow in a terminal on this platform.".into())
    }
}
