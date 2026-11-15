import { createHash, randomUUID } from 'node:crypto';
import { getDb, getProject, getSession } from './assistant-db.js';

const MAX_BYTES = 64 * 1024;
const CHUNK_BYTES = 4096;
let initialized = false;

async function database() {
  const db = await getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS bounded_tasks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT REFERENCES sessions(id),
    title TEXT NOT NULL, action TEXT NOT NULL, input_text TEXT NOT NULL, target_host TEXT NOT NULL,
    folders TEXT NOT NULL, permissions TEXT NOT NULL, max_input_bytes INTEGER NOT NULL, max_duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, requested_by TEXT NOT NULL,
    approved_at TEXT, approved_by TEXT, started_at TEXT, finished_at TEXT, result TEXT, error TEXT
  );
  CREATE TABLE IF NOT EXISTS bounded_task_checkpoints (
    id INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES bounded_tasks(id), at TEXT NOT NULL,
    event TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT NOT NULL
  );`);
  if (!initialized) {
    // A process restart cannot prove whether a previously running action finished.
    db.exec('BEGIN IMMEDIATE');
    try {
      const running = db.prepare("SELECT id FROM bounded_tasks WHERE status='running'").all();
      const now = new Date().toISOString();
      for (const row of running) { db.prepare("UPDATE bounded_tasks SET status='interrupted', finished_at=?, error='Host restarted during execution' WHERE id=? AND status='running'").run(now, row.id); db.prepare('INSERT INTO bounded_task_checkpoints(task_id,at,event,actor,detail) VALUES(?,?,?,?,?)').run(row.id, now, 'interrupted', 'host', '{}'); }
      db.exec('COMMIT'); initialized = true;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return db;
}
function record(db, id, event, actor, detail = {}) { db.prepare('INSERT INTO bounded_task_checkpoints(task_id,at,event,actor,detail) VALUES(?,?,?,?,?)').run(id, new Date().toISOString(), event, actor, JSON.stringify(detail)); }
function projectTask(row) { return row ? { ...row, folders: JSON.parse(row.folders), permissions: JSON.parse(row.permissions), result: row.result ? JSON.parse(row.result) : null } : null; }
function requireOwner(actor) { if (!actor || actor.role !== 'owner' || !actor.deviceId) throw new Error('Owner authorization is required'); }
export async function createBoundedTask(body, actor) {
  if (!actor?.deviceId) throw new Error('Device authorization is required');
  if (!body || typeof body !== 'object' || Object.keys(body).some((key) => !['projectId', 'sessionId', 'title', 'action', 'input', 'targetHost', 'folders', 'permissions', 'maxInputBytes', 'maxDurationMs', 'expiresInMinutes'].includes(key))) throw new Error('Invalid task scope or budget');
  const { projectId, sessionId = null, title, action, input, targetHost, folders, permissions, maxInputBytes, maxDurationMs, expiresInMinutes } = body || {};
  if (typeof projectId !== 'string' || typeof title !== 'string' || !title.trim() || title.length > 160 || action !== 'hash_text' || typeof input !== 'string' || Buffer.byteLength(input) > MAX_BYTES || targetHost !== 'local' || !Array.isArray(folders) || folders.length !== 0 || !Array.isArray(permissions) || permissions.length !== 1 || permissions[0] !== 'compute:sha256' || !Number.isInteger(maxInputBytes) || maxInputBytes < Buffer.byteLength(input) || maxInputBytes > MAX_BYTES || !Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 5000 || !Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 60) throw new Error('Invalid task scope or budget');
  const db = await database(); const project = await getProject(projectId); if (!project || project.archived_at) throw new Error('Project unavailable');
  if (sessionId) { const session = await getSession(sessionId); if (!session || session.project_id !== projectId) throw new Error('Conversation does not belong to this project'); }
  const id = randomUUID(), now = new Date(), createdAt = now.toISOString(), expiresAt = new Date(now.getTime() + expiresInMinutes * 60000).toISOString();
  db.exec('BEGIN IMMEDIATE'); try {
    db.prepare('INSERT INTO bounded_tasks(id,project_id,session_id,title,action,input_text,target_host,folders,permissions,max_input_bytes,max_duration_ms,status,created_at,expires_at,requested_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, projectId, sessionId, title.trim(), action, input, targetHost, '[]', '["compute:sha256"]', maxInputBytes, maxDurationMs, 'pending', createdAt, expiresAt, actor.deviceId);
    record(db, id, 'proposed', actor.deviceId); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return getBoundedTask(id);
}
export async function getBoundedTask(id) { const db = await database(); return projectTask(db.prepare('SELECT * FROM bounded_tasks WHERE id=?').get(id)); }
export async function listBoundedTasks(projectId) { const db = await database(); return db.prepare('SELECT * FROM bounded_tasks WHERE project_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(projectId).map(projectTask); }
export async function getTaskHistory(id) { const db = await database(); return db.prepare('SELECT at,event,actor,detail FROM bounded_task_checkpoints WHERE task_id=? ORDER BY id').all(id).map((r) => ({ ...r, detail: JSON.parse(r.detail) })); }
export async function approveBoundedTask(id, actor) {
  requireOwner(actor); const db = await database(), now = new Date().toISOString(); db.exec('BEGIN IMMEDIATE');
  try { const updated = db.prepare("UPDATE bounded_tasks SET status='approved', approved_at=?, approved_by=? WHERE id=? AND status='pending' AND expires_at>?").run(now, actor.deviceId, id, now); if (!updated.changes) throw new Error('Task is expired, already decided, or unknown'); record(db, id, 'approved', actor.deviceId); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  return getBoundedTask(id);
}
export async function cancelBoundedTask(id, actor) {
  requireOwner(actor); const db = await database(), now = new Date().toISOString(); db.exec('BEGIN IMMEDIATE');
  try { const updated = db.prepare("UPDATE bounded_tasks SET status='cancelled', finished_at=? WHERE id=? AND status IN ('pending','approved','running')").run(now, id); if (!updated.changes) throw new Error('Task cannot be cancelled'); record(db, id, 'cancelled', actor.deviceId); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  return getBoundedTask(id);
}
export async function startBoundedTask(id, actor) {
  requireOwner(actor); const db = await database(), now = new Date().toISOString(); db.exec('BEGIN IMMEDIATE');
  try {
    const updated = db.prepare("UPDATE bounded_tasks SET status='running', started_at=? WHERE id=? AND status='approved' AND expires_at>? AND (SELECT COUNT(*) FROM bounded_tasks WHERE status='running') < 4 AND EXISTS (SELECT 1 FROM projects WHERE projects.id=bounded_tasks.project_id AND projects.archived_at IS NULL)").run(now, id, now);
    if (!updated.changes) throw new Error('Task is unavailable, expired, already used, or not approved');
    record(db, id, 'started', actor.deviceId); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  setImmediate(() => run(id).catch(() => {})); return getBoundedTask(id);
}
async function run(id) {
  const db = await database(), task = await getBoundedTask(id); if (!task || task.status !== 'running') return;
  const started = Date.now(), bytes = Buffer.from(task.input_text), digest = createHash('sha256');
  try {
    if (task.action !== 'hash_text' || task.target_host !== 'local' || task.folders.length || task.permissions.length !== 1 || task.permissions[0] !== 'compute:sha256' || bytes.length > task.max_input_bytes || task.max_input_bytes > MAX_BYTES || task.max_duration_ms > 5000) throw new Error('Task scope is invalid');
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      await new Promise((resolve) => setImmediate(resolve));
      if ((await getBoundedTask(id))?.status !== 'running') return;
      if (Date.now() - started > task.max_duration_ms) throw new Error('Task exceeded its time budget');
      digest.update(bytes.subarray(offset, offset + CHUNK_BYTES));
    }
    const result = JSON.stringify({ sha256: digest.digest('hex'), inputBytes: bytes.length }); const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE'); try { const updated = db.prepare("UPDATE bounded_tasks SET status='completed', result=?, finished_at=? WHERE id=? AND status='running'").run(result, now, id); if (updated.changes) record(db, id, 'completed', 'host', { inputBytes: bytes.length }); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  } catch (error) {
    db.exec('BEGIN IMMEDIATE'); try { const updated = db.prepare("UPDATE bounded_tasks SET status='failed', error=?, finished_at=? WHERE id=? AND status='running'").run(error.message, new Date().toISOString(), id); if (updated.changes) record(db, id, 'failed', 'host'); db.exec('COMMIT'); } catch { db.exec('ROLLBACK'); }
  }
}
