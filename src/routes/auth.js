import {
  isAuthenticated,
  extractToken,
  isDesktopSession,
  isLocalhost,
  verifyLocalAuthSecret,
  getSocketRemoteAddress,
  checkPairRateLimit,
  recordFailedPairAttempt,
  resetPairRateLimit,
  getRollingPinInfo,
  getPairingPin,
  regeneratePairingPin,
  pairDevice,
  getTrustedDevices,
  revokeDevice,
} from '../services/auth.js';
import { removeDeviceFromRegistry } from '../services/devices.js';
import { logEvent } from '../services/sse.js';
import { enrollInitialOwner, createDevice, createChallenge, authenticateChallenge, recoverOwner, listDevices, revokeDevice as revokeIdentityDevice, authorize } from '../services/identity-store.js';

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
 * Restricted strictly to localhost to prevent network PIN leakage
 */
export async function handleGetPin(req, res) {
  try {
    if (!isAuthenticated(req) && !verifyLocalAuthSecret(req)) {
      return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
    }
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
 * Creates the desktop WebView2's HttpOnly session cookie. The only accepted
 * credential is an in-memory secret passed directly by the native host when it
 * starts Node; normal loopback traffic cannot mint a session by location alone.
 */
export async function handleLocalSession(req, res) {
  if (!isLocalhost(req) || !verifyLocalAuthSecret(req)) {
    return sendJson(res, 401, { status: 'error', error: 'Local desktop authentication required' });
  }

  res.setHeader(
    'Set-Cookie',
    `aion_token=${process.env.AION_LOCAL_AUTH_SECRET}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
  );
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('<!doctype html><meta charset="utf-8"><script>location.replace("/")</script>');
  return true;
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
 * Enforces rate limiting per IP (5 failed attempts per 60s)
 */
export async function handlePair(req, res) {
  return sendJson(res, 410, { status: 'disabled', error: 'PIN pairing is retired. Use device-key enrollment.' });
  /* try {
    const clientIp = getSocketRemoteAddress(req);
    const rateCheck = checkPairRateLimit(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter));
      return sendJson(res, 429, {
        status: 'error',
        error: `Too many failed pairing attempts. Please retry after ${rateCheck.retryAfter} seconds.`,
        retryAfter: rateCheck.retryAfter,
      });
    }

    const body = await readJsonBody(req, 64 * 1024);
    const userAgent = req.headers?.['user-agent'] || '';

    const result = pairDevice({
      pin: body.pin,
      deviceName: body.deviceName,
      userAgent,
      ip: clientIp,
      remember: body.remember !== false,
    });

    if (!result.success) {
      recordFailedPairAttempt(clientIp);
      return sendJson(res, 401, { status: 'error', error: result.error });
    }

    resetPairRateLimit(clientIp);

    // Set persistent secure cookie
    res.setHeader(
      'Set-Cookie',
      `aion_token=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
    );

    return sendJson(res, 200, {
      status: 'ok',
      ...result,
    });
  } catch (err) {
    logEvent('ERROR', `Pairing error: ${err.message}`);
    return sendJson(res, 500, { status: 'error', error: err.message });
  } */
}

async function handleIdentityRequest(req, res, action) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    if (action === 'enroll-owner') {
      if (!verifyLocalAuthSecret(req) && !isDesktopSession(req)) return sendJson(res, 401, { status: 'error', error: 'Verified desktop session required' });
      return sendJson(res, 201, { status: 'ok', ...(await enrollInitialOwner(body)) });
    }
    if (action === 'challenge') return sendJson(res, 200, { status: 'ok', ...(await createChallenge(body.deviceId)) });
    if (action === 'authenticate') return sendJson(res, 200, { status: 'ok', ...(await authenticateChallenge(body)) });
    if (action === 'enroll-device') {
      const actor = await identityContext(req, 'identity:manage');
      if (!actor) return sendJson(res, 401, { status: 'error', error: 'Owner authorization required' });
      return sendJson(res, 201, { status: 'ok', ...(await createDevice(body, actor)) });
    }
    if (action === 'recover') {
      if (!verifyLocalAuthSecret(req) && !isDesktopSession(req)) return sendJson(res, 401, { status: 'error', error: 'Verified desktop session required' });
      return sendJson(res, 200, { status: 'ok', ...(await recoverOwner(body)) });
    }
  } catch (err) { return sendJson(res, 400, { status: 'error', error: err.message }); }
}

async function identityContext(req, capability) {
  if (isDesktopSession(req)) return { type: 'desktop', role: 'owner', deviceId: 'desktop' };
  return authorize(extractToken(req), capability);
}

/**
 * GET /api/auth/devices
 * Lists all remembered devices (requires authentication or localhost)
 */
export async function handleGetDevices(req, res) {
  const context = await identityContext(req, 'identity:manage');
  if (!context) {
    return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
  }
  const devices = await listDevices();
  return sendJson(res, 200, { status: 'ok', count: devices.length, devices });
}

/**
 * DELETE /api/auth/devices/:id
 * Revokes a trusted device by ID (requires authentication or localhost)
 */
export async function handleRevokeDevice(req, res, deviceId) {
  const context = await identityContext(req, 'identity:manage');
  if (!context) {
    return sendJson(res, 401, { status: 'error', error: 'Authentication required' });
  }

  if (!deviceId) {
    return sendJson(res, 400, { status: 'error', error: 'Device ID is required' });
  }

  try {
    await revokeIdentityDevice(deviceId, context);
    removeDeviceFromRegistry(deviceId);
    return sendJson(res, 200, { status: 'ok', success: true, message: 'Device revoked' });
  } catch (err) { return sendJson(res, 400, { status: 'error', error: err.message }); }
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
  if (urlPath === '/api/auth/local-session' && req.method === 'GET') {
    return handleLocalSession(req, res);
  }
  if (urlPath === '/api/auth/enroll-owner' && req.method === 'POST') return handleIdentityRequest(req, res, 'enroll-owner');
  if (urlPath === '/api/auth/challenge' && req.method === 'POST') return handleIdentityRequest(req, res, 'challenge');
  if (urlPath === '/api/auth/authenticate' && req.method === 'POST') return handleIdentityRequest(req, res, 'authenticate');
  if (urlPath === '/api/auth/enroll-device' && req.method === 'POST') return handleIdentityRequest(req, res, 'enroll-device');
  if (urlPath === '/api/auth/recover-owner' && req.method === 'POST') return handleIdentityRequest(req, res, 'recover');
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
