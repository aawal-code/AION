import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReplicationEvent } from './replication-store.js';

const folders = new Map();
const forbidden = new Set(['.git', 'node_modules', '.env', 'security.sqlite', 'replication.sqlite']);
export function linkSyncFolder(projectId, folder) {
  const resolved = path.resolve(folder); if (!projectId || !fs.statSync(resolved).isDirectory()) throw new Error('A readable project folder is required');
  folders.set(String(projectId), resolved); return { projectId: String(projectId), path: resolved };
}
function safe(projectId, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part === '..' || forbidden.has(part))) throw new Error('Unsafe or excluded sync path');
  const root = folders.get(String(projectId)); if (!root) throw new Error('No linked folder for project'); const target = path.resolve(root, relative); if (!target.startsWith(root + path.sep)) throw new Error('Sync path escapes linked folder'); return target;
}
export async function queueFile(projectId, relative) {
  const target = safe(projectId, relative), bytes = fs.readFileSync(target); if (bytes.length > 24 * 1024) throw new Error('Large-file chunk transfer is not implemented');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  return createReplicationEvent({ recordId: `${projectId}:${relative}`, recordType: 'file-content', revision: 1, payload: { projectId, relative, bytes: bytes.toString('base64'), sha256: hash } });
}
export async function applyFileEvent(event) {
  if (event.recordType !== 'file-content') return; const { projectId, relative, bytes, sha256 } = event.payload || {}; const target = safe(projectId, relative); const data = Buffer.from(String(bytes || ''), 'base64');
  if (crypto.createHash('sha256').update(data).digest('hex') !== sha256) throw new Error('File content integrity verification failed');
  fs.mkdirSync(path.dirname(target), { recursive: true }); const temp = `${target}.aion-${process.pid}.tmp`; fs.writeFileSync(temp, data, { flag: 'wx' }); fs.renameSync(temp, target);
}
