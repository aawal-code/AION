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

$BuildCache = if ($env:AION_BUILD_CACHE) { $env:AION_BUILD_CACHE } else { Join-Path $ProjectRoot "build-cache" }
$CoreDll = Join-Path $BuildCache "Microsoft.Web.WebView2.Core.dll"
$WinFormsDll = Join-Path $BuildCache "Microsoft.Web.WebView2.WinForms.dll"
$LoaderDll = Join-Path $BuildCache "WebView2Loader.dll"

if (-not (Test-Path $CoreDll) -or -not (Test-Path $WinFormsDll) -or -not (Test-Path $LoaderDll)) {
    throw "Required WebView2 assemblies missing from build-cache"
}

# 3. Ensure dist/ output directory exists
$DistDir = if ($env:AION_BUILD_OUTPUT) { $env:AION_BUILD_OUTPUT } else { Join-Path $ProjectRoot "dist" }
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

$BrandDir = Join-Path $ProjectRoot "public\brand"
$IconFiles = Get-ChildItem -Path $BrandDir -Filter "*.ico" -File
if ($IconFiles -and $IconFiles.Count -gt 0) {
    $IconPath = $IconFiles[0].FullName
} else {
    $IconPath = Join-Path $BrandDir "aion.ico"
}

if (-not (Test-Path $IconPath)) {
    throw "Master Windows icon not found at $IconPath"
}
Write-Host "[OK] Using application icon for win32icon: $IconPath" -ForegroundColor Green

# 4. Compile dist/AION.exe (Native WinForms + WebView2 app)
Write-Host "[INFO] Compiling dist\AION.exe..." -ForegroundColor Yellow
$AionAppSource = Join-Path $ProjectRoot "scripts\win\AionApp.cs"
$AionAppOut = Join-Path $DistDir "AION.exe"
$NativeIpcClientSource = Join-Path $ProjectRoot "scripts\win\NativeIpcClient.cs"
$NativeIpcStreamSource = Join-Path $ProjectRoot "scripts\win\NativeIpcResponseStream.cs"
$PrivateIpcSource = Join-Path $ProjectRoot "scripts\win\MainWindow.PrivateIpc.cs"
$NativeChatSource = Join-Path $ProjectRoot "scripts\win\MainWindow.NativeChat.cs"
$PrivateAssets = Join-Path $DistDir "private-assets.zip"
Compress-Archive -Path (Join-Path $ProjectRoot 'public\*') -DestinationPath $PrivateAssets -Force

$AionAppArgs = @(
    "/target:winexe",
    "/optimize+",
    "/out:$AionAppOut",
    "/win32icon:$IconPath",
    "/r:System.dll",
    "/r:System.Core.dll",
    "/r:System.Drawing.dll",
    "/r:System.Windows.Forms.dll",
    "/r:System.Web.Extensions.dll",
    "/r:System.IO.Compression.dll",
    "/r:System.IO.Compression.FileSystem.dll",
    "/r:$CoreDll",
    "/r:$WinFormsDll",
    "/resource:$PrivateAssets,AION.PrivateAssets",
    $AionAppSource,
    $NativeIpcClientSource,
    $NativeIpcStreamSource,
    $PrivateIpcSource,
    $NativeChatSource
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

# Node's published SHA-256 for v24.18.0 win-x64/node.exe. Never use a
# system runtime or install an unverified executable on the target machine.
$NodeSha256 = '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'
$NodeExe = Join-Path $BuildCache 'node-v24.18.0-win-x64.exe'
if (-not (Test-Path $NodeExe) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $NodeExe).Hash.ToLowerInvariant() -ne $NodeSha256) {
    & curl.exe --fail --silent --show-error --location --max-time 180 --output $NodeExe 'https://nodejs.org/dist/v24.18.0/win-x64/node.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to download the pinned Node runtime' }
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $NodeExe).Hash.ToLowerInvariant() -ne $NodeSha256) { throw 'Bundled Node runtime integrity check failed' }
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $NodeExe, 'runtime/node.exe') | Out-Null

# npm ci enforces package-lock integrity while staging production dependencies.
$dependencyStage = Join-Path ([IO.Path]::GetTempPath()) ('aion-deps-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dependencyStage | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package.json'), (Join-Path $ProjectRoot 'package-lock.json') -Destination $dependencyStage
Push-Location $dependencyStage
try {
    $npm = Get-Command npm.cmd,npm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $npm) { throw 'npm is required to verify the dependency lockfile' }
    & $npm.Source ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Unable to verify and stage production dependencies' }
    Get-ChildItem -LiteralPath (Join-Path $dependencyStage 'node_modules') -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($dependencyStage.Length).TrimStart('\', '/').Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relative) | Out-Null
    }
} finally { Pop-Location }

$FoldersToInclude = @("public", "src")
foreach ($folder in $FoldersToInclude) {
    $folderPath = Join-Path $ProjectRoot $folder
    if (Test-Path $folderPath) {
        Get-ChildItem -Path $folderPath -Recurse -File | ForEach-Object {
            $fullPath = $_.FullName
            $rel = $fullPath.Substring($ProjectRoot.Length).TrimStart('\', '/')
            $zipEntryPath = $rel.Replace('\', '/')
            if ($zipEntryPath -notmatch 'temp-icon|___jb_tmp___|node_modules|\.git|\.sqlite|\.log' -and -not $zipEntryPath.Contains(':')) {
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $zipEntryPath) | Out-Null
            }
        }
    }
}

$RootFiles = @("server.js", "package.json", "README.md")
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
