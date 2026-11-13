import {
  isAuthenticated,
  isLocalhost,
  getRollingPinInfo,
  getPairingPin,
  regeneratePairingPin,
  pairDevice,
  getTrustedDevices,
  revokeDevice,
} from '../services/auth.js';
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
 * GET /api/auth/pin
 * Returns current rolling PIN, expiration timestamp, and remaining milliseconds
 */
export async function handleGetPin(req, res) {
  try {
    const pinInfo = getRollingPinInfo();
    return sendJson(res, 200, {
      status: 'ok',
      currentPin: pinInfo.currentPin,
      expiresAt: pinInfo.expiresAt,
      milliseconds_remaining: pinInfo.milliseconds_remaining,
      millisecondsRemaining: pinInfo.millisecondsRemaining,
      pin: pinInfo.currentPin,
    });
  } catch (err) {
    logEvent('ERROR', `Failed to get rolling PIN: ${err.message}`);
    return sendJson(res, 500, { status: 'error', error: err.message });
  }
}

/**
 * GET /api/auth/status
 * Returns current client authentication status and localhost presence
 */
export async function handleGetAuthStatus(req, res) {
  try {
    const authed = isAuthenticated(req);
    const local = isLocalhost(req);
    const pinInfo = local ? getRollingPinInfo() : null;

    return sendJson(res, 200, {
      status: 'ok',
      authenticated: authed,
      isLocalhost: local,
      pin: pinInfo ? pinInfo.currentPin : undefined,
      currentPin: pinInfo ? pinInfo.currentPin : undefined,
      expiresAt: pinInfo ? pinInfo.expiresAt : undefined,
      milliseconds_remaining: pinInfo ? pinInfo.milliseconds_remaining : undefined,
    });
  } catch (err) {
    logEvent('ERROR', `Auth status error: ${err.message}`);
    return sendJson(res, 500, { status: 'error', error: err.message });
  }
}

/**
 * POST /api/auth/pair
 * Validates PIN (with 15s grace), creates 64-char token, saves device, and sets cookie
 */
export async function handlePair(req, res) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const clientIp = req.socket?.remoteAddress || '';
    const userAgent = req.headers?.['user-agent'] || '';

    const result = pairDevice({
      pin: body.pin,
      deviceName: body.deviceName,
      userAgent,
      ip: clientIp,
      remember: body.remember !== false,
    });

    if (!result.success) {
      return sendJson(res, 401, { status: 'error', error: result.error });
    }

    // Set persistent secure cookie
    res.setHeader(
      'Set-Cookie',
      `aion_token=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`
    );

    return sendJson(res, 200, {
      status: 'ok',
      ...result,
    });
  } catch (err) {
    logEvent('ERROR', `Pairing error: ${err.message}`);
    return sendJson(res, 500, { status: 'error', error: err.message });
  }
}

/**
 * GET /api/auth/devices
 * Lists all remembered devices (requires authentication or localhost)
 */
export async function handleGetDevices(req, res) {
  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
  }
  const devices = getTrustedDevices();
  return sendJson(res, 200, { status: 'ok', count: devices.length, devices });
}

/**
 * DELETE /api/auth/devices/:id
 * Revokes a trusted device by ID (requires authentication or localhost)
 */
export async function handleRevokeDevice(req, res, deviceId) {
  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
  }

  if (!deviceId) {
    return sendJson(res, 400, { status: 'error', error: 'Device ID is required' });
  }

  const success = revokeDevice(deviceId);
  return sendJson(res, success ? 200 : 404, {
    status: success ? 'ok' : 'error',
    success,
    message: success ? 'Device revoked' : 'Device not found',
  });
}

/**
 * POST /api/auth/pin/regenerate
 * Forcefully regenerates the rolling PIN immediately (requires authentication or localhost)
 */
export async function handleRegeneratePin(req, res) {
  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
  }

  const newPin = regeneratePairingPin();
  const pinInfo = getRollingPinInfo();

  return sendJson(res, 200, {
    status: 'ok',
    pin: newPin,
    currentPin: pinInfo.currentPin,
    expiresAt: pinInfo.expiresAt,
    milliseconds_remaining: pinInfo.milliseconds_remaining,
  });
}

/**
 * Central dispatcher for all /api/auth/* routes
 */
export async function handleAuthRoutes(req, res, urlPath) {
  // GET /api/auth/pin
  if (urlPath === '/api/auth/pin' && req.method === 'GET') {
    return handleGetPin(req, res);
  }

  // GET /api/auth/status
  if (urlPath === '/api/auth/status' && req.method === 'GET') {
    return handleGetAuthStatus(req, res);
  }

  // POST /api/auth/pair
  if (urlPath === '/api/auth/pair' && req.method === 'POST') {
    return handlePair(req, res);
  }

  // GET /api/auth/devices
  if (urlPath === '/api/auth/devices' && req.method === 'GET') {
    return handleGetDevices(req, res);
  }

  // DELETE /api/auth/devices/:id
  const revokeMatch = urlPath.match(/^\/api\/auth\/devices\/([^/]+)$/);
  if (revokeMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(revokeMatch[1]);
    return handleRevokeDevice(req, res, id);
  }

  // POST /api/auth/pin/regenerate
  if (urlPath === '/api/auth/pin/regenerate' && req.method === 'POST') {
    return handleRegeneratePin(req, res);
  }

  return false;
}
