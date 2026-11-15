import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.AION_SECURITY_DB_PATH || path.resolve('data/security.sqlite');
const SESSION_TTL = 20 * 60_000;
const CHALLENGE_TTL = 2 * 60_000;
const BOOTSTRAP_TTL = 5 * 60_000;
const SCHEMA_VERSION = 3;
let dbPromise;

export const ROLES = Object.freeze({ OWNER: 'owner', TRUSTED: 'trusted', LIMITED: 'limited' });
export const ROLE_CAPABILITIES = Object.freeze({
  owner: new Set(['*']),
  trusted: new Set(['system:read', 'devices:read', 'conversation:read', 'conversation:write']),
  limited: new Set(['devices:read']),
});

const now = () => new Date().toISOString();
const future = (ms) => new Date(Date.now() + ms).toISOString();
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const recoveryHash = (key, salt) => hash(`${salt}:${key}`);

async function database() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(DB_PATH);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('owner','trusted','limited')), created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, FOREIGN KEY(device_id) REFERENCES devices(id));
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, challenge_hash TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, FOREIGN KEY(device_id) REFERENCES devices(id));
CREATE TABLE IF NOT EXISTS recovery_keys (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, verifier TEXT NOT NULL, rotated_at TEXT NOT NULL, invalidated_at TEXT);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, event TEXT NOT NULL, device_id TEXT, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS desktop_bootstrap_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS device_capabilities (device_id TEXT NOT NULL, capability TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY(device_id, capability), FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE);`);
      const meta = db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
      if (!meta) db.prepare('INSERT INTO schema_meta(version) VALUES (?)').run(SCHEMA_VERSION);
      else if (meta.version > SCHEMA_VERSION) throw new Error('Security storage was created by a newer AION version');
      else if (meta.version < SCHEMA_VERSION) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const legacyDevices = db.prepare('SELECT id,role FROM devices WHERE revoked_at IS NULL').all();
          const insert = db.prepare('INSERT OR IGNORE INTO device_capabilities(device_id,capability,granted_at) VALUES (?,?,?)');
          for (const device of legacyDevices) for (const capability of capabilitiesForRole(device.role)) insert.run(device.id, capability, now());
          db.prepare('UPDATE schema_meta SET version=?').run(SCHEMA_VERSION);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      return db;
    } catch (cause) { dbPromise = null; throw new Error(`Security identity storage is unavailable; access is denied until it is repaired. ${cause.message}`); }
  })();
  return dbPromise;
}

function audit(db, event, deviceId = null, detail = {}) {
  db.prepare('INSERT INTO audit_events(id,event,device_id,detail,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), event, deviceId, JSON.stringify(detail), now());
}
function publicKey(value) {
  if (!value || typeof value !== 'string' || value.length > 4096) throw new Error('A valid device public key is required');
  const key = crypto.createPublicKey(value);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Device keys must use Ed25519');
  return key.export({ type: 'spki', format: 'pem' });
}
function name(value, fallback) { return String(value || fallback).trim().slice(0, 120) || fallback; }
export function hasCapability(role, capability, grants = null) {
  const roleCaps = ROLE_CAPABILITIES[role];
  if (!roleCaps || !(roleCaps.has('*') || roleCaps.has(capability))) return false;
  return roleCaps.has('*') || (Array.isArray(grants) && grants.includes(capability));
}
function capabilitiesForRole(role, requested) {
  const allowed = ROLE_CAPABILITIES[role];
  if (!allowed) throw new Error('A valid device role is required');
  if (allowed.has('*')) return ['*'];
  const grants = requested === undefined ? [...allowed] : requested;
  if (!Array.isArray(grants) || grants.some((capability) => typeof capability !== 'string' || !allowed.has(capability))) throw new Error(`Capabilities must be permitted for the ${role} role`);
  return [...new Set(grants)].sort();
}

export async function getIdentityStatus() {
  const db = await database();
  const owner = db.prepare("SELECT id,name,created_at AS createdAt FROM devices WHERE role='owner' AND revoked_at IS NULL LIMIT 1").get();
  return { initialized: Boolean(owner), owner: owner || null, schemaVersion: SCHEMA_VERSION };
}
export async function enrollInitialOwner({ name: deviceName, publicKey: value } = {}) {
  const db = await database(); const key = publicKey(value); db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM devices WHERE role='owner' AND revoked_at IS NULL LIMIT 1").get()) throw new Error('An Owner already exists');
    const id = crypto.randomUUID(), recoveryKey = random(), salt = random(16);
    db.prepare('INSERT INTO devices(id,name,public_key,role,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(id, name(deviceName, 'AION Desktop Owner'), key, ROLES.OWNER, now());
    db.prepare('INSERT INTO device_capabilities(device_id,capability,granted_at) VALUES (?,?,?)').run(id, '*', now());
    db.prepare('INSERT OR REPLACE INTO recovery_keys(id,salt,verifier,rotated_at,invalidated_at) VALUES (1,?,?,?,NULL)').run(salt, recoveryHash(recoveryKey, salt), now());
    audit(db, 'owner.enrolled', id); db.exec('COMMIT'); return { deviceId: id, role: ROLES.OWNER, recoveryKey };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function createDevice({ name: deviceName, publicKey: value, role = ROLES.LIMITED, capabilities }, actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required');
  if (![ROLES.TRUSTED, ROLES.LIMITED].includes(role)) throw new Error('Only Trusted or Limited devices can be enrolled here');
  const grants = capabilitiesForRole(role, capabilities);
  const db = await database(), id = crypto.randomUUID(), key = publicKey(value); db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO devices(id,name,public_key,role,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(id, name(deviceName, 'AION device'), key, role, now());
    const insert = db.prepare('INSERT INTO device_capabilities(device_id,capability,granted_at) VALUES (?,?,?)');
    for (const capability of grants) insert.run(id, capability, now());
    audit(db, 'device.enrolled', id, { role, capabilities: grants, actor: actor.deviceId }); db.exec('COMMIT'); return { id, role, capabilities: grants };
  }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function createChallenge(deviceId) {
  const db = await database();
  if (!db.prepare('SELECT id FROM devices WHERE id=? AND revoked_at IS NULL').get(deviceId)) throw new Error('Unknown or revoked device');
  const challenge = random(), challengeId = crypto.randomUUID(), expiresAt = future(CHALLENGE_TTL);
  db.prepare('INSERT INTO challenges(id,device_id,challenge_hash,expires_at,consumed_at) VALUES (?,?,?,?,NULL)').run(challengeId, deviceId, hash(challenge), expiresAt);
  return { challengeId, challenge, signingPayload: `${challengeId}:${hash(challenge)}`, expiresAt };
}
export async function authenticateChallenge({ challengeId, signature }) {
  const db = await database();
  const row = db.prepare('SELECT c.*,d.public_key,d.role,d.revoked_at FROM challenges c JOIN devices d ON d.id=c.device_id WHERE c.id=?').get(challengeId);
  if (!row || row.consumed_at || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) throw new Error('Challenge is invalid or expired');
  if (!crypto.verify(null, Buffer.from(`${row.id}:${row.challenge_hash}`), row.public_key, Buffer.from(String(signature || ''), 'base64url'))) throw new Error('Invalid device signature');
  const token = random(), sessionId = crypto.randomUUID(), expiresAt = future(SESSION_TTL); db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('UPDATE challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?').run(now(), row.id, now()).changes !== 1) throw new Error('Challenge replay detected');
    db.prepare('INSERT INTO sessions(id,device_id,token_hash,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(sessionId, row.device_id, hash(token), now(), expiresAt);
    audit(db, 'session.created', row.device_id, { sessionId }); db.exec('COMMIT'); return { token, sessionId, deviceId: row.device_id, role: row.role, expiresAt };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function getSessionContext(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  const db = await database(); const row = db.prepare('SELECT s.id AS session_id,d.id AS device_id,d.role FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.expires_at>?').get(hash(token), now());
  if (!row) return null;
  const grants = db.prepare('SELECT capability FROM device_capabilities WHERE device_id=? ORDER BY capability').all(row.device_id).map((grant) => grant.capability);
  return { sessionId: row.session_id, deviceId: row.device_id, role: row.role, capabilities: grants, type: 'device' };
}
export async function authorize(token, capability) { const context = await getSessionContext(token); return context && hasCapability(context.role, capability, context.capabilities) ? context : null; }
export async function revokeDevice(deviceId, actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required'); const db = await database(); db.exec('BEGIN IMMEDIATE');
  try { const row = db.prepare('SELECT role FROM devices WHERE id=? AND revoked_at IS NULL').get(deviceId); if (!row) throw new Error('Device is already revoked or unknown'); if (row.role === ROLES.OWNER) throw new Error('Owner access can only be changed through recovery'); db.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(now(), deviceId); db.prepare('UPDATE sessions SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL').run(now(), deviceId); audit(db, 'device.revoked', deviceId, { actor: actor.deviceId }); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function revokeSession(sessionId, actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required'); const db = await database(); db.exec('BEGIN IMMEDIATE');
  try { if (db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now(), sessionId).changes !== 1) throw new Error('Session is already revoked or unknown'); audit(db, 'session.revoked', actor.deviceId, { sessionId }); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function rotateRecoveryKey(actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required'); const db = await database(), recoveryKey = random(), salt = random(16); db.exec('BEGIN IMMEDIATE');
  try { if (!db.prepare('SELECT 1 FROM recovery_keys WHERE id=1 AND invalidated_at IS NULL').get()) throw new Error('Recovery material is unavailable'); db.prepare('UPDATE recovery_keys SET salt=?,verifier=?,rotated_at=?,invalidated_at=NULL WHERE id=1').run(salt, recoveryHash(recoveryKey, salt), now()); audit(db, 'recovery.rotated', actor.deviceId); db.exec('COMMIT'); return { recoveryKey }; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function recoverOwner({ recoveryKey, name: deviceName, publicKey: value }) {
  const db = await database(), key = publicKey(value), record = db.prepare('SELECT * FROM recovery_keys WHERE id=1 AND invalidated_at IS NULL').get();
  const expected = record ? Buffer.from(record.verifier) : Buffer.alloc(0), supplied = record ? Buffer.from(recoveryHash(recoveryKey, record.salt)) : Buffer.alloc(1);
  if (!record || expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error('Recovery key invalid');
  const id = crypto.randomUUID(), next = random(), salt = random(16); db.exec('BEGIN IMMEDIATE');
  try { db.prepare("UPDATE devices SET revoked_at=? WHERE role='owner' AND revoked_at IS NULL").run(now()); db.prepare("UPDATE sessions SET revoked_at=? WHERE device_id IN (SELECT id FROM devices WHERE role='owner') AND revoked_at IS NULL").run(now()); db.prepare('INSERT INTO devices(id,name,public_key,role,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(id, name(deviceName, 'Recovered Owner'), key, ROLES.OWNER, now()); db.prepare('INSERT INTO device_capabilities(device_id,capability,granted_at) VALUES (?,?,?)').run(id, '*', now()); db.prepare('UPDATE recovery_keys SET salt=?,verifier=?,rotated_at=? WHERE id=1').run(salt, recoveryHash(next, salt), now()); audit(db, 'owner.recovered', id); db.exec('COMMIT'); return { deviceId: id, recoveryKey: next }; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function issueDesktopBootstrap() { const db = await database(), token = random(), id = crypto.randomUUID(), expiresAt = future(BOOTSTRAP_TTL); db.prepare('INSERT INTO desktop_bootstrap_sessions(id,token_hash,created_at,expires_at,revoked_at) VALUES (?,?,?,?,NULL)').run(id, hash(token), now(), expiresAt); audit(db, 'desktop.bootstrap.created', null, { id }); return { token, expiresAt }; }
export async function getDesktopBootstrapContext(token) { if (!token || typeof token !== 'string' || token.length < 32) return null; const db = await database(); const row = db.prepare('SELECT id FROM desktop_bootstrap_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(hash(token), now()); return row ? { type: 'desktop-bootstrap', role: 'bootstrap', sessionId: row.id } : null; }
export async function listDevices() {
  const db = await database(); const grants = new Map();
  for (const row of db.prepare('SELECT device_id AS deviceId,capability FROM device_capabilities ORDER BY capability').all()) grants.set(row.deviceId, [...(grants.get(row.deviceId) || []), row.capability]);
  return db.prepare('SELECT id,name,role,created_at AS createdAt,revoked_at AS revokedAt FROM devices ORDER BY created_at').all().map((device) => ({ ...device, capabilities: grants.get(device.id) || [] }));
}
export async function listSessions() { return (await database()).prepare('SELECT s.id,s.device_id AS deviceId,d.name AS deviceName,d.role,s.created_at AS createdAt,s.expires_at AS expiresAt,s.revoked_at AS revokedAt FROM sessions s JOIN devices d ON d.id=s.device_id ORDER BY s.created_at DESC').all(); }
export async function listAuditEvents(limit = 100) { return (await database()).prepare('SELECT id,event,device_id AS deviceId,detail,created_at AS createdAt FROM audit_events ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(Number(limit) || 100, 250))).map((row) => { try { return { ...row, detail: JSON.parse(row.detail) }; } catch { return { ...row, detail: {} }; } }); }
export async function resetIdentityStoreForTests() { if (dbPromise) { const db = await dbPromise; db.close(); dbPromise = null; } }
