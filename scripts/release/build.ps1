param([ValidateSet('rehearsal','publish')][string]$Mode = 'rehearsal', [ValidateSet('beta','stable')][string]$Channel = 'beta')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $repoRoot
$temporaryKey = $null
$importedCertificate = $null
function Run-Checked([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw 'Release command failed.' }
}
try {
    $releaseVersion = (Get-Content apps/desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
    $env:RELEASE_MODE = $Mode
    Run-Checked { node scripts/release/catalog.mjs check $releaseVersion }
    if ($Mode -eq 'publish') {
        $pendingChanges = git status --porcelain --untracked-files=normal
        if ($LASTEXITCODE -ne 0 -or $pendingChanges) { throw 'A signed candidate requires a clean, committed checkout.' }
        if ($env:RELEASE_SIGNING_READY -ne 'true') { throw 'Public signing is not configured. Use rehearsal.' }
        foreach ($secretName in @('TAURI_SIGNING_PRIVATE_KEY','TAURI_UPDATER_PUBLIC_KEY','WINDOWS_CERTIFICATE_BASE64','WINDOWS_CERTIFICATE_PASSWORD','WINDOWS_TIMESTAMP_URL')) {
            if (![Environment]::GetEnvironmentVariable($secretName)) { throw "Missing signing input: $secretName" }
        }
        $certificateFile = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.pfx')
        try {
            [System.IO.File]::WriteAllBytes($certificateFile, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64))
            $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
            $importedCertificate = Import-PfxCertificate -FilePath $certificateFile -CertStoreLocation Cert:\CurrentUser\My -Password $password
            if (!$importedCertificate.HasPrivateKey) { throw 'Signing certificate has no private key' }
        } finally { Remove-Item -LiteralPath $certificateFile -ErrorAction SilentlyContinue }
    } else {
        $temporaryKey = Join-Path ([System.IO.Path]::GetTempPath()) ('jackalope-rehearsal-' + [guid]::NewGuid().ToString())
        & pnpm tauri signer generate --ci --write-keys $temporaryKey *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate rehearsal updater key' }
        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $temporaryKey -Raw
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
        $env:TAURI_UPDATER_PUBLIC_KEY = (Get-Content -LiteralPath ($temporaryKey + '.pub') -Raw).Trim()
    }
    $baseUrl = if ($env:UPDATE_BASE_URL) { $env:UPDATE_BASE_URL.TrimEnd('/') } else { 'https://staging-api.jackalope.dev' }
    New-Item -ItemType Directory -Force output/release | Out-Null
    $env:RELEASE_CHANNEL = $Channel
    $communityConfig = node scripts/release/channels.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Invalid channel configuration' }
    $updaterConfig = @{
        bundle = @{ createUpdaterArtifacts = $true }
        plugins = @{ updater = @{ pubkey = $env:TAURI_UPDATER_PUBLIC_KEY; endpoints = @("$baseUrl/updates/$Channel/latest.json"); windows = @{ installMode = 'passive' } } }
    }
    $updaterConfig.plugins.jackalope = $communityConfig | ConvertFrom-Json
    if ($Mode -eq 'rehearsal') { $updaterConfig.plugins.jackalope = @{ channel = $Channel; accountServiceUrl = $updaterConfig.plugins.jackalope.accountServiceUrl; accountWebUrl = $updaterConfig.plugins.jackalope.accountWebUrl } }
    if ($Mode -eq 'publish') {
        $updaterConfig.bundle.windows = @{ certificateThumbprint = $importedCertificate.Thumbprint; digestAlgorithm = 'sha256'; timestampUrl = $env:WINDOWS_TIMESTAMP_URL; tsp = $true }
    }
    $updaterConfig | ConvertTo-Json -Depth 8 | Set-Content output/release/tauri.release.json -Encoding utf8
    Run-Checked { pnpm build }
    Run-Checked { pnpm --filter '@jackalope/desktop' test }
    Run-Checked { cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features }
    Run-Checked { pnpm tauri build --config (Join-Path $repoRoot 'output/release/tauri.release.json') --bundles 'nsis,msi' }
    $targetRoot = if ($env:CARGO_TARGET_DIR) { [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $repoRoot 'apps/desktop/src-tauri/target' }
    $installers = @(
        (Join-Path $targetRoot "release/bundle/nsis/Jackalope_${releaseVersion}_x64-setup.exe"),
        (Join-Path $targetRoot "release/bundle/msi/Jackalope_${releaseVersion}_x64_en-US.msi")
    )
    foreach ($installer in $installers) {
        if ($Mode -eq 'publish') {
            $signature = Get-AuthenticodeSignature -LiteralPath $installer
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $importedCertificate.Thumbprint) { throw 'Installer publisher signature failed verification' }
        }
        Copy-Item -LiteralPath $installer -Destination output/release
        Copy-Item -LiteralPath ($installer + '.sig') -Destination output/release
    }
    $env:RELEASE_CHANNEL = $Channel
    $env:UPDATE_BASE_URL = $baseUrl
    Run-Checked { node scripts/release/receipt.mjs }
    Write-Output "Prepared $Mode $Channel release $releaseVersion. No files were published."
} finally {
    if ($temporaryKey) {
        Remove-Item -LiteralPath $temporaryKey, ($temporaryKey + '.pub') -ErrorAction SilentlyContinue
        $env:TAURI_SIGNING_PRIVATE_KEY = $null
    }
    if ($importedCertificate) { Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($importedCertificate.Thumbprint)" -ErrorAction SilentlyContinue }
    Pop-Location
}
