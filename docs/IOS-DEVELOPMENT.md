# iOS development

How Jackalope works on iOS projects on a Mac: the Xcode toolchain it uses, the
Simulator each task gets, the tools agents use to see and drive an app, previews and
review captures, workspace caches, project file merges, physical devices, TestFlight
delivery and remote Macs. Web projects use [browser automation](BROWSER-AUTOMATION.md)
for the same jobs.

## Xcode toolchain and project detection

<!-- section: toolchain -->

## Task simulators

<!-- section: simulators -->

## Simulator tools

<!-- section: simulator-tools -->

## Simulator previews and review captures

<!-- section: simulator-preview -->

## Workspaces and build caches

<!-- section: workspaces -->

## Xcode project merges

Parallel tasks that each add a file to an Xcode project all edit
`*.xcodeproj/project.pbxproj` in the same four places (a build file, a file reference, a
group's `children` and a build phase's `files`), so Git alone reports a conflict even when
the changes are independent. Every merge Jackalope makes resolves these files by
structure instead: integration review preparation, feature-dependency bases,
reconciliation input, peer conflict prediction, the cleanup content check and
**Merge locally**.

The merge reads Xcode's OpenStep property-list layout and works on the `objects`
dictionary one 24-character ID at a time:

- An object only one side added, changed or deleted is taken from that side with its
  original text. Unchanged objects keep their exact bytes, and objects stay in Xcode's
  section and ID order.
- An object both sides changed is merged key by key. Ordered ID lists (`children`,
  `files`, `targets`, `buildPhases`, `dependencies`, `packageProductDependencies`,
  `packageReferences` and the like) keep the base order and apply both sides' insertions
  and removals; additions at the same spot place the first side's before the second's.
  A group's `children` and a build phase's `files` stay sorted by name when every version
  was. The merged object is written in Xcode's own layout.
- Two sides that independently create the same ID (XcodeGen derives IDs from paths) are
  merged as one object.

A conflict remains, and Git's text with its conflict markers is kept, when both sides
change the same setting differently, one side deletes an object the other changed, the
result would refer to an object one side removed, both sides change the top-level keys
(`objectVersion`, `rootObject`) differently, or the file is not in Xcode's layout (for
example CRLF line endings, a Git LFS pointer or existing markers). A project file in any
conflict other than a content conflict (modify/delete, rename/delete and so on) also keeps
Git's result. Other conflicted files do not
stop the project file from merging; only they are reported. **Merge locally** finishes a
stopped `git merge` this way only when the project files were its only conflicts, and
commits through the repository's normal hooks.

When a reconciliation agent lists a project file that still conflicts, the `conflicts`
tool adds a note naming each object to decide by ID and Xcode name (for example
`553BCFF4DF4A314DE3D572F3 (Debug): Both sides changed
buildSettings.PRODUCT_BUNDLE_IDENTIFIER differently.`), worked out from the file's diff3
blocks. **Split into commits** keeps a project file in one unit, because applying some of
its hunks without the others can leave references to missing objects.

The structured merge runs in Rust (`commands/pbxproj.rs`, called through
`commands/merge_tree.rs`) and needs no Xcode. It does not apply to `.xcworkspace`
contents, schemes or `Package.resolved`, which merge as ordinary text.

To check it, run `cargo test pbxproj merge_tree` from apps/desktop/src-tauri. The fixtures
in `commands/pbxproj/fixtures` are XcodeGen projects; `core_and_network.pbxproj` is what
XcodeGen writes for both branches' changes together and is the expected merge of
`core.pbxproj` and `network.pbxproj`. To confirm a merged project still opens and builds,
write the merge into a copy of the combined sources and run
`xcodebuild -list -project Demo.xcodeproj` and
`xcodebuild build -scheme Demo -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO`.

## Physical devices

<!-- section: devices -->

## Signing and TestFlight

<!-- section: testflight -->

## Remote Macs

<!-- section: remote-macs -->

## Verification

<!-- section: verification -->
