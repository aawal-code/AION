import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.AION_SECURITY_DB_PATH || path.resolve('data/security.sqlite');
const SESSION_TTL = 20 * 60_000;
const CHALLENGE_TTL = 2 * 60_000;
const BOOTSTRAP_TTL = 5 * 60_000;
const SCHEMA_VERSION = 5;
const PAIRING_TTL = 5 * 60_000;
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
      db.exec(`CREATE TABLE IF NOT EXISTS pairing_invitations (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, display_code TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT, claimed_name TEXT, claimed_public_key TEXT, approved_at TEXT, approved_device_id TEXT, cancelled_at TEXT, FOREIGN KEY(created_by) REFERENCES devices(id), FOREIGN KEY(approved_device_id) REFERENCES devices(id));`);
      const meta = db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
      if (!meta) db.prepare('INSERT INTO schema_meta(version) VALUES (?)').run(SCHEMA_VERSION);
      else if (meta.version > SCHEMA_VERSION) throw new Error('Security storage was created by a newer AION version');
      else if (meta.version < SCHEMA_VERSION) {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (meta.version < 5) db.exec("ALTER TABLE pairing_invitations ADD COLUMN display_code TEXT NOT NULL DEFAULT '';");
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
function pairingCode() { return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0'); }
function pairingCodeHash(id, code) { return hash(`aion-pairing-v1:${id}:${code}`); }
function equal(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); }

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
export async function createPairingInvitation(actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required');
  const db = await database(), id = crypto.randomUUID(), code = pairingCode(), expiresAt = future(PAIRING_TTL);
  db.prepare('INSERT INTO pairing_invitations(id,code_hash,display_code,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)').run(id, pairingCodeHash(id, code), code, actor.deviceId, now(), expiresAt);
  audit(db, 'pairing.invitation.created', actor.deviceId, { invitationId: id, expiresAt });
  return { invitationId: id, verificationCode: code, expiresAt, qrPayload: `AION-PAIR:${id}` };
}
export async function claimPairingInvitation({ invitationId, name: deviceName, publicKey: value }) {
  const key = publicKey(value), db = await database(); db.exec('BEGIN IMMEDIATE');
  try {
    const invitation = db.prepare('SELECT * FROM pairing_invitations WHERE id=?').get(String(invitationId || ''));
    if (!invitation || invitation.cancelled_at || invitation.approved_at || invitation.claimed_at || Date.parse(invitation.expires_at) <= Date.now()) throw new Error('Pairing invitation is invalid, expired, or already used');
    if (db.prepare('UPDATE pairing_invitations SET claimed_at=?,claimed_name=?,claimed_public_key=? WHERE id=? AND claimed_at IS NULL').run(now(), name(deviceName, 'AION device'), key, invitation.id).changes !== 1) throw new Error('Pairing invitation was claimed concurrently');
    audit(db, 'pairing.invitation.claimed', null, { invitationId: invitation.id }); db.exec('COMMIT');
    return { invitationId: invitation.id, verificationCode: invitation.display_code, expiresAt: invitation.expires_at, status: 'pending-owner-approval' };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function approvePairingInvitation({ invitationId, verificationCode, role = ROLES.LIMITED, capabilities }, actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required');
  if (![ROLES.TRUSTED, ROLES.LIMITED].includes(role)) throw new Error('Only Trusted or Limited devices can be approved');
  const grants = capabilitiesForRole(role, capabilities), db = await database(); db.exec('BEGIN IMMEDIATE');
  try {
    const invitation = db.prepare('SELECT * FROM pairing_invitations WHERE id=?').get(String(invitationId || ''));
    if (!invitation || invitation.cancelled_at || invitation.approved_at || !invitation.claimed_at || Date.parse(invitation.expires_at) <= Date.now()) throw new Error('Pairing invitation is not awaiting approval');
    if (!equal(invitation.code_hash, pairingCodeHash(invitation.id, verificationCode))) throw new Error('Verification code does not match this pairing invitation');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO devices(id,name,public_key,role,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(id, invitation.claimed_name, invitation.claimed_public_key, role, now());
    const insert = db.prepare('INSERT INTO device_capabilities(device_id,capability,granted_at) VALUES (?,?,?)'); for (const capability of grants) insert.run(id, capability, now());
    db.prepare('UPDATE pairing_invitations SET approved_at=?,approved_device_id=? WHERE id=? AND approved_at IS NULL').run(now(), id, invitation.id);
    audit(db, 'pairing.invitation.approved', id, { invitationId: invitation.id, role, capabilities: grants, actor: actor.deviceId }); db.exec('COMMIT');
    return { deviceId: id, role, capabilities: grants };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function listPairingInvitations() {
  return (await database()).prepare('SELECT id,created_at AS createdAt,expires_at AS expiresAt,claimed_at AS claimedAt,claimed_name AS claimedName,approved_at AS approvedAt,cancelled_at AS cancelledAt FROM pairing_invitations ORDER BY created_at DESC LIMIT 50').all();
}
export async function getPairingInvitationStatus(invitationId) {
  const row = (await database()).prepare('SELECT id,expires_at AS expiresAt,claimed_at AS claimedAt,approved_at AS approvedAt,cancelled_at AS cancelledAt,approved_device_id AS deviceId FROM pairing_invitations WHERE id=?').get(String(invitationId || ''));
  if (!row || row.cancelledAt || Date.parse(row.expiresAt) <= Date.now()) throw new Error('Pairing invitation is invalid or expired');
  return { invitationId: row.id, expiresAt: row.expiresAt, status: row.approvedAt ? 'approved' : row.claimedAt ? 'pending-owner-approval' : 'awaiting-device', deviceId: row.approvedAt ? row.deviceId : null };
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
