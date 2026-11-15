param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
try {
    $sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $previewRoot = Join-Path ([IO.Path]::GetTempPath()) ('AION-DevPreview-' + [Guid]::NewGuid().ToString('N'))
    $buildRoot = Join-Path $previewRoot 'build'
    $appRoot = Join-Path $previewRoot 'app'
    New-Item -ItemType Directory -Path $buildRoot, $appRoot | Out-Null
    $env:AION_BUILD_CACHE = Join-Path $previewRoot 'cache'
    $env:AION_BUILD_OUTPUT = $buildRoot
    & (Join-Path $sourceRoot 'scripts\win\build-win-exe.ps1') *> (Join-Path $previewRoot 'build.log')
    if ($LASTEXITCODE -ne 0 -or !(Test-Path (Join-Path $buildRoot 'AION.exe'))) { throw "Preview build failed. See $previewRoot\build.log" }
    foreach ($folder in @('src', 'public', 'node_modules')) {
        $source = Join-Path $sourceRoot $folder
        if (!(Test-Path $source)) { throw "Preview dependency is missing: $source" }
        Copy-Item -LiteralPath $source -Destination $appRoot -Recurse
    }
    foreach ($file in @('server.js', 'package.json')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination $appRoot }
    foreach ($file in @('AION.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) { Copy-Item -LiteralPath (Join-Path $buildRoot $file) -Destination $appRoot }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run-prepared.ps1') -Destination $previewRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch-Prepared.vbs') -Destination $previewRoot
    if ($PrepareOnly) { Write-Output $previewRoot } else { & (Join-Path $previewRoot 'run-prepared.ps1') }
} catch {
    if ($PrepareOnly) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'AION preview could not start', 'OK', 'Error') | Out-Null
    exit 1
}
