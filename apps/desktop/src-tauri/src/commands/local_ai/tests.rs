use super::*;

#[test]
fn download_events_reject_invalid_data_and_accept_unterminated_success() {
    let mut totals = DownloadProgress::default();
    assert!(download_event(b"\n", &mut totals).unwrap().is_none());
    assert!(
        download_event(b"{\"status\":\"success\"}", &mut totals)
            .unwrap()
            .unwrap()
            .1
    );
    for line in [
        b"null".as_slice(),
        b"{broken",
        b"{\"error\":\"failed\"}",
        &vec![b'x'; 16_385],
    ] {
        assert!(download_event(line, &mut totals).is_err());
    }
    let tags = json!({"models":[{"name":"jackalope-qwen3.5-4b:latest","digest":"abc"}]});
    assert_eq!(
        digest(&tags, "jackalope-qwen3.5-4b").as_deref(),
        Some("abc")
    );
    assert!(digest(&tags, "qwen3.5:4b").is_none());
}

#[test]
fn check_folder_cleanup_only_removes_the_owned_child() {
    let parent = std::env::temp_dir().join(format!(
        "jackalope-local-check-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&parent).unwrap();
    std::fs::write(parent.join("keep.txt"), "keep").unwrap();
    let path;
    {
        let directory = check::Directory::create(&parent).unwrap();
        path = directory.path().to_path_buf();
        std::fs::write(path.join("generated.txt"), "check").unwrap();
    }
    assert!(!path.exists());
    assert!(parent.join("keep.txt").exists());
    std::fs::remove_dir_all(parent).unwrap();
}

#[test]
fn download_counts_layers_without_counting_repeated_updates_twice() {
    let mut tracker = DownloadProgress::default();
    tracker
        .consume(&json!({"digest":"a","completed":40,"total":100}))
        .unwrap();
    tracker
        .consume(&json!({"digest":"a","completed":100,"total":100}))
        .unwrap();
    let value = tracker
        .consume(&json!({"digest":"b","completed":50,"total":100}))
        .unwrap();
    assert_eq!(value.completed, 150);
    assert_eq!(value.total, Some(200));
    assert!(tracker.consume(&json!({"error":"failed"})).is_err());
}

#[test]
fn model_catalog_is_bounded_and_local_configuration_pins_both_models() {
    assert!(model("qwen3.5:cloud").is_err());
    assert!(model("../other").is_err());
    let config = config("qwen3.5:4b");
    assert_eq!(config["model"], config["small_model"]);
    assert_eq!(config["enabled_providers"], json!([PROVIDER]));
    assert_eq!(
        config["provider"][PROVIDER]["options"]["baseURL"],
        "http://127.0.0.1:11434/v1"
    );
    assert_eq!(
        config["provider"][PROVIDER]["models"]["qwen3.5:4b"]["limit"]["context"],
        65536
    );
}

#[test]
fn operations_cannot_overlap_and_retry_clears_cancellation() {
    let service = LocalAi::default();
    let operation = service.begin().unwrap();
    assert!(service.begin().is_err());
    service.canceled.store(true, Ordering::SeqCst);
    drop(operation);
    let _retry = service.begin().unwrap();
    assert!(!service.canceled.load(Ordering::SeqCst));
}
