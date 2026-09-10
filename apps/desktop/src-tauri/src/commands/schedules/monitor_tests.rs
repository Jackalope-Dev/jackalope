use super::*;
use crate::commands::monitors::{ChangeMonitor, MonitorAction};

fn git(repo: &std::path::Path, args: &[&str]) {
    let output =
        super::super::git_command::command(repo, args, super::super::git_command::Policy::Isolated)
            .output()
            .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn commit(repo: &std::path::Path, content: &str) {
    std::fs::write(repo.join("watched.txt"), content).unwrap();
    git(repo, &["add", "watched.txt"]);
    git(
        repo,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Disposable fixture",
        ],
    );
}

#[test]
fn local_monitor_persists_baseline_and_notice_without_launching_an_agent() {
    let (directory, scheduler) = super::tests::fixture("once");
    let repo = directory.join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-b", "main"]);
    commit(&repo, "first");
    let due = {
        let mut ledger = scheduler.ledger.lock().unwrap();
        let saved = &mut ledger.schedules[0];
        saved.definition.monitor = Some(ChangeMonitor {
            path: "watched.txt".into(),
            action: MonitorAction::Notify,
        });
        saved.definition.request.project_path = repo.to_string_lossy().into();
        saved.definition.request.target_branch = Some("main".into());
        saved.next_at
    };
    scheduler.tick(due).unwrap();
    std::fs::write(repo.join("watched.txt"), "uncommitted").unwrap();
    scheduler.tick(due + chrono::Duration::hours(1)).unwrap();
    assert_eq!(
        scheduler.ledger.lock().unwrap().schedules[0].quiet_checks,
        2
    );
    commit(&repo, "changed");
    scheduler.tick(due + chrono::Duration::hours(2)).unwrap();
    scheduler.tick(due + chrono::Duration::hours(3)).unwrap();
    let reopened = Scheduler::new(scheduler.path.clone(), scheduler.coordinator.clone());
    let saved = reopened.ledger.lock().unwrap().schedules[0].clone();
    assert_eq!(saved.local_checks, 4);
    assert_eq!(saved.quiet_checks, 3);
    let notice = saved.last_notice.unwrap();
    assert!(notice.outcome.starts_with("Change detected"));
    let change = notice.change.unwrap();
    let diff = crate::commands::monitors::inspect(&repo.to_string_lossy(), &change).unwrap();
    assert!(diff.contains("-first") && diff.contains("+changed"));
    assert!(saved.history.iter().all(|e| e.run_id.is_none()));
    assert!(scheduler
        .coordinator
        .runtime
        .integration_runs()
        .unwrap()
        .is_empty());
    drop(reopened);
    git(&repo, &["rm", "watched.txt"]);
    git(
        &repo,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Remove disposable watched file",
        ],
    );
    scheduler.tick(due + chrono::Duration::hours(4)).unwrap();
    let removed = scheduler.ledger.lock().unwrap().schedules[0]
        .last_notice
        .clone()
        .unwrap()
        .change
        .unwrap();
    assert_eq!(removed.after, "absent");
    assert!(
        crate::commands::monitors::inspect(&repo.to_string_lossy(), &removed)
            .unwrap()
            .contains("was removed")
    );
    commit(&repo, "restored");
    scheduler.tick(due + chrono::Duration::hours(5)).unwrap();
    let restored = scheduler.ledger.lock().unwrap().schedules[0]
        .last_notice
        .clone()
        .unwrap()
        .change
        .unwrap();
    assert_eq!(restored.before, "absent");
    assert_ne!(restored.after, "absent");
    drop(scheduler);
    let runtime = super::super::tasks::TaskRuntime::with_test_access(directory.clone()).unwrap();
    assert!(directory.join("schedules.json").exists());
    assert!(!directory.join("schedules.json.corrupt").exists());
    let coordinator = Coordinator::new(directory.join("coordination"), runtime).unwrap();
    let scheduler = Scheduler::new(directory.join("schedules.json"), coordinator);
    let ledger = scheduler.ledger.lock().unwrap();
    assert!(ledger.error.is_none());
    assert_eq!(ledger.schedules.len(), 1);
    assert_eq!(ledger.schedules[0].local_checks, 6);
    assert!(ledger.schedules[0].last_notice.is_some());
    drop(ledger);
    drop(scheduler);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn failed_dispatch_is_not_replayed_for_unchanged_content() {
    let (directory, scheduler) = super::tests::fixture("once");
    let repo = directory.join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-b", "main"]);
    commit(&repo, "first");
    let due = {
        let mut ledger = scheduler.ledger.lock().unwrap();
        let saved = &mut ledger.schedules[0];
        saved.definition.monitor = Some(ChangeMonitor {
            path: "".into(),
            action: MonitorAction::Run,
        });
        saved.definition.request.project_path = repo.to_string_lossy().into();
        saved.definition.request.target_branch = Some("main".into());
        saved.next_at
    };
    scheduler.tick(due).unwrap();
    commit(&repo, "changed");
    scheduler.tick(due + chrono::Duration::hours(1)).unwrap();
    scheduler.tick(due + chrono::Duration::hours(2)).unwrap();
    let ledger = scheduler.ledger.lock().unwrap();
    let saved = &ledger.schedules[0];
    assert!(saved.history[1].outcome.starts_with("Failed to start"));
    assert!(saved.history[2].outcome.starts_with("Unchanged"));
    assert_eq!(
        saved.history.iter().filter(|e| e.run_id.is_some()).count(),
        1
    );
    drop(ledger);
    drop(scheduler);
    std::fs::remove_dir_all(directory).unwrap();
}
