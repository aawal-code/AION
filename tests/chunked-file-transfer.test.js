import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { linkSyncFolder, beginFileTransfer, writeFileChunk, finishFileTransfer, discardFileTransfer, applyFileEvent } from '../src/services/file-sync.js';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('Master spec §7: corrupt chunks and complete hashes leave existing files untouched', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-integrity-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); linkSyncFolder('integrity', root);
  const target = path.join(root, 'file'); fs.writeFileSync(target, 'original'); const data = Buffer.from('replacement');
  let transfer = beginFileTransfer({ projectId: 'integrity', relative: 'file', size: data.length, sha256: sha(data) });
  assert.throws(() => writeFileChunk(transfer, { index: 0, data: data.toString('base64'), sha256: sha(Buffer.from('wrong')) }), /integrity/); discardFileTransfer(transfer);
  transfer = beginFileTransfer({ projectId: 'integrity', relative: 'file', size: data.length, sha256: sha(Buffer.from('wrong')) });
  writeFileChunk(transfer, { index: 0, data: data.toString('base64'), sha256: sha(data) });
  assert.throws(() => finishFileTransfer(transfer), /integrity/); discardFileTransfer(transfer);
  transfer = beginFileTransfer({ projectId: 'integrity', relative: 'file', size: data.length, sha256: sha(data) });
  writeFileChunk(transfer, { index: 0, data: data.toString('base64'), sha256: sha(data) });
  fs.writeFileSync(transfer.temp, Buffer.alloc(data.length));
  assert.throws(() => finishFileTransfer(transfer), /integrity/); discardFileTransfer(transfer);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original'); assert.deepEqual(fs.readdirSync(root), ['file']);
});

test('Master spec §2/§7: project paths reject traversal and symlink escapes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-path-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), outside = path.join(root, 'outside'); fs.mkdirSync(project); fs.mkdirSync(outside); linkSyncFolder('paths', project);
  fs.symlinkSync(outside, path.join(project, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const relative of ['../outside/target', 'escape/target', '.git/config', 'C:\\outside\\target']) assert.throws(() => beginFileTransfer({ projectId: 'paths', relative, size: 0, sha256: sha(Buffer.alloc(0)) }));
  assert.equal(fs.existsSync(path.join(outside, 'target')), false);
});

test('Master spec §7: existing small-file replication events remain readable', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-legacy-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); linkSyncFolder('legacy', root);
  const data = Buffer.from('legacy file content');
  await applyFileEvent({ recordType: 'file-content', payload: { projectId: 'legacy', relative: 'nested/old.txt', bytes: data.toString('base64'), sha256: sha(data) } });
  assert.deepEqual(fs.readFileSync(path.join(root, 'nested', 'old.txt')), data);
});
