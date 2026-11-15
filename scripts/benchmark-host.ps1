param(
    [int]$DurationSeconds = 300,
    [int]$SampleIntervalSeconds = 1,
    [string]$OutputPath = ""
)

$ErrorActionPreference = 'Stop'
if ($DurationSeconds -lt 10) { throw 'DurationSeconds must be at least 10.' }
if ($SampleIntervalSeconds -lt 1) { throw 'SampleIntervalSeconds must be at least 1.' }
if (-not $OutputPath) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputPath = Join-Path $PSScriptRoot "..\docs\benchmarks\host-$stamp.json"
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput) | Out-Null

function Get-AionProcessSamples {
    $performance = @{}
    Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue | ForEach-Object {
        $performance[[string]$_.IDProcess] = $_
    }
    $targets = Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -match '(?i)(\\|/)AION(\\|/)|AION\\.exe|server\\.js'
    }
    foreach ($target in $targets) {
        $io = $performance[[string]$target.ProcessId]
        [pscustomobject]@{
            name = $target.Name; pid = $target.ProcessId; parentPid = $target.ParentProcessId
            workingSetBytes = [int64]$target.WorkingSetSize; privateBytes = [int64]$target.PrivatePageCount
            readBytesPerSec = if ($io) { [int64]$io.IOReadBytesPersec } else { $null }
            writeBytesPerSec = if ($io) { [int64]$io.IOWriteBytesPersec } else { $null }
            cpuPercent = if ($io) { [double]$io.PercentProcessorTime } else { $null }
            commandLine = $target.CommandLine
        }
    }
}

$samples = @()
$iterations = [math]::Ceiling($DurationSeconds / $SampleIntervalSeconds)
for ($i = 0; $i -lt $iterations; $i++) {
    $samples += [pscustomobject]@{ timestamp = (Get-Date).ToUniversalTime().ToString('o'); processes = @(Get-AionProcessSamples) }
    if ($i -lt ($iterations - 1)) { Start-Sleep -Seconds $SampleIntervalSeconds }
}

[pscustomobject]@{
    capturedAt = (Get-Date).ToUniversalTime().ToString('o'); durationSeconds = $DurationSeconds
    sampleIntervalSeconds = $SampleIntervalSeconds; host = $env:COMPUTERNAME
    notes = @('Read-only capture; does not start, stop, or reconfigure AION.', 'Run idle, desktop-visible, and active-task scenarios separately.', 'Attribute WebView2 children by parent PID and command line.')
    samples = $samples
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Host "Wrote benchmark capture: $resolvedOutput"
