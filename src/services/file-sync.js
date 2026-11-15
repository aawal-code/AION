import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReplicationEvent } from './replication-store.js';

export const CHUNK_SIZE = 32 * 1024;
export const MAX_FILE_SIZE = 256 * 1024 * 1024;
const folders = new Map();
const forbidden = new Set(['.git', 'node_modules', '.env', 'security.sqlite', 'replication.sqlite']);
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Path-based filesystem operations cannot safely confine concurrent directory
// replacement. Keep file access disabled until a handle-based backend is available.
export function requireSafeFilesystem() { throw new Error('File synchronization is unavailable: secure filesystem containment is not implemented'); }

export function linkSyncFolder(projectId, folder) {
  const resolved = fs.realpathSync(folder);
  if (typeof projectId !== 'string' || !projectId || projectId.length > 128 || !fs.statSync(resolved).isDirectory()) throw new Error('A readable project folder is required');
  folders.set(projectId, resolved); return { projectId, path: resolved };
}

// Reject links at every existing component, including the final file. Newly
// created parent directories are checked again before a temporary file is installed.
function safe(projectId, relative, createParents = false) {
  if (typeof projectId !== 'string' || typeof relative !== 'string' || !relative || relative.length > 1024 || path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || relative.includes(':') || relative.includes('\0')) throw new Error('Unsafe or excluded sync path');
  const parts = relative.split(/[\\/]/);
  if (parts.some((part) => !part || part === '.' || part === '..' || forbidden.has(part.toLowerCase()) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe or excluded sync path');
  const root = folders.get(projectId); if (!root) throw new Error('No linked folder for project');
  if (fs.realpathSync(root) !== root) throw new Error('Linked folder changed');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()) || (i === parts.length - 1 && !stat.isFile())) throw new Error('Unsafe sync path');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (i < parts.length - 1 && createParents) fs.mkdirSync(current);
      else if (i < parts.length - 1) throw error;
    }
  }
  return current;
}
function inspectSource(projectId, relative) {
  const target = safe(projectId, relative); const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > MAX_FILE_SIZE) throw new Error('File exceeds transfer limit or is not a regular file');
    const digest = crypto.createHash('sha256'); const buffer = Buffer.allocUnsafe(CHUNK_SIZE); let size = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { size += count; if (size > MAX_FILE_SIZE) throw new Error('File exceeds transfer limit'); digest.update(buffer.subarray(0, count)); }
    if (size !== stat.size) throw new Error('File changed during inspection');
    return { size, sha256: digest.digest('hex') };
  } finally { fs.closeSync(fd); }
}
export async function queueFile(projectId, relative) {
  requireSafeFilesystem();
  const metadata = inspectSource(projectId, relative);
  return createReplicationEvent({ recordId: `${projectId}:${relative}`, recordType: 'file-transfer', revision: 1, payload: { projectId, relative, ...metadata } });
}
export function openFileForTransfer(metadata) {
  requireSafeFilesystem();
  const { projectId, relative, size, sha256 } = metadata || {};
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE || !validHash(sha256)) throw new Error('Invalid file metadata');
  const fd = fs.openSync(safe(projectId, relative), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size !== size) throw new Error('Source file changed'); return fd; } catch (error) { fs.closeSync(fd); throw error; }
}
export function beginFileTransfer(metadata) {
  requireSafeFilesystem();
  const { projectId, relative, size, sha256 } = metadata || {};
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_SIZE || !validHash(sha256)) throw new Error('Invalid file metadata or transfer size');
  const target = safe(projectId, relative, true); const temp = path.join(path.dirname(target), `.aion-transfer-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx+', 0o600);
  return { projectId, relative, target, temp, fd, size, sha256, received: 0, index: 0, digest: crypto.createHash('sha256') };
}
export function writeFileChunk(transfer, { index, data, sha256 }) {
  if (!transfer || !Number.isSafeInteger(index) || index !== transfer.index || typeof data !== 'string' || data.length > Math.ceil(CHUNK_SIZE / 3) * 4 || !validHash(sha256)) throw new Error('Invalid file chunk');
  const bytes = Buffer.from(data, 'base64');
  const expected = Math.min(CHUNK_SIZE, transfer.size - transfer.received);
  if (!expected || bytes.length !== expected || bytes.toString('base64') !== data || hash(bytes) !== sha256) throw new Error('File chunk integrity verification failed');
  let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(transfer.fd, bytes, offset, bytes.length - offset); if (!count) throw new Error('Unable to write file chunk'); offset += count; }
  transfer.digest.update(bytes); transfer.received += bytes.length; transfer.index++;
}
export function discardFileTransfer(transfer) {
  if (!transfer) return;
  if (transfer.fd !== null) { try { fs.closeSync(transfer.fd); } catch {} transfer.fd = null; }
  try { fs.unlinkSync(transfer.temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function finishFileTransfer(transfer) {
  if (!transfer || transfer.received !== transfer.size || transfer.digest.digest('hex') !== transfer.sha256) throw new Error('File integrity verification failed');
  const diskHash = crypto.createHash('sha256'); const buffer = Buffer.allocUnsafe(CHUNK_SIZE); let position = 0;
  while (position < transfer.size) { const count = fs.readSync(transfer.fd, buffer, 0, Math.min(buffer.length, transfer.size - position), position); if (!count) throw new Error('Temporary file changed'); diskHash.update(buffer.subarray(0, count)); position += count; }
  if (fs.fstatSync(transfer.fd).size !== transfer.size || diskHash.digest('hex') !== transfer.sha256) throw new Error('Temporary file integrity verification failed');
  const opened = fs.fstatSync(transfer.fd); const current = fs.lstatSync(transfer.temp);
  if (safe(transfer.projectId, transfer.relative) !== transfer.target || !current.isFile() || current.isSymbolicLink() || opened.dev !== current.dev || opened.ino !== current.ino) throw new Error('Sync path changed');
  fs.closeSync(transfer.fd); transfer.fd = null;
  fs.renameSync(transfer.temp, transfer.target);
}
// Accept legacy file-content events produced before chunked transfer.
export async function applyFileEvent(event) {
  if (event.recordType !== 'file-content') return;
  const { projectId, relative, bytes, sha256 } = event.payload || {};
  if (typeof bytes !== 'string' || bytes.length > 32 * 1024 || !validHash(sha256)) throw new Error('Invalid legacy file content');
  const data = Buffer.from(bytes, 'base64'); if (data.toString('base64') !== bytes || hash(data) !== sha256) throw new Error('File content integrity verification failed');
  const transfer = beginFileTransfer({ projectId, relative, size: data.length, sha256 });
  try { if (data.length) writeFileChunk(transfer, { index: 0, data: bytes, sha256 }); finishFileTransfer(transfer); } finally { discardFileTransfer(transfer); }
}
