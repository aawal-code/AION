$ErrorActionPreference = "Stop"

$buildCache = Join-Path $PSScriptRoot "..\build-cache"
if (-not (Test-Path $buildCache)) {
    New-Item -ItemType Directory -Path $buildCache | Out-Null
}

$coreDll = Join-Path $buildCache "Microsoft.Web.WebView2.Core.dll"
$winFormsDll = Join-Path $buildCache "Microsoft.Web.WebView2.WinForms.dll"
$loaderDll = Join-Path $buildCache "WebView2Loader.dll"

$nupkgPath = Join-Path $buildCache "Microsoft.Web.WebView2.zip"
$url = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2903.40"

Write-Host "[INFO] Downloading Microsoft.Web.WebView2 NuGet package from $url..." -ForegroundColor Yellow
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
(New-Object System.Net.WebClient).DownloadFile($url, $nupkgPath)

Write-Host "[INFO] Extracting required WebView2 DLLs into $buildCache..." -ForegroundColor Yellow
Add-Type -AssemblyName "System.IO.Compression.FileSystem"
$zip = [System.IO.Compression.ZipFile]::OpenRead($nupkgPath)

foreach ($entry in $zip.Entries) {
    if ($entry.Name -like "*.dll") {
        Write-Host "Found entry: $($entry.FullName)"
    }
    if ($entry.FullName -match "lib/(net45|net462)/Microsoft\.Web\.WebView2\.Core\.dll$") {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $coreDll, $true)
    } elseif ($entry.FullName -match "lib/(net45|net462)/Microsoft\.Web\.WebView2\.WinForms\.dll$") {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $winFormsDll, $true)
    } elseif ($entry.FullName -eq "runtimes/win-x64/native/WebView2Loader.dll") {
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $loaderDll, $true)
    }
}

$zip.Dispose()
Remove-Item -Force $nupkgPath -ErrorAction SilentlyContinue

Write-Host "[OK] Extraction complete." -ForegroundColor Green
