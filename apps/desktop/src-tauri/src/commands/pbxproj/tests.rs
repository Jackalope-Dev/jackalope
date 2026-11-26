//! Fixtures are XcodeGen projects: a base app, one branch that adds a Swift file
//! and a framework target, another that adds a Swift file, a framework target and
//! a local Swift package, the project XcodeGen writes for both changes together,
//! and two branches that set the app's bundle identifier differently. XcodeGen
//! derives IDs from paths, so the combined project is what a correct merge of the
//! two branches must produce.

use super::*;

const BASE: &str = include_str!("fixtures/base.pbxproj");
const CORE: &str = include_str!("fixtures/core.pbxproj");
const NETWORK: &str = include_str!("fixtures/network.pbxproj");
const BOTH: &str = include_str!("fixtures/core_and_network.pbxproj");
const ALPHA: &str = include_str!("fixtures/bundle_alpha.pbxproj");
const BETA: &str = include_str!("fixtures/bundle_beta.pbxproj");

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|id| id.to_string()).collect()
}

#[test]
fn every_object_reads_and_writes_back_byte_for_byte() {
    for text in [BASE, CORE, NETWORK, BOTH, ALPHA, BETA] {
        let document = Document::parse(text).unwrap();
        let objects: Vec<Object> = document.objects().cloned().collect();
        assert!(objects.len() > 15);
        for object in &objects {
            assert_eq!(
                write_object(&object.key_text, object.entries.clone(), object.one_line),
                object.text,
                "{}",
                object.id
            );
        }
        assert_eq!(
            Document::write(&document.head, &document.tail, objects.clone(), true),
            text
        );
        assert_eq!(
            Document::write(&document.head, &document.tail, objects, false),
            text
        );
    }
}

#[test]
fn concurrent_files_targets_and_a_package_merge_into_the_combined_project() {
    assert_eq!(merge(BASE, CORE, NETWORK).unwrap(), BOTH);
    // The other direction differs only where both sides added to one list, which
    // keeps the first side's additions first.
    let reversed = merge(BASE, NETWORK, CORE).unwrap();
    Document::parse(&reversed).unwrap();
    for line in BOTH.lines() {
        assert!(reversed.contains(line), "{line}");
    }
    assert_eq!(reversed.len(), BOTH.len());
}

#[test]
fn one_sided_and_identical_changes_are_taken_as_they_are() {
    assert_eq!(merge(BASE, CORE, BASE).unwrap(), CORE);
    assert_eq!(merge(BASE, BASE, NETWORK).unwrap(), NETWORK);
    assert_eq!(merge(BASE, BOTH, BOTH).unwrap(), BOTH);
}

#[test]
fn the_same_setting_changed_two_ways_names_both_configurations() {
    let conflicts = merge(BASE, ALPHA, BETA).unwrap_err();
    assert_eq!(conflicts.len(), 2, "{conflicts:?}");
    for conflict in &conflicts {
        assert_eq!(conflict.id.len(), 24);
        assert!(matches!(
            conflict.name.as_deref(),
            Some("Debug" | "Release")
        ));
        assert!(conflict
            .reason
            .contains("buildSettings.PRODUCT_BUNDLE_IDENTIFIER"));
    }
    assert!(conflicts[0].describe().starts_with(&conflicts[0].id));
}

#[test]
fn deleting_an_object_the_other_side_changed_or_uses_is_a_conflict() {
    // Ours removes ContentView.swift from the project; theirs renames its file reference.
    let file = "0546BD31507D09FBD8F81BED";
    let ours: String = BASE
        .lines()
        .filter(|line| !line.contains("ContentView.swift"))
        .map(|line| format!("{line}\n"))
        .collect();
    let theirs = BASE.replace(
        "path = ContentView.swift; sourceTree",
        "path = HomeView.swift; sourceTree",
    );
    let conflicts = merge(BASE, &ours, &theirs).unwrap_err();
    assert_eq!(conflicts[0].id, file);
    assert_eq!(conflicts[0].name.as_deref(), Some("ContentView.swift"));
    // A new build file that points at the removed reference would dangle.
    let theirs = BASE.replace(
        "/* End PBXBuildFile section */",
        "\t\tFFFFFFFFFFFFFFFFFFFFFFFF /* ContentView.swift in Resources */ = {isa = PBXBuildFile; fileRef = 0546BD31507D09FBD8F81BED /* ContentView.swift */; };\n/* End PBXBuildFile section */",
    );
    let conflicts = merge(BASE, &ours, &theirs).unwrap_err();
    assert_eq!(conflicts[0].id, "FFFFFFFFFFFFFFFFFFFFFFFF");
    assert!(conflicts[0].reason.contains(file));
    // Removing it on one side and leaving it alone on the other just removes it.
    assert_eq!(merge(BASE, &ours, BASE).unwrap(), ours);
}

#[test]
fn files_outside_xcodes_layout_are_not_merged() {
    let conflicts = merge("a\n", "b\n", "c\n").unwrap_err();
    assert!(conflicts[0].id.is_empty());
    assert!(conflicts[0].reason.starts_with("Not an Xcode project file"));
    let crlf = CORE.replace('\n', "\r\n");
    assert!(merge(BASE, &crlf, NETWORK).is_err());
    let markers = CORE.replace(
        "/* End PBXBuildFile section */",
        "<<<<<<< ours\n/* End PBXBuildFile section */",
    );
    assert!(merge(BASE, &markers, NETWORK).is_err());
}

#[test]
fn list_order_keeps_both_sides_insertions_and_removals() {
    let base = ids(&["a", "b", "c"]);
    assert_eq!(
        order(
            &base,
            &ids(&["a", "x", "b", "c"]),
            &ids(&["a", "b", "y", "c"])
        )
        .unwrap(),
        ids(&["a", "x", "b", "y", "c"])
    );
    // Insertions at the same spot: ours first, then theirs.
    assert_eq!(
        order(
            &base,
            &ids(&["a", "b", "c", "x"]),
            &ids(&["a", "b", "c", "y"])
        )
        .unwrap(),
        ids(&["a", "b", "c", "x", "y"])
    );
    assert_eq!(
        order(
            &base,
            &ids(&["x", "a", "b", "c"]),
            &ids(&["y", "a", "b", "c"])
        )
        .unwrap(),
        ids(&["x", "y", "a", "b", "c"])
    );
    // A removal on either side, and an element both added, appear once or not at all.
    assert_eq!(
        order(&base, &ids(&["a", "c", "z"]), &ids(&["a", "b", "z"])).unwrap(),
        ids(&["a", "z"])
    );
    // One side's reordering is kept; two different reorderings are a conflict.
    assert_eq!(
        order(&base, &ids(&["a", "b", "c", "x"]), &ids(&["c", "b", "a"])).unwrap(),
        ids(&["c", "x", "b", "a"])
    );
    assert_eq!(
        order(&base, &ids(&["b", "a", "c"]), &ids(&["c", "b", "a"])),
        None
    );
}

#[test]
fn sorted_group_children_stay_sorted_and_build_phases_keep_their_order() {
    let item = |id: &str, name: &str| Value::Scalar {
        value: id.into(),
        text: format!("{id} /* {name} */"),
    };
    let base = vec![item("1", "B.swift")];
    let ours = vec![item("1", "B.swift"), item("3", "C.swift")];
    let theirs = vec![item("2", "A.swift"), item("1", "B.swift")];
    let names = |items: Vec<Value>| -> Vec<String> { items.iter().map(Value::display).collect() };
    assert_eq!(
        names(merge_list(&base, &ours, &theirs, true).unwrap()),
        ["a.swift", "b.swift", "c.swift"]
    );
    let ours = vec![item("1", "B.swift"), item("4", "Z.swift")];
    let theirs = vec![item("1", "B.swift"), item("2", "A.swift")];
    assert_eq!(
        names(merge_list(&base, &ours, &theirs, false).unwrap()),
        ["b.swift", "z.swift", "a.swift"]
    );
}
