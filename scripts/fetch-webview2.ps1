$ErrorActionPreference = 'Stop'

# Official Microsoft WebView2 SDK package. A pinned catalog digest is checked
# before extraction; TLS alone is not treated as package authenticity.
$PackageId = 'Microsoft.Web.WebView2'
$PackageVersion = '1.0.2903.40'
$ExpectedSha512 = 'pDLSrpyma3xyOGXlw3Aowy7XceBdeJbukZzKLVdPCFvyfnn8PrCLylMn6c456ja0TcOOal8IdQCVONDRU2OGkw=='
$CatalogUrl = 'https://api.nuget.org/v3/catalog0/data/2024.11.18.06.53.26/microsoft.web.webview2.1.0.2903.40.json'
$PackageUrl = 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.2903.40/microsoft.web.webview2.1.0.2903.40.nupkg'
$BuildCache = if ($env:AION_BUILD_CACHE) { $env:AION_BUILD_CACHE } else { Join-Path $PSScriptRoot '..\build-cache' }

New-Item -ItemType Directory -Force -Path $BuildCache | Out-Null
$PackagePath = Join-Path $BuildCache "$PackageId.$PackageVersion.nupkg"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$catalog = Invoke-RestMethod -Uri $CatalogUrl -Headers @{ 'User-Agent' = 'AION-build-verifier' }
if ($catalog.id -ne $PackageId -or $catalog.version -ne $PackageVersion -or $catalog.authors -notmatch 'Microsoft' -or $catalog.packageHashAlgorithm -ne 'SHA512' -or $catalog.packageHash -ne $ExpectedSha512) { throw 'The official NuGet catalog metadata did not match the pinned WebView2 dependency.' }

Invoke-WebRequest -Uri $PackageUrl -OutFile $PackagePath -Headers @{ 'User-Agent' = 'AION-build-verifier' }
$sha512 = [Security.Cryptography.SHA512]::Create()
try { $actualHash = [Convert]::ToBase64String($sha512.ComputeHash([IO.File]::ReadAllBytes($PackagePath))) } finally { $sha512.Dispose() }
if ($actualHash -ne $ExpectedSha512) { Remove-Item -LiteralPath $PackagePath -Force; throw 'WebView2 package SHA-512 verification failed.' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
try {
    $wanted = @{ 'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'Microsoft.Web.WebView2.Core.dll'; 'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'Microsoft.Web.WebView2.WinForms.dll'; 'runtimes/win-x64/native/WebView2Loader.dll' = 'WebView2Loader.dll' }
    foreach ($entryName in $wanted.Keys) {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq $entryName } | Select-Object -First 1
        if (-not $entry) { throw "Pinned package is missing $entryName" }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $BuildCache $wanted[$entryName]), $true)
    }
} finally { $zip.Dispose() }
Write-Host "Verified $PackageId $PackageVersion in $BuildCache" -ForegroundColor Green
