use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentProcessResult {
    pub pid: u32,
    pub status: String,
    pub message: String,
}

#[tauri::command]
pub async fn agent_spawn_process(
    program: String,
    args: Vec<String>,
    working_dir: String,
) -> Result<AgentProcessResult, String> {
    let child = Command::new(&program)
        .args(&args)
        .current_dir(&working_dir)
        .spawn()
        .map_err(|e| format!("Failed to spawn agent process {}: {}", program, e))?;

    let pid = child.id();

    Ok(AgentProcessResult {
        pid,
        status: "running".to_string(),
        message: format!("Agent process {} started in {}", program, working_dir),
    })
}
