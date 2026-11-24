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

<!-- section: devices -->

## Signing and TestFlight

<!-- section: testflight -->

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
