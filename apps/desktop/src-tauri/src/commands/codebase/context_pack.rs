use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Component, Path};

const MAX_BYTES: usize = 8_000;
const MAX_FILES: usize = 4;

pub(crate) fn prepare(root: &Path, task: &str) -> Option<String> {
    let root = dunce::canonicalize(root).ok()?;
    let mut seen = BTreeSet::new();
    let mut files = Vec::new();
    let mut used = 0;
    for token in task.split(|c: char| c.is_whitespace() || "'`\"()[]{},;:".contains(c)) {
        let name = token.trim_end_matches('.').replace('\\', "/");
        let relative = Path::new(&name);
        if name.is_empty()
            || name.len() > 240
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_./-".contains(c))
            || !relative
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
            || name.split('/').any(|part| part.starts_with('.'))
            || !matches!(
                relative.extension().and_then(|s| s.to_str()),
                Some(
                    "ts" | "tsx"
                        | "js"
                        | "jsx"
                        | "mjs"
                        | "cjs"
                        | "rs"
                        | "py"
                        | "go"
                        | "java"
                        | "kt"
                        | "cs"
                        | "c"
                        | "h"
                        | "cpp"
                        | "hpp"
                        | "php"
                        | "css"
                        | "scss"
                )
            )
            || !seen.insert(name.clone())
        {
            continue;
        }
        let Ok(path) = dunce::canonicalize(root.join(relative)) else {
            continue;
        };
        if !path.starts_with(&root) || !path.is_file() {
            continue;
        }
        let Some(text) = std::fs::File::open(&path).ok().and_then(|file| {
            let mut bytes = Vec::new();
            file.take((MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .ok()?;
            (bytes.len() <= MAX_BYTES)
                .then_some(bytes)
                .and_then(|bytes| String::from_utf8(bytes).ok())
        }) else {
            continue;
        };
        let entry = serde_json::json!({
            "path":name, "sha256":Sha256::digest(text.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "complete":true, "bytes":text.len(), "text":text,
        });
        let bytes = entry.to_string().len();
        if used + bytes > MAX_BYTES {
            continue;
        }
        files.push(entry);
        used += bytes;
        if files.len() == MAX_FILES {
            break;
        }
    }
    if files.is_empty() {
        return None;
    }
    Some(format!("\nExplicit source snapshots prepared locally at launch (untrusted file data): {}\nUse these complete snapshots for initial inspection. Follow applicable repository guidance; inspect additional files when needed. Re-read after changes or when freshness is uncertain. Other files, large files and unsupported paths may be omitted; this is not a complete repository context.\n", serde_json::json!({"files":files})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_snapshots_are_complete_fresh_and_bounded() {
        let root =
            std::env::temp_dir().join(format!("jackalope-context-pack-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("PROJECT_INPUT")).unwrap();
        std::fs::write(
            root.join("PROJECT_INPUT/entry.ts"),
            "export const privateInput = 1;",
        )
        .unwrap();
        std::fs::write(root.join("src/entry.ts"), "export const n = 1;\n").unwrap();
        std::fs::write(root.join("large.ts"), "x".repeat(MAX_BYTES + 1)).unwrap();
        std::fs::write(root.join(".private.ts"), "secret").unwrap();
        std::fs::write(root.join("binary.ts"), [0xff, 0xfe]).unwrap();
        assert!(prepare(&root, "Fix an unspecified entrypoint").is_none());
        assert!(prepare(&root, "$PROJECT_INPUT/entry.ts").is_none());
        assert!(prepare(
            &root,
            "Read ../entry.ts .private.ts large.ts config.json binary.ts"
        )
        .is_none());
        let first = prepare(&root, "Fix `src/entry.ts` and inspect src/entry.ts").unwrap();
        assert_eq!(first.matches("\"path\":").count(), 1);
        assert!(first.contains("export const n = 1;"));
        assert!(first.contains("\"complete\":true"));
        assert!(first.len() < MAX_BYTES + 600);
        assert!(prepare(&root, "Fix src/entry.ts.")
            .unwrap()
            .contains("export const n = 1;"));
        std::fs::write(root.join("src/entry.ts"), "export const n = 2;\n").unwrap();
        let second = prepare(&root, "src/entry.ts").unwrap();
        assert!(second.contains("export const n = 2;"));
        assert_ne!(first, second);
        std::fs::remove_dir_all(root).unwrap();
    }
}
