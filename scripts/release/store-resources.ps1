param(
    [Parameter(Mandatory)][string]$Stage,
    [Parameter(Mandatory)][string]$SdkBin
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$stageRoot = (Resolve-Path -LiteralPath $Stage).Path
$resourceRoot = Join-Path (Split-Path $stageRoot -Parent) ('store-resources-' + [guid]::NewGuid())
$assets = Join-Path $resourceRoot 'Assets'
& node (Join-Path $repoRoot 'apps/desktop/scripts/generate-store-assets.mjs') $assets
if ($LASTEXITCODE -ne 0) { throw 'Store icon generation failed.' }
Copy-Item -LiteralPath (Join-Path $stageRoot 'AppxManifest.xml') -Destination $resourceRoot
$config = Join-Path (Split-Path $stageRoot -Parent) ('priconfig-' + [guid]::NewGuid() + '.xml')
$makepri = Join-Path $SdkBin 'makepri.exe'
& $makepri createconfig /cf $config /dq en-US /pv 10.0.0 /o
if ($LASTEXITCODE -ne 0) { throw 'Store resource configuration failed.' }
[xml]$settings = Get-Content -LiteralPath $config -Raw
$settings.resources.RemoveChild($settings.resources.packaging) | Out-Null
$settings.Save($config)
& $makepri new /pr $resourceRoot /cf $config /of (Join-Path $stageRoot 'resources.pri') /o
if ($LASTEXITCODE -ne 0) { throw 'Store resource indexing failed.' }
$destination = Join-Path $stageRoot 'Assets'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $assets -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination
}
