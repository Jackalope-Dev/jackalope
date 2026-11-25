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
    # Candidates are Azure-signed unless the release plan chose an installer
    # without Authenticode, which also needs the explicit repository opt-in.
    $signing = if ($env:CLOUD_WINDOWS_SIGNING) { $env:CLOUD_WINDOWS_SIGNING } else { 'azure' }
    if ($signing -cnotin @('azure','unsigned')) { throw 'Unknown Windows signing mode.' }
    if ($Mode -eq 'candidate') {
        $pending = git status --porcelain --untracked-files=normal
        if ($LASTEXITCODE -ne 0 -or $pending) { throw 'A signed candidate requires a clean, committed checkout.' }
        $required = @('TAURI_SIGNING_PRIVATE_KEY','TAURI_UPDATER_PUBLIC_KEY')
        if ($signing -eq 'azure') {
            if ($env:CLOUD_SIGNING_READY -ne 'true') { throw 'Configure Azure signing before building a candidate.' }
            $required += @('AZURE_SIGNING_DLIB','AZURE_SIGNING_ENDPOINT','AZURE_SIGNING_ACCOUNT','AZURE_SIGNING_PROFILE')
        } else {
            if ($env:CLOUD_SIGNING_READY -eq 'true') { throw 'Azure signing is configured; build a signed candidate.' }
            if ($env:WINDOWS_AUTHENTICODE -cne 'unsigned') { throw 'Set WINDOWS_AUTHENTICODE=unsigned to build an installer without Authenticode.' }
        }
        foreach ($name in $required) {
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
    $env:CLOUD_WINDOWS_SIGNING = $signing
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
    if ($Mode -eq 'candidate' -and $signing -eq 'azure') {
        & "$PSScriptRoot/azure-sign.ps1" -File $binary -VerifyOnly
        & "$PSScriptRoot/azure-sign.ps1" -File $installer -VerifyOnly
    } elseif ($Mode -eq 'candidate') {
        # The receipt records this installer as unsigned; keep that claim true.
        foreach ($file in @($binary, $installer)) {
            if ((Get-AuthenticodeSignature -LiteralPath $file).Status -ne 'NotSigned') { throw "Expected no Authenticode signature: $file" }
        }
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
