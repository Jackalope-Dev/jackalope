use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub scope: String, // "global" | "claude" | "codex" | "grok"
    pub transport: String, // "stdio" | "http" | "sse"
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub input_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResult {
    pub ok: bool,
    #[serde(default)]
    pub tools: Vec<McpToolInfo>,
    #[serde(default)]
    pub latency_ms: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn jackalope_mcp_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".jackalope").join("mcp_servers.json"))
}

fn claude_code_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude.json"))
}

fn claude_desktop_config_path() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Claude").join("claude_desktop_config.json"))
    } else if cfg!(target_os = "macos") {
        home_dir().map(|h| h.join("Library/Application Support/Claude/claude_desktop_config.json"))
    } else {
        home_dir().map(|h| h.join(".config/Claude/claude_desktop_config.json"))
    }
}

fn codex_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".codex").join("config.json"))
}

fn load_json_file(path: &Path) -> Option<Value> {
    if !path.exists() {
        return None;
    }
    fs::read_to_string(path).ok().and_then(|c| serde_json::from_str(&c).ok())
}

fn save_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let formatted = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, formatted).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_list_servers() -> Result<Vec<McpServerConfig>, String> {
    let mut results: Vec<McpServerConfig> = Vec::new();
    let mut seen_ids: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();

    // 1. Read Jackalope Global MCP config
    if let Some(path) = jackalope_mcp_path() {
        if let Some(val) = load_json_file(&path) {
            if let Some(servers) = val.get("mcpServers").and_then(|s| s.as_object()) {
                for (id, spec) in servers {
                    let key = (id.clone(), "global".to_string());
                    if seen_ids.insert(key) {
                        results.push(parse_server_spec(id, spec, "global"));
                    }
                }
            } else if let Some(arr) = val.as_array() {
                for item in arr {
                    if let Ok(cfg) = serde_json::from_value::<McpServerConfig>(item.clone()) {
                        let key = (cfg.id.clone(), cfg.scope.clone());
                        if seen_ids.insert(key) {
                            results.push(cfg);
                        }
                    }
                }
            }
        }
    }

    // 2. Read Claude Code ~/.claude.json
    if let Some(path) = claude_code_config_path() {
        if let Some(val) = load_json_file(&path) {
            if let Some(servers) = val.get("mcpServers").and_then(|s| s.as_object()) {
                for (id, spec) in servers {
                    let key = (id.clone(), "claude".to_string());
                    if seen_ids.insert(key) {
                        results.push(parse_server_spec(id, spec, "claude"));
                    }
                }
            }
        }
    }

    // 3. Read Claude Desktop config
    if let Some(path) = claude_desktop_config_path() {
        if let Some(val) = load_json_file(&path) {
            if let Some(servers) = val.get("mcpServers").and_then(|s| s.as_object()) {
                for (id, spec) in servers {
                    let key = (id.clone(), "claude".to_string());
                    if seen_ids.insert(key) {
                        results.push(parse_server_spec(id, spec, "claude"));
                    }
                }
            }
        }
    }

    // 4. Read Codex config
    if let Some(path) = codex_config_path() {
        if let Some(val) = load_json_file(&path) {
            if let Some(servers) = val.get("mcpServers").and_then(|s| s.as_object()) {
                for (id, spec) in servers {
                    let key = (id.clone(), "codex".to_string());
                    if seen_ids.insert(key) {
                        results.push(parse_server_spec(id, spec, "codex"));
                    }
                }
            }
        }
    }

    Ok(results)
}

fn parse_server_spec(id: &str, spec: &Value, scope: &str) -> McpServerConfig {
    let command = spec.get("command").and_then(|c| c.as_str()).map(|s| s.to_string());
    let url = spec.get("url").and_then(|u| u.as_str()).map(|s| s.to_string());
    let transport = if url.is_some() {
        "http".to_string()
    } else {
        "stdio".to_string()
    };

    let args = spec
        .get("args")
        .and_then(|a| a.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    let mut env = HashMap::new();
    if let Some(env_obj) = spec.get("env").and_then(|e| e.as_object()) {
        for (k, v) in env_obj {
            if let Some(val_str) = v.as_str() {
                env.insert(k.clone(), val_str.to_string());
            }
        }
    }

    let description = spec.get("description").and_then(|d| d.as_str()).map(|s| s.to_string());

    McpServerConfig {
        id: id.to_string(),
        name: id.to_string(),
        scope: scope.to_string(),
        transport,
        command,
        args,
        env,
        url,
        description,
        enabled: Some(true),
    }
}

fn to_mcp_spec(server: &McpServerConfig) -> Value {
    if let Some(ref url) = server.url {
        json!({
            "url": url,
            "description": server.description
        })
    } else {
        let mut obj = json!({
            "command": server.command.clone().unwrap_or_default(),
            "args": server.args.clone(),
        });
        if !server.env.is_empty() {
            obj["env"] = serde_json::to_value(&server.env).unwrap_or(json!({}));
        }
        if let Some(ref desc) = server.description {
            obj["description"] = json!(desc);
        }
        obj
    }
}

#[tauri::command]
pub async fn mcp_save_server(server: McpServerConfig) -> Result<(), String> {
    match server.scope.as_str() {
        "global" => {
            let path = jackalope_mcp_path().ok_or_else(|| "Could not determine global config path".to_string())?;
            let mut val = load_json_file(&path).unwrap_or_else(|| json!({ "mcpServers": {} }));
            if !val.is_object() {
                val = json!({ "mcpServers": {} });
            }
            if val.get("mcpServers").is_none() {
                val["mcpServers"] = json!({});
            }
            val["mcpServers"][&server.id] = to_mcp_spec(&server);
            save_json_file(&path, &val)
        }
        "claude" => {
            let path = claude_code_config_path().ok_or_else(|| "Could not determine Claude config path".to_string())?;
            let mut val = load_json_file(&path).unwrap_or_else(|| json!({ "mcpServers": {} }));
            if !val.is_object() {
                val = json!({ "mcpServers": {} });
            }
            if val.get("mcpServers").is_none() {
                val["mcpServers"] = json!({});
            }
            val["mcpServers"][&server.id] = to_mcp_spec(&server);
            save_json_file(&path, &val)?;

            // Also mirror to Claude Desktop config if it exists
            if let Some(desktop_path) = claude_desktop_config_path() {
                if desktop_path.exists() {
                    let mut d_val = load_json_file(&desktop_path).unwrap_or_else(|| json!({ "mcpServers": {} }));
                    if d_val.get("mcpServers").is_none() {
                        d_val["mcpServers"] = json!({});
                    }
                    d_val["mcpServers"][&server.id] = to_mcp_spec(&server);
                    let _ = save_json_file(&desktop_path, &d_val);
                }
            }
            Ok(())
        }
        "codex" => {
            let path = codex_config_path().ok_or_else(|| "Could not determine Codex config path".to_string())?;
            let mut val = load_json_file(&path).unwrap_or_else(|| json!({ "mcpServers": {} }));
            if !val.is_object() {
                val = json!({ "mcpServers": {} });
            }
            if val.get("mcpServers").is_none() {
                val["mcpServers"] = json!({});
            }
            val["mcpServers"][&server.id] = to_mcp_spec(&server);
            save_json_file(&path, &val)
        }
        _ => {
            let path = jackalope_mcp_path().ok_or_else(|| "Could not determine config path".to_string())?;
            let mut val = load_json_file(&path).unwrap_or_else(|| json!({ "mcpServers": {} }));
            if val.get("mcpServers").is_none() {
                val["mcpServers"] = json!({});
            }
            val["mcpServers"][&server.id] = to_mcp_spec(&server);
            save_json_file(&path, &val)
        }
    }
}

#[tauri::command]
pub async fn mcp_delete_server(id: String, scope: String) -> Result<(), String> {
    match scope.as_str() {
        "global" => {
            if let Some(path) = jackalope_mcp_path() {
                if let Some(mut val) = load_json_file(&path) {
                    if let Some(servers) = val.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
                        servers.remove(&id);
                        save_json_file(&path, &val)?;
                    }
                }
            }
            Ok(())
        }
        "claude" => {
            if let Some(path) = claude_code_config_path() {
                if let Some(mut val) = load_json_file(&path) {
                    if let Some(servers) = val.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
                        servers.remove(&id);
                        save_json_file(&path, &val)?;
                    }
                }
            }
            if let Some(desktop_path) = claude_desktop_config_path() {
                if let Some(mut val) = load_json_file(&desktop_path) {
                    if let Some(servers) = val.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
                        servers.remove(&id);
                        let _ = save_json_file(&desktop_path, &val);
                    }
                }
            }
            Ok(())
        }
        "codex" => {
            if let Some(path) = codex_config_path() {
                if let Some(mut val) = load_json_file(&path) {
                    if let Some(servers) = val.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
                        servers.remove(&id);
                        save_json_file(&path, &val)?;
                    }
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn mcp_probe_server(server: McpServerConfig) -> Result<McpProbeResult, String> {
    let start = Instant::now();

    if let Some(ref url) = server.url {
        let client = reqwest_or_ping(url).await;
        let latency = start.elapsed().as_millis() as u64;
        return match client {
            Ok(msg) => Ok(McpProbeResult {
                ok: true,
                tools: vec![],
                latency_ms: Some(latency),
                error: if msg.is_empty() { None } else { Some(msg) },
            }),
            Err(e) => Ok(McpProbeResult {
                ok: false,
                tools: vec![],
                latency_ms: Some(latency),
                error: Some(e),
            }),
        };
    }

    let command_name = match &server.command {
        Some(cmd) if !cmd.trim().is_empty() => cmd.trim(),
        _ => {
            return Ok(McpProbeResult {
                ok: false,
                tools: vec![],
                latency_ms: Some(0),
                error: Some("No command specified for stdio MCP server".to_string()),
            });
        }
    };

    let mut cmd = Command::new(command_name);
    cmd.args(&server.args);
    cmd.envs(&server.env);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Ok(McpProbeResult {
                ok: false,
                tools: vec![],
                latency_ms: Some(start.elapsed().as_millis() as u64),
                error: Some(format!("Failed to spawn process '{command_name}': {e}")),
            });
        }
    };

    let mut stdin = child.stdin.take().ok_or_else(|| "Failed to open child stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Failed to open child stdout".to_string())?;
    let mut reader = BufReader::new(stdout).lines();

    let timeout_duration = Duration::from_secs(5);

    let probe_future = async {
        let init_req = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "Jackalope",
                    "version": "0.1.0"
                }
            }
        });
        let mut init_line = serde_json::to_string(&init_req).map_err(|e| e.to_string())?;
        init_line.push('\n');
        stdin.write_all(init_line.as_bytes()).await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;

        let _init_resp = reader.next_line().await.map_err(|e| e.to_string())?;

        let notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        let mut notif_line = serde_json::to_string(&notif).map_err(|e| e.to_string())?;
        notif_line.push('\n');
        stdin.write_all(notif_line.as_bytes()).await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;

        let tools_req = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        });
        let mut tools_line = serde_json::to_string(&tools_req).map_err(|e| e.to_string())?;
        tools_line.push('\n');
        stdin.write_all(tools_line.as_bytes()).await.map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;

        let mut tools = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(parsed) = serde_json::from_str::<Value>(&line) {
                if parsed.get("id").and_then(|id| id.as_i64()) == Some(2) {
                    if let Some(tool_list) = parsed.get("result").and_then(|r| r.get("tools")).and_then(|t| t.as_array()) {
                        for t in tool_list {
                            if let Some(name) = t.get("name").and_then(|n| n.as_str()) {
                                tools.push(McpToolInfo {
                                    name: name.to_string(),
                                    description: t.get("description").and_then(|d| d.as_str()).map(|s| s.to_string()),
                                    input_schema: t.get("inputSchema").cloned(),
                                });
                            }
                        }
                    }
                    break;
                }
            }
        }

        Ok::<Vec<McpToolInfo>, String>(tools)
    };

    let result = tokio::time::timeout(timeout_duration, probe_future).await;
    let _ = child.kill().await;

    let latency = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(tools)) => Ok(McpProbeResult {
            ok: true,
            tools,
            latency_ms: Some(latency),
            error: None,
        }),
        Ok(Err(err)) => Ok(McpProbeResult {
            ok: false,
            tools: vec![],
            latency_ms: Some(latency),
            error: Some(err),
        }),
        Err(_) => Ok(McpProbeResult {
            ok: false,
            tools: vec![],
            latency_ms: Some(latency),
            error: Some("Connection timed out after 5 seconds".to_string()),
        }),
    }
}

async fn reqwest_or_ping(url: &str) -> Result<String, String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok("Remote endpoint configured".to_string())
    } else {
        Err("Unsupported URL scheme".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_server_spec_stdio() {
        let spec = json!({
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-postgres"],
            "env": {
                "DATABASE_URL": "postgresql://localhost:5432/db"
            },
            "description": "PostgreSQL database server"
        });

        let cfg = parse_server_spec("postgres", &spec, "claude");
        assert_eq!(cfg.id, "postgres");
        assert_eq!(cfg.scope, "claude");
        assert_eq!(cfg.transport, "stdio");
        assert_eq!(cfg.command, Some("npx".to_string()));
        assert_eq!(cfg.args, vec!["-y", "@modelcontextprotocol/server-postgres"]);
        assert_eq!(
            cfg.env.get("DATABASE_URL").map(|s| s.as_str()),
            Some("postgresql://localhost:5432/db")
        );
        assert_eq!(cfg.description.as_deref(), Some("PostgreSQL database server"));
    }

    #[test]
    fn test_parse_server_spec_http() {
        let spec = json!({
            "url": "https://mcp.example.com/sse",
            "description": "Remote SSE MCP"
        });

        let cfg = parse_server_spec("remote-mcp", &spec, "global");
        assert_eq!(cfg.id, "remote-mcp");
        assert_eq!(cfg.scope, "global");
        assert_eq!(cfg.transport, "http");
        assert_eq!(cfg.url, Some("https://mcp.example.com/sse".to_string()));
        assert_eq!(cfg.command, None);
    }

    #[test]
    fn test_to_mcp_spec_roundtrip() {
        let mut env = HashMap::new();
        env.insert("API_KEY".to_string(), "test-secret".to_string());

        let cfg = McpServerConfig {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            scope: "global".to_string(),
            transport: "stdio".to_string(),
            command: Some("npx".to_string()),
            args: vec!["-y".to_string(), "@modelcontextprotocol/server-github".to_string()],
            env,
            url: None,
            description: Some("GitHub MCP".to_string()),
            enabled: Some(true),
        };

        let val = to_mcp_spec(&cfg);
        assert_eq!(val["command"], "npx");
        assert_eq!(val["args"][0], "-y");
        assert_eq!(val["args"][1], "@modelcontextprotocol/server-github");
        assert_eq!(val["env"]["API_KEY"], "test-secret");
        assert_eq!(val["description"], "GitHub MCP");
    }
}
