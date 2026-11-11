import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';
const SYNCTHING_HOST = process.env.SYNCTHING_HOST || '127.0.0.1';
const SYNCTHING_PORT = parseInt(process.env.SYNCTHING_PORT, 10) || 8384;
let cachedSyncthingApiKey = (process.env.SYNCTHING_API_KEY && process.env.SYNCTHING_API_KEY.trim()) || null;

/**
 * Dynamically resolves path to local Syncthing config.xml
 */
export function getSyncthingConfigPath() {
  if (process.env.SYNCTHING_CONFIG_PATH) {
    return process.env.SYNCTHING_CONFIG_PATH;
  }

  const home = os.homedir();
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const primary = path.join(localAppData, 'Syncthing', 'config.xml');
    if (fs.existsSync(primary)) return primary;

    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const secondary = path.join(roaming, 'Syncthing', 'config.xml');
    if (fs.existsSync(secondary)) return secondary;

    return primary;
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const linuxPath = path.join(xdgConfig, 'syncthing', 'config.xml');
  if (fs.existsSync(linuxPath)) return linuxPath;

  return path.join(home, '.local', 'state', 'syncthing', 'config.xml');
}

/**
 * Extracts API key directly from Syncthing config.xml on the fly
 */
export function parseApiKeyFromConfigFile() {
  try {
    const cfgPath = getSyncthingConfigPath();
    if (cfgPath && fs.existsSync(cfgPath)) {
      const xml = fs.readFileSync(cfgPath, 'utf8');
      const match = xml.match(/<apikey>([^<]+)<\/apikey>/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch (err) {
    logEvent('ERROR', `Failed reading Syncthing config: ${err.message}`);
  }
  return null;
}

/**
 * Resolves API key from environment variable or local config.xml
 */
export function getSyncthingApiKey() {
  if (process.env.SYNCTHING_API_KEY) {
    return process.env.SYNCTHING_API_KEY.trim();
  }
  if (cachedSyncthingApiKey) {
    return cachedSyncthingApiKey;
  }
  const parsed = parseApiKeyFromConfigFile();
  if (parsed) {
    cachedSyncthingApiKey = parsed;
    return cachedSyncthingApiKey;
  }
  return null;
}

/**
 * Internal REST request wrapper targeting Syncthing local daemon
 */
export function syncthingRequest(method, reqPath, data = null, retryOnAuth = true) {
  return new Promise((resolve, reject) => {
    const apiKey = getSyncthingApiKey();
    if (!apiKey) {
      const err = new Error(
        'Syncthing API key not configured (set SYNCTHING_API_KEY env or configure local Syncthing config.xml)'
      );
      err.statusCode = 401;
      logEvent('WARN', err.message);
      return reject(err);
    }

    const payload = data ? JSON.stringify(data) : null;
    const headers = {
      'X-API-Key': apiKey,
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      hostname: SYNCTHING_HOST,
      port: SYNCTHING_PORT,
      path: reqPath,
      method: method,
      headers: headers,
      timeout: 8000,
    };

    const req = http.request(options, (res) => {
      let resBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { resBody += chunk; });
      res.on('end', () => {
        if ((res.statusCode === 401 || res.statusCode === 403) && retryOnAuth) {
          const freshKey = parseApiKeyFromConfigFile();
          if (freshKey && freshKey !== apiKey) {
            cachedSyncthingApiKey = freshKey;
            logEvent('SYNC', 'Refreshed Syncthing API key from config.xml');
            return syncthingRequest(method, reqPath, data, false).then(resolve).catch(reject);
          }
        }

        let parsed = null;
        try {
          parsed = resBody ? JSON.parse(resBody) : null;
        } catch {
          parsed = resBody;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, data: parsed });
        } else {
          const errorMsg =
            (parsed && parsed.error) ||
            (typeof parsed === 'string' && parsed) ||
            `HTTP ${res.statusCode}`;
          const err = new Error(errorMsg);
          err.statusCode = res.statusCode;
          err.data = parsed;
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Syncthing request timeout');
      err.statusCode = 504;
      reject(err);
    });

    req.on('error', (err) => {
      err.statusCode = 502;
      reject(err);
    });

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Queries connected Syncthing cluster topology, device ID, and folder statistics
 */
export async function getSyncStatus() {
  const [systemRes, folderRes] = await Promise.all([
    syncthingRequest('GET', '/rest/system/status'),
    syncthingRequest('GET', '/rest/stats/folder'),
  ]);

  logEvent('SYNC', 'Queried sync status and folder stats');
  return {
    status: 'ok',
    myID: systemRes.data?.myID,
    uptime: systemRes.data?.uptime,
    system: systemRes.data,
    folders: folderRes.data,
  };
}

/**
 * Dynamically provisions shared directory paths across cluster nodes
 */
export async function addFolder({ id, label, path: folderPath, devices }) {
  if (!id || !folderPath) {
    const err = new Error('id and path are required');
    err.statusCode = 400;
    throw err;
  }

  const folderPayload = {
    id: String(id).trim(),
    label: (label && String(label).trim()) || String(id).trim(),
    path: String(folderPath).trim(),
  };

  if (devices && Array.isArray(devices)) {
    folderPayload.devices = devices.map((d) =>
      typeof d === 'string' ? { deviceID: d.trim() } : d
    );
  }

  const result = await syncthingRequest('POST', '/rest/config/folders', folderPayload);
  logEvent('SYNC', `Configured sync folder: ${folderPayload.id} -> ${folderPayload.path}`);
  return { status: 'ok', folder: folderPayload, result: result.data };
}

/**
 * Authorizes and pairs external machine IDs to the mesh
 */
export async function pairDevice({ deviceID, name, addresses }) {
  if (!deviceID) {
    const err = new Error('deviceID is required');
    err.statusCode = 400;
    throw err;
  }

  const devicePayload = {
    deviceID: String(deviceID).trim(),
    name: (name && String(name).trim()) || '',
    addresses: Array.isArray(addresses)
      ? addresses
      : (addresses ? [String(addresses).trim()] : ['dynamic']),
  };

  const result = await syncthingRequest('POST', '/rest/config/devices', devicePayload);
  logEvent('SYNC', `Paired sync device: ${devicePayload.deviceID} (${devicePayload.name || 'unnamed'})`);
  return { status: 'ok', device: devicePayload, result: result.data };
}
