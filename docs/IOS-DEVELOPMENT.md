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
- Web previews and task terminals receive an already assigned device; they never create
  one. **Run in Simulator** and Simulator review captures create and boot it.

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

Agents drive an iOS app in the Simulator the way the browser tools drive a page:
headless, without a Simulator or DeviceHub window and without macOS Accessibility
permission. Native MCP and the task HTTP bridge (`/v1/simulator/...`) expose the same
six tools:

| Tool | Behavior |
| --- | --- |
| `simulator_app` | `install` a simulator build's `.app` (absolute or workspace-relative; the bundle ID is read from its `Info.plist`), `launch` with arguments and environment (`simctl launch --terminate-running-process`, variables passed as `SIMCTL_CHILD_*`), `terminate`, `uninstall`, `activate` (bring a running app forward), `state`, `open_url` (links and deep links) and `list` installed apps. |
| `simulator_snapshot` | The app in front as an accessibility tree: type, label, identifier, value, placeholder, disabled/selected/focused and frame in points, each element with an `@e` ref. Optional `bundle_id`, `interactive` (controls only), `scope` (an identifier or label whose subtree is read) and `max_depth`. System alerts over the app, such as permission prompts, are listed after the tree with their own refs. |
| `simulator_interact` | `tap`, `double_tap`, `long_press`, `type` (into a ref, or the focused field), `clear`, `swipe` (finger direction), `scroll` (content direction), `scroll_to` (scroll until a ref is on screen), `press_button` (`home`), `rotate` and `wait` for text or a ref to appear or, with `gone`, disappear (at most 30 seconds). Refs come from the latest snapshot; x/y points are the fallback. |
| `simulator_screenshot` | Saves the screen through the task screenshot artifacts (`simulator://<udid>` as its address) so it appears in the attempt and Review like a browser capture, downscaled when it exceeds the 8 MiB limit. |
| `simulator_configure` | Appearance light/dark, Dynamic Type `content_size`, `increase_contrast`, `location` or `clear_location`, `privacy` grant/revoke/reset for an app, `status_bar` `clean` (9:41, full signal, charged) or `clear`, a test `push` payload with an `aps` object (at most 4 KB), pasteboard text and `read_pasteboard`. Settings apply in that order and an error names what was already applied. |
| `simulator_logs` | Unified log lines from the app's executable for the last `seconds` (default 120, at most 600) at `default`, `info` or `debug` level, filtered by `contains`, newest 40,000 characters kept, plus up to two crash reports from the last day (the host's DiagnosticReports naming the device, and the device's CrashReporter folder). |

Tools are offered on macOS when Xcode resolves and the workspace has an `.xcodeproj`,
`.xcworkspace`, `Package.swift`, XcodeGen `project.yml` or Tuist `Project.swift` at its
root or one folder below. They belong to the `simulator` group for deferred tool
surfaces, Codex approves them per call like the browser tools, and Claude's launch
allowlist includes them. A call where the Simulator cannot run is refused with what is
missing. They run on this device only, never on an agent's computer.

Inputs are validated before a device is touched: bundle IDs, environment variable
names, URL schemes, coordinates, Dynamic Type sizes, privacy services and payloads.
Snapshot text, app text and logs are untrusted content; snapshots are bounded to 40,000
characters and note when they were cut.

### Device

An attempt resolves its simulator once, the first time a tool needs one, through
`device_for` in `simulator.rs`, the seam with [task simulators](#task-simulators).
Without that resolver it uses `JACKALOPE_SIMULATOR_UDID` from Jackalope's environment
(booting it when needed), else the first booted simulator. Tools that only need `simctl`
(apps, settings, screenshots and logs) never start the driver.

### Driver

Reading and acting go through an XCUITest UI-testing bundle shipped as source in
`resources/simulator-driver` (a host app, the `Driver` test target and a committed
`JackalopeSimulatorDriver.xcodeproj`; regenerate the project with `xcodegen generate`
there after changing `project.yml`, never at runtime).

- **Build.** The first read or action copies the source to
  `<profile>/task-runs-v1/simulator-driver/<Xcode build>-<source hash>` and runs
  `xcodebuild build-for-testing` for the generic iOS Simulator destination with the
  resolved Xcode, unsigned. It takes under a minute and records activity lines; a
  failure reports `xcodebuild`'s error lines. Builds for an earlier Xcode or driver
  source are removed after a new build once no driver runs.
- **Run.** Each device gets one driver: `xcodebuild test-without-building -xctestrun ...
  -destination id=<udid>` as an owned process tree, with `TEST_RUNNER_JACKALOPE_DRIVER_PORT`
  and `TEST_RUNNER_JACKALOPE_DRIVER_TOKEN`. The test serves HTTP on `127.0.0.1` of that
  port (simulators share the host's loopback) and answers only requests with the
  per-launch bearer token. Start-up waits for `/health` for up to three minutes (about
  40 seconds on a fresh device); later calls take well under a second, except typing,
  which waits for the keyboard. Calls to one driver run one at a time.
- **Protocol.** `GET /health`, `POST /snapshot`, `/act`, `/app` and `/stop`. Every
  snapshot numbers its elements again, and actions resolve refs from the latest one:
  the element is found again by type and identifier (label when it has none), nearest
  its old frame, so a screen that shifted since the snapshot is still hit; its saved
  frame is the fallback. Waits and `scroll_to` poll snapshots rather than element
  queries. XCUITest failures become the request's error instead of failing the test,
  and the server keeps serving until `/stop` or 30 minutes without a request.
- **End.** A driver stops when its attempt is stopped or ends and no other attempt
  uses the device, and when Jackalope quits: `/stop`, then its process tree is ended,
  the runner app (`digital.jackalope.SimulatorDriver.xctrunner`) terminated and its log
  and result bundle removed. A driver that died is started again on the next call.

### Screen view

Once an attempt's tools used a simulator, the task and chat Screen view show its screen
beside the browser, refreshed with the same two-second poll through
`task_agent_screen` (`simulator` in the result): a `simctl io screenshot` scaled to at
most 1000 pixels on its longest side, with the device name and the app the agent last
used. Viewing never resolves, boots or allocates a device, and frames are not saved.

### Checks

`cargo test simulator` covers request validation, command construction, snapshot
rendering and bounds, driver answers and build failures, project detection and the
bridge refusing invalid calls before touching a device. The opt-in
`real_driver_drives_settings_in_a_cloned_simulator` test builds the driver, clones a
shut-down iPhone simulator as `Jackalope test simulator tools`, drives Settings through
the bridge (launch, snapshot, tap General, wait, screenshot, configure, home, logs),
checks the Screen view frame and that the driver stops with the attempt, then deletes
the clone. Run it from `apps/desktop/src-tauri` with
`cargo test --lib real_driver_drives_settings -- --ignored --nocapture` on a Mac with
Xcode and an iOS runtime.

## Simulator previews and review captures

A task's Preview tab runs an iOS app in the task's own Simulator, and finished work gets
review screenshots from the Simulator, the way web projects use a preview command and
the [browser](BROWSER-AUTOMATION.md#review-screenshots). Native code lives in
`commands/previews/simulator.rs` (the preview kind) and `commands/previews/review/ios.rs`
(captures); the renderer in `SimulatorPreview.tsx`.

### Run in Simulator

`simulator_preview_target(path)` reports whether a folder is an iOS app: an Xcode
workspace or project that [targets iOS](#xcode-toolchain-and-project-detection) in the
folder or its `ios` folder. Swift packages have no app and keep the web preview. For an
iOS app the Preview tab offers **Run in Simulator** instead of the command and port form;
a project that also saves a web preview command chooses between **iOS Simulator** and
**Web** above the panel, and a preview already running opens its own kind.

`task_preview_simulator_start` then, in the background:

1. Takes the task's Simulator with `simulators::ensure`, creating and booting it within
   the pool like an agent would (web previews and terminals only receive an assigned one).
2. Builds with the resolved Xcode:
   `xcodebuild build -workspace|-project <path> -scheme <scheme> -destination id=<udid> -derivedDataPath <workspace>/.jackalope/DerivedData`,
   with the scheme from project detection. An owned process tree, stopped after 30
   minutes or 10 silent minutes, or by Stop or Rebuild. The newest 64,000 characters of
   output are the **Build log**, and a failure shows `xcodebuild`'s error lines.
3. Finds the app in `-showBuildSettings -json` (the application target's
   `TARGET_BUILD_DIR/WRAPPER_NAME` for `iphonesimulator`), else the newest `.app` in
   `Build/Products/*-iphonesimulator` (test runners skipped).
4. Installs it with `simctl install`, reads `CFBundleIdentifier` and launches it with
   `simctl launch --terminate-running-process`.
5. Starts the [driver](#driver) for taps and typing (under a minute the first time,
   about 40 seconds on a fresh device) and brings the app back in front of the driver's
   runner. The status line says when input is ready; a driver that fails leaves the
   screen and device settings working and says why.

Project settings → Commands → iOS Simulator → **Simulator preview build**
(`simulatorPreview`, mirrored to the native project ledger) replaces step 2 with a
command run through `/bin/sh` in the workspace, with `JACKALOPE_SIMULATOR_UDID`,
`JACKALOPE_SIMULATOR_NAME`, `JACKALOPE_DERIVED_DATA`, `JACKALOPE_SPM_CACHE` and the
resolved `DEVELOPER_DIR`. It must build into `$JACKALOPE_DERIVED_DATA`, where step 3
looks for the newest app. The Preview tab's **Build setup** edits the same value and saves
it when the preview starts. A saved command also lets a project whose scheme Jackalope
cannot find run.

### Ownership

A Simulator preview lives in the same map as web previews (`PREVIEWS` in
`commands/previews.rs`), so `task_preview_status`, `task_preview_stop`, `ensure_idle`,
`close_all` and the integration, continuation and cleanup checks treat both alike: a
preview that is building or running holds its workspace until it is stopped. The view
has `kind: "simulator"`, `port: 0` and a `simulator` object (`udid`, `device`,
`bundleId`, `phase` booting, building, installing, launching, running, failed or
stopped, `input` off, starting, ready or failed, `appearance`, `contentSize`,
`landscape`); views without `kind` read as web.

While it runs, the preview holds the device (`simulators::InUse`) and its driver
(`simulator::DriverHold`), so neither idle shutdown nor the end of an attempt stops them.
**Stop preview** cancels a build, terminates the app and releases both; the driver stops
unless an attempt's tools still use the device. A failed build releases them at once and
keeps the log until **Save log and reset**. **Rebuild** (`task_preview_simulator_reload`)
cancels a build under way, then builds, installs and launches the workspace's current
files again. Quitting Jackalope ends every preview.

### Live screen

While the app runs, `task_preview_simulator_frame` returns a `simctl io screenshot`
scaled to at most 1000 pixels on its longest side, polled about one and a half times a
second while the panel is shown and the window is not hidden. Frames are never saved.

- **Tap**: a click is sent as a position from 0 to 1 on each axis of the frame
  (`task_preview_simulator_act` with `{action: "tap", x, y}`), turned into points with
  the screen size from the driver's latest snapshot, and tapped through the driver at
  those coordinates in the app (the home screen when the app is not in front).
- **Toolbar**: Home (`press_button`), Rotate between portrait and landscape left
  (`rotate`), Light and Dark (`simctl ui appearance`), Text size (`simctl ui
  content_size`, the twelve Dynamic Type sizes) and Select.
- **Type into the focused field** sends at most 5,000 characters with the driver's
  `type`; tap a field first. **Open link** opens any URL with a scheme (`simctl openurl`),
  such as a deep link. iOS asks "Open in “App”?" before a custom scheme opens an app;
  Jackalope taps **Open** through the driver when that prompt appears within four
  seconds (matched by its English text).

The live view taps only; swipes, long presses and hardware keyboard input go through
the agent tools or Xcode.

### Select

**Select** reads the screen's elements and frames (`task_preview_simulator_elements`,
the driver snapshot flattened) and highlights the element under the pointer: the
smallest one containing it, passing over unlabeled containers when anything else
matches. A click calls `task_preview_simulator_select`, which takes a fresh snapshot, hit
tests the same way, crops a full-resolution screenshot to the element's frame with six
points of padding (`sips`) and saves `<id>.png` and `<id>.selection.json` (type, label,
identifier, value, frame and screen in points, bundle ID) in the workspace's
`.jackalope/artifacts/screenshots`, recorded among the attempt's screenshots with
`simulator://<udid>` as its address. Selections join the same notes as web preview
selections (`jackalope-preview-selections:<run>` in the desktop profile, at most ten):
each gets a "What should change?" note, and **Add selections to follow-up** sends them
with the screenshot and context paths. Escape or **Done selecting** leaves Select.

### Review captures

When an attempt that changed files finishes successfully and its project saves no web
preview command, Jackalope captures the app in the background if **Capture Simulator
review screenshots** is on (the shared `reviewCaptures` setting, on by default), this
Mac has Xcode, the workspace is an iOS app and the attempt changed a file that can alter
what it shows: Swift, Objective-C, `.xib`, `.storyboard`, asset catalog contents,
`.strings`, `.stringsdict`, `.xcstrings`, `.plist`, `.xcconfig`, `project.pbxproj`, XcodeGen
`project.yml` or Tuist `Project.swift`. JavaScript changes in a React Native app are not
captured.

It builds and installs the app as Run in Simulator does (with the saved build command
when there is one) while holding the workspace like a running check, sets a clean status
bar (9:41, full signal, charged), then for each screen sets the appearance and Dynamic
Type size, relaunches the app, opens the screen's deep link when it has one (accepting
the "Open in" prompt through the driver, started on the first deep link and stopped
afterwards) and saves a
PNG once two consecutive screenshots match (at most eight seconds), scaled to at most
1600 pixels:

| Screen | Viewports |
| --- | --- |
| `First screen` (reason `launch`) | `iphone-light`, `iphone-dark`, `iphone-large-text` (`accessibility-large`) |
| Deep links in review pages (`configured`), then feature-map deep links whose sources changed (`feature`) | `iphone-light`, `iphone-dark` |

At most four screens are captured; an iPad device names them `ipad-…`. Review shows them
like web captures, labelled iPhone · Light, iPhone · Dark and iPhone · Large text. The
"before" side follows the [web rules](BROWSER-AUTOMATION.md#review-screenshots): it
builds the project checkout into its own `.jackalope/DerivedData` only when the task
used a separate worktree and the checkout is clean at the starting commit, installs that
app over the result's, captures the same screens, then reinstalls and launches the
result's app so follow-ups and previews find it. Afterwards the status bar override is
cleared and the device's appearance and text size are restored. Everything stops after
five minutes, since building takes most of the time, or when the result leaves review;
recovery after a quit and failure notes match web captures.

The [feature map](BROWSER-AUTOMATION.md#feature-map) accepts a deep link such as
`myapp://settings` as an entry's page (any scheme except `http`, `https`, `file`,
`javascript`, `data`, `about` and `blob`), with source globs over the app's files. Web
captures skip deep-link entries and Simulator captures skip path entries. **Suggest
from code** reads web routers only.

### Testing previews

`cargo test previews::` covers saved views without a kind, build and settings commands,
reading the built app from build settings and products, coordinate mapping, hit testing,
crops, action commands, finding the Open prompt among system alerts, the files that
trigger captures, screens and variants, and deep-link feature pages. `node --test scripts/simulator-preview.test.mjs
scripts/feature-map.test.mjs scripts/review-captures.test.mjs` from `apps/desktop`
covers the renderer's mapping, highlight, status and labels. The opt-in native test
generates a SwiftUI app with XcodeGen in a Git checkout and a task worktree that changes
its title, runs it as a Simulator preview on a `Jackalope test…` device, checks the
frame, taps a button by coordinates and sees its label change, types into a field,
selects it, changes appearance and text size, rotates and types into the field by
coordinates in landscape, opens a deep link past its prompt, stops the
preview, captures light, dark and large-text review screenshots before and after with a
deep-link feature screen, and deletes the device:

~~~sh
cd apps/desktop/src-tauri
cargo test --lib previews::simulator::tests::real_simulator_preview_and_review_captures -- --ignored --nocapture
~~~

It needs a Mac with Xcode, an iOS runtime and XcodeGen, and takes about three minutes
including the driver build.

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

Jackalope reaches the person's own iPhones and iPads through Xcode's `devicectl`
(Xcode 15 or later, run with the [resolved toolchain](#xcode-toolchain-and-project-detection)).
Every call writes `--json-output` and Jackalope reads that JSON; `devicectl`'s
human-readable output is relayed as logs but never parsed. Simulators are not listed
here; they belong to the Simulator tools. Native code lives in `commands/devices.rs`
and `commands/devices/`.

### Listing devices

`devicectl list devices` lists every physical device paired with this Mac with its
name, model, OS version, connection (USB, network, available or not connected),
pairing, Developer Mode and whether the developer disk image services are mounted
(`devicectl` mounts them on demand). A device that cannot install or launch apps
says why and what to do: not paired (connect, unlock, tap Trust), not connected,
or Developer Mode off (Settings → Privacy & Security → Developer Mode). Ready
devices are listed first. Failed commands turn the NSError `devicectl` writes,
including its `NSUnderlyingError` chain, into a specific message (locked, Developer
Mode off, untrusted, not found, not reachable, signature refused, OS too old) and
always append what `devicectl` said with its domain and code.

### Attaching a device

Nothing touches a physical device unless the person allows it. In a conversation
whose workspace has an Xcode project, the options menu offers **iPhone or iPad**:
pick a device and what the agent may do, then Attach.

| Level | Allows |
| --- | --- |
| See only | `device_app` `status` and `apps`, and `device_logs` |
| See and control | Also installing, launching and stopping apps |

An attachment covers every attempt in that conversation (or task, for work outside a
conversation) until the person detaches it or Jackalope quits; the agent's next call
uses it without asking. Detaching also stops the console capture. "Always allow this
device in <project>" stores the grant in `preferences/device-grants.json`; it answers
for any conversation in the project when nothing is attached, and Project settings →
Integrations → iPhone and iPad lists and removes it. An attached device wins over
project grants. With several project grants and nothing attached, the agent must name
one. Levels written by a newer app allow nothing.

### Agent tools

`device_app` (group `device`, offered on macOS, never placed on a computer runner)
takes an `action`:

- `status`: the device as listed now, the granted level, whether it came from the
  project, this workspace's newest device build with its bundle ID, platform and
  signing, why that build cannot run on the device, the last install and the console
  capture state.
- `apps`: apps installed from Xcode or Jackalope (`devicectl device info apps`).
- `install`: the newest `.app` built for `iphoneos` under Jackalope's own device
  builds, the workspace's `build/` or `DerivedData/`, or an Xcode DerivedData folder
  whose `WorkspacePath` lies inside the workspace; or a `path` inside one of those.
  Test runners (`*-Runner.app`) are skipped.
- `launch`: `devicectl device process launch --console --terminate-existing` for
  `bundle_id`, defaulting to the conversation's last install, then the workspace's
  build. The tool waits up to `wait_seconds` (default 5, at most 30) for early output
  or a failed launch and returns while capture continues.
- `terminate`: the launched process, or every process whose executable lies in the
  app's installed bundle (`device info processes`), stopped with
  `device process terminate`.

`device_logs` reads the captured console by line number (`from_line`, `limit` up to
1000, `nextLine` to continue) and reports whether capture is still running and how it
ended. Without a grant, or with see-only access for a control action, both tools
return a denial telling the agent to ask the person with `request_human_action`.
Codex approves each call, Claude Code's allowlist includes both, and the task report
counts them as app use.

Before installing, Jackalope reads the bundle's `DTPlatformName` and its signature
(`codesign -dv`, plus `embedded.mobileprovision`). A Simulator build, an unsigned or
ad hoc signed bundle, or one without a provisioning profile is refused with the
xcodebuild command that fixes it: `-destination id=<udid> -allowProvisioningUpdates
DEVELOPMENT_TEAM=<team>`.

### Console capture

Each conversation keeps the console of its last launch: the app's standard output
and error as `devicectl` relays them, bounded to 4,000 lines and 512 KB, with lines
cut at 2,000 characters; older lines are dropped and `device_logs` says so. Unified
logging (`os_log`, `Logger`) is not captured. Capture lasts the requested
`console_seconds` (default 300, at most 30 minutes) and stops on a new launch, on
terminate, on detach, from the panel's Stop console or when Jackalope quits.
Jackalope owns the `devicectl` process group and stops it with SIGKILL, so no signal
is forwarded and the app keeps running on the device. When the app exits on its own
the log ends with its exit code or signal.

### Run on device

The panel's **Run on device** builds the conversation's latest workspace for the
chosen device, installs and launches it, without involving the agent:

1. Finds the Xcode workspace or project (a `.xcworkspace` before a `.xcodeproj`, the
   shallowest within two folders, skipping dependency and build folders) and its
   scheme from `xcodebuild -list -json` (one named like the project, else the first
   that is not a test or package scheme).
2. Runs `xcodebuild -scheme <scheme> -configuration Debug -destination id=<udid>
   -derivedDataPath <profile>/device-builds/<workspace hash> -allowProvisioningUpdates
   [DEVELOPMENT_TEAM=<team>] build`, outside the workspace so the build never shows
   as a change. The team is the project's **Development team** (Project settings →
   Commands → iPhone and iPad), saved as `developmentTeam` and mirrored to the native
   project registry; only a ten-character team ID is passed. Failures show xcodebuild's
   `error:` lines with a hint for a missing team, missing Xcode account or profile.
3. Checks the product's platform and signing, installs it with `devicectl`, then
   launches it with the console captured for up to 30 minutes, which `device_logs`
   also reads.

Progress is announced with the `device-changed` event (at most every 250 ms) and read
with `device_run_state`; Cancel stops the build or launch. One run per conversation
runs at a time. Work that ran on a computer cannot run on a device from this Mac.

### Testing devices

`cargo test devices::` covers device lists with zero, one and two devices, readiness
problems, recorded and nested errors, install, launch and app-list results, command
construction, the device build command, scheme choice, signing, build discovery,
grants and console bounds against JSON recorded from `devicectl` 651.32. Two opt-in
tests run the real tool:

~~~sh
cargo test devices::tests::real_devicectl_lists_devices -- --ignored
JACKALOPE_DEVICECTL_TARGET=<simulator udid> JACKALOPE_DEVICECTL_APP=<simulator .app> \
  cargo test devices::tests::real_devicectl_drives_a_simulator -- --ignored
~~~

The second installs, lists, launches with console capture and stops capture on a
Simulator you created, which accepts the same `devicectl` commands. Installing,
launching, terminating and reading the console on a physical device, the
`transportType` values for USB and network, process executables in
`device info processes`, the locked and untrusted error shapes, and signed device
builds with `-allowProvisioningUpdates` are unverified without a connected device and
Apple developer account.

## Signing and TestFlight

Agents never upload. They prepare a project for TestFlight, and the person starts
every upload from the task and confirms the app and build by name.

### App Store Connect connection

Project settings → **Integrations** → **App Store Connect** holds an App Store Connect
API key for the project: the Issuer ID, the Key ID, the `.p8` key (picked from disk or
pasted; picking `AuthKey_<KEYID>.p8` fills in the Key ID), the Team ID, and optionally
the bundle ID, the scheme to archive and the export method (`app-store-connect`, or
`app-store` for older Xcode). `commands/app_store_connect.rs` refuses a key that is not
an ES256 PKCS#8 private key, and keeps the whole connection, key included, in one
protected record (`app-store-connect/<project>.bin` in the task profile, through the
same Keychain, DPAPI or Secret Service storage as project secrets). The app sees every
field but the key; saving without a key keeps the saved one. Task agents never receive
this key. A person who wants an agent to sign with a key adds it as a
[file secret](AGENT-ACCOUNTS.md#project-secrets).

**Check key** signs a 15-minute ES256 token with the key (`ring`, already in the
dependency graph through rustls) and calls `GET /v1/apps?limit=1`. Success records
when the key was checked and names what it can see; a failure shows App Store
Connect's status, error code, title and detail as Apple sent them. Changing the key,
Key ID or Issuer ID clears the check.

### Upload to TestFlight

A task whose workspace has an Xcode workspace or project (in its root or one folder
down, skipping `Pods`, `node_modules`, `build` and `DerivedData`; a workspace wins over
a project at the same depth) and whose project has a connection offers **Upload to
TestFlight…** under the delivery **More** menu while its agent is not running.
`commands/testflight.rs` then:

1. Reads the project with `xcodebuild -list -json` and `xcodebuild -showBuildSettings
   -json -configuration Release -sdk iphoneos` through the resolved Xcode. The scheme
   is the configured one, the only one, the one named like the container, or the only
   non-test, non-CocoaPods one; otherwise the dialog asks for it in the connection.
   The app target's `PRODUCT_BUNDLE_IDENTIFIER`, `MARKETING_VERSION` and
   `CURRENT_PROJECT_VERSION` are used, unless its Info.plist spells out
   `CFBundleShortVersionString` or `CFBundleVersion`.
2. Asks App Store Connect for the app with that bundle ID and its most recent build
   number. A read failure is shown in App Store Connect's words and does not block.
3. Blocks the upload, saying why, when there is no connection, the bundle ID differs
   from the connection's, the version or build number is missing or not one to three
   period-separated integers, the project signs with a different team than the key's,
   App Store Connect has no app with the bundle ID, or the build number is not higher
   than the last uploaded one.
4. Offers a higher build number. **Set build number** rewrites
   `CURRENT_PROJECT_VERSION = <old>;` lines in the app's `project.pbxproj`,
   `CURRENT_PROJECT_VERSION: <old>` in an XcodeGen `project.yml`, and a literal
   `CFBundleVersion` in the Info.plist, only inside the task workspace. It is an
   ordinary uncommitted change that review shows; a number set in an `.xcconfig` is
   reported instead of edited.
5. Uploads only after the person ticks a confirmation naming the app, version and
   build, and refuses if the project no longer builds exactly that.

The upload runs in the task workspace with output in app data
(`testflight/<run>/current/`; a new upload of the same task replaces it):

```sh
xcodebuild archive -workspace|-project <container> -scheme <scheme> \
  -configuration Release -destination generic/platform=iOS \
  -archivePath <app data>/<scheme>.xcarchive -allowProvisioningUpdates \
  -authenticationKeyPath <key> -authenticationKeyID <key id> \
  -authenticationKeyIssuerID <issuer> [DEVELOPMENT_TEAM=<team>]
xcodebuild -exportArchive -archivePath <archive> \
  -exportOptionsPlist <app data>/ExportOptions.plist -exportPath <app data>/export \
  -allowProvisioningUpdates -authenticationKeyPath <key> ...
```

`DEVELOPMENT_TEAM` is added only when the project sets no team. `ExportOptions.plist`
sets `method` to the connection's export method, `destination` `upload`, `teamID`,
automatic signing, `uploadSymbols` and `manageAppVersionAndBuildNumber` false, so the
confirmed version and build are the ones uploaded. The key is written to a `0600` file
in a `0700` folder beside the archive for the upload only and deleted when it ends,
however it ends. Each step is an owned process tree, stopped after 90 minutes or when
it is silent for 20 minutes (archive) or 30 minutes (upload). **Cancel upload** stops
xcodebuild and ends **Canceled**.

The dialog and a status line in the delivery section follow the upload: the phase
(Archiving, Uploading, Processing on App Store Connect, Uploaded, Failed or Canceled),
the newest 400 lines of output, and the full log path (`upload.log`, up to 32 MB). A
failed step shows xcodebuild's own `error:` lines and exit code, or its last lines
when it printed none. After the upload, Jackalope asks App Store Connect for the build's
`processingState` every 30 seconds for about 30 minutes: `VALID` ends **Uploaded** and
ready to test, `INVALID` or `FAILED` ends **Failed** (Apple emails the reason), and a
build still processing ends **Uploaded** with that said. **Stop checking** only stops
following processing. The last state is saved in `testflight/<run>/upload.json`; an
upload that was running when Jackalope quit reads as failed, so check App Store
Connect before uploading again.

### Agents and signing

**Ask the agent to prepare… → TestFlight** (shown when the task has an Xcode project)
hands the agent a delivery handoff that asks it to check and fix signing settings
(team, automatic signing, a bundle ID that matches App Store Connect), the version and
a build number higher than the last upload, the privacy manifest
(`PrivacyInfo.xcprivacy`, with required-reason API declarations), an Info.plist usage
description for every protected API, app icons and the launch screen, and to report
what the person must do. It never archives, exports or uploads, and never asks for the
API key. For a step only the person can take in Xcode, on the Apple Developer site or
in App Store Connect, agents use `request_human_action` with kind `signing`, which the
task shows as **Signing setup** with a pointer to Xcode's Signing & Capabilities and
to this connection.

### Not verified here

A real upload, App Store Connect processing and a key Apple accepts need Apple
developer credentials and are covered only by fakes: a stand-in xcodebuild drives the
upload states, key handling and error reporting, and a local server stands in for the
App Store Connect API. `cargo test real_archive -- --ignored` archives a generated
one-screen app for `generic/platform=iOS` with `CODE_SIGNING_ALLOWED=NO`, using the
upload's own archive command, and changes its build number through XcodeGen's
`project.yml` and the `.pbxproj`; it needs Xcode and XcodeGen.

## Remote Macs

A Mac the person owns, such as a Mac mini or a cloud Mac from MacStadium, AWS EC2 Mac
or Scaleway, pairs as a Jackalope computer so iOS builds, tests, simulators and agents
run there. It runs the same computer agent as the Linux image, natively and without
Docker: Settings → Computers → **Pair machine** → **Mac** saves a setup script carrying
this app version's agent and shows the command to run on the Mac. Setup, the
LaunchAgent, HTTPS and what a Mac computer does and does not offer are in
[bot computers](BOT-COMPUTERS.md#a-mac).

On a Mac the agent reports `os: "macos"`, its processor and the Xcode it resolved
(version, build and available simulator runtimes) in `hello`. It resolves Xcode the way
this device does (see [Xcode toolchain and project detection](#xcode-toolchain-and-project-detection)):
an explicit `DEVELOPER_DIR` or a full Xcode selection is used as is, and when
`xcode-select` names the Command Line Tools it sets `DEVELOPER_DIR` to the installed
Xcode for every run, check and command it starts. The paired machine's record keeps
what it reported, and Settings → Computers shows it (`macOS · arm64 · Xcode 27.2 · iOS 27.2, iOS 27.0`).
A Mac computer has no desktop control, viewer or browser tools.

A project builds with Xcode when its folder holds an `.xcodeproj` or `.xcworkspace`, or
a `Package.swift` that declares an Apple platform (`.iOS(`, `.macOS(`, `.tvOS(`,
`.watchOS(`, `.visionOS(` or `.macCatalyst(`); a Swift package without one can build on
Linux and has no such need (`computers::platform::xcode_need`). Its work runs only where
Xcode is:

- Planned and swarm forks need a host with Xcode: this device when it resolves Xcode, or
  a paired Mac whose agent reported Xcode. Local sandboxes, Agent37 computers and Linux
  machines never take them. The placement reason starts `Needs Xcode: …`. When no host
  the project may use has Xcode, the fork runs on this device as it did before and its
  placement says it cannot build there; under **Computers only** it is refused with how to
  pair a Mac instead.
- A task whose project's **Agents run on** names a computer that is not a Mac with Xcode
  fails before its agent starts, with the computer's name, what it is and the fix:
  choose a Mac with Xcode or This device, or install Xcode on that Mac.


## Verification

<!-- section: verification -->
