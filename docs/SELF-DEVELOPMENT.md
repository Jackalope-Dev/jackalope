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

On macOS and Linux, after the same build:

~~~sh
trial_profile="$PWD/scratch/native-trial-$(date +%s)"
mkdir -p "$trial_profile"
target="${CARGO_TARGET_DIR:-$PWD/apps/desktop/src-tauri/target}"
JACKALOPE_PROFILE_DIR="$trial_profile" "$target/debug/jackalope-desktop" > "$trial_profile.log" 2>&1 &
trial_pid=$!
kill -0 "$trial_pid"
~~~

For frontend hot reload, run `pnpm tauri dev --no-watch` from apps/desktop with the same
profile variable instead. It starts `pnpm dev` itself on port 5173, so do not start another
dev server; if something else already holds that port, the window loads that server, so
launch the built binary instead. Without `--no-watch`, every change under src-tauri
rebuilds and restarts the app. pnpm, Vite, Cargo and the app run as separate processes,
and stopping only the pnpm process leaves the others running. Start it as a background job
of an interactive shell, or under `set -m` in a bash script, so it leads its own process
group, and stop that group with `kill -- -"$dev_pid"`.

Wait for readiness by polling, not by fixed sleeps or log patterns: `kill -0` for the
process, `curl -sf http://localhost:5173/` for the dev server, then the window. Cargo and
Tauri color their output and add terminal links even when redirected, so strip escapes
before matching log text: `perl -pe 's/\e\[[0-9;]*[A-Za-z]|\e\]8;[^\e]*\e\\//g' "$log"`.

Show and inspect the test app's window for interactive checks; process startup
alone is insufficient. Use disposable repositories. The native profile isolates
Jackalope history and WebView storage, but agent sign-ins/global MCP configuration
may still be shared. Use intended accounts and scoped fixtures.

Stop tasks and quit this test instance through its tray menu when done. If it
cannot quit, confirm the saved process ID still identifies the executable you
launched before stopping it (`kill "$trial_pid"`). Retain failed profiles for
diagnosis. Never recursively remove a directory without checking its resolved path.

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

TestFlight builds sign with the team in tauri.conf.json and an App Store Connect API key kept
outside the repository: export `APPLE_API_KEY`, `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH`
from a private file, then run `pnpm tauri ios build --export-method app-store-connect
--build-number <n>` with a build number higher than the last upload. If `xcode-select -p`
names the Command Line Tools, select Xcode or put `/Applications/Xcode.app/Contents/Developer/usr/bin`
first on `PATH`. Upload the resulting `gen/apple/build/arm64/Jackalope.ipa` with
`xcrun altool --upload-app -t ios -f <ipa> --apiKey <key id> --apiIssuer <issuer id>`.
Release builds pair only over HTTPS, such as Remote access's Tailscale Serve address.
