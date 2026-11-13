import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const TRUSTED_DEVICES_FILE = path.join(DATA_DIR, 'trusted-devices.json');

export const PIN_CYCLE_DURATION_MS = 120 * 1000; // 120 seconds
export const PIN_GRACE_PERIOD_MS = 15 * 1000;    // 15 seconds grace period

/**
 * Ensures data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Generates a clean 4-digit PIN (1000 - 9999)
 */
export function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Hashes a token using SHA-256 for secure storage
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Loads trusted devices & pairing state from disk
 */
function loadStore() {
  ensureDataDir();
  try {
    if (fs.existsSync(TRUSTED_DEVICES_FILE)) {
      const raw = fs.readFileSync(TRUSTED_DEVICES_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (!Array.isArray(parsed.devices)) {
          parsed.devices = [];
        }
        return parsed;
      }
    }
  } catch (err) {
    logEvent('WARN', `Failed reading trusted-devices.json: ${err.message}`);
  }

  const initial = {
    currentPin: generatePin(),
    expiresAt: new Date(Date.now() + PIN_CYCLE_DURATION_MS).toISOString(),
    previousPin: null,
    previousExpiresAt: null,
    devices: [],
  };
  saveStore(initial);
  return initial;
}

/**
 * Saves store to disk atomically with device merging to prevent concurrent test clobbering
 */
function saveStore(store) {
  ensureDataDir();
  try {
    if (fs.existsSync(TRUSTED_DEVICES_FILE)) {
      try {
        const diskRaw = fs.readFileSync(TRUSTED_DEVICES_FILE, 'utf8');
        const diskParsed = JSON.parse(diskRaw);
        if (diskParsed && Array.isArray(diskParsed.devices)) {
          const deviceMap = new Map();
          for (const d of diskParsed.devices) {
            if (d && d.id) deviceMap.set(d.id, d);
          }
          if (store._revokedId) {
            deviceMap.delete(store._revokedId);
            delete store._revokedId;
          }
          for (const d of store.devices) {
            if (d && d.id) deviceMap.set(d.id, d);
          }
          store.devices = Array.from(deviceMap.values());
        }
      } catch {}
    }

    const tmp = `${TRUSTED_DEVICES_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, TRUSTED_DEVICES_FILE);
    } catch {
      fs.writeFileSync(TRUSTED_DEVICES_FILE, JSON.stringify(store, null, 2), 'utf8');
      try { fs.unlinkSync(tmp); } catch {}
    }
  } catch (err) {
    logEvent('ERROR', `Failed writing trusted-devices.json: ${err.message}`);
  }
}

/**
 * Ensures the rolling PIN is current and advances cycle if expired
 */
function ensureRollingPin(store, now = Date.now()) {
  if (!store.currentPin) {
    store.currentPin = store.pin || generatePin();
    store.expiresAt = new Date(now + PIN_CYCLE_DURATION_MS).toISOString();
    store.previousPin = null;
    store.previousExpiresAt = null;
    store.pin = store.currentPin;
    saveStore(store);
    return store;
  }

  const expiresTime = store.expiresAt ? new Date(store.expiresAt).getTime() : 0;

  if (now >= expiresTime) {
    const timePassedSinceExpiry = now - expiresTime;

    if (timePassedSinceExpiry < PIN_GRACE_PERIOD_MS) {
      // PIN expired within the last 15 seconds: retain as previousPin for grace period
      store.previousPin = store.currentPin;
      store.previousExpiresAt = store.expiresAt;
    } else {
      // More than grace period passed: drop previousPin
      store.previousPin = null;
      store.previousExpiresAt = null;
    }

    store.currentPin = generatePin();
    store.expiresAt = new Date(now + PIN_CYCLE_DURATION_MS).toISOString();
    store.pin = store.currentPin;
    saveStore(store);
    logEvent('AUTH', `Rolling PIN cycled to: ${store.currentPin} (expires in 120s)`);
  }

  return store;
}

/**
 * Checks if incoming request is from localhost or has localhost Host header
 */
export function isLocalhost(req) {
  if (!req) return false;

  const remote = req.socket?.remoteAddress || '';
  const host = req.headers?.host || '';
  const hostName = host.split(':')[0].toLowerCase();

  const isRemoteLocal = (
    remote === '127.0.0.1' ||
    remote === '::1' ||
    remote === '::ffff:127.0.0.1' ||
    remote === 'localhost'
  );

  const isHostLocal = (
    hostName === 'localhost' ||
    hostName === '127.0.0.1' ||
    hostName === '[::1]' ||
    hostName === '::1'
  );

  return isRemoteLocal || isHostLocal;
}

/**
 * Extracts bearer or cookie token from request
 */
export function extractToken(req) {
  if (!req) return null;

  // 1. Authorization header: Bearer <token>
  const authHeader = req.headers?.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
      return parts[1].trim();
    }
  }

  // 2. Cookie header: aion_token=<token>
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)aion_token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1].trim());
    }
  }

  // 3. Query parameter ?token=<token>
  try {
    const url = new URL(req.url, 'http://localhost');
    const qToken = url.searchParams.get('token');
    if (qToken) return qToken.trim();
  } catch {}

  return null;
}

/**
 * Retrieves the active rolling pairing PIN info with expiration countdown
 */
export function getRollingPinInfo(now = Date.now()) {
  const store = loadStore();
  ensureRollingPin(store, now);

  const expiresTime = new Date(store.expiresAt).getTime();
  const milliseconds_remaining = Math.max(0, expiresTime - now);

  return {
    currentPin: store.currentPin,
    expiresAt: store.expiresAt,
    milliseconds_remaining,
    millisecondsRemaining: milliseconds_remaining,
    pin: store.currentPin,
  };
}

/**
 * Retrieves the active 4-digit pairing PIN string
 */
export function getPairingPin(now = Date.now()) {
  return getRollingPinInfo(now).currentPin;
}

/**
 * Force regenerates the 4-digit pairing PIN immediately
 */
export function regeneratePairingPin(now = Date.now()) {
  const store = loadStore();
  store.previousPin = store.currentPin;
  store.previousExpiresAt = new Date(now).toISOString();
  store.currentPin = generatePin();
  store.expiresAt = new Date(now + PIN_CYCLE_DURATION_MS).toISOString();
  store.pin = store.currentPin;
  saveStore(store);
  logEvent('AUTH', `Pairing PIN forcefully regenerated: ${store.currentPin}`);
  return store.currentPin;
}

/**
 * Verifies a given PIN against current PIN or previous PIN within 15s grace window
 */
export function verifyPin(pin, now = Date.now()) {
  if (!pin) return false;
  const cleanInput = String(pin).trim();
  if (cleanInput.length !== 4) return false;

  const store = loadStore();
  ensureRollingPin(store, now);

  const currentExpiresTime = new Date(store.expiresAt).getTime();

  // 1. Current valid PIN
  if (cleanInput === store.currentPin && now < currentExpiresTime) {
    return true;
  }

  // 2. 15-second grace period for immediately preceding PIN
  if (store.previousPin && cleanInput === store.previousPin && store.previousExpiresAt) {
    const prevExpiresTime = new Date(store.previousExpiresAt).getTime();
    if (now < prevExpiresTime + PIN_GRACE_PERIOD_MS) {
      logEvent('AUTH', `Accepted preceding PIN '${cleanInput}' within 15s grace period`);
      return true;
    }
  }

  return false;
}

/**
 * Validates whether a token belongs to an active trusted device
 */
export function validateToken(token) {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const store = loadStore();
  const device = store.devices.find((d) => d.tokenHash === tokenHash);
  if (device) {
    device.lastUsedAt = new Date().toISOString();
    return true;
  }
  return false;
}

/**
 * Checks if request is authenticated (either from localhost or valid device token)
 */
export function isAuthenticated(req) {
  if (isLocalhost(req)) return true;
  const token = extractToken(req);
  return validateToken(token);
}

/**
 * Pairs a new device after verifying the PIN with 64-character SHA-256 token
 */
export function pairDevice({ pin, deviceName, userAgent, ip, remember = true }, now = Date.now()) {
  if (!verifyPin(pin, now)) {
    return { success: false, error: 'Invalid pairing PIN' };
  }

  // 64-character secure hexadecimal token (32 cryptographic bytes)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const deviceId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const isoNow = new Date(now).toISOString();

  const store = loadStore();
  const newDevice = {
    id: deviceId,
    name: deviceName || 'Mobile Companion',
    userAgent: userAgent || 'Unknown browser',
    ip: ip || 'Remote',
    tokenHash,
    remember: Boolean(remember),
    createdAt: isoNow,
    lastUsedAt: isoNow,
    timestamp: isoNow,
  };

  store.devices.push(newDevice);
  saveStore(store);
  logEvent('AUTH', `Device paired successfully: ${newDevice.name} (${deviceId})`);

  return {
    success: true,
    token: rawToken,
    deviceId,
    deviceName: newDevice.name,
    message: 'Paired successfully',
  };
}

/**
 * Returns list of trusted devices with sensitive hashes stripped
 */
export function getTrustedDevices() {
  const store = loadStore();
  return (store.devices || []).map((d) => ({
    id: d.id,
    name: d.name,
    userAgent: d.userAgent,
    ip: d.ip,
    remember: d.remember,
    createdAt: d.createdAt,
    lastUsedAt: d.lastUsedAt,
    timestamp: d.timestamp || d.createdAt,
  }));
}

/**
 * Revokes a trusted device by ID
 */
export function revokeDevice(id) {
  if (!id) return false;
  const store = loadStore();
  const initialLen = store.devices.length;
  store.devices = store.devices.filter((d) => d.id !== id);
  if (store.devices.length !== initialLen) {
    store._revokedId = id;
    saveStore(store);
    logEvent('AUTH', `Revoked trusted device: ${id}`);
    return true;
  }
  return false;
}

/**
 * Test helper to manually set internal rolling pin state
 */
export function _setRollingPinStateForTests({ currentPin, expiresAt, previousPin, previousExpiresAt }) {
  const store = loadStore();
  if (currentPin) store.currentPin = currentPin;
  if (expiresAt) store.expiresAt = expiresAt;
  if (previousPin !== undefined) store.previousPin = previousPin;
  if (previousExpiresAt !== undefined) store.previousExpiresAt = previousExpiresAt;
  store.pin = store.currentPin;
  saveStore(store);
}
