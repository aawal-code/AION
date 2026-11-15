import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test'; import { DatabaseSync } from 'node:sqlite';
import { getDb, closeDb, getProject, getMessages, updateProject } from '../src/services/assistant-db.js';
test('Master spec §5/§11: existing project and conversation data survive the archive and folder migration', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-project-migration-')); const file = path.join(root, 'assistant.sqlite');
  t.after(() => { closeDb(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const old = new DatabaseSync(file); old.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT,pinned_context TEXT); CREATE TABLE sessions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL,title TEXT); CREATE TABLE messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,timestamp TEXT NOT NULL,metadata TEXT); INSERT INTO projects VALUES('legacy','Old name','','context'); INSERT INTO sessions VALUES('conversation','legacy','ask','2026-01-01','title'); INSERT INTO messages VALUES('message','conversation','user','preserved','2026-01-01',NULL);`); old.close();
  await getDb(file); assert.equal((await getProject('legacy')).name, 'Old name'); assert.equal((await getMessages('conversation'))[0].content, 'preserved');
  await updateProject('legacy', { archived: true }); closeDb(); await getDb(file); assert.ok((await getProject('legacy')).archived_at); assert.equal((await getMessages('conversation'))[0].content, 'preserved');
});
