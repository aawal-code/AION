import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const root = path.resolve('.');
const port = () => new Promise((resolve, reject) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); server.on('error', reject); });
const waitFor = async (url) => { for (let i = 0; i < 50; i += 1) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 50)); } throw new Error('server did not start'); };
const cookies = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
const header = (jar, csrf, origin) => ({ cookie: jar, origin, 'x-aion-csrf': csrf, 'content-type': 'application/json' });

test('security contract rejects local impostors and enforces signed cookie sessions with CSRF', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'aion-auth-contract-'));
  const listenPort = await port(); const secret = crypto.randomBytes(32).toString('base64url');
  process.env.AION_TRANSPORT_IDENTITY_PATH = path.join(sandbox, 'joining-transport.dpapi');
  const transport = await import(`../src/services/transport-identity.js?joining=${Date.now()}`); const joiningTransport = await transport.getTransportIdentity('joining');
  const child = spawn(process.execPath, ['src/server.js'], { cwd: root, env: { ...process.env, PORT: String(listenPort), AION_SECURITY_DB_PATH: path.join(sandbox, 'security.sqlite'), AION_LOCAL_AUTH_SECRET: secret, AION_TEST_VAULT_KEY: 'fixture-only' }, stdio: 'ignore', windowsHide: true });
  const origin = `http://127.0.0.1:${listenPort}`;
  try {
    await waitFor(`${origin}/`);
    assert.equal((await fetch(`${origin}/api/devices`)).status, 401, 'anonymous loopback is not trusted');
    assert.equal((await fetch(`${origin}/api/network/mesh`)).status, 401, 'anonymous clients cannot inspect Tailscale status');
    assert.equal((await fetch(`${origin}/api/auth/status`, { headers: { origin: 'http://evil.invalid' } })).status, 403, 'foreign origins are denied');
    assert.equal((await fetch(`${origin}/api/auth/local-session`)).status, 401, 'local address alone cannot mint bootstrap');
    assert.equal((await fetch(`${origin}/api/auth/local-session`, { headers: { 'x-aion-local-secret': secret, 'x-forwarded-proto': 'https' } })).status, 401, 'a proxy cannot redeem the local bootstrap');
    const proxiedHostStatus = await new Promise((resolve, reject) => { const req = http.get({ host: '127.0.0.1', port: listenPort, path: '/api/auth/local-session', headers: { 'x-aion-local-secret': secret, host: 'example.ts.net' } }, (res) => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); }); assert.equal(proxiedHostStatus, 401, 'bootstrap requires a loopback Host header');
    assert.equal((await fetch(`${origin}/api/ios/profile.mobileconfig`)).status, 503, 'unverified remote profiles are not issued');
    assert.equal((await fetch(`${origin}/setup`)).status, 503, 'unverified remote setup is unavailable');
    const bootstrap = await fetch(`${origin}/api/auth/local-session`, { headers: { 'x-aion-local-secret': secret } });
    assert.equal(bootstrap.status, 200);
    const bootstrapJar = cookies(bootstrap); const csrf = /aion_csrf=([^;]+)/.exec(bootstrapJar)?.[1]; assert.ok(csrf);
    const owner = crypto.generateKeyPairSync('ed25519'); const publicKey = owner.publicKey.export({ type: 'spki', format: 'pem' });
    assert.equal((await fetch(`${origin}/api/auth/enroll-owner`, { method: 'POST', headers: { cookie: bootstrapJar, origin, 'content-type': 'application/json' }, body: JSON.stringify({ publicKey }) })).status, 403, 'bootstrap state change requires CSRF');
    const enrolled = await fetch(`${origin}/api/auth/enroll-owner`, { method: 'POST', headers: header(bootstrapJar, csrf, origin), body: JSON.stringify({ name: 'Synthetic Owner', publicKey }) });
    assert.equal(enrolled.status, 201); const ownerData = await enrolled.json(); assert.match(ownerData.recoveryKey, /^[A-Za-z0-9_-]{40,}$/);
    const challenge = await (await fetch(`${origin}/api/auth/challenge`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: ownerData.deviceId }) })).json();
    const signature = crypto.sign(null, Buffer.from(challenge.signingPayload), owner.privateKey).toString('base64url');
    const authenticated = await fetch(`${origin}/api/auth/authenticate`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.challengeId, signature }) });
    assert.equal(authenticated.status, 200); const sessionJar = cookies(authenticated); const sessionCsrf = /aion_csrf=([^;]+)/.exec(sessionJar)?.[1]; assert.ok(sessionCsrf);
    assert.equal((await fetch(`${origin}/api/auth/devices`, { headers: { cookie: sessionJar } })).status, 200);
    assert.equal((await fetch(`${origin}/api/auth/recovery/rotate`, { method: 'POST', headers: { cookie: sessionJar, origin, 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${origin}/api/auth/recovery/rotate`, { method: 'POST', headers: header(sessionJar, sessionCsrf, origin), body: '{}' })).status, 200);
    const invitationResponse = await fetch(`${origin}/api/auth/pairing/invitations`, { method: 'POST', headers: header(sessionJar, sessionCsrf, origin), body: '{}' });
    assert.equal(invitationResponse.status, 201, 'only an Owner session creates a pairing invitation'); const invitation = await invitationResponse.json();
    assert.match(invitation.qrPayload, /^AION-PAIR:/, 'the QR payload contains an invitation identifier, not a session token');
    assert.equal((await fetch(`${origin}/api/auth/pairing/claim`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ invitationId: invitation.invitationId, name: 'Synthetic joiner', publicKey: joiningTransport.devicePublicKey, transportCertificate: joiningTransport.certificate, transportBindingSignature: joiningTransport.signCertificateBinding() }) })).status, 202);
    assert.equal((await fetch(`${origin}/api/auth/pairing/${invitation.invitationId}/approve`, { method: 'POST', headers: header(sessionJar, sessionCsrf, origin), body: JSON.stringify({ verificationCode: invitation.verificationCode, role: 'limited' }) })).status, 201);
    assert.equal((await fetch(`${origin}/api/auth/pairing/${invitation.invitationId}/approve`, { method: 'POST', headers: header(sessionJar, sessionCsrf, origin), body: JSON.stringify({ verificationCode: invitation.verificationCode }) })).status, 400, 'approval replay is rejected');
    assert.equal((await fetch(`${origin}/api/auth/authenticate`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.challengeId, signature }) })).status, 400, 'challenge replay is rejected');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
