param([switch]$Azure)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$directory = Join-Path $root 'output/release-tools'
New-Item -ItemType Directory -Force $directory | Out-Null
function Get-VerifiedTool([string]$Url, [string]$Path, [string]$Hash) {
    if (!(Test-Path -LiteralPath $Path)) { Invoke-WebRequest -Uri $Url -OutFile $Path }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Hash) {
        throw "Tool checksum mismatch: $Path. Review the pinned vendor release before replacing it."
    }
}
$cli = Join-Path $directory 'cn.exe'
Get-VerifiedTool 'https://cdn.crabnebula.app/asset/01M122A2F49MP31AMMYK4DRV1C' $cli 'CAA8044E17516925378CDDEF71728B58C27001E621CDBE04F04D0D83BF3228D7'
& $cli --version
if ($LASTEXITCODE -ne 0) { throw 'CrabNebula CLI did not start.' }
if ($env:GITHUB_ENV) { "CN_CLI=$cli" >> $env:GITHUB_ENV }
if ($Azure) {
    $archive = Join-Path $directory 'azure-signing-1.0.128.zip'
    Get-VerifiedTool 'https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/1.0.128/microsoft.artifactsigning.client.1.0.128.nupkg' $archive '74BD7D27E6CE1051409C38D9B46BC8DF0400ECD643D51FFBF2AC00869061E40B'
    $destination = Join-Path $directory ('azure-' + [guid]::NewGuid().ToString())
    Expand-Archive -LiteralPath $archive -DestinationPath $destination
    $env:AZURE_SIGNING_DLIB = Join-Path $destination 'bin/x64/Azure.CodeSigning.Dlib.dll'
    if (!(Test-Path -LiteralPath $env:AZURE_SIGNING_DLIB)) { throw 'Missing Azure signing library.' }
    if ($env:GITHUB_ENV) { "AZURE_SIGNING_DLIB=$env:AZURE_SIGNING_DLIB" >> $env:GITHUB_ENV }
}
