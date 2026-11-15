import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const LAPTOP_MODE_FILE = path.join(DATA_DIR, 'laptop-mode.json');

// In-memory Laptop Auto-Mode state
let laptopModeConfig = 'Auto'; // 'Home' | 'Away' | 'Auto'
let effectiveLaptopMode = 'Away';
let currentEthernetState = false;
let currentAcPowerState = true;
let currentBatteryState = {
  hasBattery: false,
  percent: 100,
  acPower: true,
  charging: false,
  batteryStatus: 2,
};
let laptopModeInterval = null;

function loadLaptopModeFile() {
  try {
    if (fs.existsSync(LAPTOP_MODE_FILE)) {
      const content = fs.readFileSync(LAPTOP_MODE_FILE, 'utf8');
      const data = JSON.parse(content);
      if (data.mode && ['Home', 'Away', 'Auto'].includes(data.mode)) {
        laptopModeConfig = data.mode;
      }
      if (data.effectiveMode && ['Home', 'Away'].includes(data.effectiveMode)) {
        effectiveLaptopMode = data.effectiveMode;
      }
    }
  } catch {}
}

function saveLaptopModeFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(
      LAPTOP_MODE_FILE,
      JSON.stringify(
        {
          mode: laptopModeConfig,
          effectiveMode: effectiveLaptopMode,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {}
}

/**
 * Checks for an active Ethernet connection via os.networkInterfaces
 */
export function checkEthernetConnected() {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    const lowerName = name.toLowerCase();
    const isEthernetName = (
      lowerName.includes('ethernet') ||
      lowerName.startsWith('eth') ||
      lowerName.startsWith('en') ||
      lowerName.includes('local area connection') ||
      lowerName.includes('lan')
    ) && !lowerName.includes('wi-fi') && !lowerName.includes('wlan') && !lowerName.includes('wireless') && !lowerName.includes('virtual') && !lowerName.includes('tailscale');

    if (isEthernetName && Array.isArray(addrs)) {
      const hasActive = addrs.some((addr) => !addr.internal && addr.address && addr.address !== '127.0.0.1' && addr.address !== '::1');
      if (hasActive) return true;
    }
  }
  return false;
}

/**
 * Checks AC Power state and battery level via PowerShell Get-WmiObject Win32_Battery
 */
export function getBatteryTelemetry() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({
        hasBattery: false,
        percent: 100,
        acPower: true,
        charging: false,
        batteryStatus: 2,
      });
    }

    const psCmd = 'powershell -NoProfile -Command "$b = Get-WmiObject Win32_Battery -Property BatteryStatus, EstimatedChargeRemaining; if ($b) { [PSCustomObject]@{ BatteryStatus = [int]$b.BatteryStatus; EstimatedChargeRemaining = [int]$b.EstimatedChargeRemaining; HasBattery = $true } | ConvertTo-Json -Compress } else { [PSCustomObject]@{ BatteryStatus = 2; EstimatedChargeRemaining = 100; HasBattery = $false } | ConvertTo-Json -Compress }"';

    exec(psCmd, { timeout: 3000, windowsHide: true }, (err, stdout) => {
      let hasBattery = false;
      let batteryStatus = 2;
      let percent = 100;

      if (!err && stdout && stdout.trim()) {
        try {
          const data = JSON.parse(stdout.trim());
          hasBattery = Boolean(data.HasBattery);
          batteryStatus = Number(data.BatteryStatus) || 2;
          percent = Number(data.EstimatedChargeRemaining) || 100;
        } catch {}
      }

      // BatteryStatus values: 2 (AC), 3 (Fully Charged AC), 6 (Charging AC), 7 (Charging High), 8 (Charging Low), 9 (Charging Critical), 11 (Partially Charged AC)
      const acPower = hasBattery ? [2, 3, 6, 7, 8, 9, 11].includes(batteryStatus) : true;
      const charging = [6, 7, 8, 9].includes(batteryStatus);

      resolve({
        hasBattery,
        percent: Math.max(0, Math.min(100, percent)),
        acPower,
        charging,
        batteryStatus,
      });
    });
  });
}

/**
 * Applies Windows powercfg lid action:
 * 'Home' -> Do nothing when closing the lid (0)
 * 'Away' -> Default sleep on lid close (1)
 */
export function applyLidAction(mode) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || process.env.NODE_ENV === 'test' || Boolean(process.env.AION_TEST_MODE)) {
      return resolve({ success: true, mode });
    }

    const lidValue = mode === 'Home' ? 0 : 1; // 0 = Do nothing, 1 = Sleep
    const subButtons = '4f971e89-eebd-4455-a8de-9e59040e7347';
    const lidAction = '5ca83367-6e45-459f-a27b-476b1d01c936';
    const cmd = `powercfg /setacvalueindex SCHEME_CURRENT ${subButtons} ${lidAction} ${lidValue} && powercfg /setdcvalueindex SCHEME_CURRENT ${subButtons} ${lidAction} ${lidValue} && powercfg /setactive SCHEME_CURRENT`;

    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        logEvent('WARN', `Failed to apply powercfg lid action: ${err.message}`);
        return resolve({ success: false, error: err.message, mode });
      }
      logEvent('SYSTEM', `Laptop lid action set to '${mode === 'Home' ? 'Do nothing' : 'Sleep'}' (${mode} mode)`);
      resolve({ success: true, mode });
    });
  });
}

/**
 * Polls hardware sensors and evaluates auto laptop-mode transition
 */
export async function pollLaptopMode() {
  currentEthernetState = checkEthernetConnected();
  currentBatteryState = await getBatteryTelemetry();
  currentAcPowerState = currentBatteryState.acPower;

  let targetEffective = effectiveLaptopMode;
  if (laptopModeConfig === 'Auto') {
    targetEffective = (currentEthernetState && currentAcPowerState) ? 'Home' : 'Away';
  } else {
    targetEffective = laptopModeConfig;
  }

  if (targetEffective !== effectiveLaptopMode) {
    effectiveLaptopMode = targetEffective;
    await applyLidAction(effectiveLaptopMode);
    logEvent('SYSTEM', `Laptop auto-mode transitioned to ${effectiveLaptopMode} (config: ${laptopModeConfig}, Ethernet: ${currentEthernetState}, AC: ${currentAcPowerState})`);
    saveLaptopModeFile();
  }

  return getLaptopModeState();
}

/**
 * Sets laptop mode configuration ('Home' | 'Away' | 'Auto') and applies powercfg
 */
export async function setLaptopMode(inputMode) {
  if (!inputMode || typeof inputMode !== 'string') {
    throw new Error("Laptop mode must be 'Home', 'Away', or 'Auto'");
  }

  const norm = inputMode.trim().toLowerCase();
  let target;
  if (norm === 'home') target = 'Home';
  else if (norm === 'away') target = 'Away';
  else if (norm === 'auto') target = 'Auto';
  else {
    throw new Error("Invalid laptop mode. Must be 'Home', 'Away', or 'Auto'");
  }

  laptopModeConfig = target;

  currentEthernetState = checkEthernetConnected();
  currentBatteryState = await getBatteryTelemetry();
  currentAcPowerState = currentBatteryState.acPower;

  if (laptopModeConfig === 'Auto') {
    effectiveLaptopMode = (currentEthernetState && currentAcPowerState) ? 'Home' : 'Away';
  } else {
    effectiveLaptopMode = laptopModeConfig;
  }

  await applyLidAction(effectiveLaptopMode);
  saveLaptopModeFile();

  return getLaptopModeState();
}

/**
 * Returns current laptop mode snapshot
 */
export function getLaptopModeState() {
  return {
    mode: laptopModeConfig,
    effectiveMode: effectiveLaptopMode,
    ethernet: currentEthernetState,
    acPower: currentAcPowerState,
    battery: currentBatteryState,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Starts periodic polling for laptop auto mode
 */
export function startLaptopModePolling(intervalMs = 15000) {
  if (laptopModeInterval) clearInterval(laptopModeInterval);
  pollLaptopMode().catch(() => {});
  laptopModeInterval = setInterval(() => {
    pollLaptopMode().catch(() => {});
  }, intervalMs);
  if (laptopModeInterval.unref) laptopModeInterval.unref();
}

export function stopLaptopModePolling() {
  if (laptopModeInterval) {
    clearInterval(laptopModeInterval);
    laptopModeInterval = null;
  }
}

export function _resetLaptopModeForTests() {
  laptopModeConfig = 'Auto';
  effectiveLaptopMode = 'Away';
  currentEthernetState = false;
  currentAcPowerState = true;
  currentBatteryState = {
    hasBattery: false,
    percent: 100,
    acPower: true,
    charging: false,
    batteryStatus: 2,
  };
  stopLaptopModePolling();
}

// Initialize on module load
loadLaptopModeFile();
startLaptopModePolling(15000);

/**
 * Format bytes per second into clean human readable string
 */
function formatSpeed(bytesPerSec) {
  const bytes = Number(bytesPerSec) || 0;
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

/**
 * Internal CPU sampler reading total and idle ticks across all cores
 */
function sampleCpuTicks() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;

  for (const core of cpus) {
    if (!core || !core.times) continue;
    for (const [type, time] of Object.entries(core.times)) {
      total += time;
      if (type === 'idle') idle += time;
    }
  }

  return { idle, total, count: cpus.length, model: cpus[0]?.model || 'Generic Processor' };
}

/**
 * Computes live CPU usage percentage over a brief sample duration (default: 100ms)
 * Strictly on-demand with zero background polling.
 */
export function getCpuTelemetry(sampleDurationMs = 100) {
  return new Promise((resolve) => {
    const start = sampleCpuTicks();
    setTimeout(() => {
      const end = sampleCpuTicks();
      const idleDelta = end.idle - start.idle;
      const totalDelta = end.total - start.total;
      const usage = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
      const clamped = Math.max(0, Math.min(100, Math.round(usage * 10) / 10));

      resolve({
        usagePercent: clamped,
        cores: start.count,
        model: start.model,
      });
    }, sampleDurationMs);
  });
}

/**
 * Computes true delta CPU percentage across consecutive samples divided by CPU cores
 * Clamped strictly between 0.0% and 100.0% (fixes 29975% CPU accumulation bug)
 */
export function computeProcessCpuPercent(deltaCpuSeconds, deltaSeconds, numCpus = (os.cpus() || []).length || 1) {
  if (!deltaSeconds || deltaSeconds <= 0 || !numCpus || numCpus <= 0) return 0;
  const pct = (deltaCpuSeconds / (deltaSeconds * numCpus)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/**
 * Computes live total, available, and used RAM strictly on-demand
 */
export function getMemoryTelemetry() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);

  const totalMb = Math.round(totalBytes / (1024 * 1024));
  const availableMb = Math.round(freeBytes / (1024 * 1024));
  const usedMb = Math.round(usedBytes / (1024 * 1024));
  const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

  return {
    totalMb,
    availableMb,
    usedMb,
    usedPercent,
    totalFormatted: `${(totalBytes / (1024 ** 3)).toFixed(1)} GB`,
    availableFormatted: `${(freeBytes / (1024 ** 3)).toFixed(1)} GB`,
    usedFormatted: `${(usedBytes / (1024 ** 3)).toFixed(1)} GB`,
  };
}

/**
 * Computes live Disk I/O speed and primary volume storage strictly on-demand
 */
export function getDiskTelemetry() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const rootPath = isWin ? 'C:\\' : '/';
    let driveInfo = null;

    try {
      if (typeof fs.statfsSync === 'function') {
        const stats = fs.statfsSync(rootPath);
        const totalBytes = stats.blocks * stats.bsize;
        const freeBytes = stats.bavail * stats.bsize;
        const usedBytes = totalBytes - freeBytes;

        driveInfo = {
          mount: rootPath,
          totalGb: Math.round((totalBytes / (1024 ** 3)) * 10) / 10,
          freeGb: Math.round((freeBytes / (1024 ** 3)) * 10) / 10,
          usedGb: Math.round((usedBytes / (1024 ** 3)) * 10) / 10,
          usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
        };
      }
    } catch {}

    if (isWin) {
      const psCmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter \\"Name=\'_Total\'\\") | Select-Object DiskReadBytesPerSec, DiskWriteBytesPerSec, PercentDiskTime | ConvertTo-Json -Compress"';
      exec(psCmd, { timeout: 3000 }, (err, stdout) => {
        let readBytesPerSec = 0;
        let writeBytesPerSec = 0;
        let percentDiskTime = 0;

        if (!err && stdout && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim());
            readBytesPerSec = Number(parsed.DiskReadBytesPerSec || 0);
            writeBytesPerSec = Number(parsed.DiskWriteBytesPerSec || 0);
            percentDiskTime = Number(parsed.PercentDiskTime || 0);
          } catch {}
        }

        resolve({
          readBytesPerSec,
          writeBytesPerSec,
          percentDiskTime,
          readFormatted: formatSpeed(readBytesPerSec),
          writeFormatted: formatSpeed(writeBytesPerSec),
          drive: driveInfo,
        });
      });
      return;
    }

    // Linux Disk I/O fallback
    resolve({
      readBytesPerSec: 0,
      writeBytesPerSec: 0,
      percentDiskTime: 0,
      readFormatted: '0 B/s',
      writeFormatted: '0 B/s',
      drive: driveInfo,
    });
  });
}

/**
 * Queries GPU and VRAM utilization strictly on-demand (nvidia-smi or fallback)
 */
export function getGpuTelemetry() {
  return new Promise((resolve) => {
    if (process.env.NODE_ENV === 'test' || Boolean(process.env.AION_TEST_MODE)) {
      return resolve({
        available: true,
        usagePercent: 24,
        memoryUsedMb: 2048,
        memoryTotalMb: 8192,
        memoryPercent: 25,
        model: 'Mock NVIDIA RTX Test GPU',
      });
    }

    if (process.platform === 'win32') {
      exec('nvidia-smi --query-gpu=utilization.gpu,memory.total,memory.used,name --format=csv,noheader,nounits', { timeout: 2000, windowsHide: true }, (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          const parts = stdout.trim().split(',').map((s) => s.trim());
          if (parts.length >= 4) {
            const usagePercent = Number(parts[0]) || 0;
            const memoryTotalMb = Number(parts[1]) || 0;
            const memoryUsedMb = Number(parts[2]) || 0;
            const model = parts.slice(3).join(', ');
            const memoryPercent = memoryTotalMb > 0 ? Math.round((memoryUsedMb / memoryTotalMb) * 100) : 0;
            return resolve({
              available: true,
              usagePercent,
              memoryTotalMb,
              memoryUsedMb,
              memoryPercent,
              model,
            });
          }
        }

        resolve({
          available: false,
          usagePercent: 0,
          memoryTotalMb: 0,
          memoryUsedMb: 0,
          memoryPercent: 0,
          model: 'Integrated Graphics',
        });
      });
      return;
    }

    resolve({
      available: false,
      usagePercent: 0,
      memoryTotalMb: 0,
      memoryUsedMb: 0,
      memoryPercent: 0,
      model: 'Integrated / Basic GPU',
    });
  });
}

/**
 * Computes live Network Throughput (Rx / Tx) strictly on-demand via Windows Perf Counters
 */
export function getNetworkTelemetry() {
  return new Promise((resolve) => {
    if (process.env.NODE_ENV === 'test' || Boolean(process.env.AION_TEST_MODE)) {
      return resolve({
        rxBytesPerSec: 1048576,
        txBytesPerSec: 524288,
        rxMbps: 8.39,
        txMbps: 4.19,
        rxFormatted: '1.0 MB/s',
        txFormatted: '512.0 KB/s',
      });
    }

    if (process.platform === 'win32') {
      const psCmd = 'powershell -NoProfile -Command "(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface) | Measure-Object -Property BytesReceivedPerSec, BytesSentPerSec -Sum | Select-Object Property, Sum | ConvertTo-Json -Compress"';
      exec(psCmd, { timeout: 3000, windowsHide: true }, (err, stdout) => {
        let rxBytes = 0;
        let txBytes = 0;

        if (!err && stdout && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim());
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
              if (item.Property === 'BytesReceivedPerSec') rxBytes = Number(item.Sum || 0);
              if (item.Property === 'BytesSentPerSec') txBytes = Number(item.Sum || 0);
            }
          } catch {}
        }

        const rxMbps = Number(((rxBytes * 8) / (1000 * 1000)).toFixed(2));
        const txMbps = Number(((txBytes * 8) / (1000 * 1000)).toFixed(2));

        resolve({
          rxBytesPerSec: rxBytes,
          txBytesPerSec: txBytes,
          rxMbps,
          txMbps,
          rxFormatted: formatSpeed(rxBytes),
          txFormatted: formatSpeed(txBytes),
        });
      });
      return;
    }

    resolve({
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      rxMbps: 0,
      txMbps: 0,
      rxFormatted: '0 B/s',
      txFormatted: '0 B/s',
    });
  });
}

/**
 * Formats uptime in seconds to clean human-readable duration
 */
export function formatUptime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${s % 60}s`;
}

/**
 * Unified on-demand system telemetry gatherer
 * Evaluates CPU, Memory, Disk, GPU, and Network stats in parallel without background polling loops.
 */
export async function getSystemTelemetry() {
  const [cpu, memory, disk, gpu, network] = await Promise.all([
    getCpuTelemetry(100),
    Promise.resolve(getMemoryTelemetry()),
    getDiskTelemetry(),
    getGpuTelemetry(),
    getNetworkTelemetry(),
  ]);

  const uptimeSec = Math.round(os.uptime());

  return {
    cpu,
    memory,
    disk,
    gpu,
    network,
    laptopMode: getLaptopModeState(),
    battery: currentBatteryState,
    uptimeSeconds: uptimeSec,
    uptimeFormatted: formatUptime(uptimeSec),
    timestamp: new Date().toISOString(),
  };
}
