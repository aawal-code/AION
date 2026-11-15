import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const DB_PATH = process.env.AION_SECURITY_DB_PATH || path.join(DATA_DIR, 'security.sqlite');
const SESSION_TTL_MS = 20 * 60 * 1000;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
let dbPromise;

export const ROLES = Object.freeze({ OWNER: 'owner', TRUSTED: 'trusted', LIMITED: 'limited' });
const ROLE_CAPABILITIES = Object.freeze({
  owner: new Set(['*']),
  trusted: new Set(['system:read', 'devices:read', 'conversation:read', 'conversation:write']),
  limited: new Set(['devices:read']),
});

const now = () => new Date().toISOString();
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL UNIQUE, role TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, FOREIGN KEY(device_id) REFERENCES devices(id));
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, challenge_hash TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, FOREIGN KEY(device_id) REFERENCES devices(id));
      CREATE TABLE IF NOT EXISTS recovery_keys (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, verifier TEXT NOT NULL, rotated_at TEXT NOT NULL, invalidated_at TEXT);
      CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, event TEXT NOT NULL, device_id TEXT, detail TEXT NOT NULL, created_at TEXT NOT NULL);`);
    const meta = db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
    if (!meta) db.prepare('INSERT INTO schema_meta(version) VALUES (?)').run(1);
    return db;
  })();
  return dbPromise;
}

function audit(db, event, deviceId = null, detail = {}) {
  db.prepare('INSERT INTO audit_events(id,event,device_id,detail,created_at) VALUES (?,?,?,?,?)')
    .run(crypto.randomUUID(), event, deviceId, JSON.stringify(detail), now());
}

function validatePublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'string' || publicKey.length > 4096) throw new Error('A valid device public key is required');
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Device keys must use Ed25519');
  return key.export({ type: 'spki', format: 'pem' });
}

function recoveryVerifier(key, salt) { return digest(`${salt}:${key}`); }
function hasCapability(role, capability) { const caps = ROLE_CAPABILITIES[role]; return Boolean(caps && (caps.has('*') || caps.has(capability))); }

export async function enrollInitialOwner({ name = 'AION Desktop Owner', publicKey } = {}) {
  const db = await getDb(); const normalizedKey = validatePublicKey(publicKey);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM devices WHERE role='owner' AND revoked_at IS NULL LIMIT 1").get()) throw new Error('An Owner already exists');
    const deviceId = crypto.randomUUID(); const recoveryKey = token(32); const salt = token(16);
    db.prepare('INSERT INTO devices(id,name,public_key,role,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(deviceId, String(name).slice(0, 120), normalizedKey, ROLES.OWNER, now());
    db.prepare('INSERT OR REPLACE INTO recovery_keys(id,salt,verifier,rotated_at,invalidated_at) VALUES (1,?,?,?,NULL)').run(salt, recoveryVerifier(recoveryKey, salt), now());
    audit(db, 'owner.enrolled', deviceId, {}); db.exec('COMMIT');
    return { deviceId, role: ROLES.OWNER, recoveryKey };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export async function createDevice({ name, publicKey, role = ROLES.LIMITED }, actor) {
  if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required');
  if (!Object.values(ROLES).includes(role)) throw new Error('Invalid role');
  const db = await getDb(); const normalizedKey = validatePublicKey(publicKey); const id = crypto.randomUUID();
  db.prepare('INSERT INTO devices(id,name,public_key,role,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(id, String(name || 'Trusted device').slice(0, 120), normalizedKey, role, now());
  audit(db, 'device.enrolled', id, { role, actor: actor.deviceId }); return { id, role };
}

export async function createChallenge(deviceId) {
  const db = await getDb(); const device = db.prepare('SELECT id FROM devices WHERE id=? AND revoked_at IS NULL').get(deviceId);
  if (!device) throw new Error('Unknown or revoked device');
  const challenge = token(32); const id = crypto.randomUUID();
  db.prepare('INSERT INTO challenges(id,device_id,challenge_hash,expires_at,consumed_at) VALUES (?,?,?,?,NULL)').run(id, deviceId, digest(challenge), new Date(Date.now() + CHALLENGE_TTL_MS).toISOString());
  return { challengeId: id, challenge, signingPayload: `${id}:${digest(challenge)}`, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() };
}

export async function authenticateChallenge({ challengeId, signature }) {
  const db = await getDb(); const row = db.prepare(`SELECT c.*, d.public_key, d.role, d.revoked_at FROM challenges c JOIN devices d ON d.id=c.device_id WHERE c.id=?`).get(challengeId);
  if (!row || row.consumed_at || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) throw new Error('Challenge is invalid or expired');
  const signatureBytes = Buffer.from(String(signature || ''), 'base64url');
  // The challenge value is never persisted; clients sign challengeId + challenge separately.
  // A server-side hash cannot be verified, so signed payload uses the one-time ID and its stored hash.
  const payload = Buffer.from(`${row.id}:${row.challenge_hash}`, 'utf8');
  if (!crypto.verify(null, payload, row.public_key, signatureBytes)) throw new Error('Invalid device signature');
  const rawToken = token(32); const sessionId = crypto.randomUUID(); const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const consumed = db.prepare('UPDATE challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?').run(now(), row.id, now());
    if (consumed.changes !== 1) throw new Error('Challenge replay detected');
    db.prepare('INSERT INTO sessions(id,device_id,token_hash,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(sessionId, row.device_id, digest(rawToken), now(), expiresAt);
    audit(db, 'session.created', row.device_id, { sessionId }); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { token: rawToken, expiresAt, role: row.role, deviceId: row.device_id };
}

export async function getSessionContext(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const db = await getDb();
  const row = db.prepare(`SELECT s.id session_id, d.id device_id, d.role FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.expires_at>?`).get(digest(rawToken), now());
  return row ? { sessionId: row.session_id, deviceId: row.device_id, role: row.role, type: 'device' } : null;
}

export async function authorize(rawToken, capability) { const context = await getSessionContext(rawToken); return context && hasCapability(context.role, capability) ? context : null; }
export async function revokeDevice(deviceId, actor) { if (!actor || actor.role !== ROLES.OWNER) throw new Error('Owner authorization required'); const db = await getDb(); db.exec('BEGIN IMMEDIATE'); try { db.prepare('UPDATE devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now(), deviceId); db.prepare('UPDATE sessions SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL').run(now(), deviceId); audit(db, 'device.revoked', deviceId, { actor: actor.deviceId }); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } }
export async function listDevices() { const db = await getDb(); return db.prepare('SELECT id,name,role,created_at,revoked_at FROM devices ORDER BY created_at').all(); }
export async function recoverOwner({ recoveryKey, name, publicKey }) { const db = await getDb(); const key = validatePublicKey(publicKey); const record = db.prepare('SELECT * FROM recovery_keys WHERE id=1 AND invalidated_at IS NULL').get(); const expected = record ? Buffer.from(record.verifier) : Buffer.alloc(0); const supplied = record ? Buffer.from(recoveryVerifier(recoveryKey, record.salt)) : Buffer.alloc(1); if (!record || expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error('Recovery key invalid'); const next = token(32), salt = token(16), id = crypto.randomUUID(); db.exec('BEGIN IMMEDIATE'); try { db.prepare("UPDATE devices SET revoked_at=? WHERE role='owner' AND revoked_at IS NULL").run(now()); db.prepare("UPDATE sessions SET revoked_at=? WHERE device_id IN (SELECT id FROM devices WHERE role='owner') AND revoked_at IS NULL").run(now()); db.prepare('INSERT INTO devices(id,name,public_key,role,created_at,revoked_at) VALUES (?,?,?,?,?,NULL)').run(id, String(name || 'Recovered Owner').slice(0,120), key, ROLES.OWNER, now()); db.prepare('UPDATE recovery_keys SET salt=?, verifier=?, rotated_at=? WHERE id=1').run(salt, recoveryVerifier(next,salt),now()); audit(db,'owner.recovered',id,{}); db.exec('COMMIT'); return { deviceId:id, recoveryKey:next }; } catch(e) { db.exec('ROLLBACK'); throw e; } }
export async function resetIdentityStoreForTests() { if (dbPromise) { const db = await dbPromise; db.close(); dbPromise = null; } }
