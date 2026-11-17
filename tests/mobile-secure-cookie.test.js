import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

test('Master spec §1/§2: TLS sessions use secure cookies and ignore spoofed proxy headers', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-cookie-test-'));
  process.env.AION_SECURITY_DB_PATH = path.join(dir, 'security.sqlite');
  const identity = await import('../src/services/identity-store.js');
  const { handleAuthRoutes } = await import('../src/routes/auth.js');
  t.after(async () => { await identity.resetIdentityStoreForTests(); fs.rmSync(dir, { recursive: true, force: true }); });
  const device = crypto.generateKeyPairSync('ed25519');
  const owner = await identity.enrollInitialOwner({ publicKey: device.publicKey.export({ type: 'spki', format: 'pem' }) });
  async function authenticate(encrypted) {
    const challenge = await identity.createChallenge(owner.deviceId);
    const body = JSON.stringify({ challengeId: challenge.challengeId, signature: crypto.sign(null, Buffer.from(challenge.signingPayload), device.privateKey).toString('base64url') });
    const req = Readable.from([body]); req.method = 'POST'; req.socket = { encrypted }; req.headers = { 'x-forwarded-proto': 'https' };
    const headers = {}; const res = { writableEnded: false, setHeader(name, value) { headers[name] = value; }, writeHead(status) { this.statusCode = status; }, end() { this.writableEnded = true; } };
    await handleAuthRoutes(req, res, '/api/auth/authenticate');
    assert.equal(res.statusCode, 200);
    return headers['Set-Cookie'];
  }
  const tlsCookies = await authenticate(true);
  assert.ok(tlsCookies.every(value => /; Secure(?:;|$)/.test(value)));
  assert.match(tlsCookies[0], /HttpOnly/);
  assert.match(tlsCookies[0], /SameSite=Strict/);
  assert.doesNotMatch(tlsCookies[1], /HttpOnly/);
  assert.ok((await authenticate(false)).every(value => !/; Secure(?:;|$)/.test(value)));
});
