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
