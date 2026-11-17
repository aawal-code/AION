import 'reflect-metadata';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import * as x509 from '@peculiar/x509';

test('Master spec §1/§2/§5: gateway devices share host projects and revocation is immediate', { timeout: 90000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-mobile-gateway-'));
  process.env.AION_SECURITY_DB_PATH = path.join(dir, 'security.sqlite'); process.env.AION_ASSISTANT_DB_PATH = path.join(dir, 'assistant.sqlite');
  const identity = await import('../src/services/identity-store.js');
  const assistant = await import('../src/services/assistant-db.js');
  const { handleRequest } = await import('../src/routes/router.js');
  const { startMobileGateway } = await import('../src/services/mobile-gateway.js');
  const real = process.env.AION_TEST_GATEWAY_TAILSCALE === '1';
  const cli = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  const cliStatus = args => JSON.parse(execFileSync(cli, args, { encoding: 'utf8', windowsHide: true, timeout: 3000 }));
  if (real) assert.deepEqual(cliStatus(['serve', 'status', '--json']), {}, 'refuse to change existing Serve configuration');
  const keys = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({ name: 'CN=test.example.ts.net', keys, signingAlgorithm: { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }, notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 86400000), extensions: [new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: 'test.example.ts.net' }])] });
  const key = crypto.createPrivateKey({ key: Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' });
  const pair = real ? await (await import('../src/services/mobile-tailscale-certificate.js')).getMobileTailscaleCertificate() : { hostname: 'test.example.ts.net', cert: cert.toString('pem'), key, expiresAt: new Date(Date.now() + 86400000).toISOString() };
  const externalPort = real ? 32443 : 443, authority = externalPort === 443 ? pair.hostname : `${pair.hostname}:${externalPort}`;
  let gateway = await startMobileGateway({ certificateProvider: async () => pair, externalPort });
  let serve;
  const ip = real ? cliStatus(['status', '--json']).Self.TailscaleIPs.find(value => value.includes('.')) : '127.0.0.1';
  async function startServe() {
    serve = spawn(cli, ['serve', '--tcp=' + externalPort, 'tcp://127.0.0.1:' + gateway.port], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); serve.stderr.resume();
    for (let i = 0; i < 30; i++) { const config = cliStatus(['serve', 'status', '--json']); if ((config.TCP?.[externalPort] || Object.values(config.Foreground || {}).some(entry => entry.TCP?.[externalPort])) && JSON.stringify(config).includes(`127.0.0.1:${gateway.port}`)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Tailscale Serve mapping did not become active');
  }
  async function stopServe() { if (serve && serve.exitCode === null) { const done = once(serve, 'exit'); serve.kill(); await done; } serve = null; if (real) { for (let i = 0; i < 30; i++) { if (!Object.keys(cliStatus(['serve', 'status', '--json'])).length) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Tailscale Serve mapping did not shut down'); } }
  const desktop = http.createServer(handleRequest); desktop.listen(0, '127.0.0.1'); await once(desktop, 'listening');
  t.after(async () => { await stopServe(); await gateway.close(); await new Promise(resolve => desktop.close(resolve)); await identity.resetIdentityStoreForTests(); assistant.closeDb(); fs.rmSync(dir, { recursive: true, force: true }); if (real) assert.deepEqual(cliStatus(['serve', 'status', '--json']), {}); });
  if (real) await startServe();
  const ownerKey = crypto.generateKeyPairSync('ed25519'), owner = await identity.enrollInitialOwner({ publicKey: ownerKey.publicKey.export({ type: 'spki', format: 'pem' }) });
  const ownerChallenge = await identity.createChallenge(owner.deviceId), ownerSession = await identity.authenticateChallenge({ challengeId: ownerChallenge.challengeId, signature: crypto.sign(null, Buffer.from(ownerChallenge.signingPayload), ownerKey.privateKey).toString('base64url') });
  const desktopOrigin = `http://127.0.0.1:${desktop.address().port}`;
  const desktopRequest = async (url, method = 'GET', body) => { const response = await fetch(desktopOrigin + url, { method, headers: { origin: desktopOrigin, cookie: `aion_session=${ownerSession.token}; aion_csrf=synthetic`, 'x-aion-csrf': 'synthetic', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
  const mobileRequest = (url, body, cookies = '', overrides = {}) => new Promise((resolve, reject) => {
    const request = https.request({ host: ip, port: real ? externalPort : gateway.port, servername: pair.hostname, agent: false, ...(real ? {} : { ca: pair.cert }), path: url, method: body ? 'POST' : 'GET', headers: { host: authority, origin: 'https://' + authority, cookie: cookies, 'content-type': 'application/json', ...(cookies ? { 'x-aion-csrf': /aion_csrf=([^;]+)/.exec(cookies)?.[1] || '' } : {}), ...overrides } }, response => { let data = ''; response.on('data', chunk => { data += chunk; }); response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(data), cookies: response.headers['set-cookie']?.map(v => v.split(';')[0]).filter(v => !v.startsWith('aion_bootstrap=')).join('; ') })); }); request.on('error', error => reject(new Error(`${url}: ${error.message}`))); request.end(body ? JSON.stringify(body) : undefined);
  });
  const project = await desktopRequest('/api/assistant/projects', 'POST', { name: 'Shared workspace' }); assert.equal(project.status, 201);
  assert.equal((await mobileRequest('/api/assistant/projects')).status, 401);
  async function pairBrowser() {
    const invite = await desktopRequest('/api/auth/browser-pairing/invitations', 'POST', { hostname: pair.hostname, role: 'trusted' }); assert.equal(invite.status, 201);
    const browserKey = crypto.generateKeyPairSync('ed25519'), publicKey = browserKey.publicKey.export({ format: 'pem', type: 'spki' });
    const c = await mobileRequest('/api/mobile/pairing/challenge', { invitationId: invite.data.invitationId }); assert.equal(c.status, 200);
    const digest = crypto.createHash('sha256').update(publicKey).digest('hex');
    const payload = `aion-browser-pairing-v1:${invite.data.invitationId}:${pair.hostname}:trusted:${c.data.challenge}:${digest}`;
    const claim = await mobileRequest('/api/mobile/pairing/claim', { invitationId: invite.data.invitationId, publicKey, signature: crypto.sign(null, Buffer.from(payload), browserKey.privateKey).toString('base64url') }); assert.equal(claim.status, 202);
    assert.equal((await mobileRequest('/api/mobile/pairing/claim', { invitationId: invite.data.invitationId, publicKey, signature: crypto.sign(null, Buffer.from(payload), browserKey.privateKey).toString('base64url') })).status, 400);
    const statusProof = crypto.sign(null, Buffer.from(`aion-browser-status-v1:${invite.data.invitationId}:${pair.hostname}:${c.data.challenge}`), browserKey.privateKey).toString('base64url');
    const statusBody = { invitationId: invite.data.invitationId, signature: statusProof };
    assert.equal((await mobileRequest('/api/mobile/pairing/status', statusBody)).data.status, 'pending-owner-approval');
    const approved = await desktopRequest(`/api/auth/browser-pairing/${invite.data.invitationId}/approve`, 'POST', { verificationCode: claim.data.verificationCode }); assert.equal(approved.status, 201);
    assert.equal((await mobileRequest('/api/mobile/pairing/status', statusBody)).data.deviceId, approved.data.deviceId);
    const login = await mobileRequest('/api/auth/challenge', { deviceId: approved.data.deviceId });
    const session = await mobileRequest('/api/auth/authenticate', { challengeId: login.data.challengeId, signature: crypto.sign(null, Buffer.from(login.data.signingPayload), browserKey.privateKey).toString('base64url') }); assert.equal(session.status, 200);
    return { id: approved.data.deviceId, cookies: session.cookies };
  }
  const a = await pairBrowser();
  assert.equal((await mobileRequest('/api/assistant/sessions', { projectId: project.data.project.id }, a.cookies, { 'x-aion-csrf': 'incorrect' })).status, 403);
  assert.equal((await mobileRequest('/api/assistant/projects', null, a.cookies, { origin: 'https://attacker.invalid' })).status, 400);
  assert.equal((await mobileRequest('/api/auth/challenge', { deviceId: owner.deviceId })).status, 400, 'Owner identities cannot authenticate through the browser gateway');
  assert.ok((await mobileRequest('/api/assistant/projects', null, a.cookies)).data.projects.some(item => item.id === project.data.project.id));
  const created = await mobileRequest('/api/assistant/sessions', { projectId: project.data.project.id }, a.cookies); assert.equal(created.status, 201);
  assert.ok((await desktopRequest(`/api/assistant/projects/${project.data.project.id}/sessions`)).data.sessions.some(item => item.id === created.data.session.id));
  const b = await pairBrowser();
  assert.ok((await mobileRequest(`/api/assistant/projects/${project.data.project.id}/sessions`, null, b.cookies)).data.sessions.some(item => item.id === created.data.session.id));
  assert.equal((await desktopRequest(`/api/auth/devices/${a.id}`, 'DELETE')).status, 200);
  assert.equal((await mobileRequest('/api/assistant/projects', null, a.cookies)).status, 401);
  assert.equal((await mobileRequest('/api/assistant/projects', null, b.cookies)).status, 200);
  if (real) await stopServe(); await gateway.close(); gateway = await startMobileGateway({ certificateProvider: async () => pair, externalPort }); if (real) await startServe();
  assert.ok((await mobileRequest(`/api/assistant/projects/${project.data.project.id}/sessions`, null, b.cookies)).data.sessions.some(item => item.id === created.data.session.id));
});

