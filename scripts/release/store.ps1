param(
    [ValidateSet('rehearsal', 'submission')][string]$Mode = 'rehearsal',
    [ValidateSet('beta', 'stable')][string]$Channel = 'beta',
    [string]$IdentityName = $env:STORE_IDENTITY_NAME,
    [string]$Publisher = $env:STORE_PUBLISHER,
    [string]$PublisherDisplayName = $env:STORE_PUBLISHER_DISPLAY_NAME,
    [string]$WebViewRuntimePath = $env:STORE_WEBVIEW2_PATH
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Run-Checked([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw 'Store build command failed.' }
}
Push-Location $repoRoot
try {
    $sdk = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin" -Directory |
        Where-Object { $_.Name -match '^10\.0\.\d+\.0$' } |
        Sort-Object { [version]$_.Name } -Descending |
        Where-Object { Test-Path (Join-Path $_.FullName 'x64/makeappx.exe') } |
        Select-Object -First 1
    if (!$sdk) { throw 'Install the Windows 10/11 SDK with MakeAppx before packaging.' }
    if ($Mode -eq 'rehearsal') {
        $IdentityName = 'Jackalope.LocalRehearsal'
        $Publisher = 'CN=Jackalope Local Rehearsal'
        $PublisherDisplayName = 'Jackalope Local Rehearsal'
    } else {
        $pendingChanges = git status --porcelain --untracked-files=normal
        if ($LASTEXITCODE -ne 0 -or $pendingChanges) { throw 'Store submission builds require a clean, committed checkout.' }
        if (!$WebViewRuntimePath) { throw 'Submission requires an extracted Microsoft Fixed Version x64 WebView2 Runtime.' }
        if (!$IdentityName -or !$Publisher -or !$PublisherDisplayName -or $IdentityName -eq 'Jackalope.LocalRehearsal') {
            throw 'Submission requires the real Partner Center identity and publisher values.'
        }
    }
    if ($WebViewRuntimePath) {
        $WebViewRuntimePath = (Resolve-Path -LiteralPath $WebViewRuntimePath).Path
        $runtimeExe = Join-Path $WebViewRuntimePath 'msedgewebview2.exe'
        $signature = Get-AuthenticodeSignature -LiteralPath $runtimeExe
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
            throw 'WebView2 must have a valid Microsoft signature.'
        }
        $binary = [IO.File]::ReadAllBytes($runtimeExe)
        $pe = [BitConverter]::ToInt32($binary, 60)
        if ([BitConverter]::ToUInt16($binary, $pe + 4) -ne 0x8664) { throw 'WebView2 must be x64.' }
    }
    $version = (Get-Content apps/desktop/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
    $output = Join-Path $repoRoot ('output/store/' + [guid]::NewGuid().ToString())
    $stage = Join-Path $output 'package'
    New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null
    Run-Checked { node scripts/release/store-manifest.mjs (Join-Path $stage 'AppxManifest.xml') $IdentityName $Publisher $PublisherDisplayName $version }
    $config = @{
        bundle = @{ createUpdaterArtifacts = $false }
        plugins = @{ updater = @{ pubkey = ''; endpoints = @() }; jackalope = @{ channel = $Channel } }
    }
    if ($Mode -eq 'rehearsal') { $config.identifier = 'dev.jackalope.store.rehearsal' }
    if ($WebViewRuntimePath) { $config.bundle.windows = @{ webviewInstallMode = @{ type = 'fixedRuntime'; path = 'WebView2' } } }
    $configPath = Join-Path $output 'tauri.store.json'
    $config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8
    $buildOptions = @(if ($Mode -eq 'rehearsal') { '--debug' })
    Run-Checked { pnpm tauri build --no-bundle --features store @buildOptions --config $configPath }
    $target = if ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $repoRoot 'apps/desktop/src-tauri/target' }
    $configuration = if ($Mode -eq 'rehearsal') { 'debug' } else { 'release' }
    Copy-Item -LiteralPath (Join-Path $target "$configuration/jackalope-desktop.exe") -Destination $stage
    foreach ($icon in @('StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot "apps/desktop/src-tauri/icons/$icon") -Destination (Join-Path $stage 'Assets')
    }
    if ($WebViewRuntimePath) { Copy-Item -LiteralPath $WebViewRuntimePath -Destination (Join-Path $stage 'WebView2') -Recurse }
    $package = Join-Path $output "Jackalope_${version}_x64.msix"
    Run-Checked { & (Join-Path $sdk.FullName 'x64/makeappx.exe') pack /d $stage /p $package /o }
    $archivePath = Join-Path $output 'upload.zip'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $package, [IO.Path]::GetFileName($package), [IO.Compression.CompressionLevel]::NoCompression) | Out-Null
    } finally { $archive.Dispose() }
    $revision = git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify the source revision.' }
    $dirty = @(git status --porcelain --untracked-files=normal).Count -gt 0
    @{
        mode = $Mode; channel = $Channel; version = $version; sourceRevision = $revision; sourceDirty = $dirty
        identity = $IdentityName; publisher = $Publisher; architecture = 'x64'
        betaAccessRequired = $true; storeManagedUpdates = $true
        fixedWebView2 = [bool]$WebViewRuntimePath
        packageSha256 = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
        uploadSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        executableSha256 = (Get-FileHash -LiteralPath (Join-Path $stage 'jackalope-desktop.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        storeSigned = $false; installedAcceptance = $false
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'receipt.json') -Encoding utf8
    if ($env:GITHUB_OUTPUT) { "directory=$output" >> $env:GITHUB_OUTPUT }
    Write-Output "Unsigned MSIX and receipt: $output"
    Write-Output 'No application was installed or submitted. Microsoft signs approved Store submissions.'
} finally { Pop-Location }
