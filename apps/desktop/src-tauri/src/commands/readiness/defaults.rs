use super::{git, read};
use serde::Serialize;
use std::path::Path;

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDefaults {
    pub base_branch: Option<String>,
    pub prepare_command: Option<String>,
    pub verify_command: Option<String>,
    pub preview_command: Option<String>,
}

fn target_branch(root: &Path) -> Option<String> {
    let branches = git(
        root,
        &["for-each-ref", "--format=%(refname:strip=2)", "refs/heads/"],
    )
    .ok()?;
    let local_branch = |branch: &str| branches.lines().any(|name| name == branch);
    if let Ok(reference) = git(
        root,
        &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    ) {
        if let Some(branch) = reference.strip_prefix("refs/remotes/origin/") {
            if local_branch(branch) {
                return Some(branch.into());
            }
        }
    }
    for branch in ["main", "master", "trunk", "develop"] {
        if local_branch(branch) {
            return Some(branch.into());
        }
    }
    git(root, &["branch", "--show-current"])
        .ok()
        .filter(|branch| !branch.is_empty())
}

fn manager<'a>(root: &Path, manifest: &'a serde_json::Value) -> &'a str {
    if let Some(name) = manifest["packageManager"]
        .as_str()
        .and_then(|v| v.split('@').next())
    {
        if ["pnpm", "npm", "yarn", "bun"].contains(&name) {
            return name;
        }
    }
    for (file, name) in [
        ("pnpm-lock.yaml", "pnpm"),
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
        ("yarn.lock", "yarn"),
        ("package-lock.json", "npm"),
        ("npm-shrinkwrap.json", "npm"),
    ] {
        if root.join(file).is_file() {
            return name;
        }
    }
    "npm"
}

fn commands(content: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut fenced = false;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            found.push(line.strip_prefix("$ ").unwrap_or(line).to_string());
        } else {
            let lower = line.to_ascii_lowercase();
            if ["do not ", "don't ", "never ", "avoid "]
                .iter()
                .any(|word| lower.contains(word))
            {
                continue;
            }
            found.extend(line.split('`').skip(1).step_by(2).map(str::to_string));
        }
    }
    found
}

fn command_kind(command: &str, manifest: Option<&serde_json::Value>) -> Option<(bool, usize)> {
    if command.len() > 240
        || !command
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b" -_./:=@".contains(&b))
    {
        return None;
    }
    let words: Vec<_> = command.split_whitespace().collect();
    let (tool, args) = words.split_first()?;
    if args
        .iter()
        .any(|arg| ["--watch", "-w", "--help", "-h", "--global", "-g"].contains(arg))
    {
        return None;
    }
    if *tool == "pytest" {
        return Some((false, 3));
    }
    let action = *args.first()?;
    if ["pnpm", "npm", "yarn", "bun"].contains(tool) {
        let manifest = manifest?;
        if ["install", "ci"].contains(&action) {
            return args
                .iter()
                .skip(1)
                .all(|arg| {
                    [
                        "--frozen-lockfile",
                        "--immutable",
                        "--immutable-cache",
                        "--offline",
                        "--prefer-offline",
                        "--ignore-scripts",
                        "--no-audit",
                        "--no-fund",
                        "--non-interactive",
                        "--no-progress",
                    ]
                    .contains(arg)
                })
                .then_some((true, 0));
        }
        let script = if action == "run" {
            *args.get(1)?
        } else {
            action
        };
        if !manifest["scripts"][script].is_string() {
            return None;
        }
        if ["setup", "bootstrap"].contains(&script) {
            return Some((true, 1));
        }
        return ["verify", "validate", "check", "test", "build", "lint"]
            .iter()
            .position(|name| *name == script || script.starts_with(&format!("{name}:")))
            .map(|rank| (false, rank));
    }
    match (*tool, action) {
        ("cargo", "test") => Some((false, 3)),
        ("cargo", "check") => Some((false, 4)),
        ("cargo", "fetch") | ("uv", "sync") | ("poetry", "install") | ("composer", "install") => {
            Some((true, 0))
        }
        ("make" | "just" | "composer", "verify") => Some((false, 0)),
        ("make" | "just" | "composer", "check") => Some((false, 2)),
        ("make" | "just" | "composer", "test") => Some((false, 3)),
        ("python" | "python3", "-m") if args.get(1) == Some(&"pytest") => Some((false, 3)),
        ("uv" | "poetry", "run") if args.get(1) == Some(&"pytest") => Some((false, 3)),
        _ => None,
    }
}

pub fn detect(root: &Path) -> ProjectDefaults {
    let mut defaults = ProjectDefaults {
        base_branch: target_branch(root),
        ..Default::default()
    };
    let manifest = read(root, "package.json")
        .ok()
        .flatten()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    if let Some(manifest) = &manifest {
        let manager = manager(root, manifest);
        defaults.prepare_command = Some(match manager {
            "pnpm" if root.join("pnpm-lock.yaml").is_file() => {
                "pnpm install --frozen-lockfile".into()
            }
            "npm"
                if root.join("package-lock.json").is_file()
                    || root.join("npm-shrinkwrap.json").is_file() =>
            {
                "npm ci".into()
            }
            "bun" if root.join("bun.lock").is_file() || root.join("bun.lockb").is_file() => {
                "bun install --frozen-lockfile".into()
            }
            "yarn" if root.join("yarn.lock").is_file() => {
                if root.join(".yarnrc.yml").is_file()
                    || manifest["packageManager"]
                        .as_str()
                        .is_some_and(|v| v.starts_with("yarn@") && !v.starts_with("yarn@1."))
                {
                    "yarn install --immutable".into()
                } else {
                    "yarn install --frozen-lockfile".into()
                }
            }
            _ => format!("{manager} install"),
        });
        for name in ["verify", "validate", "check", "test", "build", "lint"] {
            if manifest["scripts"][name].is_string() {
                defaults.verify_command = Some(format!("{manager} run {name}"));
                break;
            }
        }
        if manifest["scripts"]["dev"].is_string() {
            defaults.preview_command = Some(format!("{manager} run dev"));
        }
    } else if root.join("Cargo.toml").is_file() {
        defaults.prepare_command = Some(
            if root.join("Cargo.lock").is_file() {
                "cargo fetch --locked"
            } else {
                "cargo fetch"
            }
            .into(),
        );
        defaults.verify_command = Some(
            if root.join("Cargo.lock").is_file() {
                "cargo test --locked"
            } else {
                "cargo test"
            }
            .into(),
        );
    }
    let mut preparation_rank = usize::MAX;
    let mut verification_rank = usize::MAX;
    for name in [
        "AGENTS.md",
        "CLAUDE.md",
        "CONTRIBUTING.md",
        "README.md",
        "docs/DEVELOPMENT.md",
        "docs/CONTRIBUTING.md",
    ] {
        let Some(bytes) = read(root, name).ok().flatten() else {
            continue;
        };
        for command in commands(&String::from_utf8_lossy(&bytes)) {
            let Some((preparation, rank)) = command_kind(&command, manifest.as_ref()) else {
                continue;
            };
            let current_rank = if preparation {
                &mut preparation_rank
            } else {
                &mut verification_rank
            };
            if rank < *current_rank {
                *current_rank = rank;
                if preparation {
                    defaults.prepare_command = Some(command);
                } else {
                    defaults.verify_command = Some(command);
                }
            }
        }
    }
    defaults
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("jackalope-defaults-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        git(&root, &["init", "-b", "feature/setup"]).unwrap();
        dunce::canonicalize(root).unwrap()
    }

    fn write(root: &Path, name: &str, content: &str) {
        std::fs::write(root.join(name), content).unwrap();
    }

    #[test]
    fn manifest_and_documentation_commands_are_detected_without_execution() {
        let root = fixture();
        write(
            &root,
            "package.json",
            r#"{"packageManager":"pnpm@10.11.0","scripts":{"verify":"touch executed","test":"test runner","dev":"dev server"}}"#,
        );
        write(&root, "pnpm-lock.yaml", "lockfileVersion: 9");
        let detected = detect(&root);
        assert_eq!(
            detected.prepare_command.as_deref(),
            Some("pnpm install --frozen-lockfile")
        );
        assert_eq!(detected.verify_command.as_deref(), Some("pnpm run verify"));
        assert_eq!(detected.base_branch.as_deref(), Some("feature/setup"));
        write(
            &root,
            "AGENTS.md",
            "Run `pnpm verify --offline` before submitting.\nNever run `pnpm test`.\n",
        );
        write(
            &root,
            "CONTRIBUTING.md",
            "## Setup\n```sh\n$ pnpm install --frozen-lockfile --offline\npnpm run missing\n```\n",
        );
        let detected = detect(&root);
        assert_eq!(
            detected.verify_command.as_deref(),
            Some("pnpm verify --offline")
        );
        assert_eq!(
            detected.prepare_command.as_deref(),
            Some("pnpm install --frozen-lockfile --offline")
        );
        assert!(!root.join("executed").exists());
        assert!(command_kind("pnpm verify && deploy", None).is_none());
        let manifest = serde_json::json!({"scripts": {"test": "test runner"}});
        assert!(command_kind("npm install -g cli", Some(&manifest)).is_none());
        assert!(command_kind("npm install some-package", Some(&manifest)).is_none());
        assert!(command_kind("pnpm test --watch", Some(&manifest)).is_none());
        assert_eq!(commands("Do not run `npm test`."), Vec::<String>::new());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn package_managers_and_missing_lockfiles_keep_usable_install_commands() {
        let root = fixture();
        for (manager, lockfile, expected) in [
            ("npm@11.0.0", "package-lock.json", "npm ci"),
            ("bun@1.3.0", "bun.lock", "bun install --frozen-lockfile"),
            ("yarn@1.22.0", "yarn.lock", "yarn install --frozen-lockfile"),
            ("yarn@4.0.0", "yarn.lock", "yarn install --immutable"),
        ] {
            write(
                &root,
                "package.json",
                &format!(r#"{{"packageManager":"{manager}","scripts":{{"check":"checker"}}}}"#),
            );
            write(&root, lockfile, "");
            assert_eq!(detect(&root).prepare_command.as_deref(), Some(expected));
            std::fs::remove_file(root.join(lockfile)).unwrap();
            assert_eq!(
                detect(&root).prepare_command,
                Some(format!("{} install", manager.split('@').next().unwrap()))
            );
        }
        write(&root, "package.json", "not json");
        assert!(detect(&root).prepare_command.is_none());
        write(&root, "README.md", "Run `python -m pytest` to test.\n");
        assert_eq!(
            detect(&root).verify_command.as_deref(),
            Some("python -m pytest")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn target_prefers_the_local_remote_default_then_conventional_branches() {
        let root = fixture();
        git(
            &root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "core.hooksPath=disabled-hooks",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--allow-empty",
                "-m",
                "fixture",
            ],
        )
        .unwrap();
        git(&root, &["branch", "main"]).unwrap();
        git(&root, &["branch", "release"]).unwrap();
        assert_eq!(target_branch(&root).as_deref(), Some("main"));
        git(
            &root,
            &["update-ref", "refs/remotes/origin/release", "HEAD"],
        )
        .unwrap();
        git(
            &root,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/release",
            ],
        )
        .unwrap();
        assert_eq!(target_branch(&root).as_deref(), Some("release"));
        git(&root, &["checkout", "--detach"]).unwrap();
        assert_eq!(target_branch(&root).as_deref(), Some("release"));
        git(&root, &["branch", "-D", "release", "main", "feature/setup"]).unwrap();
        assert_eq!(target_branch(&root), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}
