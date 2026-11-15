import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const DB_PATH = process.env.AION_ASSISTANT_DB_PATH || path.join(DATA_DIR, 'assistant.sqlite');

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
  dbInstance.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
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

  if (!db.prepare('PRAGMA table_info(projects)').all().some((column) => column.name === 'archived_at')) db.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS project_folders (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, path)
  )`);

  // 2. Sessions Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      title TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec('ALTER TABLE sessions ADD COLUMN title TEXT;');
  } catch {}

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
      'aion',
      'AION',
      process.cwd(),
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
  if (typeof name !== 'string' || !name.trim() || name.length > 160 || typeof projPath !== 'string' || projPath.length > 2048 || typeof pinned_context !== 'string' || pinned_context.length > 32000) throw new Error('Invalid project details');
  const projId = id || randomUUID();
  if (typeof projId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(projId)) throw new Error('Invalid project id');
  db.prepare(`
    INSERT INTO projects (id, name, path, pinned_context)
    VALUES (?, ?, ?, ?)
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

export async function createSession({ id, projectId, title = 'New Chat', mode = 'ask', createdAt = null }) {
  const db = await getDb();
  const project = await getProject(projectId); if (!project || project.archived_at) throw new Error('Project unavailable');
  const sessionId = id || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = createdAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO sessions (id, project_id, mode, created_at, title)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, projectId, mode, timestamp, title || 'New Chat');

  return getSession(sessionId);
}

export async function updateSession(id, { title, mode }) {
  const db = await getDb();
  const current = await getSession(id);
  if (!current) return null;

  const newTitle = title !== undefined ? title : current.title;
  const newMode = mode !== undefined ? mode : current.mode;

  db.prepare(`
    UPDATE sessions
    SET title = ?, mode = ?
    WHERE id = ?
  `).run(newTitle, newMode, id);

  return getSession(id);
}

export async function deleteSession(id) {
  const db = await getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Messages CRUD
 */
export async function getMessages(sessionId) {
  const db = await getDb();
  return db.prepare(`
    SELECT * FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC, rowid ASC
  `).all(sessionId);
}

export async function getRecentMessages(sessionId) {
  const db = await getDb();
  return db.prepare('SELECT * FROM (SELECT rowid AS sequence, * FROM messages WHERE session_id=? ORDER BY timestamp DESC, rowid DESC LIMIT 6) ORDER BY timestamp ASC, sequence ASC').all(sessionId);
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
}export async function updateProject(id, changes) {
  const db = await getDb(); const current = await getProject(id); if (!current) return null;
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => !['name', 'archived'].includes(key))) throw new Error('Invalid project update');
  if ('name' in changes && (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.length > 160)) throw new Error('Invalid project name');
  if ('archived' in changes && typeof changes.archived !== 'boolean') throw new Error('Invalid archive state');
  const name = changes.name === undefined ? current.name : changes.name.trim();
  const archived = changes.archived === undefined ? current.archived_at : (changes.archived ? (current.archived_at || new Date().toISOString()) : null);
  db.prepare('UPDATE projects SET name=?, archived_at=? WHERE id=?').run(name, archived, id);
  return getProject(id);
}
export async function listProjectFolders(id) {
  const db = await getDb(); if (!await getProject(id)) throw new Error('Project not found');
  return db.prepare('SELECT id, project_id AS projectId, path, created_at AS createdAt FROM project_folders WHERE project_id=? ORDER BY created_at, id').all(id);
}
export async function linkProjectFolder(id, folder) {
  const db = await getDb(); const project = await getProject(id); if (!project || project.archived_at) throw new Error('Project unavailable');
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || folder.length > 2048 || folder.includes('\0')) throw new Error('An absolute local folder is required');
  let resolved; try { resolved = fs.realpathSync(folder); if (!fs.statSync(resolved).isDirectory()) throw new Error(); } catch { throw new Error('Folder is unavailable'); }
  const folderId = randomUUID(), createdAt = new Date().toISOString();
  try { db.prepare('INSERT INTO project_folders(id,project_id,path,created_at) VALUES(?,?,?,?)').run(folderId, id, resolved, createdAt); } catch (error) { if (String(error.message).includes('UNIQUE')) throw new Error('Folder is already linked'); throw error; }
  return { id: folderId, projectId: id, path: resolved, createdAt };
}
