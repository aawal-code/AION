import os from 'os';
import http from 'http';
import { execFile } from 'child_process';
import { getGroupedApps, killAppGroup } from '../services/process-manager.js';
import { getSystemTelemetry, getLaptopModeState, setLaptopMode, pollLaptopMode } from '../services/telemetry.js';
import { getWolStatus } from '../services/wol.js';
import { getScreenViewStatus } from '../services/screen-view.js';
import { getMeshStatus, getLocalLanIp } from '../services/network.js';
import { logEvent } from '../services/sse.js';

/**
 * Utility to read and parse JSON body with payload size guard
 */
export function readJsonBody(req, maxSize = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('error', (err) => reject(new Error(`Request stream error: ${err.message}`)));
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxSize) {
        req.destroy();
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const err = new Error('Invalid JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
  });
}

/**
 * Utility to send JSON response
 */
export function sendJson(res, statusCode, data) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * GET /api/system/apps
 * Returns clean grouped list of user-facing running applications
 */
export async function handleGetApps(req, res) {
  try {
    const rawApps = await getGroupedApps();
    const apps = rawApps.map((a) => ({
      ...a,
      processName: a.processName || a.executable,
      pidCount: a.pidCount || a.count || (a.pids ? a.pids.length : 1),
      memoryMb: a.memoryMb !== undefined ? a.memoryMb : a.totalMemoryMb,
      cpuPercent: a.cpuPercent !== undefined ? a.cpuPercent : a.totalCpu,
    }));
    return sendJson(res, 200, {
      status: 'ok',
      count: apps.length,
      apps,
    });
  } catch (err) {
    logEvent('ERROR', `Failed to fetch grouped apps: ${err.message}`);
    return sendJson(res, 500, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * POST /api/system/apps/kill
 * Accepts { app | name | executable } and terminates entire process tree instantly
 */
export async function handleKillApp(req, res) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const target = body.app || body.name || body.executable || body.target;

    if (!target || typeof target !== 'string' || !target.trim()) {
      return sendJson(res, 400, {
        status: 'error',
        error: 'Application name or executable identifier is required',
      });
    }

    const result = await killAppGroup(target.trim());
    const statusCode = result.success ? 200 : (result.notFound ? 404 : 400);

    return sendJson(res, statusCode, {
      status: result.success ? 'ok' : 'error',
      ...result,
    });
  } catch (err) {
    logEvent('ERROR', `Kill app failed: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return sendJson(res, statusCode, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * GET /api/system/telemetry
 * On-demand live CPU, RAM, and Disk I/O telemetry
 */
export async function handleGetTelemetry(req, res) {
  try {
    const telemetry = await getSystemTelemetry();
    const drive = telemetry.disk?.drive || {};
    const normCpu = {
      ...telemetry.cpu,
      percent: telemetry.cpu?.percent ?? telemetry.cpu?.usagePercent ?? 0,
    };
    const normMem = {
      ...telemetry.memory,
      freeMb: telemetry.memory?.freeMb ?? telemetry.memory?.availableMb ?? 0,
      percent: telemetry.memory?.percent ?? telemetry.memory?.usedPercent ?? 0,
    };
    const normDisk = {
      ...telemetry.disk,
      totalGb: drive.totalGb ?? 0,
      freeGb: drive.freeGb ?? 0,
      usedGb: drive.usedGb ?? 0,
      percent: drive.usedPercent ?? telemetry.disk?.percentDiskTime ?? 0,
      readSec: telemetry.disk?.readFormatted || '0 MB/s',
      writeSec: telemetry.disk?.writeFormatted || '0 MB/s',
    };

    return sendJson(res, 200, {
      status: 'ok',
      telemetry,
      cpu: normCpu,
      memory: normMem,
      disk: normDisk,
      gpu: telemetry.gpu,
      network: telemetry.network,
      uptimeFormatted: telemetry.uptimeFormatted,
      laptopMode: telemetry.laptopMode,
      battery: telemetry.battery,
      uptimeSeconds: telemetry.uptimeSeconds,
      timestamp: telemetry.timestamp,
    });
  } catch (err) {
    logEvent('ERROR', `System telemetry error: ${err.message}`);
    return sendJson(res, 500, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * GET /api/system/laptop-mode
 * Returns current laptop mode state and sensor telemetry
 */
export async function handleGetLaptopMode(req, res) {
  try {
    const state = await pollLaptopMode();
    return sendJson(res, 200, {
      status: 'ok',
      ...state,
    });
  } catch (err) {
    logEvent('ERROR', `Get laptop mode error: ${err.message}`);
    return sendJson(res, 500, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * POST /api/system/laptop-mode
 * Accepts { mode: 'Home' | 'Away' | 'Auto' }
 */
export async function handleSetLaptopMode(req, res) {
  try {
    const body = await readJsonBody(req, 16 * 1024);
    const mode = body.mode || body.laptopMode;

    if (!mode || typeof mode !== 'string') {
      return sendJson(res, 400, {
        status: 'error',
        error: "Mode is required and must be 'Home', 'Away', or 'Auto'",
      });
    }

    const state = await setLaptopMode(mode);
    return sendJson(res, 200, {
      status: 'ok',
      ...state,
    });
  } catch (err) {
    const isBadInput = err.message.includes('Invalid laptop mode') || err.message.includes('must be');
    const statusCode = isBadInput ? 400 : 500;
    if (statusCode === 500) logEvent('ERROR', `Set laptop mode error: ${err.message}`);
    return sendJson(res, statusCode, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * GET /api/capabilities and GET /api/system/capabilities
 * Health check & capabilities descriptor for dynamic UI rendering (no '?' placeholders)
 */
export async function handleGetCapabilities(req, res) {
  try {
    const [telemetry, wol, mesh] = await Promise.all([
      getSystemTelemetry().catch(() => ({})),
      getWolStatus().catch(() => ({ supported: false })),
      getMeshStatus().catch(() => ({ connected: false, ipv4: null })),
    ]);

    let screenView = { available: false };
    try {
      screenView = getScreenViewStatus();
    } catch {}

    const hasBattery = Boolean(telemetry.battery?.hasBattery);
    const hasMedia = process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux';
    const hasWol = Boolean(wol?.supported);
    const hasRustDesk = Boolean(screenView?.available || screenView?.configured);
    const lanIp = getLocalLanIp();
    const tailscaleIp = mesh?.ipv4 || null;
    const hostIp = (tailscaleIp && tailscaleIp.startsWith('100.')) ? tailscaleIp : lanIp;

    return sendJson(res, 200, {
      status: 'ok',
      capabilities: {
        hasBattery,
        hasGpu: false,
        hasMedia,
        hasWol,
        hasTailscale: Boolean(tailscaleIp || mesh?.connected),
        hasRustDesk,
        platform: process.platform,
        hostname: os.hostname(),
        tailscaleIp,
        tailscaleDns: mesh?.dnsName || null,
        tailscaleHttpsUrl: null,
        tailscaleHttpUrl: null,
        lanIp,
        hostIp,
      },
    });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', error: err.message });
  }
}

/**
 * Probe an executable binary in PATH
 * @param {string} binaryName
 * @returns {Promise<{ installed: boolean, path: string|null }>}
 */
export function probeBinary(binaryName) {
  return new Promise((resolve) => {
    if (!binaryName || typeof binaryName !== 'string' || !/^[a-zA-Z0-9_\-\.]+$/.test(binaryName)) {
      return resolve({ installed: false, path: null });
    }
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'where.exe' : 'which';
    execFile(cmd, [binaryName], { timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout) {
        return resolve({ installed: false, path: null });
      }
      const lines = stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const binPath = lines[0] || null;
      resolve({
        installed: Boolean(binPath),
        path: binPath,
      });
    });
  });
}

/**
 * Probe Ollama local server port
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{ installed: boolean, running: boolean, url: string }>}
 */
export function probeOllama(host = '127.0.0.1', port = 11434) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: host,
      port: port,
      path: '/api/tags',
      method: 'GET',
      timeout: 1000,
    }, (res) => {
      resolve({
        installed: true,
        running: res.statusCode === 200,
        url: `http://${host}:${port}`,
      });
    });
    req.on('error', () => {
      resolve({
        installed: false,
        running: false,
        url: `http://${host}:${port}`,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        installed: false,
        running: false,
        url: `http://${host}:${port}`,
      });
    });
    req.end();
  });
}

/**
 * GET /api/cli/status
 * Probes installed external CLI runtimes and local Ollama server
 */
export async function handleGetCliStatus(req, res) {
  try {
    const standardBinaries = ['claude', 'codex', 'gemini', 'cursor', 'agy', 'opencode'];

    const urlObj = new URL(req.url, 'http://localhost');
    const customParam = urlObj.searchParams.get('tools');
    const customList = customParam ? customParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const allBinaries = Array.from(new Set([...standardBinaries, ...customList]));

    const [binaryResults, ollamaResult] = await Promise.all([
      Promise.all(allBinaries.map(async (bin) => [bin, await probeBinary(bin)])),
      probeOllama(),
    ]);

    const tools = {};
    for (const [bin, info] of binaryResults) {
      tools[bin] = info;
    }
    tools['ollama'] = ollamaResult;

    return sendJson(res, 200, {
      status: 'ok',
      tools,
      platform: process.platform,
    });
  } catch (err) {
    return sendJson(res, 500, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * Dispatcher for /api/system/* routes handled by this module
 */
export async function handleSystemRoutes(req, res, urlPath) {
  if (urlPath === '/api/cli/status' && req.method === 'GET') {
    return handleGetCliStatus(req, res);
  }

  if ((urlPath === '/api/system/capabilities' || urlPath === '/api/capabilities') && req.method === 'GET') {
    return handleGetCapabilities(req, res);
  }

  if (urlPath === '/api/system/laptop-mode') {
    if (req.method === 'GET') return handleGetLaptopMode(req, res);
    if (req.method === 'POST') return handleSetLaptopMode(req, res);
  }

  if (urlPath === '/api/system/apps' && req.method === 'GET') {
    return handleGetApps(req, res);
  }

  if (urlPath === '/api/system/apps/kill' && req.method === 'POST') {
    return handleKillApp(req, res);
  }

  if (urlPath === '/api/system/telemetry' && req.method === 'GET') {
    return handleGetTelemetry(req, res);
  }

  return false;
}
