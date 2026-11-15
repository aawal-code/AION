import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const fixture = new URL('./fixtures/transport-host-child.mjs', import.meta.url);
function host(name, root) {
  const child = fork(fixture, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, AION_SECURITY_DB_PATH: path.join(root, `${name}.security`), AION_REPLICATION_DB_PATH: path.join(root, `${name}.replication`), AION_TRANSPORT_IDENTITY_PATH: path.join(root, `${name}.identity`) } }); let n = 0;
  return { call(type, body = {}) { return new Promise((resolve, reject) => { const id = ++n; const timer = setTimeout(() => reject(new Error('Fixture timeout')), 15000); const on = (m) => { if (m.id !== id) return; clearTimeout(timer); child.off('message', on); m.error ? reject(Error(m.error)) : resolve(m.result); }; child.on('message', on); child.send({ id, type, ...body }); }); }, async close() { try { await this.call('stop'); } catch {} await new Promise((resolve) => { child.once('exit', resolve); child.kill(); }); } };
}
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error('Timed out waiting for cleanup'); };

test('Master spec §2/§7: authenticated chunked transfer is bounded, authorized, verified, and absent from the ledger', { timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-chunk-')); const a = host('a', root), b = host('b', root), c = host('c', root);
  t.after(async () => { await a.close(); await b.close(); await c.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const ad = path.join(root, 'a-files'), bd = path.join(root, 'b-files'); fs.mkdirSync(ad); fs.mkdirSync(bd);
  const ai = await a.call('init', { name: 'A' }), bi = await b.call('init', { name: 'B' }), ci = await c.call('init', { name: 'C' });
  const bInA = await a.call('pair', { peerName: 'B', publicKey: bi.publicKey, certificate: bi.certificate, binding: bi.binding });
  const aInB = await b.call('pair', { peerName: 'A', publicKey: ai.publicKey, certificate: ai.certificate, binding: ai.binding });
  const cInB = await b.call('pair', { peerName: 'C', publicKey: ci.publicKey, certificate: ci.certificate, binding: ci.binding, capabilities: [] });
  await c.call('pair', { peerName: 'B', publicKey: bi.publicKey, certificate: bi.certificate, binding: bi.binding });
  await a.call('link', { projectId: 'p', folder: ad }); await b.call('link', { projectId: 'p', folder: bd });
  const listener = await b.call('start', { localDeviceId: bInA.deviceId, name: 'B' });
  const params = { port: listener.port, localDeviceId: aInB.deviceId, certificate: bi.certificate, name: 'A' };
  await assert.rejects(c.call('connect', { port: listener.port, localDeviceId: cInB.deviceId, certificate: bi.certificate, name: 'C' }), /closed|authorization|failed/i);
  const bytes = crypto.randomBytes(1024 * 1024); fs.writeFileSync(path.join(ad, 'large.bin'), bytes);
  const queued = await a.call('queueFile', { projectId: 'p', relative: 'large.bin' });
  assert.equal(queued.payload.sha256, sha(bytes)); assert.equal(queued.payload.bytes, undefined);
  assert.equal((await a.call('deliver', params)).delivered, 1);
  const result = fs.readFileSync(path.join(bd, 'large.bin')); assert.deepEqual(result, bytes); assert.equal(sha(result), sha(bytes));
  for (const dbPath of [path.join(root, 'a.replication'), path.join(root, 'b.replication')]) {
    const db = new DatabaseSync(dbPath, { readOnly: true }); const rows = db.prepare('SELECT payload FROM replication_events').all(); db.close();
    assert.ok(rows.length); for (const row of rows) { assert.equal(JSON.parse(row.payload).bytes, undefined); assert.equal(row.payload.includes(bytes.subarray(0, 128).toString('base64')), false); }
  }
  const id = crypto.randomUUID();
  await a.call('connect', params);
  await assert.rejects(a.call('fileRequest', { phase: 'begin', frame: { type: 'file-begin', id, metadata: { projectId: 'unlinked', relative: 'denied', size: 0, sha256: sha(Buffer.alloc(0)) } } }), /closed|authorization/i);
  assert.equal(fs.existsSync(path.join(bd, 'denied')), false);
  await a.call('connect', params);
  await assert.rejects(a.call('fileRequest', { phase: 'begin', frame: { type: 'file-begin', id: crypto.randomUUID(), metadata: { projectId: 'p', relative: '../escape', size: 0, sha256: sha(Buffer.alloc(0)) } } }), /closed/i);
  assert.equal(fs.existsSync(path.join(root, 'escape')), false);
  await a.call('connect', params);
  await assert.rejects(a.call('fileRequest', { phase: 'begin', frame: { type: 'file-begin', id: crypto.randomUUID(), metadata: { projectId: 'p', relative: 'huge', size: 256 * 1024 * 1024 + 1, sha256: sha(Buffer.alloc(0)) } } }), /closed/i);
  assert.equal(fs.existsSync(path.join(bd, 'huge')), false);
  const previous = Buffer.from('existing destination'); fs.writeFileSync(path.join(bd, 'partial'), previous);
  await a.call('connect', params); const partialId = crypto.randomUUID();
  await a.call('fileRequest', { phase: 'begin', frame: { type: 'file-begin', id: partialId, metadata: { projectId: 'p', relative: 'partial', size: bytes.length, sha256: sha(bytes) } } });
  await a.call('fileRequest', { phase: 'chunk', frame: { type: 'file-chunk', id: partialId, index: 0, data: bytes.subarray(0, 32768).toString('base64'), sha256: sha(bytes.subarray(0, 32768)) } });
  await a.call('disconnect'); await waitFor(() => !fs.readdirSync(bd).some((name) => name.startsWith('.aion-transfer-')));
  assert.deepEqual(fs.readFileSync(path.join(bd, 'partial')), previous);
  await b.call('revoke', { deviceId: aInB.deviceId }); await assert.rejects(a.call('connect', params), /closed|authorization|failed/i);
});
