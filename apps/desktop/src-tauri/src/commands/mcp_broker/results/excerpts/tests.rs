use super::*;

fn search(terms: &[&str]) -> TextSearch {
    serde_json::from_value(json!({"terms":terms,"contextChars":40})).unwrap()
}

fn envelope(data: Value) -> Value {
    serde_json::to_value(CallToolResult::structured(data)).unwrap()
}

#[test]
fn excerpts_preserve_unicode_offsets_sources_and_neighboring_exceptions() {
    let text = "🦊 Café\r\nSTOP terminates the owned process tree.\r\nException: keep unrelated processes running.\r\n界";
    let value = envelope(json!({"items":[{"source":"guide.md","a/b~c":text}]}));
    let mut query = search(&["process tree", "PROCESS TREE"]);
    query.context_chars = Some(30);
    let result = search_inner(&value, &query, "captured", 6000).unwrap();
    assert_eq!(result["matchedOccurrences"], 1);
    assert_eq!(result["matchedExcerpts"], 1);
    let excerpt = &result["excerpts"][0];
    assert_eq!(excerpt["source"], "guide.md");
    assert_eq!(excerpt["pointer"], "/structuredContent/items/0/a~1b~0c");
    let source = value
        .pointer(excerpt["pointer"].as_str().unwrap())
        .unwrap()
        .as_str()
        .unwrap();
    let start = excerpt["start"].as_u64().unwrap() as usize;
    assert!(start > 0);
    let end = excerpt["end"].as_u64().unwrap() as usize;
    assert_eq!(
        source
            .chars()
            .skip(start)
            .take(end - start)
            .collect::<String>(),
        excerpt["text"]
    );
    assert!(excerpt["text"].as_str().unwrap().contains("Exception"));
    assert_eq!(result["sourcePartial"], false);
}

#[test]
fn pagination_is_bounded_complete_and_keeps_conflicting_matches() {
    let value = envelope(json!({"items":[
        {"source":"old","text":"Policy: allow every request."},
        {"source":"new","text":"Policy: deny requests unless authorized."},
        {"source":"extra","text":"Policy: an exception applies to pending requests."}
    ]}));
    let mut query = search(&["policy", "request"]);
    query.limit = Some(1);
    let mut sources = Vec::new();
    loop {
        let result = search_inner(&value, &query, "captured", 1100).unwrap();
        assert!(result.to_string().chars().count() <= 1100);
        assert_eq!(result["matchedExcerpts"], 3);
        assert_eq!(result["resultHandle"], "captured");
        sources.push(result["excerpts"][0]["source"].as_str().unwrap().to_owned());
        let Some(next) = result["nextCursor"].as_str() else {
            break;
        };
        assert_ne!(query.cursor.as_deref(), Some(next));
        query.cursor = Some(next.to_owned());
    }
    assert_eq!(sources, ["old", "new", "extra"]);
}

#[test]
fn distinct_terms_get_first_page_coverage_and_changed_queries_cannot_reuse_cursors() {
    let value = envelope(json!({"items":[{"text":"common"},{"text":"common"},{"text":"rare"}]}));
    let mut query = search(&["common", "rare"]);
    query.limit = Some(2);
    let result = search_inner(&value, &query, "captured", 2000).unwrap();
    assert_eq!(result["excerpts"][0]["text"], "common");
    assert_eq!(result["excerpts"][1]["text"], "rare");
    query.cursor = Some(result["nextCursor"].as_str().unwrap().into());
    assert_eq!(
        search_inner(&value, &query, "captured", 2000).unwrap()["excerpts"][0]["text"],
        "common"
    );
    query.terms = vec!["common".into()];
    assert!(search_inner(&value, &query, "captured", 2000)
        .unwrap_err()
        .contains("Cursor"));
    query.terms.push("rare".into());
    let changed = envelope(json!({"items":[{"text":"changed common"},{"text":"rare"}]}));
    assert!(search_inner(&changed, &query, "captured", 2000)
        .unwrap_err()
        .contains("Cursor"));
}

#[test]
fn missing_scope_and_excessive_queries_are_errors_not_zero_matches() {
    let value = envelope(json!({"text":"An alternative phrasing without the query term."}));
    let mut query = search(&["nonexistent"]);
    let result = search_inner(&value, &query, "captured", 6000).unwrap();
    assert_eq!(result["matchedOccurrences"], 0);
    assert_eq!(result["stringsSearched"], 1);
    assert!(result["hint"].as_str().unwrap().contains("not proof"));
    query.pointer = Some("/absent".into());
    let result = project(&value, &query, "captured", 6000);
    assert!(result["queryError"].as_str().unwrap().contains("absent"));
    assert_eq!(result["resultHandle"], "captured");
    assert_eq!(super::super::response(result, true).is_error, Some(true));
    let too_many = envelope(json!({"text":"x".repeat(10001)}));
    assert!(search_inner(&too_many, &search(&["x"]), "captured", 6000)
        .unwrap_err()
        .contains("10000"));
    assert!(search_inner(&value, &search(&["alternative"]), "captured", 256).is_err());
}

#[test]
fn raw_text_and_partial_sources_are_labeled_without_searching_binary_blocks() {
    let value =
        json!({"content":[{"type":"text","text":"A literal [error]."}],"resultType":"complete"});
    let result = search_inner(&value, &search(&["[error]"]), "captured", 6000).unwrap();
    assert_eq!(result["excerpts"][0]["pointer"], "/content/0/text");
    assert_eq!(result["matchedOccurrences"], 1);
    let value = envelope(json!({"text":"Policy needed here.","hasMore":true}));
    assert_eq!(
        search_inner(&value, &search(&["policy"]), "captured", 6000).unwrap()["sourcePartial"],
        true
    );
    let value = json!({"content":[{"type":"image","data":"policy"}]});
    assert!(search_inner(&value, &search(&["policy"]), "captured", 6000).is_err());
}

#[test]
fn first_read_selection_keeps_original_and_search_pagination_creates_no_snapshots() {
    let original = CallToolResult::structured(
        json!({"items":[{"source":"policy.md","text":format!("{} Required policy. {}", "noise ".repeat(1000), "noise ".repeat(1000))}]}),
    );
    let selection: Selection =
        serde_json::from_value(json!({"text":{"terms":["Required policy"]},"maxChars":2000}))
            .unwrap();
    let mut snapshots = VecDeque::new();
    let selected = super::super::select_inner(
        original.clone(),
        Some(&selection),
        &mut snapshots,
        &mut SelectionStats::default(),
        true,
    );
    assert_eq!(snapshots.len(), 1);
    let data = selected.structured_content.unwrap();
    assert_eq!(data["matchedExcerpts"], 1);
    let handle = data["resultHandle"].as_str().unwrap();
    assert_eq!(
        serde_json::to_value(captured_result(&snapshots, handle).unwrap()).unwrap(),
        serde_json::to_value(original).unwrap()
    );
    let query = project(
        &serde_json::from_str(&snapshots[0].json).unwrap(),
        selection.text.as_ref().unwrap(),
        handle,
        2000,
    );
    assert_eq!(query, data);
    assert_eq!(snapshots.len(), 1);
    assert!(captured_result(&VecDeque::new(), handle).is_err());
}
