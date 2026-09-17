use std::{collections::BTreeSet, path::Path};

pub(super) fn related(root: &Path, selected: &[&str]) -> String {
    let mut guides = BTreeSet::new();
    let mut manifests = BTreeSet::new();
    for file in selected.iter().take(14) {
        let mut directory = Path::new(file).parent();
        while let Some(path) = directory {
            for name in ["AGENTS.md", "CLAUDE.md"] {
                let candidate = path.join(name);
                if root.join(&candidate).is_file() {
                    guides.insert(candidate.to_string_lossy().replace('\\', "/"));
                }
            }
            for name in ["package.json", "Cargo.toml", "pyproject.toml", "go.mod"] {
                let candidate = path.join(name);
                if root.join(&candidate).is_file() {
                    manifests.insert(candidate.to_string_lossy().replace('\\', "/"));
                }
            }
            directory = path.parent();
        }
    }
    let mut text = String::new();
    for (label, paths) in [
        ("Applicable guidance", guides),
        ("Package boundaries and check scripts", manifests),
    ] {
        if !paths.is_empty() {
            let line = format!(
                "{label}: {}.\n",
                paths.into_iter().take(8).collect::<Vec<_>>().join(", ")
            );
            if text.len() + line.len() <= 1000 {
                text.push_str(&line);
            }
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guidance_and_package_boundaries_follow_selected_files_only() {
        let root =
            std::env::temp_dir().join(format!("jackalope-map-context-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("apps/one/src")).unwrap();
        std::fs::create_dir_all(root.join("apps/two")).unwrap();
        for path in [
            "AGENTS.md",
            "apps/one/AGENTS.md",
            "apps/one/package.json",
            "apps/two/package.json",
        ] {
            std::fs::write(root.join(path), "{}").unwrap();
        }
        let text = related(&root, &["apps/one/src/task.ts", "apps/one/src/other.ts"]);
        assert!(text.contains("AGENTS.md"));
        assert!(text.contains("apps/one/AGENTS.md"));
        assert_eq!(text.matches("apps/one/package.json").count(), 1);
        assert!(!text.contains("apps/two"));
        assert!(text.len() <= 1000);
        std::fs::remove_dir_all(root).unwrap();
    }
}
