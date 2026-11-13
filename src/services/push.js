import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');

/**
 * Base64URL encode buffer or string
 */
function toBase64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64URL decode to Buffer
 */
function fromBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Ensures data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Generates or loads persistent EC P-256 VAPID keys
 */
export function getOrCreateVapidKeys() {
  ensureDataDir();
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const raw = fs.readFileSync(VAPID_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.publicKey && parsed?.privateKeyJwk) {
        return parsed;
      }
    }
  } catch (err) {
    logEvent('WARN', `Failed reading vapid.json: ${err.message}`);
  }

  // Generate new EC P-256 Keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });

  // Convert JWK x and y to 65-byte uncompressed EC point (0x04 || X || Y)
  const xBuf = fromBase64Url(pubJwk.x);
  const yBuf = fromBase64Url(pubJwk.y);
  const uncompressedRaw = Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);
  const rawPublicKeyBase64Url = toBase64Url(uncompressedRaw);

  const keys = {
    publicKey: rawPublicKeyBase64Url,
    publicKeyJwk: pubJwk,
    privateKeyJwk: privJwk,
    subject: 'mailto:support@aion.local',
    createdAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf8');
    logEvent('PUSH', 'Generated persistent VAPID keypair.');
  } catch (err) {
    logEvent('ERROR', `Failed saving vapid.json: ${err.message}`);
  }

  return keys;
}

/**
 * Returns raw uncompressed Base64URL public key for browser pushManager subscription
 */
export function getVapidPublicKey() {
  const keys = getOrCreateVapidKeys();
  return keys.publicKey;
}

/**
 * Loads subscriptions from disk
 */
function loadSubscriptions() {
  ensureDataDir();
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    logEvent('WARN', `Failed reading push-subscriptions.json: ${err.message}`);
  }
  return [];
}

/**
 * Saves subscriptions to disk
 */
function saveSubscriptions(subs) {
  ensureDataDir();
  try {
    const tmp = `${SUBSCRIPTIONS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(subs, null, 2), 'utf8');
    fs.renameSync(tmp, SUBSCRIPTIONS_FILE);
  } catch (err) {
    logEvent('ERROR', `Failed writing push-subscriptions.json: ${err.message}`);
  }
}

/**
 * Registers or updates a client push subscription
 */
export function saveSubscription({ subscription, deviceId, userAgent }) {
  if (!subscription || !subscription.endpoint) {
    return { success: false, error: 'Invalid subscription payload' };
  }

  const subs = loadSubscriptions();
  const existingIdx = subs.findIndex((s) => s.endpoint === subscription.endpoint);
  const record = {
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    deviceId: deviceId || null,
    userAgent: userAgent || null,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    subs[existingIdx] = record;
  } else {
    subs.push(record);
  }

  saveSubscriptions(subs);
  logEvent('PUSH', `Registered push subscription for device: ${deviceId || 'web-client'}`);
  return { success: true, count: subs.length };
}

/**
 * Retrieves all registered push subscriptions
 */
export function getSubscriptions() {
  return loadSubscriptions();
}

/**
 * Removes a subscription by endpoint
 */
export function removeSubscription(endpoint) {
  const subs = loadSubscriptions();
  const filtered = subs.filter((s) => s.endpoint !== endpoint);
  if (filtered.length !== subs.length) {
    saveSubscriptions(filtered);
    return true;
  }
  return false;
}

/**
 * Signs VAPID JWT header and payload using Node's crypto
 */
function createVapidJwt(audience, vapidKeys) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400, // 24 hours
    sub: vapidKeys.subject || 'mailto:support@aion.local',
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const privateKey = crypto.createPrivateKey({
    key: vapidKeys.privateKeyJwk,
    format: 'jwk',
  });

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign({
    key: privateKey,
    dsaEncoding: 'ieee-p1363', // Returns 64-byte raw R||S directly for JWT
  });

  const encodedSignature = toBase64Url(signature);
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Sends a push notification to an individual subscription
 */
export async function sendPushNotification(subscription, payload = {}) {
  if (!subscription || !subscription.endpoint) {
    throw new Error('Missing push endpoint');
  }

  const endpointUrl = new URL(subscription.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const keys = getOrCreateVapidKeys();
  const jwt = createVapidJwt(audience, keys);

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = {
    TTL: '86400',
    Urgency: 'high',
    Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payloadString),
  };

  const transport = endpointUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      endpointUrl,
      {
        method: 'POST',
        headers,
        timeout: 10000,
      },
      (res) => {
        let respData = '';
        res.on('data', (c) => (respData += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: respData });
          } else if (res.statusCode === 404 || res.statusCode === 410) {
            // Subscription expired or unregistered
            removeSubscription(subscription.endpoint);
            resolve({ statusCode: res.statusCode, body: respData, expired: true });
          } else {
            resolve({ statusCode: res.statusCode, body: respData });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Push request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payloadString);
    req.end();
  });
}

/**
 * Broadcasts a push notification to all stored subscriptions
 */
export async function broadcastPush(payload) {
  const subs = loadSubscriptions();
  const results = [];
  for (const sub of subs) {
    try {
      const res = await sendPushNotification(sub, payload);
      results.push({ endpoint: sub.endpoint, success: true, ...res });
    } catch (err) {
      results.push({ endpoint: sub.endpoint, success: false, error: err.message });
    }
  }
  return results;
}
