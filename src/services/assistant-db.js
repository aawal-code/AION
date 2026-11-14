import fs from 'node:fs';
import path from 'node:path';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const DB_PATH = path.join(DATA_DIR, 'assistant.sqlite');

let dbInstance = null;

/**
 * Initializes and returns the SQLite database instance.
 * Supports better-sqlite3 if installed, otherwise falls back natively to Node 22+ built-in node:sqlite (DatabaseSync).
 */
export async function getDb(customPath = null) {
  if (dbInstance) return dbInstance;

  const targetPath = customPath || DB_PATH;

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  let DatabaseConstructor;

  try {
    const betterSqlite = await import('better-sqlite3');
    DatabaseConstructor = betterSqlite.default || betterSqlite;
  } catch {
    const { DatabaseSync } = await import('node:sqlite');
    DatabaseConstructor = DatabaseSync;
  }

  dbInstance = new DatabaseConstructor(targetPath);
  initSchema(dbInstance);
  return dbInstance;
}

/**
 * Creates required database schema and seeds initial projects if missing.
 * Tables:
 * - projects (id, name, path, pinned_context)
 * - sessions (id, project_id, mode, created_at)
 * - messages (id, session_id, role, content, timestamp, metadata)
 */
export function initSchema(db) {
  // 1. Projects Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT,
      pinned_context TEXT
    );
  `);

  // 2. Sessions Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  // 3. Messages Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  // Seed default core projects if empty
  const countRow = db.prepare('SELECT COUNT(*) as count FROM projects').get();
  const count = Number(countRow?.count || countRow?.['COUNT(*)'] || 0);

  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO projects (id, name, path, pinned_context)
      VALUES (?, ?, ?, ?)
    `);

    insert.run(
      'hexis',
      'HEXIS',
      'C:\\hexis',
      'HEXIS Cognitive Engine & Operational Workspace'
    );

    insert.run(
      'aion',
      'AION',
      'C:\\aion',
      'Autonomous Interactive Operations Node — Native Workstation Daemon'
    );
  }
}

/**
 * Projects CRUD
 */
export async function getProjects() {
  const db = await getDb();
  return db.prepare('SELECT * FROM projects ORDER BY name ASC').all();
}

export async function getProject(id) {
  const db = await getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
}

export async function createProject({ id, name, path: projPath = '', pinned_context = '' }) {
  const db = await getDb();
  const projId = id || name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  db.prepare(`
    INSERT INTO projects (id, name, path, pinned_context)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      pinned_context = excluded.pinned_context
  `).run(projId, name, projPath, pinned_context);

  return getProject(projId);
}

/**
 * Sessions CRUD
 */
export async function getSessions(projectId) {
  const db = await getDb();
  return db.prepare(`
    SELECT * FROM sessions
    WHERE project_id = ?
    ORDER BY created_at DESC
  `).all(projectId);
}

export async function getSession(id) {
  const db = await getDb();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
}

export async function createSession({ id, projectId, mode = 'ask', createdAt = null }) {
  const db = await getDb();
  const sessionId = id || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = createdAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO sessions (id, project_id, mode, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, projectId, mode, timestamp);

  return getSession(sessionId);
}

/**
 * Messages CRUD
 */
export async function getMessages(sessionId) {
  const db = await getDb();
  return db.prepare(`
    SELECT * FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId);
}

export async function addMessage({ id, sessionId, role, content, timestamp = null, metadata = null }) {
  const db = await getDb();
  const msgId = id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const time = timestamp || new Date().toISOString();
  const metaStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msgId, sessionId, role, content, time, metaStr);

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
}

/**
 * Closes current database connection (useful for tests and cleanup)
 */
export function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
}
