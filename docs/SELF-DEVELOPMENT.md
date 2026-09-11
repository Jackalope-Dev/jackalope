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
