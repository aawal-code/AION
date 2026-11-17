import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright';

const exe = process.env.AION_TEST_NATIVE_EXE;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForAuthenticated(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const authenticated = await page.evaluate(async () => {
        const response = await fetch('/api/auth/status', { signal: AbortSignal.timeout(3000) });
        return response.ok && (await response.json()).authenticated === true;
      });
      if (authenticated === true) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Authenticated status was not established before the deadline');
}
test('Master spec §1/§2/§5: actual private IPC desktop enrolls a fresh Owner and persists a project', { skip: process.platform !== 'win32' || !exe, timeout: 90000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-private-desktop-'));
  let observedConnections = 0, observedBytes = 0;
  const listener = () => net.createServer(socket => { observedConnections++; socket.on('data', data => { observedBytes += data.length; }); socket.setTimeout(250, () => socket.destroy()); });
  const attacker6 = listener(), attacker4 = listener(); attacker6.listen({ host: '::1', port: 0, ipv6Only: true }); await once(attacker6, 'listening'); attacker4.listen({ host: '127.0.0.1', port: attacker6.address().port }); await once(attacker4, 'listening');
  let providerCancelled = false, providerSawSession = false, providerActive = false, finishNormalStream = null;
  const provider = () => http.createServer((req, res) => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
    if (req.headers.cookie || req.headers['x-aion-csrf']) providerSawSession = true;
    let input; try { input = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const cancelling = ['Cancel synthetic stream', 'Crash synthetic stream'].includes(input.messages?.at(-1)?.content);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    providerActive = true; res.on('close', () => { providerActive = false; });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: cancelling ? 'Partial synthetic answer' : 'Synthetic streamed answer' } }] })}\n\n`);
    if (cancelling) res.on('close', () => { providerCancelled = true; });
    else { const timer = setTimeout(() => res.end('data: [DONE]\n\n'), 30000); finishNormalStream = () => { clearTimeout(timer); res.end('data: [DONE]\n\n'); }; res.on('close', () => { clearTimeout(timer); finishNormalStream = null; }); }
  }); });
  const provider6 = provider(), provider4 = provider();
  provider6.listen({ host: '::1', port: 11434, ipv6Only: true }); await once(provider6, 'listening');
  provider4.listen({ host: '127.0.0.1', port: 11434 }); await once(provider4, 'listening');
  const reserveDebugPort = async () => { const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); return port; };
  let debugPort = await reserveDebugPort();
  const env = { ...process.env, AION_PRIVATE_IPC_DEV: '1', AION_INSTANCE_ID: `private-${crypto.randomUUID()}`, AION_PORT: String(attacker6.address().port), AION_WEBVIEW2_DATA_PATH: path.join(temp, 'profile'), AION_SECURITY_DB_PATH: path.join(temp, 'security.sqlite'), AION_ASSISTANT_DB_PATH: path.join(temp, 'assistant.sqlite'), AION_VAULT_DIR: path.join(temp, 'vault'), AION_DEVICES_PATH: path.join(temp, 'devices.json'), AION_TRANSPORT_IDENTITY_PATH: path.join(temp, 'identity.dpapi'), SYNCTHING_CONFIG_PATH: path.join(temp, 'no-syncthing'), SYNCTHING_PORT: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` };
  if (process.env.AION_TEST_PRODUCTION === '1') delete env.AION_PRIVATE_IPC_DEV;
  for (const name of ['OPENAI_API_KEY','AION_OPENAI_KEY','ANTHROPIC_API_KEY','AION_ANTHROPIC_KEY','CLAUDE_API_KEY','CEREBRAS_API_KEY','AION_CEREBRAS_KEY','GROQ_API_KEY','AION_GROQ_KEY','GEMINI_API_KEY','AION_GEMINI_KEY','GOOGLE_API_KEY','AION_TEST_VAULT_KEY','AION_LOCAL_AUTH_SECRET']) delete env[name];
  const traceLines = [];
  const launch = () => { const p = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env }); let pending = ''; p.stderr.on('data', data => { pending += data.toString('utf8'); const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const line of lines) if (line.startsWith('AION_TRACE ')) { traceLines.push(line); if (traceLines.length > 500) traceLines.shift(); } }); return p; };
  let child = launch(), browser;
  t.after(async () => { if (browser) await browser.close(); if (child.exitCode === null) child.kill(); provider4.closeAllConnections(); provider6.closeAllConnections(); await Promise.all([new Promise(resolve => attacker4.close(resolve)), new Promise(resolve => attacker6.close(resolve)), new Promise(resolve => provider4.close(resolve)), new Promise(resolve => provider6.close(resolve))]); try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} });
  for (let i = 0; i < 80 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); } catch { await delay(200); } }
  assert.ok(browser, 'actual WebView2 debugging endpoint was not available');
  const page = browser.contexts().flatMap(context => context.pages())[0]; assert.ok(page); page.setDefaultTimeout(15000);
  const failures = []; page.on('pageerror', error => failures.push(`script: ${error.message}`)); page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  try { await page.locator('#securityOwnerName').waitFor({ state: 'visible', timeout: 20000 }); }
  catch (error) { t.diagnostic(`URL ${page.url()}; security status ${await page.locator('#securityStatus').textContent()}; errors ${JSON.stringify(failures)}`); throw error; }
  await page.locator('#securityOwnerName').fill('Isolated owner'); await page.locator('#btnSecurityEnroll').click();
  await page.locator('#securityOneTimeKey').waitFor({ state: 'visible', timeout: 15000 });
  await waitForAuthenticated(page);
  await page.locator('#securityRecoveryConfirmed').check(); await page.locator('#btnSecurityDismissRecovery').click();
  const cookieProbe = await page.evaluate(async () => { const normal = await fetch('/api/assistant/projects'); const omitted = await fetch('/api/assistant/projects', { credentials: 'omit' }); return { normal: normal.status, normalTrace: normal.headers.get('x-aion-debug-request'), omitted: omitted.status, omittedTrace: omitted.headers.get('x-aion-debug-request') }; });
  if (cookieProbe.omitted !== 401 || cookieProbe.normal !== 200) t.diagnostic(`Synthetic cookie-header probe: ${JSON.stringify(cookieProbe)}; cookie commits: ${traceLines.filter(line => /cookie_(commit|set|confirm)/.test(line)).join(' | ')}; session outcomes: ${traceLines.filter(line => /session_(valid|absent_or_invalid|error)/.test(line)).slice(-10).join(' | ')}`);
  assert.equal(cookieProbe.omitted, 401, 'requests explicitly omitting credentials must not acquire the Owner session');
  assert.equal(cookieProbe.normal, 200);
  const afterAbort = await page.evaluate(async () => {
    const controller = new AbortController();
    const cancelled = fetch('/api/auth/status', { signal: controller.signal }).catch(error => error.name);
    controller.abort();
    const error = await cancelled;
    const response = await fetch('/api/assistant/projects');
    return { error, status: response.status };
  });
  assert.deepEqual(afterAbort, { error: 'AbortError', status: 200 }, 'an aborted request does not affect the authenticated session');
  // Exercise the actual WebView message boundary even if page CSP is bypassed.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setBypassCSP', { enabled: true });
  const frameProbe = await page.evaluate(async () => {
    const id = crypto.randomUUID().replaceAll('-', '');
    const csrf = decodeURIComponent((document.cookie.split('; ').find(item => item.startsWith('aion_csrf=')) || '').slice(10));
    const frame = document.createElement('iframe'); frame.srcdoc = '<!doctype html><title>untrusted frame</title>';
    await new Promise(resolve => { frame.onload = resolve; document.body.append(frame); });
    let received = false;
    const listener = e => { if (e.data?.channel === 'aion.chat.v1' && e.data.id === id) received = true; };
    chrome.webview.addEventListener('message', listener);
    const bridge = frame.contentWindow.chrome?.webview;
    if (bridge) bridge.postMessage({ channel: 'aion.chat.v1', id, type: 'start', csrf, body: '{}' });
    await new Promise(resolve => setTimeout(resolve, 1200));
    chrome.webview.removeEventListener('message', listener); frame.remove();
    return { received };
  });
  await cdp.send('Page.setBypassCSP', { enabled: false });
  await cdp.detach();
  assert.equal(frameProbe.received, false, 'subframe messages must not reach the native chat bridge');
  await page.evaluate(() => { location.href = 'https://untrusted.invalid/'; });
  await delay(500);
  assert.equal(page.url(), 'https://aion-private.invalid/', 'untrusted document navigation is rejected');
  const invalidCsrf = await page.evaluate(async () => (await fetch('/api/assistant/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-aion-csrf': 'invalid' }, body: JSON.stringify({ name: 'Must not be created' }) })).status);
  assert.equal(invalidCsrf, 403);
  const invalidBridge = await page.evaluate(() => new Promise(resolve => { const id = crypto.randomUUID().replaceAll('-', ''); const timer = setTimeout(() => resolve('timeout'), 5000); const receive = event => { if (event.data?.channel === 'aion.chat.v1' && event.data?.id === id) { clearTimeout(timer); chrome.webview.removeEventListener('message', receive); resolve(event.data.type); } }; chrome.webview.addEventListener('message', receive); chrome.webview.postMessage({ channel: 'aion.chat.v1', id, type: 'start', csrf: 'x'.repeat(43), body: '{}' }); }));
  assert.equal(invalidBridge, 'error', 'a bridge message with invalid CSRF is rejected');
  const ownerId = await page.evaluate(async () => (await (await fetch('/api/auth/status')).json()).owner.id);
  await page.locator('#btnCloseSettings').click(); await page.locator('#navItemAssistant').click();
  await page.locator('#btnNewProject').click(); await page.locator('#newProjectName').fill('Isolated IPC project'); await page.locator('#newProjectForm button[type=submit]').click();
  await page.getByRole('button', { name: 'Isolated IPC project' }).waitFor({ state: 'visible' });
  const devices = await page.evaluate(async () => (await fetch('/api/devices')).status); assert.equal(devices, 200);
  await page.locator('#btnNewChat').click(); await page.locator('#assistantSessionsList .assistant-session-item').first().waitFor({ state: 'visible' });
  await page.locator('#targetProviderSelect').selectOption('ollama'); await page.locator('#targetModelSelect').fill('synthetic-model'); await page.locator('#targetModelSelect').blur();
  await page.locator('#commandInput').fill('A persisted question'); await page.locator('#commandBarForm').dispatchEvent('submit');
  await page.getByText('Synthetic streamed answer', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(providerActive, true, 'synthetic stream remains active');
  assert.equal(await page.evaluate(async () => (await fetch('/api/assistant/projects')).status), 200, 'ordinary authenticated request succeeds during streaming');
  assert.equal(providerActive, true, 'ordinary request completed before the stream ended');
  assert.ok(finishNormalStream, 'synthetic provider can finish the response');
  finishNormalStream();
  await page.getByRole('button', { name: 'Cancel response' }).waitFor({ state: 'hidden', timeout: 15000 });
  // A browser that stops acknowledging chunks must not block ordinary APIs.
  const slowConsumer = await page.evaluate(async () => {
    const projects = await (await fetch('/api/assistant/projects')).json();
    const projectId = projects.projects.find(project => project.name === 'Isolated IPC project').id;
    const sessions = await (await fetch(`/api/assistant/projects/${encodeURIComponent(projectId)}/sessions`)).json();
    const sessionId = sessions.sessions[0].id;
    const csrf = decodeURIComponent((document.cookie.split('; ').find(item => item.startsWith('aion_csrf=')) || '').slice(10));
    const id = crypto.randomUUID().replaceAll('-', '');
    return await new Promise(resolve => {
      let chunks = 0;
      const timer = setTimeout(() => { chrome.webview.removeEventListener('message', receive); chrome.webview.postMessage({ channel: 'aion.chat.v1', id, type: 'cancel' }); resolve({ error: 'timeout' }); }, 10000);
      const receive = async event => {
        if (event.data?.channel !== 'aion.chat.v1' || event.data.id !== id) return;
        if (event.data.type === 'error') { clearTimeout(timer); chrome.webview.removeEventListener('message', receive); resolve({ error: 'stream failed' }); return; }
        if (event.data.type !== 'chunk') return;
        chunks++;
        if (chunks !== 1) return;
        await new Promise(done => setTimeout(done, 1000));
        const status = await (await fetch('/api/assistant/projects', { signal: AbortSignal.timeout(4000) })).status;
        chrome.webview.postMessage({ channel: 'aion.chat.v1', id, type: 'cancel' });
        clearTimeout(timer); chrome.webview.removeEventListener('message', receive); resolve({ status, chunks });
      };
      chrome.webview.addEventListener('message', receive);
      chrome.webview.postMessage({ channel: 'aion.chat.v1', id, type: 'start', csrf, body: JSON.stringify({ prompt: 'Cancel synthetic stream', mode: 'ask', projectId, sessionId, runtimeMode: 'api', provider: 'ollama', model: 'synthetic-model' }) });
    });
  });
  assert.deepEqual(slowConsumer, { status: 200, chunks: 1 }, 'unacknowledged chunks remain bounded and do not block ordinary APIs');
  for (let i = 0; i < 100 && !providerCancelled; i++) await delay(50);
  assert.equal(providerCancelled, true, 'slow consumer cancellation closes the provider connection');
  providerCancelled = false;
  await page.locator('#commandInput').fill('Cancel synthetic stream'); await page.locator('#commandBarForm').dispatchEvent('submit');
  await page.getByText('Partial synthetic answer', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Cancel response' }).click();
  for (let i = 0; i < 100 && !providerCancelled; i++) await delay(50);
  assert.equal(providerCancelled, true, 'provider connection is cancelled');
  assert.equal(providerSawSession, false, 'AION session and CSRF are never sent to the provider');
  await page.locator('#btnOpenSettings').click(); await page.locator('[data-settings-tab="vault"]').click();
  const row = page.locator('.api-vault-item').filter({ has: page.locator('.api-key-entry[data-provider="openai"]') });
  await row.locator('input').fill('synthetic-fixture-only'); await row.getByRole('button', { name: 'Save' }).click();
  try { await row.getByText('Configured', { exact: true }).waitFor({ state: 'visible', timeout: 15000 }); }
  catch (error) { t.diagnostic(`Vault row: ${await row.innerText()}; errors: ${JSON.stringify(failures)}; toasts: ${await page.locator('#toastContainer').innerText()}`); throw error; }
  await page.locator('#btnCloseSettings').click();
  if (process.env.AION_TEST_NATIVE_SCREENSHOT) await page.screenshot({ path: process.env.AION_TEST_NATIVE_SCREENSHOT });
  const exited = once(child, 'exit'); child.kill(); await exited; try { await browser.close(); } catch {} browser = null; await delay(1500);
  debugPort = await reserveDebugPort(); env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${debugPort}`;
  child = launch();
  for (let i = 0; i < 80 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); } catch { await delay(200); } }
  assert.ok(browser, 'private desktop did not reopen');
  const reopened = browser.contexts().flatMap(context => context.pages())[0]; assert.ok(reopened); reopened.setDefaultTimeout(15000);
  await reopened.waitForURL('https://aion-private.invalid/', { timeout: 20000 });
  try { await waitForAuthenticated(reopened); }
  catch (error) { const diagnostic = await reopened.evaluate(async () => { try { const r = await fetch('/api/auth/status', { signal: AbortSignal.timeout(3000) }); const d = await r.json(); return { status: r.status, authenticated: d.authenticated, trace: r.headers.get('x-aion-debug-request'), cookieNames: document.cookie.split(';').map(x => x.trim().split('=')[0]) }; } catch (e) { return { error: e.name, cookieNames: document.cookie.split(';').map(x => x.trim().split('=')[0]) }; } }); const statusTrace = [...traceLines].reverse().find(line => line.endsWith('intercept_auth_status')); const id = statusTrace?.split(' ')[3]; t.diagnostic(`Reopened security status: ${await reopened.locator('#securityStatus').textContent()}; ${JSON.stringify(diagnostic)}; trace ${id || 'none'}: ${traceLines.filter(line => line.split(' ')[3] === id).join(' | ')}; recent: ${traceLines.slice(-60).join(' | ')}`); throw error; }
  assert.equal(await reopened.evaluate(async () => (await (await fetch('/api/auth/status')).json()).owner.id), ownerId);
  await reopened.locator('#navItemAssistant').click(); await reopened.getByRole('button', { name: 'Isolated IPC project' }).waitFor({ state: 'visible' });
  await reopened.getByRole('button', { name: 'Isolated IPC project' }).click(); await reopened.getByText('A persisted question').waitFor({ state: 'visible' });
  await reopened.locator('#btnOpenSettings').click(); await reopened.locator('[data-settings-tab="vault"]').click();
  const reopenedRow = reopened.locator('.api-vault-item').filter({ has: reopened.locator('.api-key-entry[data-provider="openai"]') });
  await reopenedRow.getByText('Configured', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await reopened.locator('#btnCloseSettings').click();
  await reopened.evaluate(() => { window.__testBridgeError = false; chrome.webview.addEventListener('message', e => { if (e.data?.channel === 'aion.chat.v1' && e.data.type === 'error') window.__testBridgeError = true; }); });
  await reopened.locator('#commandInput').fill('Crash synthetic stream'); await reopened.locator('#commandBarForm').dispatchEvent('submit');
  await reopened.getByText('Partial synthetic answer', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  const procInfo = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Where-Object { $_.Name -eq 'node.exe' } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`], { windowsHide: true, encoding: 'utf8' }));
  assert.ok(!Array.isArray(procInfo) && procInfo.ExecutablePath.toLowerCase() === path.join(path.dirname(exe), 'runtime', 'node.exe').toLowerCase(), 'only the launched isolated backend is targeted');
  process.kill(procInfo.ProcessId);
  await reopened.waitForFunction(() => window.__testBridgeError === true, null, { timeout: 10000 });
  const stopped = once(child, 'exit'); child.kill(); await stopped; await browser.close(); browser = null;
  debugPort = await reserveDebugPort();
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${debugPort}`;
  env.AION_WEBVIEW2_DATA_PATH = path.join(temp, 'fresh-profile');
  child = launch();
  for (let i = 0; i < 80 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); } catch { await delay(200); } }
  assert.ok(browser, 'fresh-profile desktop did not open');
  const migrated = browser.contexts().flatMap(context => context.pages())[0];
  await migrated.waitForURL('https://aion-private.invalid/', { timeout: 20000 });
  await migrated.waitForFunction(() => document.querySelector('#securityStatus')?.textContent.includes('recovery is required'), null, { timeout: 20000 });
  const legacyStatus = await migrated.evaluate(async () => (await (await fetch('/api/auth/status')).json()));
  assert.equal(legacyStatus.initialized, true);
  assert.equal(legacyStatus.authenticated, false);
  assert.equal(legacyStatus.owner.id, ownerId, 'missing private-origin key cannot replace an existing Owner');
  assert.equal(observedConnections, 0); assert.equal(observedBytes, 0);
});
