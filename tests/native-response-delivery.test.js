import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright';

test('Master spec §1/§2: production WebView bounds IPC response bodies and deadlines', { skip: process.platform !== 'win32' || !process.env.AION_TEST_NATIVE_EXE, timeout: 90000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-response-probe-'));
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const env = { ...process.env, AION_PRIVATE_IPC_DEV: '1', AION_IPC_RESPONSE_PROBE: '1', AION_INSTANCE_ID: `response-${crypto.randomUUID()}`, AION_WEBVIEW2_DATA_PATH: path.join(temp, 'profile'), AION_SECURITY_DB_PATH: path.join(temp, 'security.sqlite'), AION_ASSISTANT_DB_PATH: path.join(temp, 'assistant.sqlite'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }; delete env.AION_LOCAL_AUTH_SECRET;
  const exe = process.env.AION_TEST_NATIVE_EXE, child = spawn(exe, [], { cwd: path.dirname(exe), env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const lines = []; let pending = '', browser;
  child.stderr.on('data', chunk => { pending += chunk.toString('utf8'); const parts = pending.split(/\r?\n/); pending = parts.pop(); for (const line of parts) if (line.startsWith('AION_TRACE ')) { lines.push(line); if (lines.length > 200) lines.shift(); } });
  t.after(async () => { if (browser) try { await browser.close(); } catch {} if (child.exitCode === null) child.kill(); try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} });
  for (let i = 0; i < 70 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
  assert.ok(browser, 'WebView debugging unavailable'); const page = browser.contexts().flatMap(context => context.pages())[0]; assert.ok(page);
  await page.waitForURL('https://aion-private.invalid/', { timeout: 15000 });
  const probe = async url => page.evaluate(async target => { try { const response = await fetch(target, { signal: AbortSignal.timeout(4000) }); return { status: response.status, value: await response.json() }; } catch (error) { return { error: error.name }; } }, url);
  const expected = { status: 200, value: { probe: 'fixed' } };
  const check = async (label, value) => { if (JSON.stringify(value) !== JSON.stringify(expected)) t.diagnostic(`${label}: ${JSON.stringify(value)}; trace: ${lines.slice(-80).join(' | ')}`); assert.deepEqual(value, expected, label); };
  await check('local in-memory body', await probe('/_dev/local-response'));
  await check('IPC buffered body', await probe('/api/_dev/response'));
  const oversized = await page.evaluate(async () => (await fetch('/api/_dev/oversized', { signal: AbortSignal.timeout(15000) })).status);
  assert.equal(oversized, 503, 'responses above 1 MiB fail closed');
  await check('IPC remains available after oversized response', await probe('/api/_dev/response'));
  const stalled = await page.evaluate(async () => { const start = performance.now(); try { const response = await fetch('/api/_dev/stalled', { signal: AbortSignal.timeout(27000) }); return { status: response.status, elapsed: performance.now() - start }; } catch (error) { return { error: error.name, elapsed: performance.now() - start }; } });
  assert.equal(stalled.status, 503, `stalled response failed closed: ${JSON.stringify(stalled)}`);
  assert.ok(stalled.elapsed >= 19000 && stalled.elapsed < 27000, `20-second deadline: ${stalled.elapsed}`);
  await check('IPC remains available after stalled response', await probe('/api/_dev/response'));
  const closedBefore = lines.filter(line => line.endsWith('probe_stalled_closed')).length;
  const cancelled = await page.evaluate(async () => { try { await fetch('/api/_dev/stalled', { signal: AbortSignal.timeout(500) }); return 'completed'; } catch (error) { return error.name; } });
  assert.equal(cancelled, 'TimeoutError');
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.ok(lines.filter(line => line.endsWith('probe_stalled_closed')).length > closedBefore, 'browser cancellation releases the backend response promptly');
  await check('IPC remains available after browser cancellation', await probe('/api/_dev/response'));
  const isolation = await page.evaluate(async () => {
    const first = new AbortController(), second = new AbortController();
    let secondSettled = false;
    const one = fetch('/api/_dev/stalled', { signal: first.signal }).catch(e => e.name);
    const two = fetch('/api/_dev/stalled', { signal: second.signal }).then(() => { secondSettled = true; }, () => { secondSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 700)); first.abort();
    const firstResult = await one; await new Promise(resolve => setTimeout(resolve, 1200));
    const unaffected = !secondSettled; second.abort(); await two;
    return { firstResult, unaffected };
  });
  assert.deepEqual(isolation, { firstResult: 'AbortError', unaffected: true }, 'cancellation is scoped to its request');
  await check('IPC remains available after independent cancellations', await probe('/api/_dev/response'));
  const openCancelled = await page.evaluate(async () => { try { await fetch('/api/_dev/noheaders', { signal: AbortSignal.timeout(500) }); return 'completed'; } catch (error) { return error.name; } });
  assert.equal(openCancelled, 'TimeoutError', 'abort cancels a request waiting for headers');
  await check('IPC remains available after cancelling header wait', await probe('/api/_dev/response'));
  const beforeNavigation = lines.filter(line => line.endsWith('probe_stalled_closed')).length;
  await page.evaluate(() => { fetch('/api/_dev/stalled').catch(() => {}); });
  await new Promise(resolve => setTimeout(resolve, 800));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  for (let i = 0; i < 30 && lines.filter(line => line.endsWith('probe_stalled_closed')).length <= beforeNavigation; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(lines.filter(line => line.endsWith('probe_stalled_closed')).length > beforeNavigation, 'navigation cancels the previous document request');
  await check('IPC remains available after navigation', await probe('/api/_dev/response'));
  const noHeaders = await page.evaluate(async () => { const start = performance.now(); try { const response = await fetch('/api/_dev/noheaders', { signal: AbortSignal.timeout(25000) }); return { status: response.status, elapsed: performance.now() - start }; } catch (error) { return { error: error.name, elapsed: performance.now() - start }; } });
  assert.equal(noHeaders.status, 503, `missing headers fail closed: ${JSON.stringify(noHeaders)}`);
  assert.ok(noHeaders.elapsed >= 19000 && noHeaders.elapsed < 25000, `headers deadline: ${noHeaders.elapsed}`);
  // Concurrent authenticated chat streaming is exercised through the real
  // native messaging bridge in native-private-workspace.test.js. A live HTTP
  // response is deliberately not exposed to WebView2.
});
