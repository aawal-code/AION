import fs from 'fs';
import path from 'path';
import { handleSseConnection, logEvent } from '../services/sse.js';
import { sanitizeCommand, InvalidCommandError } from '../utils/sanitizer.js';
import { executeWorkstationCommand } from '../services/os.js';
import { executeAiPrompt } from '../services/ai-bridge.js';
import { getSyncStatus, addFolder, pairDevice } from '../services/syncthing.js';
import { checkForUpdates, applyUpdate } from '../services/updater.js';
import { getRunningProcesses } from '../services/os.js';
import { getDevicesList, updateDevice, getDeviceById } from '../services/devices.js';
import { getWolStatus, enableWol, sendMagicPacket } from '../services/wol.js';

const PUBLIC_DIR = path.resolve('public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function readJsonBody(req, maxSize = 1024 * 1024) {
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
      } catch (e) {
        const err = new Error('Invalid JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * Central HTTP request dispatcher matching routes cleanly
 */
export async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.writeHead(200).end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = parsedUrl.pathname;

  // 1. Live SSE Logs Stream
  if (urlPath === '/api/logs' && req.method === 'GET') {
    return handleSseConnection(req, res);
  }

  // 2. Hardware / OS Actions Dispatcher
  if (urlPath === '/api/command' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 64 * 1024);
      const { action, target } = sanitizeCommand(body.action, body.target);
      const result = await executeWorkstationCommand(action, target);
      return sendJson(res, 200, { status: 'ok', ...result });
    } catch (err) {
      if (err instanceof InvalidCommandError) {
        return sendJson(res, err.statusCode || 400, { status: 'error', error: err.message });
      }
      const statusCode = err.statusCode || 500;
      return sendJson(res, statusCode, { status: 'error', error: err.message });
    }
  }

  // 3. Antigravity AI Bridge
  if (urlPath === '/api/ai' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 1024 * 1024);
      const prompt = body?.prompt;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return sendJson(res, 400, {
          status: 'error',
          error: 'A non-empty "prompt" string is required',
        });
      }
      const result = await executeAiPrompt(prompt);
      return sendJson(res, 200, result);
    } catch (err) {
      const statusCode = err.statusCode || 400;
      return sendJson(res, statusCode, { status: 'error', error: err.message });
    }
  }

  // 4. Syncthing Peer Sync Management
  if (urlPath.startsWith('/api/sync')) {
    if (urlPath === '/api/sync/status' && req.method === 'GET') {
      try {
        const statusData = await getSyncStatus();
        return sendJson(res, 200, statusData);
      } catch (err) {
        logEvent('ERROR', `Syncthing status error: ${err.message}`);
        return sendJson(res, err.statusCode || 502, { status: 'error', error: err.message });
      }
    }

    if (urlPath === '/api/sync/folder' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const folderData = await addFolder(body);
        return sendJson(res, 200, folderData);
      } catch (err) {
        logEvent('ERROR', `Add folder failed: ${err.message}`);
        return sendJson(res, err.statusCode || 500, { status: 'error', error: err.message });
      }
    }

    if (urlPath === '/api/sync/device' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const deviceData = await pairDevice(body);
        return sendJson(res, 200, deviceData);
      } catch (err) {
        logEvent('ERROR', `Pair device failed: ${err.message}`);
        return sendJson(res, err.statusCode || 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown sync endpoint' });
  }

  // 5. System Auto-Updater Endpoints
  if (urlPath.startsWith('/api/system/update')) {
    if (urlPath === '/api/system/update/check' && req.method === 'GET') {
      try {
        const updateInfo = await checkForUpdates();
        return sendJson(res, 200, updateInfo);
      } catch (err) {
        logEvent('ERROR', `Update check failed: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    if (urlPath === '/api/system/update/apply' && req.method === 'POST') {
      try {
        const result = await applyUpdate();
        return sendJson(res, 200, result);
      } catch (err) {
        logEvent('ERROR', `Update apply failed: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown update endpoint' });
  }

  // 6. System Processes & Telemetry Endpoints
  if (urlPath === '/api/system/processes' && req.method === 'GET') {
    try {
      const processes = await getRunningProcesses();
      return sendJson(res, 200, { status: 'ok', processes });
    } catch (err) {
      logEvent('ERROR', `Running processes query error: ${err.message}`);
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // 7. System Wake-on-LAN (WoL) Endpoints
  if (urlPath.startsWith('/api/system/wol')) {
    if (urlPath === '/api/system/wol' && req.method === 'GET') {
      try {
        const wolData = await getWolStatus();
        return sendJson(res, 200, { status: 'ok', ...wolData });
      } catch (err) {
        logEvent('ERROR', `WoL status query error: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    if (urlPath === '/api/system/wol/enable' && req.method === 'POST') {
      try {
        const result = await enableWol();
        return sendJson(res, 200, { status: 'ok', ...result });
      } catch (err) {
        logEvent('ERROR', `WoL enable error: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown WoL endpoint' });
  }

  // 8. Smart Devices Registry & Wake Endpoints
  if (urlPath.startsWith('/api/devices')) {
    // Wake specific device: POST /api/devices/:id/wake
    const wakeMatch = urlPath.match(/^\/api\/devices\/([^/]+)\/wake$/);
    if (wakeMatch && req.method === 'POST') {
      const deviceId = decodeURIComponent(wakeMatch[1]);
      try {
        const body = await readJsonBody(req, 64 * 1024);
        const targetDevice = await getDeviceById(deviceId);
        const targetMac = body.mac || targetDevice?.mac;
        if (!targetMac) {
          return sendJson(res, 400, {
            status: 'error',
            error: `No MAC address found for device '${deviceId}'. Please configure its MAC first.`,
          });
        }
        const result = await sendMagicPacket(targetMac);
        return sendJson(res, 200, { status: 'ok', ...result });
      } catch (err) {
        logEvent('ERROR', `Wake device '${deviceId}' failed: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    // Update device overrides: PATCH /api/devices/:id
    const patchMatch = urlPath.match(/^\/api\/devices\/([^/]+)$/);
    if (patchMatch && req.method === 'PATCH') {
      const deviceId = decodeURIComponent(patchMatch[1]);
      try {
        const body = await readJsonBody(req, 64 * 1024);
        const updated = await updateDevice(deviceId, body);
        return sendJson(res, 200, { status: 'ok', device: updated });
      } catch (err) {
        logEvent('ERROR', `Update device '${deviceId}' error: ${err.message}`);
        return sendJson(res, 400, { status: 'error', error: err.message });
      }
    }

    // List all devices: GET /api/devices
    if (urlPath === '/api/devices' && req.method === 'GET') {
      try {
        const devices = await getDevicesList();
        return sendJson(res, 200, { status: 'ok', devices });
      } catch (err) {
        logEvent('ERROR', `Devices list error: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown devices endpoint' });
  }

  // 9. Client PWA & Static Asset Serving (Offline-ready, secure path resolution)
  if (req.method === 'GET') {
    let cleanPath = parsedUrl.pathname;
    try {
      cleanPath = decodeURIComponent(cleanPath);
    } catch {
      return sendJson(res, 400, { status: 'error', error: 'Malformed URL' });
    }

    const relativePath = (cleanPath === '/' || cleanPath === '') ? 'index.html' : cleanPath.replace(/^\/+/, '');
    const safePath = path.normalize(path.join(PUBLIC_DIR, relativePath));
    const rel = path.relative(PUBLIC_DIR, safePath);

    if (rel.startsWith('..') || path.isAbsolute(rel) || !safePath.startsWith(PUBLIC_DIR)) {
      return sendText(res, 403, 'Forbidden');
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        return sendJson(res, 404, { status: 'error', error: 'Not Found' });
      }

      const ext = path.extname(safePath).toLowerCase();
      let contentType = MIME_TYPES[ext] || 'application/octet-stream';
      if (path.basename(safePath) === 'manifest.json') {
        contentType = 'application/manifest+json; charset=utf-8';
      }
      const headers = { 'Content-Type': contentType };

      // Ensure fresh UI assets with no-cache revalidation
      if (['.html', '.js', '.css'].includes(ext) || path.basename(safePath) === 'index.html') {
        headers['Cache-Control'] = 'no-cache';
      }

      // Dedicated Service Worker & Manifest headers to prevent iOS Safari caching lock
      const baseName = path.basename(safePath);
      if (baseName === 'sw.js' || baseName === 'manifest.json') {
        headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
        if (baseName === 'sw.js') {
          headers['Service-Worker-Allowed'] = '/';
        }
      }

      res.writeHead(200, headers);
      fs.createReadStream(safePath).pipe(res);
    });
    return;
  }

  // Fallthrough 404
  return sendJson(res, 404, { status: 'error', error: 'Not Found' });
}
