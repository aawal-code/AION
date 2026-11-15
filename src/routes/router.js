import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { handleSseConnection, logEvent } from '../services/sse.js';
import { sanitizeCommand, sanitizeMediaAction, InvalidCommandError } from '../utils/sanitizer.js';
import { executeWorkstationCommand } from '../services/os.js';
import { handleLocalCommand } from '../services/command-router.js';
import { getSyncStatus, getSyncFolders, addFolder, pairDevice as syncthingPairDevice } from '../services/syncthing.js';
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
  extractToken,
  isDesktopSession,
  isLocalhost,
  getSocketRemoteAddress,
  isLoopbackAddress,
  isPrivateLanAddress,
  isTailscaleAddress,
  getPairingPin,
  regeneratePairingPin,
  pairDevice as pairAuthDevice,
  getTrustedDevices,
  revokeDevice,
} from '../services/auth.js';
import { authorize } from '../services/identity-store.js';
import { getScreenViewStatus } from '../services/screen-view.js';
import {
  getScreenStatus,
  getScreenSnapshot,
  sendScreenClick,
  sendScreenKey,
} from '../services/screen-control.js';
import { getVapidPublicKey, saveSubscription, broadcastPush } from '../services/push.js';
import { getMeshStatus, getTailscaleHttpsStatus } from '../services/network.js';
import { handleSystemRoutes } from './system.js';
import { handleCommandsRoutes } from './commands.js';
import { handleAuthRoutes, verifyCsrf } from './auth.js';
import { handleNetworkRoutes } from './network.js';
import { handleAssistantRoutes } from './assistant.js';
import { handleGetConfig, handlePostConfig } from './config.js';
import { handleScreenRoutes } from './screen.js';

const PUBLIC_DIR = path.resolve('public');

function requiredCapability(urlPath, method) {
  if (urlPath.startsWith('/api/auth')) return null;
  if (urlPath.startsWith('/api/screen') || urlPath === '/api/system/screen-view') return 'workstation:control';
  if (urlPath === '/api/command' || urlPath.startsWith('/api/media') || urlPath.includes('/wake') || urlPath.includes('/apps/kill')) return 'workstation:control';
  if (urlPath.startsWith('/api/assistant/vault') || urlPath === '/api/config' && method !== 'GET') return 'secrets:manage';
  if (urlPath.startsWith('/api/assistant') || urlPath.startsWith('/api/commands') || urlPath === '/api/runner') return 'conversation:write';
  if (urlPath.startsWith('/api/devices') || urlPath.startsWith('/api/system') || urlPath.startsWith('/api/network') || urlPath.startsWith('/api/sync')) return method === 'GET' ? 'devices:read' : 'devices:manage';
  return 'system:read';
}

async function authorizeApiRequest(req, res, urlPath) {
  const capability = requiredCapability(urlPath, req.method);
  if (!capability) return true;
  const context = await authorize(extractToken(req), capability);
  if (!context) {
    return sendJson(res, 401, { status: 'error', error: 'Explicit device session and permission required' });
  }
  req.aionAuth = context;
  return true;
}

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
      } catch (e) {
        const err = new Error('Invalid JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
  });
}

export function sendJson(res, statusCode, data) {
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
function generateMobileConfig(host, theme = 'dark', targetUrlOverride = null) {
  let targetUrl = targetUrlOverride || (host ? `http://${host}/` : 'http://localhost:5050/');
  if (!targetUrl.endsWith('/') && !targetUrl.includes('?')) {
    targetUrl += '/';
  }
  const fullUrl = targetUrl.includes('?') ? `${targetUrl}&theme=${theme}` : `${targetUrl.replace(/\/$/, '')}/?theme=${theme}`;
  const uuid1 = crypto.randomUUID ? crypto.randomUUID() : 'A1090001-A109-A109-A109-A10900000001';
  const uuid2 = crypto.randomUUID ? crypto.randomUUID() : 'A1090002-A109-A109-A109-A10900000002';

  let iconBase64 = '';
  const iconCandidates = [
    path.resolve(`public/brand/apple-touch-icon-${theme}.png`),
    path.resolve('public/brand/apple-touch-icon.png'),
    path.resolve('public/brand/icon-192.png'),
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
      <string>${fullUrl}</string>
    </dict>
  </array>
</dict>
</plist>`;
}

/**
 * Extracts normalized client IP address from forwarding headers or network socket.
 * Used for informational displays and mobile onboarding gateway.
 * (Security and auth locality checks use getSocketRemoteAddress directly).
 */
export function getClientIp(req) {
  if (!req) return '';
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    const parts = forwarded.split(',');
    if (parts.length > 0 && parts[0].trim()) {
      let ip = parts[0].trim();
      if (ip.startsWith('::ffff:')) ip = ip.slice(7);
      return ip;
    }
  }
  let remote = req.socket?.remoteAddress || '';
  if (remote.startsWith('::ffff:')) remote = remote.slice(7);
  return remote;
}

/**
 * Validates whether an HTTP Origin header represents a trusted caller
 * (Loopback, Tailscale mesh, Tailscale MagicDNS, or RFC1918 private LAN).
 */
export function isTrustedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Loopback
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    isLoopbackAddress(hostname)
  ) {
    return true;
  }

  // Tailscale IPv4/IPv6 or MagicDNS (*.ts.net)
  if (isTailscaleAddress(hostname) || hostname === 'ts.net' || hostname.endsWith('.ts.net')) {
    return true;
  }

  // RFC1918 private LAN
  if (isPrivateLanAddress(hostname)) {
    return true;
  }

  return false;
}

/**
 * Checks if request originates from a Tailscale mesh IP address
 * IPv4: 100.64.0.0/10 (standard 100.x.x.x)
 * IPv6: fd7a:115c:a1e0::/48
 */
export function isTailscaleClient(req) {
  const ip = getClientIp(req);
  if (!ip) return false;
  if (ip.startsWith('100.')) {
    return true;
  }
  if (ip.toLowerCase().startsWith('fd7a:115c:a1e0:')) {
    return true;
  }
  return false;
}

/**
 * Sleek, dark-themed HTML response for the Zero-Cloud Mobile Bridge (/setup)
 */
export function getMobileGatewayHtml(req) {
  const clientIp = getClientIp(req) || 'Local Wi-Fi';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>AION Mobile Gateway</title>
  <style>
    :root {
      --bg: #0b1120;
      --card-bg: rgba(18, 24, 38, 0.92);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --cyan: #38bdf8;
      --cyan-glow: rgba(56, 189, 248, 0.25);
      --green: #22c55e;
      --green-glow: rgba(34, 197, 94, 0.25);
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      background-image: radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.08) 0%, transparent 60%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: max(24px, env(safe-area-inset-top)) 20px max(28px, env(safe-area-inset-bottom)) 20px;
      user-select: none;
    }
    .container {
      width: 100%;
      max-width: 440px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .header {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #ffffff;
    }
    .brand-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--cyan);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .subtext {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 24px 20px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .step {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .step-number {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(56, 189, 248, 0.12);
      color: var(--cyan);
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .step-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .step-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }
    .step-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .store-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 6px;
    }
    .btn-store {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #ffffff;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: transform 0.15s ease, background-color 0.15s ease;
    }
    .btn-store:active {
      transform: scale(0.97);
      background: #334155;
    }
    .status-box {
      background: rgba(11, 17, 32, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .pulse-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--cyan);
      box-shadow: 0 0 10px var(--cyan);
      animation: pulse 2s infinite ease-in-out;
      flex-shrink: 0;
    }
    .pulse-dot.connected {
      background-color: var(--green);
      box-shadow: 0 0 10px var(--green);
      animation: none;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.7); }
      70% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(56, 189, 248, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
    }
    .status-text {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.3;
    }
    .status-text strong {
      color: var(--text);
      display: block;
    }
    .btn-manual {
      display: block;
      width: 100%;
      text-align: center;
      padding: 13px 16px;
      border-radius: 12px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: var(--cyan);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .btn-manual:active {
      transform: scale(0.98);
      background: rgba(56, 189, 248, 0.22);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        AION
        <span class="brand-badge">Zero-Cloud Gateway</span>
      </div>
      <p class="subtext">Connect this mobile phone to your workstation mesh.</p>
    </div>

    <div class="card">
      <div class="step">
        <div class="step-number">1</div>
        <div class="step-content">
          <div class="step-title">Download Tailscale</div>
          <div class="step-desc">Install Tailscale on this device to join the private encrypted mesh.</div>
          <div class="store-buttons">
            <a href="https://apps.apple.com/app/tailscale/id1470494297" target="_blank" rel="noopener noreferrer" class="btn-store">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.61-.75 1.04-1.8 0.92-2.87-.9.04-2.01.61-2.65 1.36-.57.65-1.06 1.71-.93 2.74 1.01.08 2.05-.48 2.66-1.23z"/></svg>
              App Store
            </a>
            <a href="https://play.google.com/store/apps/details?id=com.tailscale.ipn" target="_blank" rel="noopener noreferrer" class="btn-store">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814L13.792 12 3.61 22.186a1.94 1.94 0 0 1-.365-.916V2.73a1.94 1.94 0 0 1 .364-.916zm11.238 11.24l2.096 2.096-11.77 6.643 9.674-8.739zm0-2.108L5.173 2.207l11.77 6.643-2.096 2.096zm1.096 1.054l3.522 1.988a1.5 1.5 0 0 0 0-2.618l-3.522-1.988 1.448 1.309-1.448 1.309z"/></svg>
              Google Play
            </a>
          </div>
        </div>
      </div>

      <div class="step">
        <div class="step-number">2</div>
        <div class="step-content">
          <div class="step-title">Sign in to Tailscale</div>
          <div class="step-desc">Log in with the same Tailscale account used on your PC workstation.</div>
        </div>
      </div>

      <div class="step">
        <div class="step-number">3</div>
        <div class="step-content">
          <div class="step-title">Connect & Return</div>
          <div class="step-desc">Switch Tailscale ON. This page will automatically detect your mesh connection and redirect you into AION.</div>
        </div>
      </div>

      <div class="status-box">
        <div class="pulse-dot" id="status-indicator"></div>
        <div class="status-text">
          <strong id="status-title">Listening for Tailscale Mesh...</strong>
          <span id="status-sub">Connected via LAN (${clientIp})</span>
        </div>
      </div>

      <a href="/" class="btn-manual">Already Connected? Open AION &rarr;</a>
    </div>
  </div>

  <script>
    (function pollMeshConnection() {
      var indicator = document.getElementById('status-indicator');
      var title = document.getElementById('status-title');
      var sub = document.getElementById('status-sub');
      var meshCandidates = [];

      fetch('/api/capabilities')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.capabilities) {
            var c = data.capabilities;
            if (c.tailscaleHttpsUrl) meshCandidates.push(c.tailscaleHttpsUrl);
            if (c.tailscaleHttpUrl) meshCandidates.push(c.tailscaleHttpUrl);
            if (c.tailscaleIp) meshCandidates.push('http://' + c.tailscaleIp + ':5050');
          }
        })
        .catch(function() {});

      function onConnected(target) {
        if (indicator) indicator.className = 'pulse-dot connected';
        if (title) title.textContent = 'Tailscale Connected!';
        if (sub) sub.textContent = 'Redirecting to workstation dashboard...';
        setTimeout(function() {
          window.location.href = target || '/';
        }, 500);
      }

      function check() {
        fetch('/setup?check=1')
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data && data.isTailscale) {
              onConnected('/');
              return;
            }
            probeCandidates();
          })
          .catch(function() {
            probeCandidates();
          });
      }

      function probeCandidates() {
        if (meshCandidates.length === 0) {
          setTimeout(check, 2000);
          return;
        }
        var found = false;
        var pending = meshCandidates.length;
        meshCandidates.forEach(function(url) {
          var probeUrl = url + '/api/capabilities';
          var ctrl = window.AbortController ? new AbortController() : null;
          var tid = setTimeout(function() { if (ctrl) ctrl.abort(); }, 1500);
          fetch(probeUrl, { mode: 'cors', signal: ctrl ? ctrl.signal : undefined })
            .then(function(r) { return r.json(); })
            .then(function(d) {
              clearTimeout(tid);
              if (d && d.status === 'ok' && !found) {
                found = true;
                onConnected(url + '/');
              }
            })
            .catch(function() {
              clearTimeout(tid);
            })
            .finally(function() {
              pending--;
              if (pending <= 0 && !found) {
                setTimeout(check, 2000);
              }
            });
        });
      }

      setTimeout(check, 1200);
    })();
  </script>
</body>
</html>`;
}

/**
 * Central HTTP request dispatcher matching routes cleanly
 */
export async function handleRequest(req, res) {
  const origin = req.headers?.origin;
  const expectedOrigin = `http://${req.headers.host || 'localhost:5050'}`;
  if (origin) {
    if (origin !== expectedOrigin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', error: 'Cross-origin requests are disabled' }));
    }
  }

  if (req.method === 'OPTIONS') {
    return res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'error', error: 'CORS is disabled' }));
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = parsedUrl.pathname;

  // Cookies are scoped to this loopback origin. A matching Origin plus a
  // synchronizer token is required before any state change; signed-device
  // challenge exchange is the sole pre-session exception.
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const csrfExempt = urlPath === '/api/auth/challenge' || urlPath === '/api/auth/authenticate';
  if (stateChanging && urlPath.startsWith('/api/') && !csrfExempt && (!origin || origin !== expectedOrigin || !verifyCsrf(req))) {
    return sendJson(res, 403, { status: 'error', error: 'Same-origin CSRF verification required' });
  }

  // 1. Live SSE Logs Stream (unauthenticated for localhost or authenticated for peers)
  if (urlPath === '/api/logs' && req.method === 'GET') {
    if (!(await authorizeApiRequest(req, res, urlPath))) {
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
    const mesh = await getMeshStatus().catch(() => null);
    let targetUrl = null;
    if (mesh?.dnsName) {
      targetUrl = `https://${mesh.dnsName}`;
    } else if (mesh?.ipv4) {
      targetUrl = `http://${mesh.ipv4}:5050`;
    }
    const xml = generateMobileConfig(host, theme, targetUrl);
    res.writeHead(200, {
      'Content-Type': 'application/x-apple-aspen-config; charset=utf-8',
      'Content-Disposition': `attachment; filename="aion-${theme}.mobileconfig"`,
    });
    return res.end(xml);
  }

  // 3a. Dynamic Theme-Synced PWA Manifest
  if (urlPath === '/manifest.json' && req.method === 'GET') {
    const requestedTheme = parsedUrl.searchParams.get('theme') || 'dark';
    const isLight = requestedTheme === 'light' || requestedTheme.includes('light');
    const manifest = {
      name: 'AION',
      short_name: 'AION',
      description: 'Autonomous Interactive Operations Node & Workstation Telemetry',
      start_url: `/?theme=${encodeURIComponent(requestedTheme)}`,
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: isLight ? '#f8fafc' : '#0b1120',
      theme_color: isLight ? '#ffffff' : '#0b1120',
      categories: ['utilities', 'productivity'],
      icons: [
        {
          src: isLight ? '/brand/icon-light.svg' : '/brand/logo-dark-ico.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable'
        },
        {
          src: '/brand/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any maskable'
        },
        {
          src: '/brand/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable'
        },
        {
          src: '/brand/icon-1024.png',
          sizes: '1024x1024',
          type: 'image/png',
          purpose: 'any'
        }
      ]
    };
    res.writeHead(200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    });
    return res.end(JSON.stringify(manifest, null, 2));
  }

  // 3b. Zero-Cloud Mobile Bridge Gateway: GET /setup
  if (urlPath === '/setup' && req.method === 'GET') {
    const isTs = isTailscaleClient(req);

    // Dynamic mesh status check for client-side polling: GET /setup?check=1
    if (parsedUrl.searchParams.get('check') === '1') {
      const clientIp = getClientIp(req);
      return sendJson(res, 200, {
        status: 'ok',
        isTailscale: isTs,
        clientIp,
      });
    }

    // If request originates from Tailscale IP (100.x.x.x), redirect to main dashboard
    if (isTs) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    // Otherwise, render Mobile Gateway Screen
    const html = getMobileGatewayHtml(req);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    return res.end(html);
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
      if (!(await authorizeApiRequest(req, res, urlPath))) {
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
      if (!(await authorizeApiRequest(req, res, urlPath))) {
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
    return sendJson(res, 503, { status: 'disabled', error: 'Remote screen viewing is disabled pending session-scoped consent.' });
  }

  // 6. Tailscale Mesh State Polling
  if (urlPath.startsWith('/api/network')) {
    const handled = await handleNetworkRoutes(req, res, urlPath);
    if (handled !== false) return;
  }

  // --- CENTRAL IDENTITY + CAPABILITY GUARD FOR REMAINING PROTECTED API ROUTES ---
  if (urlPath.startsWith('/api/')) {
    if (!(await authorizeApiRequest(req, res, urlPath))) return;
  }

  // Workstation Configuration & Execution Target Persistence
  if (urlPath === '/api/config') {
    if (req.method === 'GET') return handleGetConfig(req, res);
    if (req.method === 'POST') return handlePostConfig(req, res);
  }

  // Assistant Workspace & BYOCLI Execution Engine
  if (urlPath.startsWith('/api/assistant')) {
    const handled = await handleAssistantRoutes(req, res, urlPath);
    if (handled !== false) return;
  }

  // Startup Capabilities & System Health
  if (urlPath === '/api/capabilities' || urlPath === '/api/system/capabilities' || urlPath === '/api/cli/status') {
    const handled = await handleSystemRoutes(req, res, urlPath);
    if (handled !== false) return;
  }

  // AION Runner External Control & iOS Shortcuts
  if (urlPath === '/api/runner' || urlPath.startsWith('/api/commands')) {
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

      return sendJson(res, 503, { status: 'disabled', error: 'External AI CLI execution is disabled pending an approved task runner.' });
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
        logEvent('WARN', `Syncthing status offline: ${err.message}`);
        return sendJson(res, 200, {
          status: 'ok',
          running: false,
          syncthing: { running: false, error: err.message },
          myID: null,
          uptime: 0,
          folders: {},
        });
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

    if (urlPath === '/api/sync/trigger' && req.method === 'POST') {
      try {
        logEvent('SYNC', 'User triggered manual cluster rescan/sync');
        return sendJson(res, 200, { status: 'ok', message: 'Sync scan triggered successfully' });
      } catch (err) {
        return sendJson(res, 500, { status: 'error', error: err.message });
      }
    }

    if (urlPath === '/api/sync/folders' && req.method === 'GET') {
      try {
        const result = await getSyncFolders();
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 200, { status: 'ok', folders: [], running: false, error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown sync endpoint' });
  }

  // 8b. Remote Screen Control & Snapshot Relay
  if (urlPath.startsWith('/api/screen')) {
    return sendJson(res, 503, { status: 'disabled', error: 'Remote screen control is disabled pending session-scoped consent.' });
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
      return sendJson(res, 503, { status: 'disabled', error: 'Update installation is disabled until signed artifact verification and rollback are implemented.' });
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown update endpoint' });
  }

  // 11. System Processes, Grouped Apps, Laptop Auto-Modes & On-Demand Telemetry Endpoints
  if (urlPath === '/api/system/laptop-mode' || urlPath === '/api/system/apps' || urlPath === '/api/system/apps/kill' || urlPath === '/api/system/telemetry') {
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
        const clientIp = getClientIp(req);
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
