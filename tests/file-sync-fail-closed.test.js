import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { linkSyncFolder, queueFile, openFileForTransfer, beginFileTransfer, applyFileEvent } from '../src/services/file-sync.js';

test('Master spec §2/§7: file operations fail closed without handle-based containment', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-containment-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  linkSyncFolder('closed', root); fs.writeFileSync(path.join(root, 'source'), 'untouched');
  const metadata = { projectId: 'closed', relative: 'source', size: 9, sha256: '0'.repeat(64) };
  await assert.rejects(queueFile('closed', 'source'), /secure filesystem containment/);
  assert.throws(() => openFileForTransfer(metadata), /secure filesystem containment/);
  assert.throws(() => beginFileTransfer(metadata), /secure filesystem containment/);
  await assert.rejects(applyFileEvent({ recordType: 'file-content', payload: { ...metadata, bytes: '', sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' } }), /secure filesystem containment/);
  assert.equal(fs.readFileSync(path.join(root, 'source'), 'utf8'), 'untouched');
  assert.deepEqual(fs.readdirSync(root), ['source']);
});
