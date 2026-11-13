import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { logEvent } from './sse.js';

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
 * Unified on-demand system telemetry gatherer
 * Evaluates CPU, Memory, and Disk stats in parallel without any background polling loops.
 */
export async function getSystemTelemetry() {
  const [cpu, memory, disk] = await Promise.all([
    getCpuTelemetry(100),
    Promise.resolve(getMemoryTelemetry()),
    getDiskTelemetry(),
  ]);

  return {
    cpu,
    memory,
    disk,
    uptimeSeconds: Math.round(os.uptime()),
    timestamp: new Date().toISOString(),
  };
}
