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

Every task workspace gets two folders for Xcode output, exported to preparation, checks,
disposable check worktrees and agents on this device:

| Variable | Folder | Use with |
| --- | --- | --- |
| `JACKALOPE_DERIVED_DATA` | `<workspace>/.jackalope/DerivedData` | `xcodebuild -derivedDataPath "$JACKALOPE_DERIVED_DATA"` |
| `JACKALOPE_SPM_CACHE` | `<workspace>/.jackalope/DerivedData/SourcePackages` | `xcodebuild -clonedSourcePackagesDirPath "$JACKALOPE_SPM_CACHE"` |

`-derivedDataPath` alone puts packages in the same `SourcePackages` folder, so either flag
reuses it. Xcode's default DerivedData is keyed by the checkout's path, so without these
flags every worktree resolves and builds from scratch, and parallel tasks contend for
the same per-path folders when they share one. `.jackalope/` is excluded from Git, and
worktree cleanup and archive discard `DerivedData`, `SourcePackages`, `Pods` and `.build`
without blocking (their package checkouts hold `.git` folders and build databases that
would otherwise look like local data).

**Swift package snapshots.** After preparation or a check succeeds, Jackalope saves the
workspace's `SourcePackages` as a copy-on-write snapshot in
`<data>/source-packages/<project digest>/<resolution digest>`, keyed by the Xcode
`Package.resolved` files (those in `*.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/`
and `*.xcworkspace/xcshareddata/swiftpm/`). It saves one only when SwiftPM's
`workspace-state.json` holds exactly the pinned identities and revisions, every
dependency is a remote repository or registry package, and every absolute path it
records lies inside the folder. A new isolated worktree whose `Package.resolved` files
match a snapshot gets a clone of it before preparation, with or without a preparation
command, and the paths SwiftPM recorded (each checkout's Git alternates and `origin`,
macro `prebuilts` and binary `artifacts`) are rewritten to the worktree's folder, so
Xcode resolves without fetching and nothing refers back to the snapshot. Each worktree
owns its clone, so concurrent `xcodebuild` runs never share one checkout folder; snapshot
writes are serialized in the app and published by renaming a staging folder. Three
snapshots per project are kept, most recently used first. Projects with local packages
(`.package(path:)` or local Xcode package references) are not snapshotted; a volume
without copy-on-write clones gets no snapshot or seed.

**Installed folders from the checkout.** With a preparation command, a new worktree also
gets copy-on-write clones of the checkout's CocoaPods `Pods` (beside `Podfile.lock`),
Carthage `Carthage/Build` (beside `Cartfile.resolved`) and a pure Swift package's `.build`
resolution (beside `Package.resolved` and `Package.swift`) when the manifests match; see
[Preparation and verification](CORE-WORKFLOW.md#preparation-and-verification) for the
rules each one must pass. The fingerprint that gates those clones and skips repeated
preparation includes `Podfile`, `Podfile.lock`, `Package.swift`, every `Package.resolved`,
`project.yml`, `Cartfile.resolved`, `.xcode-version` and `DEVELOPER_DIR`.

**Time limits.** Xcode builds and test runs can print nothing for many minutes while they
compile packages or boot a simulator. Project settings → Commands → Time limits sets the
setup quiet limit, check quiet limit and total limit per project; for a project with an
`.xcodeproj` or `.xcworkspace` it suggests 15 and 20 quiet minutes and 60 in total. Existing
projects keep the defaults (5, 10 and 30 minutes) until someone saves values.

Command-line builds of packages that declare Swift macros stop at Xcode's macro trust
check ("must be enabled before it can be used") until the macros are trusted for that
Xcode, as with any `xcodebuild` run.

## Xcode project merges

<!-- section: pbxproj -->

## Physical devices

<!-- section: devices -->

## Signing and TestFlight

<!-- section: testflight -->

## Remote Macs

<!-- section: remote-macs -->

## Verification

<!-- section: verification -->
