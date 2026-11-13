import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const TRUSTED_DEVICES_FILE = path.join(DATA_DIR, 'trusted-devices.json');

/**
 * Ensures data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
        if (!parsed.pin) {
          parsed.pin = generatePin();
          saveStore(parsed);
        }
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
    pin: generatePin(),
    devices: [],
  };
  saveStore(initial);
  return initial;
}

/**
 * Saves store to disk atomically
 */
function saveStore(store) {
  ensureDataDir();
  try {
    const tmp = `${TRUSTED_DEVICES_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, TRUSTED_DEVICES_FILE);
  } catch (err) {
    logEvent('ERROR', `Failed writing trusted-devices.json: ${err.message}`);
  }
}

/**
 * Generates a clean 4-digit PIN (1000 - 9999)
 */
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Hashes a token using SHA-256 for secure storage
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Checks if incoming request is from localhost
 */
export function isLocalhost(req) {
  const remote = req?.socket?.remoteAddress || '';
  return (
    remote === '127.0.0.1' ||
    remote === '::1' ||
    remote === '::ffff:127.0.0.1' ||
    remote === 'localhost'
  );
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
 * Retrieves the active 4-digit pairing PIN
 */
export function getPairingPin() {
  const store = loadStore();
  return store.pin;
}

/**
 * Regenerates the 4-digit pairing PIN
 */
export function regeneratePairingPin() {
  const store = loadStore();
  store.pin = generatePin();
  saveStore(store);
  logEvent('AUTH', `Pairing PIN regenerated: ${store.pin}`);
  return store.pin;
}

/**
 * Verifies a given PIN against the stored pairing PIN
 */
export function verifyPin(pin) {
  if (!pin) return false;
  const store = loadStore();
  const cleanInput = String(pin).trim();
  return cleanInput.length === 4 && cleanInput === store.pin;
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
    // Update lastUsedAt asynchronously
    device.lastUsedAt = new Date().toISOString();
    saveStore(store);
    return true;
  }
  return false;
}

/**
 * Checks if request is authenticated (either from localhost or valid token)
 */
export function isAuthenticated(req) {
  if (isLocalhost(req)) return true;
  const token = extractToken(req);
  return validateToken(token);
}

/**
 * Pairs a new device after verifying the PIN
 */
export function pairDevice({ pin, deviceName, userAgent, ip, remember = true }) {
  if (!verifyPin(pin)) {
    return { success: false, error: 'Invalid pairing PIN' };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const deviceId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  const store = loadStore();
  const newDevice = {
    id: deviceId,
    name: deviceName || 'Mobile Companion',
    userAgent: userAgent || 'Unknown browser',
    ip: ip || 'Remote',
    tokenHash,
    remember: Boolean(remember),
    createdAt: now,
    lastUsedAt: now,
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
    saveStore(store);
    logEvent('AUTH', `Revoked trusted device: ${id}`);
    return true;
  }
  return false;
}
