import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('Master spec §1/§2/§5: native IPC dispatcher preserves Owner authorization and CSRF', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-native-dispatch-')); const original = process.cwd(); process.chdir(dir);
  process.env.AION_SECURITY_DB_PATH = path.join(dir, 'security.sqlite'); process.env.AION_ASSISTANT_DB_PATH = path.join(dir, 'assistant.sqlite');
  process.env.AION_OPENAI_KEY = 'synthetic-fixture-only'; const originalFetch = globalThis.fetch; let cancelled = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) !== 'https://api.openai.com/v1/chat/completions') return originalFetch(url, options);
    const input = JSON.parse(options.body), shouldCancel = input.messages.at(-1).content === 'cancel stream';
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Streamed"}}]}\n\n'));
      if (shouldCancel) options.signal.addEventListener('abort', () => { cancelled = true; controller.error(new Error('cancelled')); }, { once: true });
      else { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); }
    } }), { status: 200 });
  };
  const { createNativeHttpDispatcher, NATIVE_ORIGIN } = await import('../src/services/native-http-dispatch.js');
  const native = createNativeHttpDispatcher(); t.after(() => { native.close(); globalThis.fetch = originalFetch; process.chdir(original); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  const call = (method, payload) => native.dispatch(method, payload, new AbortController().signal);
  let bufferedResponses = 0;
  const request = async (method, url, { headers = {}, body } = {}) => {
    const raw = body === undefined ? '' : Buffer.from(JSON.stringify(body)).toString('base64');
    const opened = await call('http.open', { method, path: url, headers, body: raw }); let data = '';
    if (opened.done) { bufferedResponses++; data = Buffer.from(opened.data, 'base64').toString('utf8'); return { ...opened, data: data ? JSON.parse(data) : null }; }
    for (let i = 0; i < 100; i++) { const part = await call('http.read', { id: opened.id }); data += Buffer.from(part.data, 'base64').toString('utf8'); if (part.done) return { ...opened, data: data ? JSON.parse(data) : null }; }
    throw new Error('Response did not finish');
  };
  const bootstrap = await call('desktop.bootstrap', null); assert.equal(bootstrap.initialized, false);
  await assert.rejects(call('desktop.bootstrap', null));
  await assert.rejects(call('http.open', { method: 'GET', path: '/api/auth/local-session' }));
  await assert.rejects(call('http.open', { method: 'GET', path: '/api/../index.html' }));
  await assert.rejects(call('http.open', { method: 'GET', path: '/api/devices', headers: { 'x-forwarded-for': '127.0.0.1' } }));
  assert.equal((await request('GET', '/api/assistant/projects')).status, 401);
  const key = crypto.generateKeyPairSync('ed25519'), publicKey = key.publicKey.export({ type: 'spki', format: 'pem' });
  const cookie = `aion_bootstrap=${bootstrap.bootstrap}; aion_csrf=${bootstrap.csrf}`;
  const headers = { cookie, origin: NATIVE_ORIGIN, 'x-aion-csrf': bootstrap.csrf, 'content-type': 'application/json' };
  assert.equal((await request('POST', '/api/auth/enroll-owner', { headers: { ...headers, origin: 'https://untrusted.invalid' }, body: { publicKey } })).status, 403);
  assert.equal((await request('POST', '/api/auth/enroll-owner', { headers: { ...headers, 'x-aion-csrf': 'wrong' }, body: { publicKey } })).status, 403);
  const enrolled = await request('POST', '/api/auth/enroll-owner', { headers, body: { name: 'Isolated Owner', publicKey } }); assert.equal(enrolled.status, 201);
  const challenge = await request('POST', '/api/auth/challenge', { headers: { origin: NATIVE_ORIGIN, 'content-type': 'application/json' }, body: { deviceId: enrolled.data.deviceId } });
  const signature = crypto.sign(null, Buffer.from(challenge.data.signingPayload), key.privateKey).toString('base64url');
  const authenticated = await request('POST', '/api/auth/authenticate', { headers: { origin: NATIVE_ORIGIN, 'content-type': 'application/json' }, body: { challengeId: challenge.data.challengeId, signature } }); assert.equal(authenticated.status, 200);
  const cookies = authenticated.headers['set-cookie'].map(value => value.split(';')[0]).filter(value => !value.startsWith('aion_bootstrap=')).join('; ');
  const csrf = /aion_csrf=([^;]+)/.exec(cookies)[1]; const signed = { cookie: cookies, origin: NATIVE_ORIGIN, 'x-aion-csrf': csrf, 'content-type': 'application/json' };
  assert.equal((await request('POST', '/api/assistant/projects', { headers: { ...signed, 'x-aion-csrf': 'wrong' }, body: { name: 'Denied' } })).status, 403);
  const project = await request('POST', '/api/assistant/projects', { headers: signed, body: { name: 'IPC project' } }); assert.equal(project.status, 201);
  const projects = await request('GET', '/api/assistant/projects', { headers: { cookie: cookies } }); assert.ok(projects.data.projects.some(p => p.name === 'IPC project'));
  const limitedKey = crypto.generateKeyPairSync('ed25519');
  const limited = await request('POST', '/api/auth/enroll-device', { headers: signed, body: { name: 'Limited', role: 'limited', publicKey: limitedKey.publicKey.export({ type: 'spki', format: 'pem' }) } }); assert.equal(limited.status, 201);
  const limitedChallenge = await request('POST', '/api/auth/challenge', { headers: { origin: NATIVE_ORIGIN, 'content-type': 'application/json' }, body: { deviceId: limited.data.id } });
  const limitedSignature = crypto.sign(null, Buffer.from(limitedChallenge.data.signingPayload), limitedKey.privateKey).toString('base64url');
  const limitedAuth = await request('POST', '/api/auth/authenticate', { headers: { origin: NATIVE_ORIGIN, 'content-type': 'application/json' }, body: { challengeId: limitedChallenge.data.challengeId, signature: limitedSignature } });
  const limitedCookie = limitedAuth.headers['set-cookie'].map(value => value.split(';')[0]).filter(value => !value.startsWith('aion_bootstrap=')).join('; ');
  assert.equal((await request('GET', '/api/assistant/projects', { headers: { cookie: limitedCookie } })).status, 401, 'Limited role cannot access conversations');
  assert.equal((await request('DELETE', `/api/auth/devices/${limited.data.id}`, { headers: signed })).status, 200);
  assert.equal((await request('GET', '/api/devices', { headers: { cookie: limitedCookie } })).status, 401, 'revoked session is denied');
  const conversation = await request('POST', '/api/assistant/sessions', { headers: signed, body: { projectId: project.data.project.id } }); assert.equal(conversation.status, 201);
  const streamPayload = prompt => ({ method: 'POST', path: '/api/assistant/chat/stream', headers: signed, body: Buffer.from(JSON.stringify({ projectId: project.data.project.id, sessionId: conversation.data.session.id, prompt, mode: 'ask', runtimeMode: 'api', provider: 'openai', model: 'synthetic-model' })).toString('base64') });
  const stream = await call('http.open', streamPayload('stream reply')); assert.equal(stream.status, 200);
  let streamed = stream.done ? Buffer.from(stream.data, 'base64').toString('utf8') : ''; if (!stream.done) for (let i = 0; i < 100; i++) { const part = await call('http.read', { id: stream.id }); streamed += Buffer.from(part.data, 'base64').toString('utf8'); if (part.done) break; }
  assert.match(streamed, /event: delta/); assert.match(streamed, /Streamed/); assert.match(streamed, /event: done/);
  const interrupted = await call('http.open', streamPayload('cancel stream')); let partial = '';
  for (let i = 0; i < 20 && !partial.includes('event: delta'); i++) { const part = await call('http.read', { id: interrupted.id }); partial += Buffer.from(part.data, 'base64').toString('utf8'); }
  assert.match(partial, /event: delta/); await call('http.cancel', { id: interrupted.id });
  for (let i = 0; i < 100 && !cancelled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(cancelled, true, 'closing the IPC response aborts the provider stream');
  assert.equal((await request('POST', '/api/sync/folder', { headers: signed, body: {} })).status, 503);
  const existing = createNativeHttpDispatcher(); t.after(() => existing.close()); const state = await existing.dispatch('desktop.bootstrap', null, new AbortController().signal);
  assert.deepEqual(state, { initialized: true }, 'existing Owner never receives a new bootstrap session');
  assert.ok(bufferedResponses > 5, 'small completed responses do not keep stream slots open');
});

test('Master spec §1/§2: production native host serves framed pipes without a TCP listener', { timeout: 15000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-native-host-'));
  let connections = 0; const occupied = net.createServer(socket => { connections++; socket.destroy(); });
  occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  const env = { ...process.env, PORT: String(occupied.address().port), AION_SECURITY_DB_PATH: path.join(dir, 'security.sqlite'), AION_ASSISTANT_DB_PATH: path.join(dir, 'assistant.sqlite') }; delete env.AION_LOCAL_AUTH_SECRET;
  const child = spawn(process.execPath, [path.join(root, 'src/native-host.js')], { cwd: dir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) child.kill(); await new Promise(resolve => occupied.close(resolve)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  let buffer = Buffer.alloc(0); const messages = [], waiters = [];
  child.stdout.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) { const length = buffer.readUInt32BE(0); messages.push(JSON.parse(buffer.subarray(4, 4 + length))); buffer = buffer.subarray(4 + length); } while (messages.length && waiters.length) waiters.shift()(messages.shift()); });
  const request = (id, method, payload) => { const data = Buffer.from(JSON.stringify({ type: 'request', id, method, payload })); const header = Buffer.alloc(4); header.writeUInt32BE(data.length); child.stdin.write(Buffer.concat([header, data])); return messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve)); };
  const bootstrap = await request('one', 'desktop.bootstrap', null); assert.equal(bootstrap.ok, true); assert.equal(bootstrap.result.initialized, false);
  const response = await request('two', 'http.open', { method: 'GET', path: '/api/auth/status', headers: {}, body: '' }); assert.equal(response.ok, true); assert.equal(response.result.status, 200);
  const data = response.result.done ? response.result.data : (await request('three', 'http.read', { id: response.result.id })).result.data;
  assert.equal(JSON.parse(Buffer.from(data, 'base64')).initialized, false);
  const exited = once(child, 'exit'); child.stdin.end(); const [code] = await exited; assert.equal(code, 0); assert.equal(connections, 0);
});
