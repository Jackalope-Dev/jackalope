param([string]$Url = $env:STORE_WEBVIEW2_URL, [string]$Sha256 = $env:STORE_WEBVIEW2_SHA256)
$ErrorActionPreference = 'Stop'
$uri = [uri]$Url
if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'msedge.sf.dl.delivery.mp.microsoft.com' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw 'Provide the direct Microsoft Fixed Version WebView2 CAB download URL.'
}
if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Provide the independently verified WebView2 SHA256.' }
$folder = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) ('output/webview2/' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$cab = Join-Path $folder 'runtime.cab'
Invoke-WebRequest -Uri $uri -OutFile $cab -MaximumRedirection 0
if ((Get-FileHash -LiteralPath $cab -Algorithm SHA256).Hash -ne $Sha256) { throw 'WebView2 archive hash mismatch.' }
& expand.exe $cab '-F:*' $folder | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not extract the WebView2 runtime.' }
$runtime = @(Get-ChildItem -LiteralPath $folder -Filter msedgewebview2.exe -File -Recurse)
if ($runtime.Count -ne 1) { throw 'Expected exactly one WebView2 runtime.' }
$runtimePath = $runtime[0].Directory.FullName
if ($env:GITHUB_ENV) { "STORE_WEBVIEW2_PATH=$runtimePath" >> $env:GITHUB_ENV }
Write-Output $runtimePath
