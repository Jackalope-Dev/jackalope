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

<!-- section: pbxproj -->

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

<!-- section: testflight -->

## Remote Macs

<!-- section: remote-macs -->

## Verification

<!-- section: verification -->
