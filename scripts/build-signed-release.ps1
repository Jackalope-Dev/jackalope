param(
    [Parameter(Mandatory)][string]$UpdateUrl,
    [Parameter(Mandatory)][string]$UpdaterPublicKey,
    [Parameter(Mandatory)][string]$CertificateThumbprint,
    [Parameter(Mandatory)][string]$TimestampUrl,
    [Parameter(Mandatory)][string]$ArtifactBaseUrl,
    [Parameter(Mandatory)][string]$ReleaseNotesFile
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    node scripts/release-config.mjs $UpdateUrl $UpdaterPublicKey $CertificateThumbprint $TimestampUrl
    if ($LASTEXITCODE -ne 0) { throw 'Release configuration failed.' }
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    pnpm --filter '@jackalope/desktop' test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features
    if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }
    $config = Join-Path $repo 'output/release/tauri.release.json'
    pnpm tauri build --config $config --bundles 'nsis,msi'
    if ($LASTEXITCODE -ne 0) { throw 'Signed installer build failed.' }
    $targetRoot = if ($env:CARGO_TARGET_DIR) { [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $repo 'apps/desktop/src-tauri/target' }
    $bundleRoot = Join-Path $targetRoot 'release/bundle'
    $version = (Get-Content -Raw -LiteralPath 'apps/desktop/src-tauri/tauri.conf.json' | ConvertFrom-Json).version
    $artifacts = @(
        Get-Item -LiteralPath (Join-Path $bundleRoot "nsis/Jackalope_${version}_x64-setup.exe")
        Get-Item -LiteralPath (Join-Path $bundleRoot "msi/Jackalope_${version}_x64_en-US.msi")
    )
    if (!$artifacts) { throw 'No Windows installers were produced.' }
    $hashes = foreach ($artifact in $artifacts) {
        $signature = Get-AuthenticodeSignature -LiteralPath $artifact.FullName
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint) {
            throw "Installer signature failed verification: $($artifact.Name)"
        }
        if (!(Test-Path -LiteralPath ($artifact.FullName + '.sig'))) { throw "Missing updater signature: $($artifact.Name)" }
        $hash = Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256
        [pscustomobject]@{ File = $artifact.Name; SHA256 = $hash.Hash }
    }
    $hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repo 'output/release/checksums.json') -Encoding utf8
    $manifest = Join-Path $repo 'output/release/latest.json'
    node scripts/update-manifest.mjs $version $ArtifactBaseUrl $ReleaseNotesFile $artifacts[0].FullName $artifacts[1].FullName $manifest
    if ($LASTEXITCODE -ne 0) { throw 'Update manifest generation failed.' }
    Write-Output 'Signed artifacts and update manifest prepared locally. Publication remains a separate action.'
} finally { Pop-Location }
