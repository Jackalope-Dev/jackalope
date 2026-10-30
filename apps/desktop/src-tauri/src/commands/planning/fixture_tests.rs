//! A planning session against a fixture agent process: the interview run is
//! read-only, its final message becomes a draft revision, edits add revisions,
//! approval needs the exact revision, and Save to repo never commits.

use super::{artifact, session};
use crate::commands::{
    agent_policy::{AgentPolicy, CustomAgent},
    coordination::Coordinator,
    tasks::{git, RunRequest, TaskRuntime},
};
use std::time::{Duration, Instant};

const FIXTURE: &str = r#"
const fs = require('node:fs');
const path = require('node:path');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  const folder = path.dirname(process.argv[1]);
  fs.appendFileSync(path.join(folder, 'args.txt'), process.argv.slice(2).join(' ') + '\n');
  fs.writeFileSync(path.join(folder, 'input.txt'), prompt);
  const plan = [
    '---', 'recommendedShape: subtasks', 'shapeReason: Two separate files', 'workers: 2', '---', '',
    '# Add CSV export', '', '## Goal', 'Export reports as CSV.', '', '## Context', 'src/report.ts renders reports.', '',
    '## Clarifications', 'Coverage: Scope Clear · Done signals Partial', '- Q: Which delimiter?', '  A: Comma', '',
    '## Assumptions', '- Checked: Reports render in src/report.ts — evidence: src/report.ts:1', '- Under 10,000 rows', '', '## Out of scope', '- Excel', '',
    '## Approach & Interfaces', 'Add a serializer and a button.', '',
    '## Tasks', '### csv · Serialize reports', '- scopes: src/csv.ts', '- dependsOn: none', '- parallel: no', '- covers: AC-1', '',
    'Follow src/json.ts.', '',
    '### button · Export button', '- scopes: src/ui', '- dependsOn: csv', '- parallel: yes', '- covers: AC-2', '',
    '## Acceptance criteria', '- AC-1 [test: pnpm test csv] WHEN a cell has quotes THEN they are escaped',
    '- AC-2 [manual] The button downloads a file', '', '## Risks', '- None', '', '## Decision log', '- Reuse the serializer pattern', '',
    '## Surprises', '- None',
  ].join('\n');
  console.log(JSON.stringify({type: 'thread.started', thread_id: 'plan-session'}));
  console.log(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: 'Here is the plan.\n\n' + plan}}));
});
"#;

fn repository(folder: &std::path::Path) -> String {
    let root = folder.join("repo");
    std::fs::create_dir_all(&root).unwrap();
    let root = root.to_string_lossy().into_owned();
    git(&root, &["init", "-b", "master"]).unwrap();
    git(
        &root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    )
    .unwrap();
    root
}

fn executable(folder: &std::path::Path) -> std::path::PathBuf {
    std::fs::write(folder.join("planner.cjs"), FIXTURE).unwrap();
    #[cfg(windows)]
    let path = {
        let path = folder.join("planner.cmd");
        std::fs::write(&path, "@echo off\r\nnode \"%~dp0planner.cjs\" %*\r\n").unwrap();
        path
    };
    #[cfg(unix)]
    let path = {
        use std::os::unix::fs::PermissionsExt;
        let path = folder.join("planner");
        std::fs::write(
            &path,
            "#!/bin/sh\nexec node \"$(dirname \"$0\")/planner.cjs\" \"$@\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    };
    path
}

fn wait_for_draft(coordinator: &Coordinator, id: &str) -> session::PlanView {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let view = session::view(coordinator, id).unwrap();
        if !view.planning && (view.revision.is_some() || view.error.is_some()) {
            return view;
        }
        if Instant::now() > deadline {
            coordinator.runtime.stop_all();
            panic!("The planning fixture did not finish: {:?}", view.error);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_fixture_planner_drafts_a_plan_that_is_revised_approved_only_exactly_and_exported() {
    let folder =
        std::env::temp_dir().join(format!("jackalope-plan-session-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    let root = repository(&folder);
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    let mut policy = AgentPolicy::default();
    policy.custom_agents.push(CustomAgent {
        id: "planner-fixture".into(),
        name: "Planner fixture".into(),
        command: executable(&folder).to_string_lossy().into(),
        adapter: Some("codex".into()),
        args: Vec::new(),
    });
    std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
    std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
    let coordinator = Coordinator::new(folder.join("queue"), runtime.clone()).unwrap();
    coordinator.launch();
    let ready = Instant::now() + Duration::from_secs(10);
    while !coordinator.bridge_ready() && Instant::now() < ready {
        std::thread::sleep(Duration::from_millis(25));
    }
    let template: RunRequest = serde_json::from_value(serde_json::json!({
        "id": "template", "projectId": "fixture", "projectName": "Fixture", "projectPath": root,
        "agent": "planner-fixture", "model": null, "prompt": "", "isolated": true,
        "previousRunId": null
    }))
    .unwrap();

    let record = session::start(&coordinator, template, "Add CSV export".into()).unwrap();
    let view = wait_for_draft(&coordinator, &record.id);
    assert_eq!(view.error, None);
    assert_eq!(view.status, "draft");
    assert_eq!(view.revision, Some(1));
    let doc = view.document.clone().unwrap();
    assert_eq!(doc.tasks.len(), 2);
    assert_eq!(doc.clarifications[0].answer, "Comma");
    assert_eq!(
        doc.assumptions,
        [
            "Checked: Reports render in src/report.ts — evidence: src/report.ts:1",
            "Under 10,000 rows"
        ]
    );
    assert_eq!(
        artifact::checked_assumption(&doc.assumptions[0]),
        Some("Reports render in src/report.ts — evidence: src/report.ts:1")
    );
    assert_eq!(view.shape, "subtasks");
    let args = std::fs::read_to_string(folder.join("args.txt")).unwrap();
    assert!(
        args.contains("sandbox_mode=\"read-only\""),
        "planning runs read-only: {args}"
    );
    let input = std::fs::read_to_string(folder.join("input.txt")).unwrap();
    assert!(input.contains("You are planning, not implementing"));
    assert!(input.contains("Ask only preference questions") && input.contains("why_ask"));

    // Editing directly adds a revision and the diff names the changed section.
    let edited = view
        .markdown
        .clone()
        .unwrap()
        .replace("- Under 10,000 rows", "- Under 50,000 rows")
        .replace("src/report.ts:1", "src/report.ts:4");
    assert!(session::save_edit(&coordinator, &record.id, &edited, 0).is_err());
    assert_eq!(
        session::save_edit(&coordinator, &record.id, &edited, 1).unwrap(),
        2
    );
    let view = session::view(&coordinator, &record.id).unwrap();
    assert_eq!(view.revision, Some(2));
    assert_eq!(view.changes.len(), 1);
    assert_eq!(view.changes[0].section, "Assumptions");

    // Approval binds to the exact revision and hash shown.
    let checks = || {
        Some(session::PlanChecks {
            verify_command: Some("node --version".into()),
            ..Default::default()
        })
    };
    let stale = session::approve(
        &coordinator,
        &record.id,
        1,
        "stale",
        "subtasks",
        "app",
        checks(),
    );
    assert!(stale.unwrap_err().contains("plan changed"));
    let hash = view.hash.as_deref().unwrap();
    // Without a saved project check, the plan's test criterion is the check.
    assert_eq!(view.verification.source, "criteria");
    assert_eq!(view.verification.command.as_deref(), Some("pnpm test csv"));
    let swarm = session::approve(&coordinator, &record.id, 2, hash, "swarm", "app", checks());
    assert!(swarm.unwrap_err().contains("swarm Worker"));
    let unapproved = session::store(&coordinator).load(&record.id).unwrap();
    assert!(unapproved.approval.is_none());

    // Save to repo writes the file and leaves it uncommitted.
    let written = session::export(&coordinator, &record.id, None).unwrap();
    assert_eq!(written, "docs/plans/add-csv-export.md");
    let status = git(&root, &["status", "--porcelain"]).unwrap();
    assert!(status.contains("docs/"), "{status}");
    let log = git(&root, &["log", "--oneline"]).unwrap();
    assert_eq!(log.lines().count(), 1, "nothing was committed");

    // Approving the exact revision starts a fresh, writable worker from the plan.
    session::approve(&coordinator, &record.id, 2, hash, "single", "app", checks()).unwrap();
    let view = session::view(&coordinator, &record.id).unwrap();
    assert_eq!(view.status, "running");
    let approval = view.approval.clone().unwrap();
    assert_eq!((approval.revision, approval.shape.as_str()), (2, "single"));
    assert!(approval.approved_by.ends_with("(app)"));
    assert_eq!(approval.verification, "project");
    let progress = view
        .progress
        .clone()
        .expect("the plan runs as a managed task");
    assert_eq!(progress.tasks.len(), 1);
    assert!(
        progress.review.is_some(),
        "one worker still gets an independent review"
    );
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let args = std::fs::read_to_string(folder.join("args.txt")).unwrap();
        if args.lines().count() >= 2 {
            let worker = args.lines().nth(1).unwrap();
            assert!(worker.contains("workspace-write"), "{worker}");
            break;
        }
        if Instant::now() > deadline {
            runtime.stop_all();
            panic!("The approved plan did not start a worker.");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let input = std::fs::read_to_string(folder.join("input.txt")).unwrap();
    assert!(input.contains("Implement this approved plan"));
    assert!(input.contains("AC-1"));

    drop(coordinator);
    runtime.stop_all();
    drop(runtime);
    let _ = std::fs::remove_dir_all(folder);
}
