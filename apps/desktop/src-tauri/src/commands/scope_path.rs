//! Repository-relative paths that tasks own, touch or name: queue scopes,
//! subtask handoffs, round assignments, peer reads and worktree folders.
//!
//! A path is `/`-separated (a `\` is read as `/`), relative, and has no empty,
//! `.` or `..` segment, drive letter or control character. `.` alone is the
//! whole project. Paths compare with Unicode lowercase, the rule the scope
//! audits that gate integration use, because Windows and macOS checkouts
//! treat differently cased names as the same file.

const MAX_LEN: usize = 500;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ScopePath(String);

impl ScopePath {
    /// Normalizes and validates `text`, keeping its case. A leading `./` and a
    /// trailing `/` are dropped.
    pub(crate) fn parse(text: &str) -> Option<Self> {
        let path = text.trim().replace('\\', "/");
        let path = path.strip_prefix("./").unwrap_or(&path);
        let path = path.trim_end_matches('/');
        if path == "." {
            return Some(Self(".".into()));
        }
        let valid = !path.is_empty()
            && path.len() <= MAX_LEN
            && !path.starts_with('/')
            && !path.contains(':')
            && !path.chars().any(char::is_control)
            && path
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != "..");
        valid.then(|| Self(path.to_string()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// The form scopes are saved and compared in.
    pub(crate) fn key(&self) -> String {
        self.0.to_lowercase()
    }

    pub(crate) fn is_root(&self) -> bool {
        self.0 == "."
    }
}

/// Whether the scope `owner` includes `path`. Both are compared lowercased;
/// `.` includes everything.
pub(crate) fn contains(owner: &str, path: &str) -> bool {
    let (owner, path) = (fold(owner), fold(path));
    owner == "." || owner == path || path.starts_with(&format!("{owner}/"))
}

/// Whether two scopes can touch the same files: equal, nested, or the root.
pub(crate) fn overlaps(a: &str, b: &str) -> bool {
    contains(a, b) || contains(b, a)
}

/// Whether any of `scopes` includes `path`.
pub(crate) fn any_contains(scopes: &[String], path: &str) -> bool {
    scopes.iter().any(|scope| contains(scope, path))
}

/// Whether any scope of `a` overlaps any scope of `b`.
pub(crate) fn any_overlap(a: &[String], b: &[String]) -> bool {
    a.iter().any(|a| b.iter().any(|b| overlaps(a, b)))
}

fn fold(path: &str) -> String {
    ScopePath::parse(path).map_or_else(|| path.to_lowercase(), |path| path.key())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_normalized_and_escapes_rejected() {
        assert_eq!(ScopePath::parse("./Src\\UI/").unwrap().as_str(), "Src/UI");
        assert!(ScopePath::parse(".").unwrap().is_root());
        for bad in ["", "/etc", "C:/x", "a/../b", "a//b", "a/./b", "..", "a\nb"] {
            assert!(ScopePath::parse(bad).is_none(), "{bad:?}");
        }
        assert!(ScopePath::parse(&"a".repeat(501)).is_none());
    }

    #[test]
    fn containment_and_overlap_fold_case_and_respect_segments() {
        assert!(overlaps("src/ui", "src/ui/form.tsx"));
        assert!(overlaps("./Src/UI/", "src/ui"));
        assert!(overlaps(".", "docs"));
        assert!(!overlaps("src/ui", "src/uikit"));
        assert!(!overlaps("src/a", "src/b"));
        assert!(contains("SRC", "src/a.rs"));
        assert!(!contains("src/a.rs", "src"));
    }
}
