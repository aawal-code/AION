import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { logEvent } from './sse.js';
import { getWolStatus } from './wol.js';
import { getSyncStatus } from './syncthing.js';

const IS_WIN = process.platform === 'win32';
const DATA_DIR = path.resolve('data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

/**
 * Classifies DMI / SMBIOS chassis integer into standard device type:
 * 'desktop' | 'laptop' | 'server'
 */
export function classifyChassis(chassisInt) {
  const num = parseInt(chassisInt, 10);
  if (isNaN(num)) return 'desktop';

  // Laptop / Notebook / Handheld / Portable / Tablet
  if ([8, 9, 10, 11, 14, 30, 31, 32].includes(num)) {
    return 'laptop';
  }

  // Server / Rack / Blade
  if ([23, 28, 29].includes(num)) {
    return 'server';
  }

  // Desktop / Tower / Mini / All-in-one
  return 'desktop';
}

/**
 * Loads devices registry from data/devices.json with fallback defaults
 */
export function loadRegistry() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DEVICES_FILE)) {
      const raw = fs.readFileSync(DEVICES_FILE, 'utf8').trim();
      if (raw) return JSON.parse(raw);
    }
  } catch (err) {
    logEvent('WARN', `Failed reading devices.json: ${err.message}`);
  }
  return { devices: {} };
}

/**
 * Saves devices registry to data/devices.json
 */
export function saveRegistry(registry) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(registry, null, 2), 'utf8');
  } catch (err) {
    logEvent('ERROR', `Failed writing devices.json: ${err.message}`);
  }
}

/**
 * Detects local hardware chassis type
 */
function detectLocalChassis() {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      const dmiPath = '/sys/class/dmi/id/chassis_type';
      if (fs.existsSync(dmiPath)) {
        try {
          const raw = fs.readFileSync(dmiPath, 'utf8').trim();
          return resolve(classifyChassis(raw));
        } catch {}
      }
      return resolve('desktop');
    }

    const psCmd = '(Get-CimInstance Win32_SystemEnclosure -ErrorAction SilentlyContinue).ChassisTypes';
    exec(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve('desktop');
      const match = stdout.match(/\d+/);
      const chassisCode = match ? match[0] : 3;
      resolve(classifyChassis(chassisCode));
    });
  });
}

/**
 * Resolves local primary network interface IP and MAC
 */
function getLocalNetworkDetails() {
  const ifaces = os.networkInterfaces();
  let lanIp = '127.0.0.1';
  let mac = '';

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanIp = iface.address;
        if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
          mac = iface.mac.replace(/-/g, ':').toUpperCase();
        }
        return { lanIp, mac };
      }
    }
  }
  return { lanIp, mac };
}

/**
 * Queries Tailscale peer metadata if Tailscale CLI is installed and running
 */
function queryTailscalePeers() {
  return new Promise((resolve) => {
    exec('tailscale status --json', { timeout: 2500 }, (err, stdout) => {
      if (err || !stdout) return resolve({ self: null, peers: [] });

      try {
        const data = JSON.parse(stdout.trim());
        const selfTs = data.Self ? {
          hostName: data.Self.HostName,
          tailscaleIp: data.Self.TailscaleIPs?.[0] || '',
          os: data.Self.OS || '',
        } : null;

        const peers = [];
        if (data.Peer) {
          for (const key of Object.keys(data.Peer)) {
            const p = data.Peer[key];
            if (!p) continue;

            const osRaw = (p.OS || '').toLowerCase();
            let normOs = 'Linux';
            let normType = 'desktop';

            if (osRaw.includes('ios')) {
              normOs = 'iOS';
              normType = (p.HostName || '').toLowerCase().includes('ipad') ? 'tablet' : 'phone';
            } else if (osRaw.includes('android')) {
              normOs = 'Android';
              normType = 'phone';
            } else if (osRaw.includes('windows')) {
              normOs = 'Windows';
              normType = (p.HostName || '').toLowerCase().match(/laptop|notebook|surface/i) ? 'laptop' : 'desktop';
            } else if (osRaw.includes('darwin') || osRaw.includes('mac')) {
              normOs = 'macOS';
              normType = (p.HostName || '').toLowerCase().includes('book') ? 'laptop' : 'desktop';
            } else if (osRaw.includes('linux')) {
              normOs = 'Linux';
              normType = (p.HostName || '').toLowerCase().match(/server|vps|node|nas/i) ? 'server' : 'desktop';
            }

            peers.push({
              id: `ts-${p.HostName || key}`,
              name: p.HostName || key,
              type: normType,
              os: normOs,
              isLocal: false,
              online: Boolean(p.Online),
              tailscaleIp: p.TailscaleIPs?.[0] || '',
              lanIp: '',
              mac: '',
              lastSeen: p.LastSeen || null,
              source: 'tailscale',
            });
          }
        }
        resolve({ self: selfTs, peers });
      } catch {
        resolve({ self: null, peers: [] });
      }
    });
  });
}

/**
 * Returns complete merged list of devices (local node + mesh peers)
 * Auto-syncs local node MAC into data/devices.json
 */
export async function getDevicesList() {
  const [chassisType, wolData, tsData] = await Promise.all([
    detectLocalChassis(),
    getWolStatus().catch(() => ({ supported: true, enabled: true, fastStartupBlocking: false, mac: '', interface: '' })),
    queryTailscalePeers().catch(() => ({ self: null, peers: [] })),
  ]);

  const net = getLocalNetworkDetails();
  const hostName = os.hostname();
  const localMac = (wolData.mac || net.mac || '').replace(/-/g, ':').toUpperCase();
  const localLanIp = net.lanIp;
  const localTsIp = tsData.self?.tailscaleIp || '';

  // Load user overrides
  const registry = loadRegistry();
  if (!registry.devices) registry.devices = {};

  // Auto-sync local node metadata into devices.json
  const localOverride = registry.devices.local || {};
  registry.devices.local = {
    id: 'local',
    name: localOverride.name || hostName || 'My Computer',
    type: localOverride.type || chassisType,
    mac: localOverride.mac || localMac,
    lanIp: localOverride.lanIp || localLanIp,
    tailscaleIp: localOverride.tailscaleIp || localTsIp,
    updatedAt: new Date().toISOString(),
  };
  saveRegistry(registry);

  const localDevice = {
    id: 'local',
    name: registry.devices.local.name,
    type: registry.devices.local.type,
    os: IS_WIN ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
    isLocal: true,
    online: true,
    mac: registry.devices.local.mac,
    lanIp: registry.devices.local.lanIp,
    tailscaleIp: registry.devices.local.tailscaleIp,
    wolSupported: wolData.supported,
    wolEnabled: wolData.enabled,
    fastStartupBlocking: wolData.fastStartupBlocking,
    activeInterface: wolData.interface,
  };

  const deviceMap = new Map();
  deviceMap.set('local', localDevice);

  // Merge Tailscale peers
  for (const peer of tsData.peers) {
    const override = registry.devices[peer.id] || {};
    deviceMap.set(peer.id, {
      ...peer,
      name: override.name || peer.name,
      type: override.type || peer.type,
      mac: override.mac || peer.mac || '',
      lanIp: override.lanIp || peer.lanIp || '',
      tailscaleIp: override.tailscaleIp || peer.tailscaleIp || '',
      wolSupported: Boolean(override.mac || peer.mac),
      wolEnabled: true,
    });
  }

  // Merge any standalone overrides from devices.json not in Tailscale
  for (const id of Object.keys(registry.devices)) {
    if (id !== 'local' && !deviceMap.has(id)) {
      const dev = registry.devices[id];
      deviceMap.set(id, {
        id,
        name: dev.name || id,
        type: dev.type || 'desktop',
        os: dev.os || 'Unknown',
        isLocal: false,
        online: dev.online ?? false,
        mac: dev.mac || '',
        lanIp: dev.lanIp || '',
        tailscaleIp: dev.tailscaleIp || '',
        wolSupported: Boolean(dev.mac),
        wolEnabled: true,
      });
    }
  }

  const allDevices = Array.from(deviceMap.values()).map((dev) => {
    const telem = getDeviceTelemetry(dev.id);
    const updatedDev = { ...dev, telemetry: telem };
    if (telem?.updatedAt) {
      const ageMs = Date.now() - new Date(telem.updatedAt).getTime();
      if (ageMs < 180000) {
        updatedDev.online = true;
        updatedDev.lastSeen = telem.updatedAt;
      }
    }
    return updatedDev;
  });

  return allDevices;
}

/**
 * Returns a specific device by id
 */
export async function getDeviceById(id) {
  const devices = await getDevicesList();
  return devices.find((d) => d.id === id) || null;
}

/**
 * Updates a device's custom name, type, mac, lanIp, or tailscaleIp in data/devices.json
 */
export async function updateDevice(id, patch = {}) {
  if (!id || typeof id !== 'string') {
    throw new Error('Device id is required');
  }

  const registry = loadRegistry();
  if (!registry.devices) registry.devices = {};

  const existing = registry.devices[id] || { id };
  const updated = {
    ...existing,
    id,
    ...(patch.name ? { name: String(patch.name).trim() } : {}),
    ...(patch.type ? { type: String(patch.type).trim().toLowerCase() } : {}),
    ...(patch.mac !== undefined ? { mac: String(patch.mac).trim().replace(/-/g, ':').toUpperCase() } : {}),
    ...(patch.lanIp !== undefined ? { lanIp: String(patch.lanIp).trim() } : {}),
    ...(patch.tailscaleIp !== undefined ? { tailscaleIp: String(patch.tailscaleIp).trim() } : {}),
    updatedAt: new Date().toISOString(),
  };

  registry.devices[id] = updated;
  saveRegistry(registry);
  logEvent('COMMAND', `Updated device overrides for ${id}: ${JSON.stringify(patch)}`);

  return getDeviceById(id);
}

// ==========================================================================
// In-Memory Mobile Telemetry & Remote Command Queue
// ==========================================================================

const deviceCommandQueues = new Map();
const deviceTelemetryStore = new Map();
const commandWaiters = new Map();

/**
 * Enqueues a command for a target device (e.g. mobile node)
 */
export function enqueueDeviceCommand(deviceId, action, payload = {}) {
  if (!deviceId) throw new Error('Device id is required');
  if (!action) throw new Error('Action is required');

  if (!deviceCommandQueues.has(deviceId)) {
    deviceCommandQueues.set(deviceId, []);
  }

  const queue = deviceCommandQueues.get(deviceId);
  const cmd = {
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action: String(action).trim(),
    payload: typeof payload === 'object' && payload !== null ? payload : {},
    createdAt: new Date().toISOString(),
  };

  queue.push(cmd);
  if (queue.length > 50) queue.shift();

  // Notify any active long-poll waiters
  const waiters = commandWaiters.get(deviceId);
  if (waiters && waiters.size > 0) {
    const toNotify = Array.from(waiters);
    waiters.clear();
    const batch = dequeueDeviceCommands(deviceId);
    for (const resolve of toNotify) {
      resolve(batch);
    }
  }

  return cmd;
}

/**
 * Dequeues all pending commands for a device
 */
export function dequeueDeviceCommands(deviceId) {
  const queue = deviceCommandQueues.get(deviceId) || [];
  deviceCommandQueues.set(deviceId, []);
  return queue;
}

/**
 * Waits for commands up to timeoutMs (supports long-polling or immediate return if timeoutMs <= 0)
 */
export function waitForDeviceCommands(deviceId, timeoutMs = 15000) {
  const existing = dequeueDeviceCommands(deviceId);
  if (existing.length > 0 || timeoutMs <= 0) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    if (!commandWaiters.has(deviceId)) {
      commandWaiters.set(deviceId, new Set());
    }
    const waiters = commandWaiters.get(deviceId);

    let timer = null;
    const waiterFn = (cmds) => {
      if (timer) clearTimeout(timer);
      resolve(cmds);
    };

    waiters.add(waiterFn);

    timer = setTimeout(() => {
      waiters.delete(waiterFn);
      resolve([]);
    }, timeoutMs);
  });
}

/**
 * Updates in-memory telemetry for a device (battery, charging, wakeLock, route)
 */
export function setDeviceTelemetry(deviceId, data = {}) {
  if (!deviceId) throw new Error('Device id is required');
  const existing = deviceTelemetryStore.get(deviceId) || {};

  const updated = {
    battery: typeof data.battery === 'number' && !isNaN(data.battery) ? data.battery : (existing.battery ?? null),
    charging: typeof data.charging === 'boolean' ? data.charging : (existing.charging ?? null),
    wakeLock: typeof data.wakeLock === 'boolean' ? data.wakeLock : (existing.wakeLock ?? false),
    route: data.route ? String(data.route).trim() : (existing.route || 'mesh'),
    updatedAt: new Date().toISOString(),
  };

  deviceTelemetryStore.set(deviceId, updated);
  logEvent('TELEMETRY', `Mobile telemetry updated for ${deviceId}: ${Math.round(updated.battery ?? 0)}% battery`);
  return updated;
}

/**
 * Gets telemetry for a device
 */
export function getDeviceTelemetry(deviceId) {
  return deviceTelemetryStore.get(deviceId) || null;
}

/**
 * Helper to clear queues (useful for testing)
 */
export function clearDeviceQueues() {
  deviceCommandQueues.clear();
  deviceTelemetryStore.clear();
  commandWaiters.clear();
}
