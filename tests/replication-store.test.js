import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Master spec §7/§11: replication ledger is durable, idempotent, acknowledged, and detects conflicts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aion-replication-'));
  try {
    process.env.AION_REPLICATION_DB_PATH = path.join(dir, 'replication.sqlite');
    const moduleUrl = new URL('../src/services/replication-store.js', import.meta.url).href;
    const store = await import(`${moduleUrl}?case=${Date.now()}`);
    const host = await store.getHostIdentity(); assert.match(host.hostId, /^[0-9a-f-]{36}$/);
    const event = await store.createReplicationEvent({ recordId: 'project:synthetic', recordType: 'project-metadata', revision: 1, payload: { name: 'Synthetic' } });
    assert.equal((await store.listOutboundEvents()).length, 1); assert.equal(await store.acknowledgeOutboundEvent(event.eventId), true); assert.equal((await store.listOutboundEvents()).length, 0);
    const inbound = { eventId: '11111111-1111-4111-8111-111111111111', originHostId: '22222222-2222-4222-8222-222222222222', recordId: 'project:remote', recordType: 'project-metadata', revision: 2, payload: { name: 'Remote' } };
    assert.deepEqual(await store.applyInboundEvent(inbound), { status: 'applied' }); assert.deepEqual(await store.applyInboundEvent(inbound), { status: 'duplicate' });
    assert.deepEqual(await store.applyInboundEvent({ ...inbound, eventId: '33333333-3333-4333-8333-333333333333', revision: 1 }), { status: 'conflict' });
    await store.resetReplicationStoreForTests(); const restarted = await import(`${moduleUrl}?restart=${Date.now()}`); assert.equal((await restarted.getHostIdentity()).hostId, host.hostId); await restarted.resetReplicationStoreForTests();
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
