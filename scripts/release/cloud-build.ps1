param([ValidateSet('rehearsal','candidate')][string]$Mode = 'rehearsal', [ValidateSet('beta','stable')][string]$Channel = 'beta')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
$temporaryKey = $null
$savedKey = $env:TAURI_SIGNING_PRIVATE_KEY
$savedPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$savedPublicKey = $env:TAURI_UPDATER_PUBLIC_KEY
function Invoke-Checked([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw 'Cloud release command failed.' }
}
try {
    $env:CLOUD_BUILD_MODE = $Mode
    $env:RELEASE_CHANNEL = $Channel
    $env:CLOUD_PACKAGE_DIRECTORY = Join-Path $root ('output/cloud/' + [guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Force $env:CLOUD_PACKAGE_DIRECTORY | Out-Null
    if ($Mode -eq 'candidate') {
        $pending = git status --porcelain --untracked-files=normal
        if ($LASTEXITCODE -ne 0 -or $pending) { throw 'A signed candidate requires a clean, committed checkout.' }
        if ($env:CLOUD_SIGNING_READY -ne 'true') { throw 'Configure Azure signing before building a candidate.' }
        foreach ($name in @('TAURI_SIGNING_PRIVATE_KEY','TAURI_UPDATER_PUBLIC_KEY','AZURE_SIGNING_DLIB','AZURE_SIGNING_ENDPOINT','AZURE_SIGNING_ACCOUNT','AZURE_SIGNING_PROFILE')) {
            if (![Environment]::GetEnvironmentVariable($name)) { throw "Missing candidate input: $name" }
        }
    } else {
        $temporaryKey = Join-Path ([System.IO.Path]::GetTempPath()) ('jackalope-cloud-' + [guid]::NewGuid().ToString())
        & pnpm tauri signer generate --ci --write-keys $temporaryKey *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate the temporary rehearsal key.' }
        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $temporaryKey -Raw
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
        $env:TAURI_UPDATER_PUBLIC_KEY = (Get-Content -LiteralPath ($temporaryKey + '.pub') -Raw).Trim()
    }
    Invoke-Checked { node scripts/release/cloud-artifacts.mjs config }
    $configPath = Join-Path $env:CLOUD_PACKAGE_DIRECTORY 'tauri.cloud.json'
    $buildArgs = @('--features','beta-access','--config',$configPath,'--bundles','nsis')
    if ($Mode -eq 'rehearsal') { $buildArgs += '--debug' }
    Invoke-Checked { pnpm tauri build @buildArgs }
    $target = if ($env:CARGO_TARGET_DIR) { [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $root 'apps/desktop/src-tauri/target' }
    $profile = if ($Mode -eq 'rehearsal') { 'debug' } else { 'release' }
    $name = if ($Mode -eq 'rehearsal') { 'Jackalope Rehearsal' } else { 'Jackalope' }
    $version = (Get-Content apps/desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
    $installer = Join-Path $target "$profile/bundle/nsis/${name}_${version}_x64-setup.exe"
    $binaryName = if ($Mode -eq 'rehearsal') { 'jackalope-rehearsal.exe' } else { 'jackalope-desktop.exe' }
    $binary = Join-Path $target "$profile/$binaryName"
    if ($Mode -eq 'candidate') {
        & "$PSScriptRoot/azure-sign.ps1" -File $binary -VerifyOnly
        & "$PSScriptRoot/azure-sign.ps1" -File $installer -VerifyOnly
    }
    Copy-Item -LiteralPath $installer, ($installer + '.sig') -Destination $env:CLOUD_PACKAGE_DIRECTORY
    $env:CLOUD_NATIVE_BINARY = $binary
    Invoke-Checked { node scripts/release/cloud-artifacts.mjs receipt }
    if ($env:GITHUB_OUTPUT) { "directory=$env:CLOUD_PACKAGE_DIRECTORY" >> $env:GITHUB_OUTPUT }
    Write-Output "Prepared $Mode $Channel package in $env:CLOUD_PACKAGE_DIRECTORY. Nothing uploaded or published."
} finally {
    if ($temporaryKey) { Remove-Item -LiteralPath $temporaryKey, ($temporaryKey + '.pub') -ErrorAction SilentlyContinue }
    $env:TAURI_SIGNING_PRIVATE_KEY = $savedKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $savedPassword
    $env:TAURI_UPDATER_PUBLIC_KEY = $savedPublicKey
    Pop-Location
}
