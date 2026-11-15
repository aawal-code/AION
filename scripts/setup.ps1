# ==============================================================================
# AION Workstation Node - Automated Installer & Provisioning Script
# ==============================================================================
# Ensures Node.js v20+ is provisioned, registers elevated interactive Scheduled
# Task daemon, and validates local environment configuration.
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 5050,
    [switch]$SkipTaskRegistration
)

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
Write-Host ">>> Initializing AION Installation at: $rootDir" -ForegroundColor Cyan

# 1. Verify Node.js runtime (v20+)
$nodePath = $null
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCmd) {
    try {
        $nodeVerStr = (& node -v)
        if ($nodeVerStr -match '^v?(\d+)') {
            $majorVer = [int]$matches[1]
            if ($majorVer -ge 20) {
                $nodePath = $nodeCmd.Source
                Write-Host ">>> Detected system Node.js: $nodeVerStr ($nodePath)" -ForegroundColor Green
            } else {
                Write-Host ">>> System Node.js is $nodeVerStr (Required: >= v20.0.0)" -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host ">>> Failed executing system node command: $_" -ForegroundColor Yellow
    }
}

# If Node is missing or < 20, provision local standalone binary
if (-not $nodePath) {
    $binDir = Join-Path $rootDir "bin"
    $localNodeExe = Join-Path $binDir "node\node-v20.18.0-win-x64\node.exe"

    if (Test-Path $localNodeExe) {
        $nodePath = $localNodeExe
        Write-Host ">>> Using pre-provisioned local Node.js runtime: $nodePath" -ForegroundColor Green
    } else {
        Write-Host ">>> Downloading official standalone Node.js v20.18.0 runtime..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
        $zipPath = Join-Path $binDir "node-v20.18.0.zip"
        $downloadUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"

        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

        Write-Host ">>> Extracting runtime archive..." -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath (Join-Path $binDir "node") -Force
        Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue

        $nodePath = $localNodeExe
        if (-not (Test-Path $nodePath)) {
            # Find node.exe in extracted folder
            $found = Get-ChildItem -Path (Join-Path $binDir "node") -Filter "node.exe" -Recurse | Select-Object -First 1
            if ($found) { $nodePath = $found.FullName }
        }
        Write-Host ">>> Local Node.js provisioned at: $nodePath" -ForegroundColor Green
    }
}

# 2. Write dynamic local configuration
$envFile = Join-Path $rootDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Host ">>> Generating dynamic environment configuration (.env)..." -ForegroundColor Cyan
    $envContent = @"
PORT=$Port
SYNCTHING_HOST=127.0.0.1
SYNCTHING_PORT=8384
"@
    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Host ">>> Configuration written to: $envFile" -ForegroundColor Green
}

# 3. Register elevated Scheduled Task daemon with interactive user context
if (-not $SkipTaskRegistration) {
    Write-Host ">>> Configuring AionDaemon Windows Scheduled Task..." -ForegroundColor Cyan
    $taskName = "AionDaemon"
    $serverScript = Join-Path $rootDir "src\server.js"

    $action = New-ScheduledTaskAction -Execute $nodePath -Argument "src/server.js" -WorkingDirectory $rootDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0

    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $taskName
        Write-Host ">>> AionDaemon Scheduled Task registered and started successfully." -ForegroundColor Green
    } catch {
        Write-Host ">>> Note: Task registration requires elevated administrative permissions. $_" -ForegroundColor Yellow
        Write-Host ">>> To start AION manually: & `"$nodePath`" `"$serverScript`"" -ForegroundColor Cyan
    }
}

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  AION INSTALLATION COMPLETE" -ForegroundColor Green
Write-Host "  Port: http://localhost:$Port" -ForegroundColor Green
Write-Host "==================================================================`n" -ForegroundColor Green
