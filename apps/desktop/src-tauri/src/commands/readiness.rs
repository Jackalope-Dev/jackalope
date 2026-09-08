use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    pub head: String,
    pub branch: String,
    pub changes: String,
    pub recent_changes: String,
    pub prepare_command: Option<String>,
    pub verify_command: Option<String>,
    pub preview_command: Option<String>,
    pub dependencies_missing: bool,
    pub missing_configuration: Vec<String>,
    pub notes: Vec<String>,
}

fn read(root: &Path, name: &str) -> Result<Option<Vec<u8>>, String> {
    let path = root.join(name);
    if !path.exists() {
        return Ok(None);
    }
    let path = dunce::canonicalize(path).map_err(|e| e.to_string())?;
    if !path.starts_with(root) {
        return Err(format!("{name} points outside this project."));
    }
    super::history::read_bounded(&path, 256_000).map(Some)
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = super::process_control::run(
        super::git_command::command(root, args, super::git_command::Policy::Isolated),
        std::time::Duration::from_secs(15),
    )?;
    if !output.success {
        return Err("Could not inspect the project's Git state.".into());
    }
    Ok(output.stdout.trim().to_string())
}

fn variable_names(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter_map(|line| {
            let line = line.trim().strip_prefix("export ").unwrap_or(line.trim());
            let (name, _) = line.split_once('=')?;
            let name = name.trim();
            (!name.is_empty()
                && name.len() <= 100
                && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
            .then(|| name.to_string())
        })
        .take(100)
        .collect()
}

pub fn inspect(path: &str) -> Result<Readiness, String> {
    let root =
        dunce::canonicalize(path).map_err(|_| "Project folder is unavailable.".to_string())?;
    let mut result = Readiness {
        head: git(&root, &["rev-parse", "HEAD"])?,
        branch: git(&root, &["branch", "--show-current"])?,
        changes: git(&root, &["status", "--short", "--untracked-files=normal"])?,
        recent_changes: git(&root, &["log", "-5", "--format=%h %s"])?,
        prepare_command: None,
        verify_command: None,
        preview_command: None,
        dependencies_missing: false,
        missing_configuration: vec![],
        notes: vec![],
    };
    if let Some(bytes) = read(&root, "package.json")? {
        let manifest: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| "package.json is not valid JSON.".to_string())?;
        let manager = if root.join("pnpm-lock.yaml").exists() {
            "pnpm"
        } else if root.join("package-lock.json").exists() {
            "npm"
        } else if root.join("yarn.lock").exists() {
            "yarn"
        } else {
            ""
        };
        result.dependencies_missing = !root.join("node_modules").is_dir();
        if !manager.is_empty() {
            result.prepare_command = Some(
                match manager {
                    "pnpm" => "pnpm install --frozen-lockfile",
                    "npm" => "npm ci",
                    _ if manifest["packageManager"]
                        .as_str()
                        .is_some_and(|v| v.starts_with("yarn@1.")) =>
                    {
                        "yarn install --frozen-lockfile"
                    }
                    _ if root.join(".yarnrc.yml").exists() => "yarn install --immutable",
                    _ => "yarn install --frozen-lockfile",
                }
                .into(),
            );
            let scripts = &manifest["scripts"];
            for name in ["verify", "check", "test", "build"] {
                if scripts[name].is_string() {
                    result.verify_command = Some(format!("{manager} run {name}"));
                    break;
                }
            }
            if scripts["dev"].is_string() {
                result.preview_command = Some(format!("{manager} run dev"));
            }
        } else {
            result.notes.push("No supported package lockfile found. Choose preparation and verification commands in project settings.".into());
        }
    } else if root.join("Cargo.toml").exists() {
        result.verify_command = Some("cargo test --locked".into());
    }
    let mut configured = Vec::new();
    for name in [
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
    ] {
        if let Some(bytes) = read(&root, name)? {
            configured.extend(variable_names(&bytes));
        }
    }
    if let Some(bytes) = read(&root, ".env.example")? {
        result.missing_configuration = variable_names(&bytes)
            .into_iter()
            .filter(|name| !configured.contains(name) && std::env::var_os(name).is_none())
            .collect();
    }
    result.notes.push("Configuration checks compare variable names only; present values may still be invalid. Package scripts have not been executed.".into());
    Ok(result)
}

#[tauri::command]
pub async fn project_readiness(path: String) -> Result<Readiness, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_output_contains_names_only() {
        assert_eq!(
            variable_names(b"# comment\nTOKEN=very-private\nexport PORT=3000\nBAD KEY=secret\n"),
            vec!["TOKEN", "PORT"]
        );
    }
}
