use serde_json::Value;

pub(super) fn workspace_path(raw: &str, workspace: &str) -> Option<String> {
    let path = raw.replace('\\', "/");
    let root = workspace.replace('\\', "/");
    let root = root.trim_end_matches('/');
    let absolute = path.starts_with('/') || path.as_bytes().get(1) == Some(&b':');
    let relative = if absolute {
        let prefix = path.get(..root.len())?;
        let matches = if cfg!(windows) {
            prefix.eq_ignore_ascii_case(root)
        } else {
            prefix == root
        };
        if root.is_empty() || !matches || path.as_bytes().get(root.len()) != Some(&b'/') {
            return None;
        }
        &path[root.len() + 1..]
    } else {
        &path
    };
    let parts: Vec<_> = relative.split('/').filter(|part| *part != ".").collect();
    if parts.is_empty()
        || parts.iter().any(|part| part.is_empty() || *part == "..")
        || relative.len() > 240
        || relative.chars().any(|ch| ch.is_control() || ch == ':')
    {
        return None;
    }
    Some(parts.join("/"))
}

pub(super) fn label(name: &str, input: &Value, workspace: &str) -> String {
    let verb = match name.to_ascii_lowercase().as_str() {
        "read" | "read_file" | "readfile" => Some("Reading"),
        "edit" | "edit_file" | "str_replace" | "str_replace_editor" => Some("Editing"),
        "write" | "write_file" | "writefile" => Some("Writing"),
        "grep" | "glob" | "search" | "search_files" => return "Searching the project".into(),
        "bash" | "powershell" | "shell" | "execute" | "command_execution" => {
            return "Running a command".into()
        }
        "mcp__jackalope__computer_verify" | "computer_verify" => {
            return "Running project checks".into()
        }
        _ => None,
    };
    if let Some(verb) = verb {
        let path = ["file_path", "filePath", "path", "target_file"]
            .into_iter()
            .filter_map(|key| input[key].as_str())
            .find_map(|raw| workspace_path(raw, workspace));
        return path.map_or_else(|| format!("{verb} a file"), |path| format!("{verb} {path}"));
    }
    let name: String = name
        .chars()
        .filter(|ch| !ch.is_control())
        .take(80)
        .collect();
    format!("Using {name}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn file_activity_keeps_only_bounded_workspace_paths() {
        assert_eq!(
            workspace_path("C:\\work\\src\\a.rs", "C:/work"),
            Some("src/a.rs".into())
        );
        assert_eq!(workspace_path("./src/a.rs", ""), Some("src/a.rs".into()));
        for path in [
            "../private",
            "src/../../private",
            "C:/work-other/a",
            "/etc/passwd",
            "src/\nsecret",
            "src/./../private",
        ] {
            assert_eq!(workspace_path(path, "C:/work"), None, "{path}");
        }
        assert_eq!(
            label(
                "Edit",
                &json!({"file_path":"C:/work/src/a.rs", "new_string":"secret code"}),
                "C:/work"
            ),
            "Editing src/a.rs"
        );
        assert_eq!(
            label("Bash", &json!({"command":"echo secret"}), ""),
            "Running a command"
        );
        assert_eq!(
            label("Read", &json!({"file_path":"/private/secret"}), "/work"),
            "Reading a file"
        );
    }
}
