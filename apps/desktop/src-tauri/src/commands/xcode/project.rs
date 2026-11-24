//! Recognising Xcode projects and the commands that prepare and check them.
//!
//! Detection only reads files. Choosing a scheme may run `xcodebuild -list`
//! through the resolved toolchain, bounded by a timeout, and tolerates failure.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Folders searched for a project, in order. `ios` covers React Native,
/// Capacitor and Flutter apps.
const FOLDERS: [&str; 2] = ["", "ios"];
const LIST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Container {
    Workspace,
    Project,
    /// A Swift package with no Xcode project.
    Package,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Generator {
    XcodeGen,
    Tuist,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XcodeProject {
    pub container: Container,
    /// The workspace or project `xcodebuild` opens, relative to the project
    /// root. For a generated project it is the file the generator writes.
    /// `None` for a package or when the generated name is unknown.
    pub path: Option<String>,
    pub generator: Option<Generator>,
    pub cocoapods: bool,
    /// Whether the app targets iOS, so tasks need a Simulator.
    pub ios: bool,
    pub scheme: Option<String>,
}

impl XcodeProject {
    /// The `-workspace X` or `-project X` arguments, shell-quoted.
    fn container_args(&self) -> String {
        match (&self.path, self.container) {
            (Some(path), Container::Workspace) => format!(" -workspace {}", quote(path)),
            (Some(path), Container::Project) => format!(" -project {}", quote(path)),
            _ => String::new(),
        }
    }

    fn scheme_args(&self) -> String {
        self.scheme
            .as_deref()
            .map(|scheme| format!(" -scheme {}", quote(scheme)))
            .unwrap_or_default()
    }

    /// Generates the project or installs pods and packages.
    pub fn prepare_command(&self) -> String {
        let mut steps = Vec::new();
        match self.generator {
            Some(Generator::XcodeGen) => steps.push("xcodegen generate".to_string()),
            Some(Generator::Tuist) => steps.push("tuist generate --no-open".to_string()),
            None => {}
        }
        if self.cocoapods {
            steps.push("pod install".into());
        }
        if steps.is_empty() {
            steps.push(match self.container {
                Container::Package => "swift package resolve".into(),
                _ => format!(
                    "xcodebuild -resolvePackageDependencies{}{}",
                    self.container_args(),
                    self.scheme_args()
                ),
            });
        }
        steps.join(" && ")
    }

    /// Builds and tests on the task's own Simulator, or with `swift test` for a
    /// package that is not an iOS app.
    pub fn verify_command(&self) -> String {
        if self.container == Container::Package && !self.ios {
            return "swift test".into();
        }
        format!(
            "xcodebuild test{}{} -destination \"id=$JACKALOPE_SIMULATOR_UDID\" -quiet",
            self.container_args(),
            self.scheme_args()
        )
    }
}

fn quote(value: &str) -> String {
    if value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"-_./".contains(&b))
    {
        value.into()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn read_text(path: &Path, limit: u64) -> String {
    let mut text = String::new();
    if let Ok(file) = std::fs::File::open(path) {
        let mut bytes = Vec::new();
        let _ = file.take(limit).read_to_end(&mut bytes);
        text = String::from_utf8_lossy(&bytes).into_owned();
    }
    text
}

fn entries(folder: &Path, extension: &str) -> Vec<String> {
    let mut found: Vec<String> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(extension) && !name.starts_with('.'))
        .collect();
    found.sort();
    found
}

fn project_targets_ios(project: &Path) -> bool {
    let text = read_text(&project.join("project.pbxproj"), 8_000_000);
    text.contains("SDKROOT = iphoneos") || text.contains("IPHONEOS_DEPLOYMENT_TARGET")
}

/// The `name:` of an XcodeGen spec, or the `name:` argument of a Tuist
/// `Project(...)`.
fn generated_name(spec: &str, tuist: bool) -> Option<String> {
    if tuist {
        let rest = &spec[spec.find("Project(")?..];
        let rest = &rest[rest.find("name:")? + 5..];
        let rest = rest.trim_start().strip_prefix('"')?;
        return Some(rest[..rest.find('"')?].to_string()).filter(|name| !name.is_empty());
    }
    spec.lines()
        .find_map(|line| line.strip_prefix("name:"))
        .map(|name| name.trim().trim_matches(['"', '\'']).to_string())
        .filter(|name| !name.is_empty())
}

/// Finds an Xcode project in `root` or its `ios` folder without running
/// anything. The scheme is left for [`detect`].
pub fn find(root: &Path) -> Option<XcodeProject> {
    for folder in FOLDERS {
        let dir = root.join(folder);
        let relative = |name: &str| {
            if folder.is_empty() {
                name.to_string()
            } else {
                format!("{folder}/{name}")
            }
        };
        let workspaces = entries(&dir, ".xcworkspace");
        let projects = entries(&dir, ".xcodeproj");
        let xcodegen = dir.join("project.yml").is_file();
        let tuist = dir.join("Project.swift").is_file()
            || dir.join("Tuist").is_dir()
            || dir.join("Workspace.swift").is_file();
        let cocoapods = dir.join("Podfile").is_file();
        let package = dir.join("Package.swift").is_file();
        if workspaces.is_empty() && projects.is_empty() && !xcodegen && !tuist && !package {
            continue;
        }
        let generator = if xcodegen {
            Some(Generator::XcodeGen)
        } else if tuist {
            Some(Generator::Tuist)
        } else {
            None
        };
        let spec = match generator {
            Some(Generator::XcodeGen) => read_text(&dir.join("project.yml"), 1_000_000),
            Some(Generator::Tuist) => read_text(&dir.join("Project.swift"), 1_000_000),
            None => String::new(),
        };
        let generated = generated_name(&spec, generator == Some(Generator::Tuist));
        let (container, path) = if let Some(workspace) = workspaces.first() {
            (Container::Workspace, Some(relative(workspace)))
        } else if let Some(project) = projects.first() {
            (Container::Project, Some(relative(project)))
        } else if generator == Some(Generator::Tuist) || cocoapods {
            // Tuist and CocoaPods both write a workspace.
            (
                Container::Workspace,
                generated
                    .as_ref()
                    .map(|name| relative(&format!("{name}.xcworkspace"))),
            )
        } else if generator == Some(Generator::XcodeGen) {
            (
                Container::Project,
                generated
                    .as_ref()
                    .map(|name| relative(&format!("{name}.xcodeproj"))),
            )
        } else {
            (Container::Package, None)
        };
        let ios = projects
            .iter()
            .any(|project| project_targets_ios(&dir.join(project)))
            || (generator == Some(Generator::XcodeGen) && spec.contains("iOS"))
            || (generator == Some(Generator::Tuist) && spec.contains(".iOS"))
            || (cocoapods && read_text(&dir.join("Podfile"), 200_000).contains(":ios"))
            || (container == Container::Package
                && read_text(&dir.join("Package.swift"), 200_000).contains(".iOS("));
        let scheme = generated
            .filter(|_| container != Container::Package)
            .or_else(|| choose_scheme(&shared_schemes(&dir, &projects), stem(&path)));
        return Some(XcodeProject {
            container,
            path,
            generator,
            cocoapods,
            ios,
            scheme,
        });
    }
    None
}

/// Finds a project and chooses its scheme, asking `xcodebuild -list` when a
/// full Xcode is available.
pub fn detect(root: &Path) -> Option<XcodeProject> {
    let mut project = find(root)?;
    if project.container == Container::Package {
        return Some(project);
    }
    let folder = project
        .path
        .as_deref()
        .and_then(|path| Path::new(path).parent())
        .map(|parent| root.join(parent))
        .unwrap_or_else(|| root.to_path_buf());
    let projects = entries(&folder, ".xcodeproj");
    let mut candidates = shared_schemes(&folder, &projects);
    if let Some(listed) = list_schemes(root, &project) {
        for name in listed {
            if !candidates.iter().any(|(known, _)| known == &name) {
                candidates.push((name, false));
            }
        }
    }
    if let Some(scheme) = choose_scheme(&candidates, stem(&project.path)) {
        project.scheme = Some(scheme);
    }
    Some(project)
}

fn stem(path: &Option<String>) -> Option<&str> {
    Path::new(path.as_deref()?).file_stem()?.to_str()
}

/// Shared schemes saved in the projects, and whether each has tests.
fn shared_schemes(folder: &Path, projects: &[String]) -> Vec<(String, bool)> {
    let mut found = Vec::new();
    for project in projects {
        let schemes = folder.join(project).join("xcshareddata/xcschemes");
        let Ok(entries) = std::fs::read_dir(schemes) else {
            continue;
        };
        let mut names: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        names.sort();
        for path in names {
            if path.extension().is_some_and(|ext| ext == "xcscheme") {
                let tests = read_text(&path, 1_000_000).contains("<TestableReference");
                if let Some(name) = path.file_stem() {
                    found.push((name.to_string_lossy().into_owned(), tests));
                }
            }
        }
    }
    found
}

fn list_schemes(root: &Path, project: &XcodeProject) -> Option<Vec<String>> {
    let path = project.path.as_deref()?;
    if !root.join(path).exists() {
        return None;
    }
    super::toolchain()?;
    let mut command = super::xcrun("xcodebuild");
    command.current_dir(root).arg("-list").arg("-json");
    command.arg(match project.container {
        Container::Workspace => "-workspace",
        _ => "-project",
    });
    command.arg(path);
    let output = super::super::process_control::run(command, LIST_TIMEOUT).ok()?;
    if !output.success {
        return None;
    }
    parse_list(&output.stdout)
}

/// The schemes in `xcodebuild -list -json` output, which may be preceded by
/// log lines.
fn parse_list(output: &str) -> Option<Vec<String>> {
    let value: serde_json::Value = serde_json::from_str(&output[output.find('{')?..]).ok()?;
    let schemes = value["workspace"]["schemes"]
        .as_array()
        .or_else(|| value["project"]["schemes"].as_array())?;
    Some(
        schemes
            .iter()
            .filter_map(|scheme| scheme.as_str().map(str::to_string))
            .collect(),
    )
}

/// Prefers a scheme with tests, then one named like the project, then the
/// first. Package product schemes such as `Foo-Package` sort last.
fn choose_scheme(candidates: &[(String, bool)], stem: Option<&str>) -> Option<String> {
    candidates
        .iter()
        .enumerate()
        .max_by_key(|(index, (name, tests))| {
            (
                *tests,
                Some(name.as_str()) == stem,
                !name.ends_with("-Package"),
                std::cmp::Reverse(*index),
            )
        })
        .map(|(_, (name, _))| name.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!("jackalope-xcproj-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn xcodeproj(root: &Path, name: &str, ios: bool, schemes: &[(&str, bool)]) {
        let project = root.join(name);
        std::fs::create_dir_all(project.join("project.xcworkspace")).unwrap();
        std::fs::write(
            project.join("project.pbxproj"),
            if ios {
                "buildSettings = { SDKROOT = iphoneos; };"
            } else {
                "buildSettings = { SDKROOT = macosx; };"
            },
        )
        .unwrap();
        let shared = project.join("xcshareddata/xcschemes");
        std::fs::create_dir_all(&shared).unwrap();
        for (scheme, tests) in schemes {
            std::fs::write(
                shared.join(format!("{scheme}.xcscheme")),
                if *tests {
                    "<TestAction><Testables><TestableReference/></Testables></TestAction>"
                } else {
                    "<TestAction/>"
                },
            )
            .unwrap();
        }
    }

    #[test]
    fn a_workspace_wins_over_the_project_inside_it() {
        let root = scratch();
        xcodeproj(&root, "Notes.xcodeproj", true, &[("Notes", true)]);
        std::fs::create_dir_all(root.join("Notes.xcworkspace")).unwrap();
        std::fs::write(root.join("Podfile"), "platform :ios, '17.0'").unwrap();
        let found = find(&root).unwrap();
        assert_eq!(found.container, Container::Workspace);
        assert_eq!(found.path.as_deref(), Some("Notes.xcworkspace"));
        assert!(found.cocoapods && found.ios);
        assert_eq!(found.scheme.as_deref(), Some("Notes"));
        assert_eq!(found.prepare_command(), "pod install");
        assert_eq!(
            found.verify_command(),
            "xcodebuild test -workspace Notes.xcworkspace -scheme Notes -destination \"id=$JACKALOPE_SIMULATOR_UDID\" -quiet"
        );
    }

    #[test]
    fn a_plain_project_resolves_packages_and_tests_its_scheme() {
        let root = scratch();
        xcodeproj(
            &root,
            "My App.xcodeproj",
            true,
            &[("Widgets", false), ("My App", true)],
        );
        let found = find(&root).unwrap();
        assert_eq!(found.container, Container::Project);
        assert_eq!(found.scheme.as_deref(), Some("My App"));
        let found = detect(&root).unwrap();
        assert_eq!(found.scheme.as_deref(), Some("My App"));
        assert_eq!(
            found.prepare_command(),
            "xcodebuild -resolvePackageDependencies -project 'My App.xcodeproj' -scheme 'My App'"
        );
    }

    #[test]
    fn a_macos_project_needs_no_simulator() {
        let root = scratch();
        xcodeproj(&root, "Tool.xcodeproj", false, &[]);
        assert!(!find(&root).unwrap().ios);
    }

    #[test]
    fn generators_and_packages() {
        let root = scratch();
        std::fs::write(
            root.join("project.yml"),
            "name: Driver\ntargets:\n  Host:\n    platform: iOS\n",
        )
        .unwrap();
        let found = find(&root).unwrap();
        assert_eq!(found.generator, Some(Generator::XcodeGen));
        assert_eq!(found.path.as_deref(), Some("Driver.xcodeproj"));
        assert_eq!(found.scheme.as_deref(), Some("Driver"));
        assert!(found.ios);
        assert_eq!(found.prepare_command(), "xcodegen generate");

        let tuist = scratch();
        std::fs::write(
            tuist.join("Project.swift"),
            "let project = Project(\n  name: \"Shop\",\n  targets: [.target(name: \"Shop\", destinations: .iOS)]\n)",
        )
        .unwrap();
        let found = find(&tuist).unwrap();
        assert_eq!(found.generator, Some(Generator::Tuist));
        assert_eq!(found.path.as_deref(), Some("Shop.xcworkspace"));
        assert_eq!(found.prepare_command(), "tuist generate --no-open");

        let package = scratch();
        std::fs::write(
            package.join("Package.swift"),
            "let package = Package(name: \"Core\", platforms: [.macOS(.v14)])",
        )
        .unwrap();
        let found = detect(&package).unwrap();
        assert_eq!(found.container, Container::Package);
        assert!(!found.ios);
        assert_eq!(found.prepare_command(), "swift package resolve");
        assert_eq!(found.verify_command(), "swift test");

        let native = scratch();
        std::fs::create_dir_all(native.join("ios")).unwrap();
        xcodeproj(&native.join("ios"), "Mobile.xcodeproj", true, &[]);
        let found = find(&native).unwrap();
        assert_eq!(found.path.as_deref(), Some("ios/Mobile.xcodeproj"));
        assert!(find(&scratch()).is_none());
    }

    #[test]
    fn list_output_and_scheme_choice() {
        let output = "Command line invocation:\n{\n  \"project\" : { \"name\" : \"App\", \"schemes\" : [\"App-Package\", \"App\", \"Other\"] }\n}";
        assert_eq!(
            parse_list(output).unwrap(),
            vec!["App-Package", "App", "Other"]
        );
        let workspace = r#"{"workspace":{"name":"W","schemes":["Pods-App","App"]}}"#;
        assert_eq!(parse_list(workspace).unwrap(), vec!["Pods-App", "App"]);
        let listed = |names: &[&str]| -> Vec<(String, bool)> {
            names.iter().map(|name| (name.to_string(), false)).collect()
        };
        assert_eq!(
            choose_scheme(&listed(&["App-Package", "Other", "App"]), Some("App")).as_deref(),
            Some("App")
        );
        assert_eq!(
            choose_scheme(&listed(&["App-Package", "Other"]), Some("App")).as_deref(),
            Some("Other")
        );
        let mut tested = listed(&["App"]);
        tested.push(("AppTests".into(), true));
        assert_eq!(
            choose_scheme(&tested, Some("App")).as_deref(),
            Some("AppTests")
        );
        assert_eq!(choose_scheme(&[], None), None);
        assert_eq!(quote("it's"), "'it'\\''s'");
    }
}
