# Native development and verification

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for prerequisites. Run from the repository
root; build the frontend before the native binary so it loads current assets.

~~~powershell
pnpm build
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
~~~

Stop on any failure. Use an isolated profile without clearing your everyday data
or stopping unrelated Jackalope instances. The runtime locks its profile to prevent
two writers. Retain the test process ID:

~~~powershell
$repo = (Get-Location).Path
$trialProfile = Join-Path $repo ('scratch/native-trial-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $trialProfile | Out-Null
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $repo 'apps/desktop/src-tauri/target' }
$exe = Join-Path $target 'debug/jackalope-desktop.exe'
$previousProfile = $env:JACKALOPE_PROFILE_DIR
try {
    $env:JACKALOPE_PROFILE_DIR = $trialProfile
    $trial = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
} finally {
    $env:JACKALOPE_PROFILE_DIR = $previousProfile
}
Get-Process -Id $trial.Id
~~~

Show and inspect the test app's window for interactive checks; process startup
alone is insufficient. Use disposable repositories. The native profile isolates
Jackalope history and WebView storage, but agent sign-ins/global MCP configuration
may still be shared. Use intended accounts and scoped fixtures.

Stop tasks and quit this test instance through its tray menu when done. If it
cannot quit, confirm the saved process ID still identifies the executable you
launched before stopping it. Retain failed profiles for diagnosis. Never recursively
remove a directory without checking its resolved path.

Inspect 1280×840 and 960×640 windows, keyboard/focus, themes, automatic appearance,
preview cancellation and persistence. For runtime changes, exercise setup, a real
agent, questions, stop, checks, review and restart in a disposable repository.
Label browser fixtures as fixtures. pnpm verify does not prove native window,
provider sign-in or installed-upgrade acceptance; see [RELEASE.md](RELEASE.md).

Workspace entry completes when its required readiness work finishes, including with reduced
motion enabled. It refreshes history and agents, validates the selected project,
reads repository context and prepares its local codebase map. Completed checks
are labeled Done; errors can be retried and slow checks can continue in the background.
Settings → General → Open guided setup replays onboarding without clearing saved data.

## Phone companion

The companion in apps/mobile builds with the Tauri mobile CLI from that directory:
`pnpm tauri android dev`, or `pnpm tauri ios build --debug --target aarch64-sim`. The Xcode
project in src-tauri/gen/apple is tracked; build through the CLI rather than Xcode alone.
Run `pnpm tauri ios init` only when that project is missing or the Tauri configuration
changes, and review its diff: it overwrites the tracked icons and Info.plist, which must keep
the keys from src-tauri/Info.ios.plist. iOS needs Xcode, xcodegen, the
`aarch64-apple-ios-sim` Rust target and a simulator runtime matching the Xcode SDK; the CLI
stops with "Xcode Simulator SDK … is not installed" otherwise. Debug builds accept a loopback
host, so pair a simulator or `adb reverse tcp:<port> tcp:<port>` emulator with
`http://127.0.0.1:<port>` and the pairing code from Settings → Remote access. Give a test
desktop its own remote access port so it does not collide with an everyday instance.
