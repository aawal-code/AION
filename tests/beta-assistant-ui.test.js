import assert from 'node:assert/strict'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import test from 'node:test'; import { chromium } from 'playwright';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
test('Master spec §2/§3/§5: browser sends one project-aware chat request with CSRF', { skip: !fs.existsSync(chrome), timeout: 20000 }, async (t) => {
  const root = path.resolve('public'); const server = http.createServer((req, res) => { const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]); try { const ext = path.extname(file); res.setHeader('content-type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404); res.end(); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const browser = await chromium.launch({ headless: true, executablePath: chrome });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const page = await browser.newPage(); const base = `http://127.0.0.1:${server.address().port}`; let requests = []; let authenticated = true;
  await page.context().addCookies([{ name: 'aion_csrf', value: 'test-csrf', url: base }]);
  await page.route('**/api/**', (route) => { const req = route.request(), p = new URL(req.url()).pathname; let data = { status: 'ok' };
    if (p === '/api/auth/status') data = { status: 'ok', authenticated, initialized: authenticated, role: authenticated ? 'owner' : null, owner: authenticated ? { name: 'Owner' } : null };
    if (p === '/api/assistant/projects') data = { status: 'ok', projects: [{ id: 'aion', name: 'AION' }] };
    if (p.endsWith('/sessions')) data = { status: 'ok', sessions: [] };
    if (p === '/api/config') data = { status: 'ok', config: { executionTarget: { runtimeMode: 'api', apiProvider: 'openai', apiModel: 'test' } } };
    if (p === '/api/assistant/chat') { requests.push({ headers: req.headers(), body: req.postDataJSON() }); data = { status: 'ok', sessionId: 'session1', assistantMessage: { content: 'Answer' } }; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }); });
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700);
  await page.evaluate(() => { document.getElementById('canvasChatView').style.display = 'block'; });
  await page.locator('#commandInput').fill('Hello'); await page.locator('#commandBarForm').dispatchEvent('submit');
  await page.waitForTimeout(300); assert.equal(requests.length, 1); assert.equal(requests[0].headers['x-aion-csrf'], 'test-csrf'); assert.equal(requests[0].body.projectId, 'aion'); assert.equal(requests[0].body.prompt, 'Hello');
  authenticated = false; await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
  assert.equal(await page.locator('#pairingModal').evaluate((el) => getComputedStyle(el).display), 'none');
  assert.equal(await page.locator('#settingsModal').evaluate((el) => el.classList.contains('active')), true);
  assert.equal(await page.locator('#settingsPanel-security').evaluate((el) => el.classList.contains('active')), true);
});
