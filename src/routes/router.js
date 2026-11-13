import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { handleSseConnection, logEvent } from '../services/sse.js';
import { sanitizeCommand, sanitizeMediaAction, InvalidCommandError } from '../utils/sanitizer.js';
import { executeWorkstationCommand } from '../services/os.js';
import { executeAiPrompt } from '../services/ai-bridge.js';
import { handleLocalCommand } from '../services/command-router.js';
import { getSyncStatus, addFolder, pairDevice as syncthingPairDevice } from '../services/syncthing.js';
import { checkForUpdates, applyUpdate } from '../services/updater.js';
import { getRunningProcesses } from '../services/os.js';
import {
  getDevicesList,
  updateDevice,
  getDeviceById,
  enqueueDeviceCommand,
  waitForDeviceCommands,
  setDeviceTelemetry,
  getDeviceTelemetry,
} from '../services/devices.js';
import { getWolStatus, enableWol, sendMagicPacket } from '../services/wol.js';
import { getMediaStatus, controlMedia } from '../services/media.js';
import {
  isAuthenticated,
  isLocalhost,
  getPairingPin,
  regeneratePairingPin,
  pairDevice as pairAuthDevice,
  getTrustedDevices,
  revokeDevice,
} from '../services/auth.js';
import { getScreenViewStatus } from '../services/screen-view.js';
import { getVapidPublicKey, saveSubscription, broadcastPush } from '../services/push.js';
import { handleSystemRoutes } from './system.js';
import { handleCommandsRoutes } from './commands.js';
import { handleAuthRoutes } from './auth.js';
import { handleNetworkRoutes } from './network.js';

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
  '.mobileconfig': 'application/x-apple-aspen-config; charset=utf-8',
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
 * Generates an Apple iOS Web Clip .mobileconfig XML profile
 */
function generateMobileConfig(host, theme = 'dark') {
  const targetUrl = `http://${host}/`;
  const uuid1 = crypto.randomUUID ? crypto.randomUUID() : 'A1090001-A109-A109-A109-A10900000001';
  const uuid2 = crypto.randomUUID ? crypto.randomUUID() : 'A1090002-A109-A109-A109-A10900000002';

  let iconBase64 = '';
  const iconCandidates = [
    path.resolve('public/brand/apple-touch-icon.png'),
    path.resolve('public/apple-touch-icon.png'),
  ];
  for (const cand of iconCandidates) {
    if (fs.existsSync(cand)) {
      iconBase64 = fs.readFileSync(cand).toString('base64');
      break;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key>
  <string>AION (${theme === 'light' ? 'Light' : 'Dark'})</string>
  <key>PayloadDescription</key>
  <string>Installs AION full-screen web app.</string>
  <key>PayloadIdentifier</key>
  <string>com.aion.webclip.${theme}</string>
  <key>PayloadOrganization</key>
  <string>AION</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuid1}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      ${iconBase64 ? `<key>Icon</key>\n      <data>${iconBase64}</data>` : ''}
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>AION</string>
      <key>PayloadDescription</key>
      <string>Configures AION full-screen Web Clip</string>
      <key>PayloadDisplayName</key>
      <string>AION</string>
      <key>PayloadIdentifier</key>
      <string>com.aion.webclip.clip.${theme}</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>${uuid2}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>${targetUrl}?theme=${theme}</string>
    </dict>
  </array>
</dict>
</plist>`;
}

/**
 * Central HTTP request dispatcher matching routes cleanly
 */
export async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.writeHead(200).end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = parsedUrl.pathname;

  // 1. Live SSE Logs Stream (unauthenticated for localhost or authenticated for peers)
  if (urlPath === '/api/logs' && req.method === 'GET') {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
    }
    return handleSseConnection(req, res);
  }

  // 2. Auth & Pairing Endpoints
  if (urlPath.startsWith('/api/auth')) {
    const handled = await handleAuthRoutes(req, res, urlPath);
    if (handled !== false) return;
  }

  // 3. Apple iOS Web Clip Profile (.mobileconfig)
  if (urlPath === '/api/ios/profile.mobileconfig' && req.method === 'GET') {
    const theme = parsedUrl.searchParams.get('theme') || 'dark';
    const host = req.headers.host || 'localhost:5050';
    const xml = generateMobileConfig(host, theme);
    res.writeHead(200, {
      'Content-Type': 'application/x-apple-aspen-config; charset=utf-8',
      'Content-Disposition': `attachment; filename="aion-${theme}.mobileconfig"`,
    });
    return res.end(xml);
  }

  // 4. Zero-Dependency VAPID Web Push Endpoints
  if (urlPath.startsWith('/api/push')) {
    // GET /api/push/vapid-public-key (Public)
    if (urlPath === '/api/push/vapid-public-key' && req.method === 'GET') {
      const publicKey = getVapidPublicKey();
      return sendJson(res, 200, { status: 'ok', publicKey });
    }

    // POST /api/push/subscribe (Requires auth or localhost)
    if (urlPath === '/api/push/subscribe' && req.method === 'POST') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
      }
      try {
        const body = await readJsonBody(req, 64 * 1024);
        const userAgent = req.headers?.['user-agent'] || '';
        const result = saveSubscription({
          subscription: body.subscription,
          deviceId: body.deviceId,
          userAgent,
        });
        return sendJson(res, 200, { status: 'ok', ...result });
      } catch (err) {
        logEvent('ERROR', `Push subscription failed: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    // POST /api/push/send (Requires auth or localhost)
    if (urlPath === '/api/push/send' && req.method === 'POST') {
      if (!isAuthenticated(req)) {
        return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
      }
      try {
        const body = await readJsonBody(req, 64 * 1024);
        const results = await broadcastPush(body);
        return sendJson(res, 200, { status: 'ok', results });
      } catch (err) {
        logEvent('ERROR', `Push broadcast failed: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown push endpoint' });
  }

  // 5. Remote Screen View / RustDesk Integration
  if (urlPath === '/api/system/screen-view' && req.method === 'GET') {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
    }
    try {
      const screenView = getScreenViewStatus();
      return sendJson(res, 200, { ...screenView, status: 'ok', screenStatus: screenView.status });
    } catch (err) {
      logEvent('ERROR', `Screen view status error: ${err.message}`);
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // 6. Tailscale Mesh State Polling
  if (urlPath.startsWith('/api/network')) {
    const handled = await handleNetworkRoutes(req, res, urlPath);
    if (handled !== false) return;
  }

  // --- STRICT AUTHENTICATION GUARD FOR REMAINING PROTECTED API ROUTES ---
  if (urlPath.startsWith('/api/')) {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, {
        status: 'error',
        error: 'Authentication required. Please pair this device.',
        paired: false,
      });
    }
  }

  // 6. Zero-AI Instant Multilingual Command Router (<10ms)
  if (urlPath.startsWith('/api/commands')) {
    const handled = await handleCommandsRoutes(req, res, urlPath);
    if (handled !== false) return;
  }

  // 7. Hardware / OS Actions Dispatcher
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

  // 7. Antigravity AI Bridge & Instant Local Command Router
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

      // Instant deterministic local command routing (<50ms)
      const localResult = await handleLocalCommand(prompt);
      if (localResult.handled) {
        return sendJson(res, 200, {
          response: localResult.response,
          error: null,
          stderr: null,
          local: true,
        });
      }

      // Delegate to agy with generous timeout
      const result = await executeAiPrompt(prompt);
      return sendJson(res, 200, result);
    } catch (err) {
      const statusCode = err.statusCode || 400;
      return sendJson(res, statusCode, { status: 'error', error: err.message });
    }
  }

  // 8. Syncthing Peer Sync Management
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
        const deviceData = await syncthingPairDevice(body);
        return sendJson(res, 200, deviceData);
      } catch (err) {
        logEvent('ERROR', `Pair device failed: ${err.message}`);
        return sendJson(res, err.statusCode || 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown sync endpoint' });
  }

  // 9. System Auto-Updater Endpoints
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

  // 11. System Processes, Grouped Apps & On-Demand Telemetry Endpoints
  if (urlPath === '/api/system/apps' || urlPath === '/api/system/apps/kill' || urlPath === '/api/system/telemetry') {
    const handled = await handleSystemRoutes(req, res, urlPath);
    if (handled !== false) return;
  }

  if (urlPath === '/api/system/processes' && req.method === 'GET') {
    try {
      const processes = await getRunningProcesses();
      return sendJson(res, 200, { status: 'ok', processes });
    } catch (err) {
      logEvent('ERROR', `Running processes query error: ${err.message}`);
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // 11. System Wake-on-LAN (WoL) Endpoints
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

  // 12. Smart Devices Registry & Wake Endpoints
  if (urlPath.startsWith('/api/devices')) {
    // Mobile Command: POST /api/devices/:id/command
    const cmdMatch = urlPath.match(/^\/api\/devices\/([^/]+)\/command$/);
    if (cmdMatch && req.method === 'POST') {
      const deviceId = decodeURIComponent(cmdMatch[1]);
      try {
        const body = await readJsonBody(req, 64 * 1024);
        if (!body.action || typeof body.action !== 'string') {
          return sendJson(res, 400, { status: 'error', error: 'Action is required' });
        }
        const cmd = enqueueDeviceCommand(deviceId, body.action, body);
        logEvent('COMMAND', `Enqueued mobile command '${body.action}' for device ${deviceId}`);
        return sendJson(res, 200, { status: 'ok', command: cmd });
      } catch (err) {
        logEvent('ERROR', `Queue command for '${deviceId}' failed: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    // Mobile Event Stream / Long-poll: GET /api/devices/:id/events
    const eventsMatch = urlPath.match(/^\/api\/devices\/([^/]+)\/events$/);
    if (eventsMatch && req.method === 'GET') {
      const deviceId = decodeURIComponent(eventsMatch[1]);
      const waitParam = parsedUrl.searchParams.get('wait');
      const timeoutMs = waitParam === 'false' ? 0 : Math.min(parseInt(parsedUrl.searchParams.get('timeout') || '15000', 10), 30000);
      try {
        const commands = await waitForDeviceCommands(deviceId, timeoutMs);
        return sendJson(res, 200, { status: 'ok', commands });
      } catch (err) {
        logEvent('ERROR', `Events stream for '${deviceId}' error: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    // Mobile Telemetry: POST /api/devices/:id/telemetry & GET /api/devices/:id/telemetry
    const telemetryMatch = urlPath.match(/^\/api\/devices\/([^/]+)\/telemetry$/);
    if (telemetryMatch) {
      const deviceId = decodeURIComponent(telemetryMatch[1]);
      if (req.method === 'POST') {
        try {
          const body = await readJsonBody(req, 64 * 1024);
          const telemetry = setDeviceTelemetry(deviceId, body);
          return sendJson(res, 200, { status: 'ok', telemetry });
        } catch (err) {
          logEvent('ERROR', `Telemetry update for '${deviceId}' error: ${err.message}`);
          return sendJson(res, 500, { status: 'error', error: err.message });
        }
      }
      if (req.method === 'GET') {
        try {
          const telemetry = getDeviceTelemetry(deviceId);
          return sendJson(res, 200, { status: 'ok', telemetry });
        } catch (err) {
          return sendJson(res, 500, { status: 'error', error: err.message });
        }
      }
    }

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
        const clientIp = req.socket?.remoteAddress || '';
        return sendJson(res, 200, { status: 'ok', devices, clientIp });
      } catch (err) {
        logEvent('ERROR', `Devices list error: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown devices endpoint' });
  }

  // 13. Live Media & Audio Deck Endpoints
  if (urlPath.startsWith('/api/media')) {
    // GET /api/media/status
    if (urlPath === '/api/media/status' && req.method === 'GET') {
      try {
        const mediaState = await getMediaStatus();
        return sendJson(res, 200, { status: 'ok', ...mediaState });
      } catch (err) {
        logEvent('ERROR', `Media status query error: ${err.message}`);
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    // POST /api/media/control
    if (urlPath === '/api/media/control' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 64 * 1024);
        const { action, value } = sanitizeMediaAction(body.action, body.value);
        const result = await controlMedia(action, value);
        return sendJson(res, 200, { status: 'ok', ...result });
      } catch (err) {
        logEvent('ERROR', `Media control error: ${err.message}`);
        return sendJson(res, err.statusCode || 400, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown media endpoint' });
  }

  // 14. Client PWA & Static Asset Serving (Offline-ready, secure path resolution)
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
