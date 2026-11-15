import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const fixture = new URL('./fixtures/transport-host-child.mjs', import.meta.url);
function host(name, root) {
  const child = fork(fixture, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, AION_SECURITY_DB_PATH: path.join(root, `${name}-security.sqlite`), AION_REPLICATION_DB_PATH: path.join(root, `${name}-replication.sqlite`), AION_TRANSPORT_IDENTITY_PATH: path.join(root, `${name}-transport.dpapi`) } }); let sequence = 0;
  return { child, call(type, body = {}) { return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => reject(new Error(`${name} command timed out`)), 15_000); const listener = (reply) => { if (reply.id !== id) return; child.off('message', listener); clearTimeout(timer); reply.error ? reject(new Error(reply.error)) : resolve(reply.result); }; child.on('message', listener); child.send({ id, type, ...body }); }); }, async close() { try { await this.call('stop'); } catch {} await new Promise((resolve) => { child.once('exit', resolve); child.kill(); }); } };
}

test('two independent hosts authenticate over TLS and durably replicate over TCP', { timeout: 60_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-two-host-')); const a = host('a', root), b = host('b', root); t.after(async () => { await a.close(); await b.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  const ai = await a.call('init'), bi = await b.call('init');
  const bInA = await a.call('pair', { peerName: 'B', publicKey: bi.publicKey, certificate: bi.certificate, binding: bi.binding });
  const aInB = await b.call('pair', { peerName: 'A', publicKey: ai.publicKey, certificate: ai.certificate, binding: ai.binding });
  const listening = await b.call('start', { localDeviceId: bInA.deviceId, name: 'B' });
  await a.call('event', { event: { recordId: 'project-1', recordType: 'project-metadata', revision: 1, payload: { title: 'Synthetic project' } } });
  await assert.rejects(() => a.call('deliver', { port: listening.port, localDeviceId: aInB.deviceId, certificate: ai.certificate, name: 'A' }), /certificate|TLS|closed|authorization/i, 'a substituted server certificate cannot establish the pinned TLS channel');
  assert.equal((await a.call('pending')).count, 1, 'failed TLS authentication does not acknowledge or lose queued work');
  assert.equal((await a.call('deliver', { port: listening.port, localDeviceId: aInB.deviceId, certificate: bi.certificate, name: 'A' })).delivered, 1);
  assert.equal((await a.call('pending')).count, 0, 'acknowledgement is durably recorded by sender');
  assert.deepEqual((await b.call('heads'))[0].payload, { title: 'Synthetic project' }, 'B transactionally applies project metadata received over TLS');
  // The reverse path is the same real socket protocol, with B updating its
  // project metadata and A accepting the newer revision.
  const aListening = await a.call('start', { localDeviceId: aInB.deviceId, name: 'A' });
  await b.call('event', { event: { recordId: 'project-1', recordType: 'project-metadata', revision: 2, payload: { title: 'Project changed on B' } } });
  assert.equal((await b.call('deliver', { port: aListening.port, localDeviceId: bInA.deviceId, certificate: ai.certificate, name: 'B' })).delivered, 1);
  assert.deepEqual((await a.call('heads'))[0].payload, { title: 'Project changed on B' }, 'A receives the reverse metadata change');
  // Concurrent revision 3 edits retain both event versions rather than using
  // timestamps to discard the losing edit silently.
  await a.call('event', { event: { recordId: 'project-1', recordType: 'project-metadata', revision: 3, payload: { title: 'Offline A version' } } });
  await b.call('event', { event: { recordId: 'project-1', recordType: 'project-metadata', revision: 3, payload: { title: 'Offline B version' } } });
  await a.call('deliver', { port: listening.port, localDeviceId: aInB.deviceId, certificate: bi.certificate, name: 'A' });
  assert.equal((await b.call('history', { recordId: 'project-1' })).filter((event) => event.revision === 3).length, 2, 'conflicting offline versions are retained for explicit resolution');
  // Revocation is checked after the TLS handshake before each protected event.
  await b.call('revoke', { deviceId: aInB.deviceId });
  await a.call('event', { event: { recordId: 'project-2', recordType: 'project-metadata', revision: 1, payload: { title: 'Denied project' } } });
  await assert.rejects(() => a.call('deliver', { port: listening.port, localDeviceId: aInB.deviceId, certificate: bi.certificate, name: 'A' }), /authorization|closed|failed/i);
  assert.equal((await a.call('pending')).count, 1, 'revoked peer cannot receive pending protected events');
});

test('outstanding replication work survives a sending-host process restart', { timeout: 60_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-restart-host-')); let a = host('a', root); const b = host('b', root); t.after(async () => { await a.close(); await b.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  const ai = await a.call('init'), bi = await b.call('init');
  const bInA = await a.call('pair', { peerName: 'B', publicKey: bi.publicKey, certificate: bi.certificate, binding: bi.binding });
  const aInB = await b.call('pair', { peerName: 'A', publicKey: ai.publicKey, certificate: ai.certificate, binding: ai.binding });
  const listening = await b.call('start', { localDeviceId: bInA.deviceId, name: 'B' });
  await a.call('event', { event: { recordId: 'restart-project', recordType: 'project-metadata', revision: 1, payload: { title: 'Queued before restart' } } });
  await a.close(); a = host('a', root); await a.call('resume', { name: 'A' });
  assert.equal((await a.call('deliver', { port: listening.port, localDeviceId: aInB.deviceId, certificate: bi.certificate, name: 'A' })).delivered, 1);
  assert.deepEqual((await b.call('heads')).find((head) => head.recordId === 'restart-project').payload, { title: 'Queued before restart' });
});
