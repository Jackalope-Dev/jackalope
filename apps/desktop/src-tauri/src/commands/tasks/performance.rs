use super::*;
use std::time::Instant;

#[test]
#[ignore = "repeatable local performance measurement"]
fn performance_baseline() {
    let directory = std::env::temp_dir().join(format!("jackalope-perf-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::new(directory.clone()).unwrap();
    for index in 0..1000 {
        let mut run = tests::sample("codex");
        run.id = format!("benchmark-{index:08}");
        run.task_id = run.id.clone();
        run.status = "review".into();
        run.result = "A".repeat(100_000);
        runtime.save(&run).unwrap();
        runtime
            .inner
            .lock()
            .unwrap()
            .runs
            .insert(run.id.clone(), run);
    }
    let start = Instant::now();
    for _ in 0..30 {
        let runs = runtime.snapshot(None);
        std::hint::black_box(runs);
    }
    let snapshots_ms = start.elapsed().as_secs_f64() * 1000.0 / 30.0;
    let start = Instant::now();
    std::thread::scope(|scope| {
        for index in 0..4 {
            let runtime = &runtime;
            scope.spawn(move || {
                for line in 0..100 {
                    runtime
                        .update_output(&format!("benchmark-{index:08}"), |run| {
                            run.activity.push(format!("Output line {line}"));
                        })
                        .unwrap();
                }
            });
        }
    });
    let output_ms = start.elapsed().as_secs_f64() * 1000.0;
    drop(runtime);
    let start = Instant::now();
    let reopened = TaskRuntime::new(directory.clone()).unwrap();
    let startup_ms = start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(reopened.inner.lock().unwrap().runs.len(), 1000);
    println!(
        "PERFORMANCE {}",
        serde_json::json!({"snapshot_ms": snapshots_ms, "four_streams_400_lines_ms": output_ms, "startup_1000_runs_ms": startup_ms})
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}
