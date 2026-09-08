param([Parameter(Mandatory)][string]$File, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$filePath = (Resolve-Path -LiteralPath $File).Path
if ([System.IO.Path]::GetExtension($filePath) -notin @('.exe', '.dll', '.msi')) { throw 'Unsupported signing target.' }
if (!$VerifyOnly) {
    foreach ($name in @('AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'AZURE_SIGNING_DLIB')) {
        if (![Environment]::GetEnvironmentVariable($name)) { throw "Missing signing setting: $name" }
    }
    if ($env:AZURE_SIGNING_ENDPOINT -cnotmatch '^https://[a-z0-9]+\.codesigning\.azure\.net/?$') { throw 'Invalid Azure signing endpoint.' }
    if ($env:AZURE_SIGNING_ACCOUNT -cnotmatch '^[a-zA-Z0-9-]{3,24}$' -or $env:AZURE_SIGNING_PROFILE -cnotmatch '^[a-zA-Z0-9-]{5,100}$') { throw 'Invalid Azure signing account/profile.' }
    $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $signTool = Get-ChildItem -LiteralPath $sdk -Directory |
        Where-Object { $_.Name -match '^10\.0\.\d+\.\d+$' -and [version]$_.Name -ge [version]'10.0.22621.0' } |
        Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (!$signTool) { throw 'Install Windows SDK 10.0.22621 or newer with x64 SignTool.' }
    $metadataFile = Join-Path ([System.IO.Path]::GetTempPath()) ('jackalope-sign-' + [guid]::NewGuid().ToString() + '.json')
    try {
        @{
            Endpoint = $env:AZURE_SIGNING_ENDPOINT
            CodeSigningAccountName = $env:AZURE_SIGNING_ACCOUNT
            CertificateProfileName = $env:AZURE_SIGNING_PROFILE
            ExcludeCredentials = @('EnvironmentCredential', 'WorkloadIdentityCredential', 'ManagedIdentityCredential', 'SharedTokenCacheCredential', 'VisualStudioCredential', 'VisualStudioCodeCredential', 'AzurePowerShellCredential', 'AzureDeveloperCliCredential', 'InteractiveBrowserCredential')
        } | ConvertTo-Json | Set-Content -LiteralPath $metadataFile -Encoding utf8
        & $signTool sign /fd SHA256 /tr 'http://timestamp.acs.microsoft.com' /td SHA256 /dlib $env:AZURE_SIGNING_DLIB /dmdf $metadataFile /d 'Jackalope' $filePath
        if ($LASTEXITCODE -ne 0) { throw 'Azure publisher signing failed.' }
    } finally { Remove-Item -LiteralPath $metadataFile -ErrorAction SilentlyContinue }
}
$signature = Get-AuthenticodeSignature -LiteralPath $filePath
if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate -or !$signature.SignerCertificate) { throw 'Publisher signature or trusted timestamp verification failed.' }
$publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if ($publisher -cne 'Jackalope Digital LLC') { throw 'The signed publisher must be Jackalope Digital LLC.' }
