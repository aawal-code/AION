# ==============================================================================
# AION Windows Native Executable & Setup Compiler
# Compiles:
# 1. dist/AION.exe (Native C# WinForms + WebView2 standalone executable)
# 2. dist/Uninstall.exe (Clean dark uninstallation wizard)
# 3. dist/AION-Setup.exe (Self-contained zero-prerequisite installer wizard)
# ==============================================================================

$ErrorActionPreference = "Stop"

if (Test-Path "$PSScriptRoot\..\..\package.json") {
    $ProjectRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
} else {
    $ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
}
Set-Location $ProjectRoot

Write-Host "=== Compiling AION Native Windows Executable Suite ===" -ForegroundColor Cyan

# 1. Locate built-in Microsoft .NET C# Compiler
$CscCandidates = @(
    "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)

$Csc = $null
foreach ($candidate in $CscCandidates) {
    if (Test-Path $candidate) {
        $Csc = $candidate
        break
    }
}

if (-not $Csc) {
    throw "Microsoft .NET C# Compiler (csc.exe) not found on system."
}

Write-Host "[OK] Located C# Compiler: $Csc" -ForegroundColor Green

# 2. Ensure WebView2 libraries are available in build-cache
$FetchScript = Join-Path $ProjectRoot "scripts\fetch-webview2.ps1"
if (Test-Path $FetchScript) {
    & powershell -ExecutionPolicy Bypass -File $FetchScript
}

$BuildCache = Join-Path $ProjectRoot "build-cache"
$CoreDll = Join-Path $BuildCache "Microsoft.Web.WebView2.Core.dll"
$WinFormsDll = Join-Path $BuildCache "Microsoft.Web.WebView2.WinForms.dll"
$LoaderDll = Join-Path $BuildCache "WebView2Loader.dll"

if (-not (Test-Path $CoreDll) -or -not (Test-Path $WinFormsDll) -or -not (Test-Path $LoaderDll)) {
    throw "Required WebView2 assemblies missing from build-cache"
}

# 3. Ensure dist/ output directory exists
$DistDir = Join-Path $ProjectRoot "dist"
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

$IconPath = Join-Path $ProjectRoot "public\brand\aion.ico"
if (-not (Test-Path $IconPath)) {
    throw "Master Windows icon not found at $IconPath"
}

# 4. Compile dist/AION.exe (Native WinForms + WebView2 app)
Write-Host "[INFO] Compiling dist\AION.exe..." -ForegroundColor Yellow
$AionAppSource = Join-Path $ProjectRoot "scripts\win\AionApp.cs"
$AionAppOut = Join-Path $DistDir "AION.exe"

$AionAppArgs = @(
    "/target:winexe",
    "/optimize+",
    "/out:$AionAppOut",
    "/win32icon:$IconPath",
    "/r:System.dll",
    "/r:System.Core.dll",
    "/r:System.Drawing.dll",
    "/r:System.Windows.Forms.dll",
    "/r:$CoreDll",
    "/r:$WinFormsDll",
    $AionAppSource
)

& $Csc $AionAppArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $AionAppOut)) {
    throw "Failed to compile dist\AION.exe"
}
Write-Host "[OK] Compiled dist\AION.exe ($( (Get-Item $AionAppOut).Length ) bytes)" -ForegroundColor Green

# Copy WebView2 companion DLLs into dist/ for direct testing
Copy-Item -Force $CoreDll (Join-Path $DistDir "Microsoft.Web.WebView2.Core.dll")
Copy-Item -Force $WinFormsDll (Join-Path $DistDir "Microsoft.Web.WebView2.WinForms.dll")
Copy-Item -Force $LoaderDll (Join-Path $DistDir "WebView2Loader.dll")

# 5. Compile dist/Uninstall.exe
Write-Host "[INFO] Compiling dist\Uninstall.exe..." -ForegroundColor Yellow
$UninstallSource = Join-Path $ProjectRoot "scripts\win\Uninstall.cs"
$UninstallOut = Join-Path $DistDir "Uninstall.exe"

$UninstallArgs = @(
    "/target:winexe",
    "/optimize+",
    "/out:$UninstallOut",
    "/win32icon:$IconPath",
    "/r:System.dll",
    "/r:System.Core.dll",
    "/r:System.Drawing.dll",
    "/r:System.Windows.Forms.dll",
    $UninstallSource
)

& $Csc $UninstallArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $UninstallOut)) {
    throw "Failed to compile dist\Uninstall.exe"
}
Write-Host "[OK] Compiled dist\Uninstall.exe ($( (Get-Item $UninstallOut).Length ) bytes)" -ForegroundColor Green

# 6. Assemble Application Payload Archive
$PayloadZip = Join-Path $DistDir "payload.zip"
if (Test-Path $PayloadZip) {
    Remove-Item -Force $PayloadZip
}

Write-Host "[INFO] Assembling application payload into $PayloadZip..." -ForegroundColor Yellow
Add-Type -AssemblyName "System.IO.Compression"
Add-Type -AssemblyName "System.IO.Compression.FileSystem"
$zip = [System.IO.Compression.ZipFile]::Open($PayloadZip, [System.IO.Compression.ZipArchiveMode]::Create)

$FoldersToInclude = @("public", "src", "data")
foreach ($folder in $FoldersToInclude) {
    $folderPath = Join-Path $ProjectRoot $folder
    if (Test-Path $folderPath) {
        Get-ChildItem -Path $folderPath -Recurse -File | ForEach-Object {
            $fullPath = $_.FullName
            $rel = $fullPath.Substring($ProjectRoot.Length).TrimStart('\', '/')
            $zipEntryPath = $rel.Replace('\', '/')
            if ($zipEntryPath -notmatch 'temp-icon|___jb_tmp___|node_modules|\.git' -and -not $zipEntryPath.Contains(':')) {
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $zipEntryPath) | Out-Null
            }
        }
    }
}

$RootFiles = @("package.json", "README.md")
foreach ($rf in $RootFiles) {
    $filePath = Join-Path $ProjectRoot $rf
    if (Test-Path $filePath) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $filePath, $rf) | Out-Null
    }
}

$zip.Dispose()
Write-Host "[OK] Application payload archived successfully ($( (Get-Item $PayloadZip).Length ) bytes)" -ForegroundColor Green

# 7. Compile dist/AION-Setup.exe (Embedding payload, AION.exe, Uninstall.exe, and WebView2 DLLs)
Write-Host "[INFO] Compiling dist\AION-Setup.exe..." -ForegroundColor Yellow
$SetupSource = Join-Path $ProjectRoot "scripts\win\Setup.cs"
$SetupOut = Join-Path $DistDir "AION-Setup.exe"

$SetupArgs = @(
    "/target:winexe",
    "/optimize+",
    "/out:$SetupOut",
    "/win32icon:$IconPath",
    "/resource:$PayloadZip,AION.Payload.zip",
    "/resource:$AionAppOut,AION.AION.exe",
    "/resource:$UninstallOut,AION.Uninstall.exe",
    "/resource:$CoreDll,AION.Microsoft.Web.WebView2.Core.dll",
    "/resource:$WinFormsDll,AION.Microsoft.Web.WebView2.WinForms.dll",
    "/resource:$LoaderDll,AION.WebView2Loader.dll",
    "/r:System.dll",
    "/r:System.Core.dll",
    "/r:System.Drawing.dll",
    "/r:System.Windows.Forms.dll",
    "/r:System.IO.Compression.dll",
    "/r:System.IO.Compression.FileSystem.dll",
    $SetupSource
)

& $Csc $SetupArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $SetupOut)) {
    throw "Failed to compile dist\AION-Setup.exe"
}

# Clean up intermediate payload zip
if (Test-Path $PayloadZip) {
    Remove-Item -Force $PayloadZip
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] AION Native Suite successfully generated!" -ForegroundColor Green
Write-Host "App Executable: $AionAppOut ($( (Get-Item $AionAppOut).Length ) bytes)" -ForegroundColor Cyan
Write-Host "Setup Wizard:   $SetupOut ($( (Get-Item $SetupOut).Length ) bytes)" -ForegroundColor Cyan
Write-Host "Uninstaller:    $UninstallOut ($( (Get-Item $UninstallOut).Length ) bytes)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
