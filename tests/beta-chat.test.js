import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-chat-'));
process.env.AION_SECURITY_DB_PATH = path.join(root, 'security.sqlite');
process.env.AION_ASSISTANT_DB_PATH = path.join(root, 'assistant.sqlite');
process.env.AION_VAULT_DIR = path.join(root, 'vault');
process.env.AION_LOCAL_AUTH_SECRET = crypto.randomBytes(32).toString('base64url');
process.env.AION_OPENAI_KEY = 'synthetic-test-only';
const originalFetch = globalThis.fetch; const sent = [];
globalThis.fetch = async (url, options = {}) => {
  if (String(url) === 'https://api.openai.com/v1/chat/completions') {
    const request = JSON.parse(options.body); sent.push(request);
    if (request.stream) {
      const cancel = request.messages.at(-1).content === 'cancel this stream';
      const payload = 'data: {"choices":[{"delta":{"content":"Stream "}}]}\n\ndata: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n';
      if (cancel) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n')); options.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); } }), { status: 200 });
      return new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(payload); for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: `Synthetic answer ${sent.length}` } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(url, options);
};
const { handleRequest } = await import('../src/routes/router.js');
const { closeDb } = await import('../src/services/assistant-db.js');
const { resetIdentityStoreForTests } = await import('../src/services/identity-store.js');
const server = http.createServer(handleRequest);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const cookies = (response) => response.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
const headers = (jar, csrf) => ({ cookie: jar, origin, 'x-aion-csrf': csrf, 'content-type': 'application/json' });
const post = (url, body, h) => fetch(origin + url, { method: 'POST', headers: h, body: JSON.stringify(body) });

test('Master spec §2/§5/§6: authenticated chat persists project-bound conversations and uses the selected provider', async (t) => {
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); closeDb(); await resetIdentityStoreForTests(); globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  assert.equal((await fetch(origin + '/api/assistant/projects')).status, 401);
  const bootstrap = await fetch(origin + '/api/auth/local-session', { headers: { 'x-aion-local-secret': process.env.AION_LOCAL_AUTH_SECRET } });
  const bootJar = cookies(bootstrap), bootCsrf = /aion_csrf=([^;]+)/.exec(bootJar)[1];
  const pair = crypto.generateKeyPairSync('ed25519');
  const enrolled = await post('/api/auth/enroll-owner', { name: 'Test owner', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }, headers(bootJar, bootCsrf));
  assert.equal(enrolled.status, 201); const owner = await enrolled.json();
  const challenge = await (await post('/api/auth/challenge', { deviceId: owner.deviceId }, { origin, 'content-type': 'application/json' })).json();
  const signature = crypto.sign(null, Buffer.from(challenge.signingPayload), pair.privateKey).toString('base64url');
  const auth = await post('/api/auth/authenticate', { challengeId: challenge.challengeId, signature }, { origin, 'content-type': 'application/json' });
  const jar = cookies(auth), csrf = /aion_csrf=([^;]+)/.exec(jar)[1], h = headers(jar, csrf);
  let response = await post('/api/assistant/projects', { name: 'Project One', pinned_context: 'Project one context' }, h); assert.equal(response.status, 201); const project = (await response.json()).project;
  response = await post('/api/assistant/projects', { name: 'Project One' }, h); assert.equal(response.status, 201); assert.notEqual((await response.json()).project.id, project.id);
  response = await post('/api/assistant/projects', { name: 'Project Two', pinned_context: 'Private other context' }, h); assert.equal(response.status, 201); const other = (await response.json()).project;
  const folderPath = path.join(root, 'existing-folder'); fs.mkdirSync(folderPath); fs.writeFileSync(path.join(folderPath, 'keep.txt'), 'unchanged');
  response = await post(`/api/assistant/projects/${project.id}/folders`, { path: folderPath }, { cookie: jar, origin, 'content-type': 'application/json' }); assert.equal(response.status, 403);
  response = await post(`/api/assistant/projects/${project.id}/folders`, { path: folderPath }, h); assert.equal(response.status, 201);
  response = await post(`/api/assistant/projects/${project.id}/folders`, { path: 'relative' }, h); assert.equal(response.status, 400);
  assert.equal(fs.readFileSync(path.join(folderPath, 'keep.txt'), 'utf8'), 'unchanged');
  response = await fetch(origin + `/api/assistant/projects/${project.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ name: 'Renamed project' }) }); assert.equal(response.status, 200);
  response = await fetch(origin + `/api/assistant/projects/${project.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ archived: true }) }); assert.equal(response.status, 200);
  response = await post('/api/assistant/chat', { projectId: project.id, runtimeMode: 'api', provider: 'openai', prompt: 'blocked' }, h); assert.equal(response.status, 409);
  response = await fetch(origin + `/api/assistant/projects/${project.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ archived: false }) }); assert.equal(response.status, 200);
  closeDb(); response = await fetch(origin + `/api/assistant/projects/${project.id}/folders`, { headers: { cookie: jar } }); assert.equal((await response.json()).folders[0].path, fs.realpathSync(folderPath));
  const chat = { projectId: project.id, runtimeMode: 'api', provider: 'openai', model: 'test-model', mode: 'ask' };
  response = await post('/api/assistant/chat', { ...chat, prompt: 'First message' }, h); assert.equal(response.status, 200); const first = await response.json();
  assert.equal(first.assistantMessage.content, 'Synthetic answer 1');
  response = await post('/api/assistant/chat', { ...chat, sessionId: first.sessionId, prompt: 'Second message' }, h); assert.equal(response.status, 200);
  assert.deepEqual(sent[1].messages.map((m) => m.content), ['You are AION Assistant, a clean, precise, and Apple-grade workstation intelligence. Respond concisely and accurately.\nActive Project Context: Project one context', 'First message', 'Synthetic answer 1', 'Second message']);
  response = await post('/api/assistant/chat', { ...chat, projectId: other.id, sessionId: first.sessionId, prompt: 'leak' }, h); assert.equal(response.status, 400); assert.equal(sent.length, 2);
  response = await post('/api/assistant/chat', { ...chat, sessionId: first.sessionId, mode: 'execute', prompt: 'run' }, h); assert.equal(response.status, 503); assert.equal(sent.length, 2);
  response = await post('/api/assistant/chat', { ...chat, provider: 'groq', prompt: 'No key' }, h); assert.equal(response.status, 503); const failed = await response.json(); assert.ok(failed.sessionId); assert.equal(sent.length, 2);
  response = await fetch(origin + `/api/assistant/sessions/${first.sessionId}/messages`, { headers: { cookie: jar } }); const messages = (await response.json()).messages;
  assert.deepEqual(messages.map((m) => m.content), ['First message', 'Synthetic answer 1', 'Second message', 'Synthetic answer 2']);
  closeDb(); response = await fetch(origin + `/api/assistant/sessions/${first.sessionId}/messages`, { headers: { cookie: jar } }); assert.equal((await response.json()).messages.length, 4);
  response = await post('/api/assistant/chat/stream', { ...chat, sessionId: first.sessionId, prompt: 'stream it' }, h); assert.equal(response.status, 200); const streamText = await response.text();
  assert.match(streamText, /event: delta/); assert.match(streamText, /event: done/); assert.match(streamText, /Stream answer/);
  response = await fetch(origin + `/api/assistant/sessions/${first.sessionId}/messages`, { headers: { cookie: jar } }); assert.equal((await response.json()).messages.at(-1).content, 'Stream answer');
  const cancel = new AbortController(); response = await fetch(origin + '/api/assistant/chat/stream', { method: 'POST', headers: h, body: JSON.stringify({ ...chat, sessionId: first.sessionId, prompt: 'cancel this stream' }), signal: cancel.signal });
  const reader = response.body.getReader(); let partial = ''; while (!partial.includes('event: delta')) { const next = await reader.read(); partial += new TextDecoder().decode(next.value); }
  cancel.abort(); await new Promise((resolve) => setTimeout(resolve, 100));
  response = await fetch(origin + `/api/assistant/sessions/${first.sessionId}/messages`, { headers: { cookie: jar } }); assert.equal((await response.json()).messages.at(-1).content, 'cancel this stream');
  // Master spec §2/§6: exact scope, Owner approval, single-use bounded action.
  response = await post('/api/assistant/chat/stream', { ...chat, mode: 'plan', sessionId: first.sessionId, prompt: 'Plan a text integrity check' }, h); assert.match(await response.text(), /event: done/);
  const proposal = { projectId: project.id, sessionId: first.sessionId, title: 'Hash test text', action: 'hash_text', input: 'harmless input', targetHost: 'local', folders: [], permissions: ['compute:sha256'], maxInputBytes: 64, maxDurationMs: 1000, expiresInMinutes: 10 };
  response = await post('/api/assistant/tasks', { ...proposal, folders: ['../escape'] }, h); assert.equal(response.status, 400);
  response = await post('/api/assistant/tasks', { ...proposal, command: 'whoami' }, h); assert.equal(response.status, 400);
  response = await post('/api/assistant/tasks', proposal, h); assert.equal(response.status, 201); const task = (await response.json()).task;
  response = await post(`/api/assistant/tasks/${task.id}/run`, {}, h); assert.equal(response.status, 409);
  response = await post(`/api/assistant/tasks/${task.id}/approve`, {}, { cookie: jar, origin, 'content-type': 'application/json' }); assert.equal(response.status, 403);
  const trustedKey = crypto.generateKeyPairSync('ed25519');
  const { createDevice } = await import('../src/services/identity-store.js'); const trusted = await createDevice({ name: 'Limited task user', role: 'trusted', publicKey: trustedKey.publicKey.export({ type: 'spki', format: 'pem' }), capabilities: ['conversation:write', 'system:read'] }, { role: 'owner', deviceId: owner.deviceId });
  const challenge2 = await (await post('/api/auth/challenge', { deviceId: trusted.id }, { origin, 'content-type': 'application/json' })).json();
  const sign2 = crypto.sign(null, Buffer.from(challenge2.signingPayload), trustedKey.privateKey).toString('base64url');
  const auth2 = await post('/api/auth/authenticate', { challengeId: challenge2.challengeId, signature: sign2 }, { origin, 'content-type': 'application/json' });
  const jar2 = cookies(auth2), csrf2 = /aion_csrf=([^;]+)/.exec(jar2)[1]; response = await post(`/api/assistant/tasks/${task.id}/approve`, {}, headers(jar2, csrf2)); assert.equal(response.status, 403);
  response = await post(`/api/assistant/projects/${project.id}/folders`, { path: folderPath }, headers(jar2, csrf2)); assert.equal(response.status, 403);
  for (const [route, body] of [['/api/ai', { prompt: 'lock' }], ['/api/command', { action: 'lock' }], ['/api/system/apps/kill', { name: 'example' }], ['/api/sync/folder', { path: folderPath }], ['/api/sync/device', {}], ['/api/sync/trigger', {}], ['/api/devices/local/command', { action: 'lock' }]]) { response = await post(route, body, h); assert.equal(response.status, 503, route); }
  response = await post('/api/ai', { prompt: 'lock' }, headers(jar2, csrf2)); assert.equal(response.status, 503);
  response = await post(`/api/assistant/tasks/${task.id}/approve`, {}, h); assert.equal(response.status, 200);
  response = await post(`/api/assistant/tasks/${task.id}/run`, { input: 'changed' }, h); assert.equal(response.status, 409);
  response = await post(`/api/assistant/tasks/${task.id}/run`, {}, h); assert.equal(response.status, 200);
  let completed; for (let i = 0; i < 100; i++) { response = await fetch(origin + `/api/assistant/tasks/${task.id}`, { headers: { cookie: jar } }); completed = await response.json(); if (completed.task.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.equal(completed.task.status, 'completed'); assert.equal(completed.task.result.sha256, crypto.createHash('sha256').update(proposal.input).digest('hex'));
  assert.deepEqual(completed.history.map((entry) => entry.event), ['proposed', 'approved', 'started', 'completed']);
  response = await post(`/api/assistant/tasks/${task.id}/run`, {}, h); assert.equal(response.status, 409);
  response = await post('/api/assistant/tasks', proposal, h); const cancelledTask = (await response.json()).task;
  response = await post(`/api/assistant/tasks/${cancelledTask.id}/cancel`, {}, h); assert.equal(response.status, 200);
  response = await post(`/api/assistant/tasks/${cancelledTask.id}/approve`, {}, h); assert.equal(response.status, 409);
  const { createBoundedTask, approveBoundedTask, startBoundedTask, cancelBoundedTask, getBoundedTask } = await import('../src/services/bounded-tasks.js');
  const actor = { role: 'owner', deviceId: owner.deviceId }; const running = await createBoundedTask({ ...proposal, input: 'x'.repeat(65536), maxInputBytes: 65536 }, actor);
  await approveBoundedTask(running.id, actor); await startBoundedTask(running.id, actor); await cancelBoundedTask(running.id, actor); await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal((await getBoundedTask(running.id)).status, 'cancelled');
  response = await post('/api/assistant/tasks', proposal, h); const expired = (await response.json()).task;
  const { getDb } = await import('../src/services/assistant-db.js'); (await getDb()).prepare('UPDATE bounded_tasks SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.id);
  response = await post(`/api/assistant/tasks/${expired.id}/approve`, {}, h); assert.equal(response.status, 409);
  response = await post('/api/assistant/tasks', proposal, h); const expiredApproved = (await response.json()).task;
  await post(`/api/assistant/tasks/${expiredApproved.id}/approve`, {}, h); (await getDb()).prepare('UPDATE bounded_tasks SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expiredApproved.id);
  response = await post(`/api/assistant/tasks/${expiredApproved.id}/run`, {}, h); assert.equal(response.status, 409);
  response = await post('/api/assistant/tasks', proposal, h); const restarted = (await response.json()).task;
  (await getDb()).prepare("UPDATE bounded_tasks SET status='running' WHERE id=?").run(restarted.id); closeDb();
  const moduleUrl = new URL('../src/services/bounded-tasks.js', import.meta.url).href;
  const script = `const m = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify([await m.getBoundedTask(${JSON.stringify(restarted.id)}), await m.getBoundedTask(${JSON.stringify(task.id)})]));`;
  const child = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, AION_ASSISTANT_DB_PATH: path.join(root, 'assistant.sqlite') }, windowsHide: true });
  const recovered = JSON.parse(child.stdout.trim()); assert.equal(recovered[0].status, 'interrupted'); assert.equal(recovered[1].status, 'completed'); assert.equal(recovered[1].result.sha256, crypto.createHash('sha256').update(proposal.input).digest('hex'));
  process.env.ANTHROPIC_API_KEY = 'synthetic-only'; const { streamPrompt } = await import('../src/services/llm-provider.js'); let observed = '';
  globalThis.fetch = async () => new Response('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude reply"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
  const result = await streamPrompt({ prompt: 'test', mode: 'plan', provider: 'anthropic', history: [], signal: new AbortController().signal, onText: async (part) => { observed += part; } }); assert.equal(result.content, 'Claude reply'); assert.equal(observed, 'Claude reply');
  globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"incomplete"}}]}\n\n');
  await assert.rejects(streamPrompt({ prompt: 'test', mode: 'ask', provider: 'openai', history: [], signal: new AbortController().signal, onText: async () => {} }), /before completion/);


});
