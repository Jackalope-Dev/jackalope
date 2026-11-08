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

mod delivery;
mod storage;
pub(super) use delivery::{acp_servers, command_env, opencode_server};

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
    pub managed: bool,
    #[serde(default)]
    pub agents: Option<Vec<String>>,
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
    let home = super::platform::home_dir().ok_or("Home directory unavailable")?;
    if let Some(path) = super::agents::find(scope).and_then(|agent| agent.mcp_config(&home)) {
        return Ok(path);
    }
    match scope {
        "global" => Ok(home.join(".jackalope/mcp_servers.json")),
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

/// Where an unmanaged global connection is written: Jackalope's own file and
/// every agent configuration Jackalope edits.
fn mirror_scopes() -> Vec<&'static str> {
    std::iter::once("global")
        .chain(
            super::agents::all()
                .iter()
                .filter(|agent| agent.has_mcp_config())
                .map(|agent| agent.id.as_str()),
        )
        .collect()
}

fn read_config(path: &Path) -> Result<(String, Value), String> {
    let text = if storage::owned(path) {
        storage::read(path)?
    } else {
        match fs::read_to_string(path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }
    };
    let value = if text.is_empty() {
        json!({})
    } else if path.extension().is_some_and(|e| e == "toml") {
        let parsed: toml::Value = toml::from_str(&text).map_err(|_| {
            format!(
                "Invalid TOML configuration in {}. Check its syntax; the original was preserved.",
                path.display()
            )
        })?;
        serde_json::to_value(parsed).map_err(|e| e.to_string())?
    } else {
        serde_json::from_str(&text).map_err(|_| {
            format!(
                "Invalid JSON configuration in {}. Check its syntax; the original was preserved.",
                path.display()
            )
        })?
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
        "jackalopeManaged",
        "jackalopeAgents",
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
        managed: spec["jackalopeManaged"].as_bool().unwrap_or(false),
        agents: serde_json::from_value(spec["jackalopeAgents"].clone()).unwrap_or(None),
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
        if server.managed {
            value["jackalopeManaged"] = json!(true);
        }
        if let Some(agents) = &server.agents {
            value["jackalopeAgents"] = json!(agents);
        }
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
        let mut doc = text.parse::<toml_edit::DocumentMut>().map_err(|_| {
            "Invalid MCP TOML configuration. Check its syntax; the original was preserved."
        })?;
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
    if storage::owned(path) {
        return storage::write(path, text);
    }
    fs::create_dir_all(path.parent().ok_or("Invalid config path")?).map_err(|e| e.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, text).map_err(|e| e.to_string())?;
    if path.exists() {
        fs::copy(path, path.with_extension("jackalope-backup")).map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

fn validate_endpoint(value: &str) -> Result<(), String> {
    let valid = reqwest::Url::parse(value).ok().is_some_and(|url| {
        let local = url.host_str().is_some_and(|host| {
            host == "localhost"
                || host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
        url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && (url.scheme() == "https" || (url.scheme() == "http" && local))
    });
    if valid {
        Ok(())
    } else {
        Err("Use an HTTPS endpoint. HTTP is only allowed on this computer (localhost or a loopback IP), without URL credentials or fragments.".into())
    }
}

fn validate(server: &McpServerConfig) -> Result<(), String> {
    if server.agents.as_ref().is_some_and(|agents| {
        agents.is_empty() || agents.iter().any(|agent| !super::agents::is_builtin(agent))
    }) {
        return Err("Select at least one supported agent.".into());
    }
    if server.managed && server.scope != "global" && !server.scope.starts_with("project:") {
        return Err("Managed connections require global or project scope.".into());
    }

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
        validate_endpoint(server.url.as_deref().unwrap_or_default())?;
    } else {
        return Err("Unsupported MCP transport.".into());
    }
    Ok(())
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::mcp::mcp_authenticate,
            commands::mcp::mcp_list_servers,
            commands::mcp::mcp_save_server,
            commands::mcp::mcp_delete_server,
            commands::mcp::mcp_probe_server,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

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
                    Some(text) if storage::owned(path) => storage::write(path, text),
                    Some(text) => fs::write(path, text).map_err(|error| error.to_string()),
                    None if storage::owned(path) => super::account_storage::remove(path),
                    None => fs::remove_file(path).map_err(|error| error.to_string()),
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
    let scopes = if server.scope == "global" && !server.managed {
        mirror_scopes()
    } else {
        vec![server.scope.as_str()]
    };
    let mut writes = Vec::new();
    let previous_global = if server.scope == "global" {
        Some(read_config(&config_path("global")?)?.1["mcpServers"][&server.id].clone())
    } else {
        None
    };
    if server.managed
        && previous_global
            .as_ref()
            .is_some_and(|value| !value.is_null() && value["jackalopeManaged"] != true)
    {
        return Err("This identifier belongs to an existing global client configuration. Edit that connection or choose a different identifier.".into());
    }
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
            Some(read_config(&path)?.0)
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
    let scopes = if scope == "global" && original_spec["jackalopeManaged"] != true {
        mirror_scopes()
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
            if let Some(found) = super::platform::find_executable(program, &[]) {
                executable = found;
            }
        }
        let mut command = tokio::process::Command::new(executable);
        command
            .args(&server.args)
            .envs(&server.env)
            .kill_on_drop(true);
        super::process_control::isolated(command.as_std_mut());
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

pub(super) fn project_delivery(
    project_id: &str,
    selection: Option<&[String]>,
    adapter: &str,
) -> Result<(serde_json::Map<String, Value>, Vec<McpServerConfig>), String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let scope = format!("project:{project_id}");
    let (_, global) = read_config(&config_path("global")?)?;
    let project = if project_id.is_empty() {
        json!({})
    } else {
        read_config(&config_path(&scope)?)?.1
    };
    delivery_from_configs(&scope, &global, &project, selection, adapter)
}

fn delivery_from_configs(
    scope: &str,
    global: &Value,
    project: &Value,
    selection: Option<&[String]>,
    adapter: &str,
) -> Result<(serde_json::Map<String, Value>, Vec<McpServerConfig>), String> {
    let mut entries = global["mcpServers"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    entries.retain(|_, value| value["jackalopeManaged"] == true);
    let mut project_ids = std::collections::HashSet::new();
    for (id, value) in project["mcpServers"].as_object().into_iter().flatten() {
        project_ids.insert(id.clone());
        entries.insert(id.clone(), value.clone());
    }
    let mut result = serde_json::Map::new();
    let mut optimized = Vec::new();
    let mut selected = std::collections::HashSet::new();
    {
        for (id, value) in &entries {
            if (project_ids.contains(id) && selection.is_some_and(|ids| !ids.contains(id)))
                || value["enabled"] == false
            {
                continue;
            }
            if id == "jackalope" {
                return Err("The jackalope server name is reserved for task coordination.".into());
            }
            let server = parse_server_spec(
                id,
                value,
                if project_ids.contains(id) {
                    &scope
                } else {
                    "global"
                },
            );
            if server
                .agents
                .as_ref()
                .is_some_and(|agents| !agents.iter().any(|agent| agent == adapter))
            {
                continue;
            }
            validate(&server)?;
            selected.insert(id.clone());
            if server.discovery {
                optimized.push(server);
                continue;
            }
            if !super::agents::find(adapter)
                .is_some_and(|agent| agent.capabilities.direct.contains(&server.transport))
            {
                return Err("This agent requires on-demand discovery for this project connection. Enable on-demand tools, or choose an agent supporting its direct transport.".into());
            }
            result.insert(id.clone(), spec(&server, adapter));
        }
    }
    if selection.is_some_and(|ids| ids.iter().any(|id| !selected.contains(id))) {
        return Err("A selected project connection is disabled or missing. Review the task's tools before starting.".into());
    }
    Ok((result, optimized))
}

/// A selected connection an agent on a computer does not receive, or receives
/// another way than intended, and why.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Withheld {
    pub name: String,
    pub reason: String,
}

const WITHHELD_DIRECT: &str = "it is delivered directly to the agent, and its command, environment and sign-ins exist only on this device; turn on on-demand tools for it to use it on a computer";
const USES_WORKSPACE: &str =
    "and it uses the workspace, whose copy on this device is not the one the agent edits";
const RUNS_HERE: &str = "it does not use the workspace, so it runs on this device";

/// A selected stdio connection that runs on the computer, in the workspace the
/// agent edits. `env` and `args` hold values resolved on this device, which
/// can be credentials: they travel with the run the way project secrets do,
/// and [`Debug`] names the variables without their values.
#[derive(Clone, PartialEq)]
pub(crate) struct ComputerConnection {
    /// Its name in the agent's MCP configuration.
    pub key: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

impl std::fmt::Debug for ComputerConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ComputerConnection")
            .field("key", &self.key)
            .field("name", &self.name)
            .field("command", &self.command)
            .field("args", &self.args.len())
            .field(
                "env",
                &self.env.iter().map(|(name, _)| name).collect::<Vec<_>>(),
            )
            .finish()
    }
}

/// What a computer's attempt is: whether it is read-only, the paths that name
/// its workspace on this device (the attempt's workspace and the project
/// folder), and the project secrets available to computers.
pub(super) struct RemoteContext<'a> {
    pub read_only: bool,
    pub roots: &'a [&'a Path],
    pub secrets: &'a [(String, String)],
}

/// How an attempt's selected connections reach an agent on a computer.
#[derive(Debug, Default)]
pub(super) struct RemoteDelivery {
    /// On-demand connections the broker on this device runs, reached through
    /// the bridge relay.
    pub broker: Vec<McpServerConfig>,
    /// Stdio connections that run on the computer.
    pub computer: Vec<ComputerConnection>,
    /// Stdio connections that cannot run on the computer and run in the
    /// broker instead, because they do not use the workspace.
    pub on_device: Vec<Withheld>,
    pub withheld: Vec<Withheld>,
}

/// Programs a computer has or installs when a run starts (see
/// `resources/computer/agent.py`): Node.js, Python, uv, Git and the shell.
const COMPUTER_RUNTIMES: &[&str] = &[
    "npx", "node", "npm", "python3", "python", "uvx", "uv", "git", "sh", "bash",
];
/// Programs a computer cannot run: containers need a daemon the sandbox does
/// not have, and Windows shells do not exist on Linux.
const HOST_ONLY: &[(&str, &str)] = &[
    ("docker", "Docker is not available on computers"),
    ("podman", "Podman is not available on computers"),
    ("cmd", "cmd is a Windows program"),
    ("powershell", "PowerShell is not available on computers"),
    ("pwsh", "PowerShell is not available on computers"),
];
/// Words in a command or its arguments that mark a server working on files
/// or a repository, so it must see the copy the agent edits.
const WORKSPACE_WORDS: &[&str] = &[
    "filesystem",
    "files",
    "file",
    "fs",
    "git",
    "serena",
    "lsp",
    "workspace",
    "repo",
    "repository",
    "codebase",
    "shell",
    "terminal",
    "commander",
];

/// Narrows an attempt's connections for an agent on a computer.
///
/// Direct entries (project or managed all-project ones) carry this device's
/// commands, environment references and CLI sign-ins, so none are sent there.
/// On-demand HTTP connections stay with the broker on this device, so their
/// credentials and OAuth never leave it, and reach the agent through the
/// bridge relay. A stdio connection of a read-only attempt also stays there:
/// this device's copy of the workspace matches the computer's. A writing
/// attempt's stdio connection runs on the computer in the workspace the agent
/// edits; when its program cannot run there it falls back to the broker only
/// if it does not use the workspace, and is withheld otherwise.
pub(super) fn remote_delivery(
    direct: &serde_json::Map<String, Value>,
    on_demand: Vec<McpServerConfig>,
    context: &RemoteContext,
) -> RemoteDelivery {
    let mut delivery = RemoteDelivery {
        withheld: direct
            .keys()
            .map(|id| Withheld {
                name: id.clone(),
                reason: WITHHELD_DIRECT.into(),
            })
            .collect(),
        ..RemoteDelivery::default()
    };
    let mut keys = std::collections::HashSet::new();
    for server in on_demand {
        if server.transport != "stdio" || context.read_only {
            delivery.broker.push(server);
            continue;
        }
        match computer_connection(&server, context, &mut keys) {
            Ok(connection) => delivery.computer.push(connection),
            Err(reason) if !touches_workspace(&server, context.roots) => {
                delivery.on_device.push(Withheld {
                    name: server.name.clone(),
                    reason: format!("{reason}; {RUNS_HERE}"),
                });
                delivery.broker.push(server);
            }
            Err(reason) => delivery.withheld.push(Withheld {
                name: server.name.clone(),
                reason: format!("{reason}, {USES_WORKSPACE}"),
            }),
        }
    }
    delivery
}

/// The connection as it runs on the computer, or why it cannot.
fn computer_connection(
    server: &McpServerConfig,
    context: &RemoteContext,
    keys: &mut std::collections::HashSet<String>,
) -> Result<ComputerConnection, String> {
    let command = computer_command(server.command.as_deref().unwrap_or_default())?;
    let args = server
        .args
        .iter()
        .map(|arg| computer_value(arg, context))
        .collect::<Result<Vec<_>, _>>()?;
    let mut env: Vec<(String, String)> = Vec::new();
    for (name, value) in &server.env {
        if !environment_name(name) {
            return Err(format!(
                "its environment variable {} has a name computers cannot use",
                name.chars().take(60).collect::<String>()
            ));
        }
        env.push((name.clone(), computer_value(value, context)?));
    }
    env.sort();
    Ok(ComputerConnection {
        key: connection_key(&server.id, keys),
        name: server.name.clone(),
        command,
        args,
        env,
    })
}

/// The program name to run on the computer: a runtime it has, written without
/// a Windows extension. Paths and other programs exist only on this device.
fn computer_command(command: &str) -> Result<String, String> {
    let command = command.trim();
    if command.contains(['/', '\\']) || command.contains(':') {
        return Err("its command is a program on this device".into());
    }
    let lower = command.to_ascii_lowercase();
    let stem = [".exe", ".cmd", ".bat", ".ps1"]
        .iter()
        .find_map(|extension| lower.strip_suffix(extension))
        .unwrap_or(&lower);
    if let Some((_, reason)) = HOST_ONLY.iter().find(|(name, _)| *name == stem) {
        return Err((*reason).into());
    }
    COMPUTER_RUNTIMES
        .iter()
        .find(|runtime| **runtime == stem)
        .map(|runtime| (*runtime).to_string())
        .ok_or_else(|| {
            format!(
                "{} is not installed on computers, which run npx, uvx, python3 and node",
                command.chars().take(60).collect::<String>()
            )
        })
}

/// One argument or environment value for the computer. A path inside the
/// workspace on this device becomes the same path relative to the computer's
/// workspace, `${NAME}` is filled from the project secrets available to
/// computers, and other paths on this device cannot be used there.
fn computer_value(value: &str, context: &RemoteContext) -> Result<String, String> {
    let mut rest = relative_to_workspace(value, context.roots).unwrap_or_else(|| value.into());
    let mut value = String::new();
    while let Some(start) = rest.find("${") {
        let end = rest[start..]
            .find('}')
            .map(|end| start + end)
            .ok_or("its environment has an unfinished ${...} reference")?;
        let name = &rest[start + 2..end];
        let secret = context
            .secrets
            .iter()
            .find(|(secret, _)| secret == name)
            .map(|(_, secret)| secret.as_str())
            .ok_or_else(|| {
                format!(
                    "it needs {}, which is not a project secret available to computers",
                    name.chars().take(60).collect::<String>()
                )
            })?;
        value.push_str(&rest[..start]);
        value.push_str(secret);
        rest = rest[end + 1..].to_string();
    }
    value.push_str(&rest);
    if value.len() > 100_000 {
        return Err("its environment is too large to send".into());
    }
    if crate::commands::computers::runs::looks_local(&value) {
        return Err("it refers to a file on this device".into());
    }
    Ok(value)
}

/// `value` as a path relative to the workspace, when it names the workspace
/// or a path inside it on this device.
fn relative_to_workspace(value: &str, roots: &[&Path]) -> Option<String> {
    let normal = |text: &str| {
        let text = text.replace('\\', "/");
        let text = text.trim_end_matches('/').to_string();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text
        }
    };
    let candidate = normal(value);
    let original = value.replace('\\', "/");
    roots.iter().find_map(|root| {
        let root = normal(&root.to_string_lossy());
        if root.is_empty() {
            return None;
        }
        if candidate == root {
            return Some(".".into());
        }
        let inside = candidate.strip_prefix(&format!("{root}/"))?;
        // Keeps the original letter case where lowercasing kept lengths.
        let rest = original.get(root.len() + 1..).unwrap_or(inside);
        Some(format!("./{}", rest.trim_end_matches('/')))
    })
}

fn environment_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .enumerate()
            .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit()))
}

/// A name for the connection in the agent's MCP configuration: its ID with
/// only letters, digits, `-` and `_`, unique and never `jackalope`.
fn connection_key(id: &str, keys: &mut std::collections::HashSet<String>) -> String {
    let base: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(40)
        .collect();
    let base = if base.is_empty() || base == "jackalope" {
        format!("connection_{base}")
    } else {
        base
    };
    let mut key = base.clone();
    let mut index = 2;
    while !keys.insert(key.clone()) {
        key = format!("{base}_{index}");
        index += 1;
    }
    key
}

/// Whether a stdio connection works on files: an argument or value names the
/// workspace or a relative path, or its command names a file, repository or
/// shell server.
fn touches_workspace(server: &McpServerConfig, roots: &[&Path]) -> bool {
    let values = || server.args.iter().chain(server.env.values());
    let relative = values().any(|value| {
        let value = value.trim();
        value == "."
            || value == ".."
            || ["./", "../", ".\\", "..\\"]
                .iter()
                .any(|prefix| value.starts_with(prefix))
            || value.contains("${workspaceFolder}")
            || value.contains("$PWD")
            || relative_to_workspace(value, roots).is_some()
    });
    relative
        || std::iter::once(server.command.as_deref().unwrap_or_default())
            .chain(server.args.iter().map(String::as_str))
            .flat_map(|text| text.split(|c: char| !c.is_ascii_alphanumeric()))
            .any(|word| WORKSPACE_WORDS.contains(&word.to_ascii_lowercase().as_str()))
}

/// One line naming each withheld connection with its reason.
pub(super) fn withheld_summary(withheld: &[Withheld]) -> String {
    withheld
        .iter()
        .map(|item| format!("{} ({})", item.name, item.reason))
        .collect::<Vec<_>>()
        .join("; ")
}

/// Resolves one enabled connection a project's tasks would receive: its own or a managed global one.
pub(super) fn resolve_connection(
    project_id: &str,
    connection_id: &str,
) -> Result<McpServerConfig, String> {
    let _guard = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let scope = format!("project:{project_id}");
    let project = read_config(&config_path(&scope)?)?.1;
    let global = read_config(&config_path("global")?)?.1;
    let (value, scope) = match project["mcpServers"].get(connection_id) {
        Some(value) => (value.clone(), scope),
        None => (
            global["mcpServers"]
                .get(connection_id)
                .filter(|value| value["jackalopeManaged"] == true)
                .cloned()
                .ok_or("This connection is no longer set up for the project.")?,
            "global".to_owned(),
        ),
    };
    if value["enabled"] == false {
        return Err("This connection is turned off.".into());
    }
    let server = parse_server_spec(connection_id, &value, &scope);
    validate(&server)?;
    Ok(server)
}

fn tool_allowed(server: &McpServerConfig, name: &str) -> bool {
    let listed = |key: &str| {
        server
            .extra
            .get(key)
            .and_then(Value::as_array)
            .map(|list| list.iter().any(|item| item.as_str() == Some(name)))
    };
    listed("enabled_tools").unwrap_or(true) && !listed("disabled_tools").unwrap_or(false)
}

/// Tools a connection marks read-only, the only ones a bot wake-up may poll.
pub(super) async fn read_only_tools(server: &McpServerConfig) -> Result<Vec<McpToolInfo>, String> {
    let future = async {
        let client = connect(server, None, None).await?;
        let result = client.list_all_tools().await.map_err(|e| e.to_string());
        client.cancel().await;
        result
    };
    let tools = tokio::time::timeout(Duration::from_secs(20), future)
        .await
        .map_err(|_| "The connection did not list its tools within 20 seconds.".to_string())??;
    Ok(tools
        .into_iter()
        .filter(|tool| super::mcp_broker::is_read_only(tool) && tool_allowed(server, &tool.name))
        .map(|tool| McpToolInfo {
            name: tool.name.to_string(),
            description: tool.description.map(|value| value.to_string()),
            input_schema: Some(json!(tool.input_schema)),
        })
        .collect())
}

/// Calls one read-only tool and returns its result. Tools without a read-only annotation are refused.
pub(super) async fn read_tool_once(
    server: &McpServerConfig,
    tool: &str,
    arguments: serde_json::Map<String, Value>,
) -> Result<rmcp::model::CallToolResult, String> {
    if !tool_allowed(server, tool) {
        return Err("This tool is excluded by the connection's tool list.".into());
    }
    let future = async {
        let client = connect(server, None, None).await?;
        let outcome = async {
            let tools = client.list_all_tools().await.map_err(|e| e.to_string())?;
            let found = tools
                .iter()
                .find(|item| item.name == tool)
                .ok_or("The connection no longer offers this tool.")?;
            if !super::mcp_broker::is_read_only(found) {
                return Err("Only tools the connection marks read-only can be watched.".into());
            }
            let request: rmcp::model::CallToolRequestParams =
                serde_json::from_value(json!({"name": tool, "arguments": arguments}))
                    .map_err(|_| "Invalid tool arguments.".to_string())?;
            client.call_tool(request).await.map_err(|e| e.to_string())
        }
        .await;
        client.cancel().await;
        outcome
    };
    tokio::time::timeout(Duration::from_secs(60), future)
        .await
        .map_err(|_| "The connection did not answer within 60 seconds.".to_string())?
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

/// The arguments that open `agent`'s interactive sign-in to connection `id`,
/// one of `servers`.
fn sign_in_args(
    agent: &str,
    id: &str,
    servers: &serde_json::Map<String, Value>,
) -> Result<Vec<String>, String> {
    match agent {
        "codex" => {
            let mut args = Vec::new();
            for value in codex_overrides(servers)? {
                args.extend(["-c".to_string(), value]);
            }
            args.extend(["mcp".to_string(), "login".to_string(), id.to_string()]);
            Ok(args)
        }
        "claude" => Ok(vec![
            "--mcp-config".into(),
            json!({ "mcpServers": servers }).to_string(),
            "/mcp".into(),
        ]),
        _ => Err(format!(
            "{} has no connection sign-in.",
            super::agents::name(agent)
        )),
    }
}

#[tauri::command]
pub async fn mcp_authenticate(
    id: String,
    scope: String,
    agent: String,
    profile_id: Option<String>,
    runtime: tauri::State<'_, super::tasks::TaskRuntime>,
) -> Result<(), String> {
    if !super::agents::find(&agent).is_some_and(|agent| agent.mcp_sign_in) {
        return Err(format!(
            "Choose {} for connection sign-in.",
            super::agents::names(
                super::agents::all()
                    .iter()
                    .filter(|agent| agent.mcp_sign_in),
                "or"
            )
        ));
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
    command.args(sign_in_args(&agent, &id, &servers)?);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_agent_with_connection_sign_in_has_its_arguments() {
        for agent in crate::commands::agents::all() {
            assert_eq!(
                sign_in_args(&agent.id, "docs", &serde_json::Map::new()).is_ok(),
                agent.mcp_sign_in,
                "{}",
                agent.id
            );
        }
    }

    #[test]
    fn endpoint_validation_requires_tls_outside_loopback() {
        for value in [
            "https://example.invalid/mcp",
            "http://localhost:8787/mcp",
            "http://127.0.0.1:8080",
            "http://[::1]:8080",
            "http://127.2.3.4",
        ] {
            assert!(validate_endpoint(value).is_ok(), "{value}");
        }
        for value in [
            "http://example.invalid",
            "http://192.168.1.1",
            "http://localhost.example.invalid",
            "http://0.0.0.0",
            "https://user:secret@example.invalid",
            "https://example.invalid/#token",
            "file:///mcp",
            "not a url",
        ] {
            assert!(validate_endpoint(value).is_err(), "{value}");
        }
    }
    #[test]
    fn managed_connections_preserve_location_agent_selection_and_legacy_clients() {
        let global = json!({"mcpServers": {
            "shared": {"command":"unused", "jackalopeManaged":true, "jackalopeDiscovery":true},
            "codex-only": {"command":"unused", "jackalopeManaged":true, "jackalopeAgents":["codex"], "jackalopeDiscovery":true},
            "legacy": {"command":"unused"}
        }});
        let project = json!({"mcpServers": {"local": {"command":"unused", "jackalopeAgents":["claude"], "jackalopeDiscovery":true}}});
        let (_, mut codex) =
            delivery_from_configs("project:test", &global, &project, None, "codex").unwrap();
        codex.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(
            codex
                .iter()
                .map(|server| server.id.as_str())
                .collect::<Vec<_>>(),
            vec!["codex-only", "shared"]
        );
        let (_, claude) =
            delivery_from_configs("project:test", &global, &project, None, "claude").unwrap();
        assert_eq!(claude.len(), 2);
        assert!(claude.iter().any(|server| server.id == "local"));
        let (_, selected) =
            delivery_from_configs("project:test", &global, &project, Some(&[]), "claude").unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].id, "shared");
        assert!(delivery_from_configs(
            "project:test",
            &global,
            &project,
            Some(&["local".into()]),
            "codex"
        )
        .is_err());
        let spec = spec(&codex[0], "global");
        assert_eq!(
            parse_server_spec("codex-only", &spec, "global").agents,
            Some(vec!["codex".into()])
        );
        assert!(spec.get("jackalopeManaged").is_some());
        assert!(super::spec(&codex[0], "codex")
            .get("jackalopeAgents")
            .is_none());
    }
    #[test]
    fn project_delivery_preserves_selection_and_adapter_authentication() {
        let global = json!({});
        let project = json!({"mcpServers": {
            "test.server": {"url":"https://example.invalid/mcp", "bearer_token_env_var":"TEST_TOKEN"},
            "off": {"command":"unused", "enabled":false}
        }});
        let servers = |selected: &[String], adapter: &str| {
            delivery_from_configs("project:test", &global, &project, Some(selected), adapter)
                .map(|(direct, _)| direct)
        };
        let selected = vec!["test.server".to_string()];
        let codex = servers(&selected, "codex").unwrap();
        assert_eq!(codex["test.server"]["bearer_token_env_var"], "TEST_TOKEN");
        let overrides = codex_overrides(&codex).unwrap();
        assert_eq!(overrides.len(), 1);
        assert_eq!(overrides[0].split_once('=').unwrap().0, "mcp_servers");
        let parsed: toml::Value = toml::from_str(&overrides.join("\n")).unwrap();
        assert_eq!(
            parsed["mcp_servers"]["test.server"]["url"].as_str(),
            Some("https://example.invalid/mcp")
        );
        let claude = servers(&selected, "claude").unwrap();
        assert_eq!(
            claude["test.server"]["headers"]["Authorization"],
            "Bearer ${TEST_TOKEN}"
        );
        assert!(servers(&[], "grok").unwrap().is_empty());
        assert!(servers(&selected, "grok").is_err());
        assert!(servers(&selected, "antigravity")
            .unwrap_err()
            .contains("on-demand discovery"));
        assert!(servers(&[], "antigravity").unwrap().is_empty());
        assert!(servers(&selected, "gemini")
            .unwrap_err()
            .contains("on-demand discovery"));
        assert!(servers(&[], "gemini").unwrap().is_empty());
        assert!(servers(&["off".into()], "codex").is_err());
        assert!(config_path("project:../escape").is_err());
        let invalid = parse_server_spec(
            "x",
            &json!({"url":"https://example.invalid", "bearer_token_env_var":"BAD}TOKEN"}),
            "codex",
        );
        assert!(validate(&invalid).is_err());
    }

    #[test]
    fn computers_receive_only_on_demand_connections_they_can_use() {
        let global = json!({"mcpServers": {
            "composio": {"url":"https://backend.composio.dev/mcp", "jackalopeManaged":true, "jackalopeDiscovery":true},
            "managed-direct": {"command":"local-tool", "jackalopeManaged":true}
        }});
        let project = json!({"mcpServers": {
            "remote-docs": {"name":"Docs", "url":"https://example.invalid/mcp", "jackalopeDiscovery":true},
            "local-files": {"name":"Files", "command":"node", "jackalopeDiscovery":true},
            "direct": {"url":"https://example.invalid/direct", "bearer_token_env_var":"DIRECT_TOKEN"}
        }});
        let selected: Vec<String> = ["remote-docs", "local-files", "direct"]
            .map(String::from)
            .to_vec();
        let (direct, on_demand) =
            delivery_from_configs("project:test", &global, &project, Some(&selected), "claude")
                .unwrap();
        let ids = |servers: &[McpServerConfig]| {
            let mut ids: Vec<String> = servers.iter().map(|s| s.id.clone()).collect();
            ids.sort();
            ids
        };
        let names = |withheld: &[Withheld]| {
            let mut names: Vec<String> = withheld.iter().map(|w| w.name.clone()).collect();
            names.sort();
            names
        };

        let workspace = std::env::temp_dir().join("jackalope-remote-delivery");
        let roots = [workspace.as_path()];
        let writer = RemoteContext {
            read_only: false,
            roots: &roots,
            secrets: &[],
        };
        let delivery = remote_delivery(&direct, on_demand.clone(), &writer);
        assert_eq!(ids(&delivery.broker), ["composio", "remote-docs"]);
        assert_eq!(delivery.computer.len(), 1);
        assert_eq!(delivery.computer[0].name, "Files");
        assert_eq!(delivery.computer[0].command, "node");
        assert_eq!(names(&delivery.withheld), ["direct", "managed-direct"]);
        assert!(delivery
            .withheld
            .iter()
            .all(|w| w.reason == WITHHELD_DIRECT));

        let reader = RemoteContext {
            read_only: true,
            ..writer
        };
        let delivery = remote_delivery(&direct, on_demand, &reader);
        assert_eq!(
            ids(&delivery.broker),
            ["composio", "local-files", "remote-docs"]
        );
        assert!(delivery.computer.is_empty() && delivery.on_device.is_empty());
        assert_eq!(names(&delivery.withheld), ["direct", "managed-direct"]);
        let summary = withheld_summary(&delivery.withheld);
        assert!(summary.contains("direct (it is delivered directly"));
        assert!(!summary.contains("DIRECT_TOKEN"));
    }

    fn stdio(id: &str, command: &str, args: &[&str], env: &[(&str, &str)]) -> McpServerConfig {
        parse_server_spec(
            id,
            &json!({
                "name": id,
                "command": command,
                "args": args,
                "env": env.iter().cloned().collect::<HashMap<_, _>>(),
                "jackalopeDiscovery": true
            }),
            "project:test",
        )
    }

    #[test]
    fn writers_run_stdio_connections_on_the_computer_or_fall_back_precisely() {
        let workspace = std::env::temp_dir().join(format!("jackalope-ws-{}", uuid::Uuid::new_v4()));
        let project = if cfg!(windows) {
            PathBuf::from("C:\\Projects\\Site")
        } else {
            PathBuf::from("/projects/site")
        };
        let roots = [workspace.as_path(), project.as_path()];
        let secrets = vec![("LINEAR_KEY".to_string(), "lin-secret-value".to_string())];
        let context = RemoteContext {
            read_only: false,
            roots: &roots,
            secrets: &secrets,
        };
        let inside = project.join("docs").to_string_lossy().into_owned();
        let windows_key = "C:\\keys\\service.json";
        let on_demand = vec![
            stdio(
                "linear",
                "npx.cmd",
                &["-y", "@linear/mcp"],
                &[("API_KEY", "${LINEAR_KEY}"), ("PLAIN", "saved-credential")],
            ),
            stdio(
                "files",
                "npx",
                &["@modelcontextprotocol/server-filesystem", &inside],
                &[],
            ),
            stdio("fetch", "UVX.EXE", &["mcp-server-fetch"], &[]),
            stdio("search", "docker", &["run", "-i", "search-mcp"], &[]),
            stdio("git", "docker", &["run", "-i", "mcp/git"], &[]),
            stdio("tool.x", "my-local-tool", &[], &[]),
            stdio("keyfile", "npx", &["gcp-mcp"], &[("KEY_FILE", windows_key)]),
            stdio(
                "missing",
                "npx",
                &["needs-secret"],
                &[("TOKEN", "${NOT_SAVED}")],
            ),
            stdio("jackalope-like", "node", &["server.js"], &[]),
        ];
        let delivery = remote_delivery(&serde_json::Map::new(), on_demand, &context);
        let computer: HashMap<&str, &ComputerConnection> = delivery
            .computer
            .iter()
            .map(|c| (c.name.as_str(), c))
            .collect();
        let mut on_computer: Vec<&str> = computer.keys().copied().collect();
        on_computer.sort();
        assert_eq!(on_computer, ["fetch", "files", "jackalope-like", "linear"]);
        let linear = computer["linear"];
        assert_eq!(linear.command, "npx");
        assert_eq!(
            linear.env,
            [
                ("API_KEY".to_string(), "lin-secret-value".to_string()),
                ("PLAIN".to_string(), "saved-credential".to_string())
            ]
        );
        assert_eq!(computer["fetch"].command, "uvx");
        assert_eq!(
            computer["files"].args,
            ["@modelcontextprotocol/server-filesystem", "./docs"]
        );
        // Debug output, which logs can carry, never shows values.
        let debug = format!("{:?}", delivery);
        assert!(!debug.contains("lin-secret-value") && !debug.contains("saved-credential"));
        assert!(debug.contains("API_KEY"));

        // Docker is not on computers: a server without the workspace runs on
        // this device, one with a repository is withheld.
        assert_eq!(
            ids_of(&delivery.broker),
            ["keyfile", "missing", "search", "tool.x"]
        );
        let reason = |list: &[Withheld], name: &str| {
            list.iter()
                .find(|w| w.name == name)
                .map(|w| w.reason.clone())
                .unwrap_or_default()
        };
        assert!(reason(&delivery.on_device, "search").starts_with("Docker is not available"));
        assert!(reason(&delivery.on_device, "search").ends_with(RUNS_HERE));
        assert!(reason(&delivery.on_device, "tool.x").contains("my-local-tool is not installed"));
        assert!(reason(&delivery.on_device, "keyfile").contains("a file on this device"));
        assert!(reason(&delivery.withheld, "git").starts_with("Docker is not available"));
        assert!(reason(&delivery.withheld, "git").ends_with(USES_WORKSPACE));
        // An unresolved secret falls back like any other connection that
        // cannot run there, and names only the missing secret.
        assert!(reason(&delivery.on_device, "missing")
            .contains("NOT_SAVED, which is not a project secret available to computers"));
        let lines = format!(
            "{} {}",
            withheld_summary(&delivery.on_device),
            withheld_summary(&delivery.withheld)
        );
        assert!(!lines.contains("lin-secret-value") && !lines.contains("saved-credential"));
    }

    fn ids_of(servers: &[McpServerConfig]) -> Vec<String> {
        let mut ids: Vec<String> = servers.iter().map(|s| s.id.clone()).collect();
        ids.sort();
        ids
    }

    #[test]
    fn computer_names_and_values_are_safe_for_the_agent_configuration() {
        let mut keys = std::collections::HashSet::new();
        assert_eq!(connection_key("docs.server", &mut keys), "docs_server");
        assert_eq!(connection_key("docs server", &mut keys), "docs_server_2");
        assert_eq!(
            connection_key("jackalope", &mut keys),
            "connection_jackalope"
        );
        assert_eq!(connection_key("", &mut keys), "connection_");
        assert!(computer_command("C:\\tools\\server.exe").is_err());
        assert!(computer_command("/usr/local/bin/server").is_err());
        assert_eq!(computer_command("Python.EXE").unwrap(), "python");
        assert!(computer_command("pwsh").unwrap_err().contains("PowerShell"));
        let secrets = vec![("A".to_string(), "${A}".to_string())];
        let context = RemoteContext {
            read_only: false,
            roots: &[],
            secrets: &secrets,
        };
        // A secret whose value looks like a reference is not expanded again.
        assert_eq!(computer_value("x-${A}-y", &context).unwrap(), "x-${A}-y");
        assert!(computer_value("${A", &context).is_err());
        assert!(environment_name("API_KEY") && !environment_name("1X") && !environment_name("A-B"));
    }

    #[test]
    fn discovery_is_native_only_and_rejects_unsupported_adapters() {
        let scope = "project:test";
        let server = parse_server_spec(
            "tools",
            &json!({"command":"node","jackalopeDiscovery":true}),
            scope,
        );
        assert!(server.discovery);
        assert_eq!(spec(&server, scope)["jackalopeDiscovery"], true);
        assert!(spec(&server, "codex").get("jackalopeDiscovery").is_none());
        let global = json!({});
        let project = json!({"mcpServers":{"tools":spec(&server,scope)}});
        for adapter in [
            "codex",
            "claude",
            "grok",
            "antigravity",
            "gemini",
            "opencode",
        ] {
            let (direct, optimized) =
                delivery_from_configs(scope, &global, &project, Some(&["tools".into()]), adapter)
                    .unwrap();
            assert!(direct.is_empty());
            assert_eq!(optimized.len(), 1);
            assert!(
                delivery_from_configs(scope, &global, &project, Some(&[]), adapter)
                    .unwrap()
                    .1
                    .is_empty()
            );
        }
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
