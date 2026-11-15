import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.AION_REPLICATION_DB_PATH || path.resolve('data/replication.sqlite');
const SCHEMA_VERSION = 1;
let dbPromise;
const now = () => new Date().toISOString();

async function database() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(DB_PATH);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS host_identity (id INTEGER PRIMARY KEY CHECK(id=1), host_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS replication_events (event_id TEXT PRIMARY KEY, origin_host_id TEXT NOT NULL, record_id TEXT NOT NULL, record_type TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, CHECK(revision >= 1));
CREATE TABLE IF NOT EXISTS outbound_events (event_id TEXT PRIMARY KEY, acknowledged_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, FOREIGN KEY(event_id) REFERENCES replication_events(event_id));
CREATE TABLE IF NOT EXISTS inbound_events (event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL, applied_at TEXT, conflict_at TEXT, FOREIGN KEY(event_id) REFERENCES replication_events(event_id));
CREATE TABLE IF NOT EXISTS record_heads (record_id TEXT PRIMARY KEY, record_type TEXT NOT NULL, revision INTEGER NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);`);
      const meta = db.prepare('SELECT version FROM schema_meta LIMIT 1').get();
      if (!meta) db.prepare('INSERT INTO schema_meta(version) VALUES (?)').run(SCHEMA_VERSION);
      else if (meta.version !== SCHEMA_VERSION) throw new Error('Replication storage schema is unavailable');
      return db;
    } catch (cause) { dbPromise = null; throw new Error(`Replication storage is unavailable; replication is paused. ${cause.message}`); }
  })();
  return dbPromise;
}

export async function getHostIdentity() {
  const db = await database(); let row = db.prepare('SELECT host_id AS hostId,created_at AS createdAt FROM host_identity WHERE id=1').get();
  if (!row) { row = { hostId: crypto.randomUUID(), createdAt: now() }; db.prepare('INSERT INTO host_identity(id,host_id,created_at) VALUES (1,?,?)').run(row.hostId, row.createdAt); }
  return row;
}
export async function createReplicationEvent({ recordId, recordType, payload, revision }) {
  if (!recordId || !recordType || !Number.isInteger(revision) || revision < 1) throw new Error('A record id, type, and positive revision are required');
  const db = await database(), host = await getHostIdentity(), event = { eventId: crypto.randomUUID(), originHostId: host.hostId, recordId: String(recordId), recordType: String(recordType), revision, payload: JSON.stringify(payload ?? {}), createdAt: now() };
  db.exec('BEGIN IMMEDIATE'); try { db.prepare('INSERT INTO replication_events(event_id,origin_host_id,record_id,record_type,revision,payload,created_at) VALUES (?,?,?,?,?,?,?)').run(event.eventId,event.originHostId,event.recordId,event.recordType,event.revision,event.payload,event.createdAt); db.prepare('INSERT INTO outbound_events(event_id) VALUES (?)').run(event.eventId); db.prepare('INSERT OR REPLACE INTO record_heads(record_id,record_type,revision,event_id,payload,updated_at) VALUES (?,?,?,?,?,?)').run(event.recordId,event.recordType,event.revision,event.eventId,event.payload,event.createdAt); db.exec('COMMIT'); return { ...event, payload: JSON.parse(event.payload) }; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function listOutboundEvents(limit = 100) { const db = await database(); return db.prepare('SELECT e.event_id AS eventId,e.origin_host_id AS originHostId,e.record_id AS recordId,e.record_type AS recordType,e.revision,e.payload,e.created_at AS createdAt,o.attempts FROM outbound_events o JOIN replication_events e ON e.event_id=o.event_id WHERE o.acknowledged_at IS NULL ORDER BY e.created_at LIMIT ?').all(Math.max(1, Math.min(limit, 100))).map((event) => ({ ...event, payload: JSON.parse(event.payload) })); }
export async function acknowledgeOutboundEvent(eventId) { const db = await database(); return db.prepare('UPDATE outbound_events SET acknowledged_at=? WHERE event_id=? AND acknowledged_at IS NULL').run(now(), String(eventId)).changes === 1; }
export async function applyInboundEvent(event) {
  if (!event?.eventId || !event.originHostId || !event.recordId || !event.recordType || !Number.isInteger(event.revision) || event.revision < 1) throw new Error('Invalid replication event');
  const db = await database(), payload = JSON.stringify(event.payload ?? {}); db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM inbound_events WHERE event_id=?').get(event.eventId)) { db.exec('COMMIT'); return { status: 'duplicate' }; }
    db.prepare('INSERT OR IGNORE INTO replication_events(event_id,origin_host_id,record_id,record_type,revision,payload,created_at) VALUES (?,?,?,?,?,?,?)').run(event.eventId,event.originHostId,event.recordId,event.recordType,event.revision,payload,event.createdAt || now());
    const head = db.prepare('SELECT revision FROM record_heads WHERE record_id=?').get(event.recordId); const receivedAt = now();
    if (head && head.revision >= event.revision) { db.prepare('INSERT INTO inbound_events(event_id,received_at,conflict_at) VALUES (?,?,?)').run(event.eventId,receivedAt,receivedAt); db.exec('COMMIT'); return { status: 'conflict' }; }
    db.prepare('INSERT OR REPLACE INTO record_heads(record_id,record_type,revision,event_id,payload,updated_at) VALUES (?,?,?,?,?,?)').run(event.recordId,event.recordType,event.revision,event.eventId,payload,receivedAt);
    db.prepare('INSERT INTO inbound_events(event_id,received_at,applied_at) VALUES (?,?,?)').run(event.eventId,receivedAt,receivedAt); db.exec('COMMIT'); return { status: 'applied' };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function listRecordHeads() {
  return (await database()).prepare('SELECT record_id AS recordId,record_type AS recordType,revision,event_id AS eventId,payload,updated_at AS updatedAt FROM record_heads ORDER BY record_id').all().map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}
export async function listRecordHistory(recordId) {
  return (await database()).prepare('SELECT event_id AS eventId,origin_host_id AS originHostId,record_id AS recordId,record_type AS recordType,revision,payload,created_at AS createdAt FROM replication_events WHERE record_id=? ORDER BY created_at,event_id').all(String(recordId)).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}
export async function resetReplicationStoreForTests() { if (dbPromise) { const db = await dbPromise; db.close(); dbPromise = null; } }
