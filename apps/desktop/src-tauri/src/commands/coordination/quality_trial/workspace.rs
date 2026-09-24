use serde_json::Value;
use std::path::{Component, Path, PathBuf};

pub(super) fn prepare(root: &Path, spec: &Value) -> Result<PathBuf, String> {
    if let Some(path) = spec["externalWorkspace"].as_str() {
        validate_external(
            spec,
            std::env::var("JACKALOPE_EXTERNAL_WORKSPACE")
                .ok()
                .as_deref(),
        )?;
        let repo = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        if !repo.is_dir() || repo.parent().is_none() {
            return Err("External evaluation needs a prepared repository directory".into());
        }
        let git_root =
            super::super::evaluation_trial::git(&repo, &["rev-parse", "--show-toplevel"])?;
        if std::fs::canonicalize(git_root).map_err(|error| error.to_string())? != repo {
            return Err("External workspace must be the prepared repository root".into());
        }
        return Ok(repo);
    }
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).map_err(|error| error.to_string())?;
    for (name, content) in spec["files"].as_object().ok_or("Missing fixture files")? {
        let relative = PathBuf::from(name);
        if relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err("Fixture paths must be relative without traversal".into());
        }
        let path = repo.join(relative);
        std::fs::create_dir_all(path.parent().ok_or("Invalid fixture path")?)
            .map_err(|error| error.to_string())?;
        std::fs::write(path, content.as_str().ok_or("Invalid fixture content")?)
            .map_err(|error| error.to_string())?;
    }
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "user.name", "Evaluation fixture"],
        vec!["config", "user.email", "evaluation@example.invalid"],
        vec!["config", "commit.gpgsign", "false"],
        vec!["add", "."],
        vec!["commit", "-m", "Evaluation fixture"],
        vec![
            "config",
            "jackalope.commitPolicy",
            r#"{"attribution":"user","name":"Evaluation fixture","email":"evaluation@example.invalid","cleanupAfterMerge":false,"autoCheckpoint":false}"#,
        ],
    ] {
        super::super::evaluation_trial::git(&repo, &args)?;
    }
    Ok(repo)
}

fn validate_external(spec: &Value, authorized: Option<&str>) -> Result<(), String> {
    let path = spec["externalWorkspace"]
        .as_str()
        .ok_or("Missing external workspace")?;
    if !Path::new(path).is_absolute() || authorized != Some(path) {
        return Err(
            "External evaluation requires a matching absolute JACKALOPE_EXTERNAL_WORKSPACE".into(),
        );
    }
    for name in [
        "files",
        "oracle",
        "toolFixture",
        "toolFixtures",
        "followups",
        "learningHistory",
    ] {
        if !spec[name].is_null() {
            return Err(format!("External evaluation cannot supply {name}; the upstream environment and verifier own fixtures"));
        }
    }
    Ok(())
}

#[test]
fn external_workspace_requires_explicit_matching_path_and_no_grader() {
    let root = std::env::temp_dir().join("external-quality-contract");
    let path = root.to_string_lossy();
    let mut spec = serde_json::json!({"externalWorkspace":path});
    assert!(validate_external(&spec, None).is_err());
    assert!(validate_external(&spec, Some("another-path")).is_err());
    assert!(validate_external(&spec, Some(&path)).is_ok());
    spec["oracle"] = "hidden answer".into();
    assert!(validate_external(&spec, Some(&path)).is_err());
}
