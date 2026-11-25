//! Xcode's trust check for Swift macros and package plugins.
//!
//! Xcode runs a package's macros only after someone has trusted them once in
//! the Xcode app; `xcodebuild` has no prompt and stops with "must be enabled
//! before it can be used". Jackalope keeps the check: it names the packages
//! and tells the person how to trust them, and never passes
//! `-skipMacroValidation` itself.

use std::path::Path;

/// One macro or plugin target Xcode refused to run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Untrusted {
    pub target: String,
    pub package: String,
}

/// The macros and plugins `output` says must be enabled, in order, without repeats.
pub fn untrusted(output: &str) -> Vec<Untrusted> {
    let mut found: Vec<Untrusted> = Vec::new();
    for line in output.lines() {
        let Some(at) = line.find("must be enabled before it can be used") else {
            continue;
        };
        let head = &line[..at];
        let Some(kind) = ["Macro ", "Plugin "]
            .iter()
            .filter_map(|kind| head.rfind(kind).map(|start| start + kind.len()))
            .max()
        else {
            continue;
        };
        let quoted = quoted(&head[kind..]);
        if let [target, package, ..] = quoted.as_slice() {
            let item = Untrusted {
                target: target.clone(),
                package: package.clone(),
            };
            if !found.contains(&item) {
                found.push(item);
            }
        }
    }
    found
}

/// What to do when `output` shows untrusted macros or plugins, naming the
/// project to open when it is known.
pub fn hint(output: &str, project: Option<&Path>) -> Option<String> {
    let found = untrusted(output);
    if found.is_empty() {
        return None;
    }
    let mut packages: Vec<String> = Vec::new();
    for item in &found {
        let entry = format!("{} ({})", item.package, item.target);
        if !packages.contains(&entry) {
            packages.push(entry);
        }
    }
    let open = project
        .and_then(Path::file_name)
        .map(|name| format!("Open {} in Xcode", name.to_string_lossy()))
        .unwrap_or_else(|| "Open the project in Xcode".into());
    Some(format!(
        "Xcode has not been allowed to run Swift macros or plugins from: {}. {open} once, build it, and choose Trust & Enable for each package when Xcode asks (or from the build error in the Issue navigator). Xcode remembers this on this Mac, so later command-line builds pass; it asks again when a package's macros change. Jackalope does not skip this check.",
        packages.join(", ")
    ))
}

/// `text` with [`hint`] added at the end when it applies.
pub fn explain(text: &str, project: Option<&Path>) -> String {
    match hint(text, project) {
        Some(hint) => format!("{text}\n\n{hint}"),
        None => text.to_string(),
    }
}

/// The contents of each pair of straight or curly double quotes, in order.
fn quoted(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut current: Option<String> = None;
    for character in text.chars() {
        match (&mut current, character) {
            (None, '"' | '“') => current = Some(String::new()),
            (Some(value), '"' | '”') => {
                found.push(std::mem::take(value));
                current = None;
            }
            (Some(value), other) => value.push(other),
            (None, _) => {}
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTPUT: &str = "\
/w/SourcePackages/checkouts/swift-case-paths/Package.swift:PACKAGE-TARGET:CasePathsMacros: error: Macro “CasePathsMacros” from package “swift-case-paths” must be enabled before it can be used
/w/SourcePackages/checkouts/swift-composable-architecture/Package.swift:PACKAGE-TARGET:ComposableArchitectureMacros: error: Macro “ComposableArchitectureMacros” from package “swift-composable-architecture” must be enabled before it can be used
/w/SourcePackages/checkouts/swift-case-paths/Package.swift:PACKAGE-TARGET:CasePathsMacros: error: Macro “CasePathsMacros” from package “swift-case-paths” must be enabled before it can be used
error: Plugin \"SwiftLintBuildToolPlugin\" from package \"SwiftLintPlugins\" must be enabled before it can be used
** BUILD FAILED **";

    #[test]
    fn finds_each_untrusted_macro_and_plugin_once() {
        let found = untrusted(OUTPUT);
        assert_eq!(
            found,
            vec![
                Untrusted {
                    target: "CasePathsMacros".into(),
                    package: "swift-case-paths".into()
                },
                Untrusted {
                    target: "ComposableArchitectureMacros".into(),
                    package: "swift-composable-architecture".into()
                },
                Untrusted {
                    target: "SwiftLintBuildToolPlugin".into(),
                    package: "SwiftLintPlugins".into()
                },
            ]
        );
    }

    #[test]
    fn hint_names_the_packages_and_the_project() {
        let hint = hint(OUTPUT, Some(Path::new("Demo.xcodeproj"))).unwrap();
        assert!(hint.contains("swift-case-paths (CasePathsMacros)"));
        assert!(hint.contains("Open Demo.xcodeproj in Xcode once"));
        assert!(hint.contains("Trust & Enable"));
        assert_eq!(hint.matches("swift-case-paths").count(), 1);
    }

    #[test]
    fn other_failures_get_no_hint() {
        let text = "error: cannot find 'x' in scope\n** BUILD FAILED **";
        assert_eq!(hint(text, None), None);
        assert_eq!(explain(text, None), text);
        assert!(explain(OUTPUT, None).ends_with("Jackalope does not skip this check."));
    }
}
