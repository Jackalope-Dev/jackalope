use super::*;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

type Analysis = (Vec<CodebaseReference>, Vec<symbols::CodebaseSymbol>, bool);
struct Entry {
    key: String,
    value: Analysis,
    bytes: usize,
}
static CACHE: LazyLock<Mutex<VecDeque<Entry>>> = LazyLock::new(|| Mutex::new(VecDeque::new()));

pub(super) fn analyze(parser: &mut Parser, path: &str, text: &str, rust: bool) -> Analysis {
    cached(parser, path, text, rust)
}

fn cached(parser: &mut Parser, path: &str, text: &str, rust: bool) -> Analysis {
    let hash: String = Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let key = format!("{path}:{rust}:{hash}");
    if let Ok(cache) = CACHE.lock() {
        if let Some(entry) = cache.iter().find(|entry| entry.key == key) {
            return entry.value.clone();
        }
    }
    let value = super::analyze(parser, path, text, rust);
    if !value.2 {
        let bytes = serde_json::to_vec(&value).map_or(usize::MAX, |v| v.len());
        if bytes <= 128_000 {
            if let Ok(mut cache) = CACHE.lock() {
                cache.retain(|entry| entry.key != key);
                cache.push_back(Entry {
                    key,
                    value: value.clone(),
                    bytes,
                });
                while cache.len() > 512 || cache.iter().map(|e| e.bytes).sum::<usize>() > 4_000_000
                {
                    cache.pop_front();
                }
            }
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edited_source_invalidates_analysis_without_using_mtime() {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
            .unwrap();
        let first = cached(
            &mut parser,
            "cache-test.ts",
            "export function before() {}",
            false,
        );
        let second = cached(
            &mut parser,
            "cache-test.ts",
            "export function after() {}",
            false,
        );
        assert_eq!(first.1[0].name, "before");
        assert_eq!(second.1[0].name, "after");
        assert_eq!(
            cached(
                &mut parser,
                "cache-test.ts",
                "export function before() {}",
                false
            )
            .1,
            first.1
        );
    }
}
