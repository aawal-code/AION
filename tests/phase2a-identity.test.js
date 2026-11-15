import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Phase 2A identity store enforces signed role sessions, expiry/revocation, replay and recovery', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'aion-phase2a-'));
  const moduleUrl = new URL('../src/services/identity-store.js', import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict'; import crypto from 'node:crypto';
    process.env.AION_SECURITY_DB_PATH = ${JSON.stringify(path.join(sandbox, 'security.sqlite'))};
    const s = await import(${JSON.stringify(moduleUrl)});
    const owner = crypto.generateKeyPairSync('ed25519');
    const pem = owner.publicKey.export({type:'spki',format:'pem'});
    const enrolled = await s.enrollInitialOwner({name:'owner', publicKey:pem});
    assert.equal((await s.authorize('missing', 'devices:read')), null);
    const trusted = crypto.generateKeyPairSync('ed25519');
    const device = await s.createDevice({name:'trusted', role:'trusted', publicKey:trusted.publicKey.export({type:'spki',format:'pem'})}, {role:'owner',deviceId:enrolled.deviceId});
    const challenge = await s.createChallenge(device.id);
    const signature = crypto.sign(null, Buffer.from(challenge.signingPayload), trusted.privateKey).toString('base64url');
    const session = await s.authenticateChallenge({challengeId:challenge.challengeId, signature});
    assert.ok(await s.authorize(session.token, 'devices:read'));
    assert.equal(await s.authorize(session.token, 'workstation:control'), null);
    await assert.rejects(() => s.authenticateChallenge({challengeId:challenge.challengeId, signature}), /replay|invalid|expired/i);
    await s.revokeDevice(device.id, {role:'owner',deviceId:enrolled.deviceId});
    assert.equal(await s.getSessionContext(session.token), null);
    await assert.rejects(() => s.recoverOwner({recoveryKey:'wrong', name:'x', publicKey:pem}), /invalid/i);
    const recoveryDevice = crypto.generateKeyPairSync('ed25519');
    const restored = await s.recoverOwner({recoveryKey:enrolled.recoveryKey, name:'restored', publicKey:recoveryDevice.publicKey.export({type:'spki',format:'pem'})});
    assert.ok(restored.recoveryKey);
    await assert.rejects(() => s.recoverOwner({recoveryKey:enrolled.recoveryKey, name:'again', publicKey:recoveryDevice.publicKey.export({type:'spki',format:'pem'})}), /invalid/i);
    console.log('phase2a identity checks passed');
  `;
  try {
    await new Promise((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', code], { cwd: sandbox, timeout: 15_000 }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stdout}\n${stderr}`)) : resolve()));
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});
