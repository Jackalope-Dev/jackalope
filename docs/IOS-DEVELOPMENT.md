# iOS development

How Jackalope works on iOS projects on a Mac: the Xcode toolchain it uses, the
Simulator each task gets, the tools agents use to see and drive an app, previews and
review captures, workspace caches, project file merges, physical devices, TestFlight
delivery and remote Macs. Web projects use [browser automation](BROWSER-AUTOMATION.md)
for the same jobs.

## Xcode toolchain and project detection

`commands/xcode.rs` resolves the Xcode that iOS work uses. An explicit `DEVELOPER_DIR`
wins, then a full Xcode selected with `xcode-select`; when the selection is the Command
Line Tools (no `xcodebuild` or `simctl`) or missing, Jackalope picks an installed
`Xcode.app` in `/Applications` or `~/Applications`, preferring `Xcode.app`, then the
newest `Xcode*.app`. It never changes the system selection. `xcode_status` reports the
result to the app.

Processes Jackalope runs in an Xcode project's workspace get `DEVELOPER_DIR` when the
resolved Xcode is not the system selection: agent processes on this device, preparation
and check commands (`verification.rs` `shell`), preview commands and task terminals
(saved terminal commands run inside them). A `DEVELOPER_DIR` already set on the process
is left alone. Other projects keep the system selection, so their Git, compilers and
`make` do not depend on Xcode's license state.

`xcode/project.rs` recognises a project in the repository root or its `ios` folder, in
this order:

| Found | Treated as | Suggested preparation |
| --- | --- | --- |
| `*.xcworkspace` (never the `project.xcworkspace` inside a project) | workspace | `pod install` with a `Podfile`, else `xcodebuild -resolvePackageDependencies` |
| `*.xcodeproj` | project | as above |
| XcodeGen `project.yml` | the generated `<name>.xcodeproj` | `xcodegen generate` |
| Tuist `Project.swift`, `Workspace.swift` or `Tuist/` | the generated `<name>.xcworkspace` | `tuist generate --no-open` |
| `Package.swift` only | Swift package | `swift package resolve` |

The suggested check builds and tests on the task's own Simulator, for example
`xcodebuild test -workspace App.xcworkspace -scheme App -destination "id=$JACKALOPE_SIMULATOR_UDID" -quiet`;
a package that is not an iOS app uses `swift test`. The scheme comes from the shared
schemes saved in the project and `xcodebuild -list -json` (run through the resolved
Xcode with a 20-second timeout; failure falls back to the saved schemes or the project
name), preferring a scheme with tests, then one named like the project. A project targets
iOS when its `project.pbxproj` sets `SDKROOT = iphoneos` or an iOS deployment target, or
its XcodeGen, Tuist, CocoaPods or package manifest names iOS.

Commands in AGENTS.md, CLAUDE.md, CONTRIBUTING.md and README.md are recognised for
`xcodebuild` (`test`, `build`, `-resolvePackageDependencies`), `swift` (`test`, `build`,
`package resolve`), `xcodegen`, `tuist` (`install`, `generate`, `test`), `pod install`,
`fastlane` test lanes (`test`, `tests`, `scan`, `unit_tests`) and any of these behind
`bundle exec`. Quotes, commas and `$` are allowed in them; pipes, `;` and `&` are not. A
documented `-destination` that names a Simulator is replaced with the task's own, and
`tuist generate` gains `--no-open`.

Project readiness (`project_readiness`) reports `toolchainIssue` when the folder is an
Xcode project and no full Xcode is installed, quoting what `xcode-select -p` reports, and
a note naming the Xcode tasks use when it differs from the selection. Workspace
readiness and the project overview's Setup row show the issue. Project discovery tags
Swift, iOS, Xcode, XcodeGen, Tuist and CocoaPods.

## Task simulators

Each workspace of an iOS project gets its own Simulator, created by
`commands/simulators.rs` with `simctl create` from the project's base device and named
`Jackalope <first 8 characters of the task id>`. Continuations and retries in the same
workspace reuse it, so installed apps and their data persist across follow-ups. Devices
boot headless with `simctl bootstatus <udid> -b`; Jackalope never opens Simulator or
DeviceHub.

When a device is assigned:

- An agent on this device in a project that targets iOS gets one before it starts. It
  boots in the background, and the agent's launch text names it.
- Preparation gets one (not booted) and a check gets a booted one when the command names
  `$JACKALOPE_SIMULATOR_UDID`, or runs `xcodebuild`, `fastlane`, `tuist test` or `simctl`
  in an iOS project. A JavaScript check in a React Native app gets none.
- A check in a disposable worktree (combined checks before merging, challenge reruns)
  gets a temporary device that is deleted with it.
- Previews and task terminals receive an already assigned device; they never create one.

Processes receive `JACKALOPE_SIMULATOR_UDID` and `JACKALOPE_SIMULATOR_NAME`. When a
device cannot be had, the reason is recorded in the task's activity (or prefixed to a
disposable check's output) and the command runs without it.

At most `JACKALOPE_SIMULATOR_CONCURRENCY` (1–8) devices are booted at once; the default
is one per 8 GB of memory and per four cores, at most three. A boot beyond the limit
first shuts down the least recently used idle device, otherwise waits up to five minutes
or until the task stops. A device is busy while a running attempt uses its workspace or a
Jackalope command holds it. Booted devices idle for ten minutes shut down, and all of
Jackalope's devices shut down when the app quits (waiting at most three seconds).

Every created device is recorded in `simulators/devices.json` in the profile's data
folder, and only recorded devices are ever shut down or deleted. Removing a workspace
(cleanup, archive or leftover-folder removal) deletes its device in the background;
removal waits while a Jackalope command is booting or using it. On start, recorded devices
that no longer exist are forgotten and those whose workspace is gone are deleted. A
device that cannot be deleted stays recorded and is retried on the next start.

Project settings → Commands → iOS Simulator chooses the device type and iOS version
(`ProjectRecord.simulator`, `{deviceType, runtime}` identifiers). Without a choice, or
when the chosen pair is no longer installed, devices use the newest available iOS
runtime and its newest standard iPhone (for example iPhone 17 rather than a Pro model).
`simulator_catalog` lists the runtimes and device types; `task_simulator` returns a
task's device.

Other native modules use:

| API | Purpose |
| --- | --- |
| `simulators::ensure(runtime, run_id, canceled) -> Result<Device>` | The task's device, created and booted within the pool |
| `simulators::assign(runtime, run_id)` | Created but not booted; fast |
| `simulators::assigned(workspace)`, `assigned_to_run(runtime, run_id)` | The current device, without creating one |
| `simulators::boot(&device, canceled)`, `boot_in_background(device, canceled)` | Boot within the pool |
| `simulators::InUse::new(&device)` | Holds a device so it is not shut down or evicted while a command uses it |
| `simulators::simctl()` | `xcrun simctl` through the resolved Xcode |
| `Device { udid, name, runtime, device_type, state }` | `environment()` and `guidance()` give its variables and agent text |

Run the opt-in test that creates, boots, uses and deletes a real device on a Mac with
Xcode:

~~~sh
cd apps/desktop/src-tauri
cargo test --lib simulators::tests::real_device_lifecycle -- --ignored --nocapture
~~~

## Simulator tools

<!-- section: simulator-tools -->

## Simulator previews and review captures

<!-- section: simulator-preview -->

## Workspaces and build caches

<!-- section: workspaces -->

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
