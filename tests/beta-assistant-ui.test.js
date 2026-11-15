import assert from 'node:assert/strict'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import test from 'node:test'; import { chromium } from 'playwright';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
test('Master spec §2/§3/§5: browser sends one project-aware chat request with CSRF', { skip: !fs.existsSync(chrome), timeout: 20000 }, async (t) => {
  const root = path.resolve('public'); const server = http.createServer((req, res) => { const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]); try { const ext = path.extname(file); res.setHeader('content-type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404); res.end(); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const browser = await chromium.launch({ headless: true, executablePath: chrome });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const page = await browser.newPage(); const base = `http://127.0.0.1:${server.address().port}`; let requests = []; let projects = []; let updates = []; let folders = []; let authenticated = true;
  await page.context().addCookies([{ name: 'aion_csrf', value: 'test-csrf', url: base }]);
  await page.route('**/api/**', (route) => { const req = route.request(), p = new URL(req.url()).pathname; let data = { status: 'ok' };
    if (p === '/api/auth/status') data = { status: 'ok', authenticated, initialized: authenticated, role: authenticated ? 'owner' : null, owner: authenticated ? { name: 'Owner' } : null };
    if (p === '/api/assistant/projects') { if (req.method() === 'POST') { projects.push({ headers: req.headers(), body: req.postDataJSON() }); data = { status: 'ok', project: { id: 'new-project', name: req.postDataJSON().name } }; } else data = { status: 'ok', projects: [{ id: 'aion', name: 'AION' }, ...(projects.length ? [{ id: 'new-project', name: projects[0].body.name }] : [])] }; }
    if (p === '/api/assistant/projects/new-project' && req.method() === 'PATCH') { updates.push(req.postDataJSON()); data = { status: 'ok', project: { id: 'new-project' } }; }
    if (p.endsWith('/folders')) { if (req.method() === 'POST') folders.push(req.postDataJSON()); data = { status: 'ok', folders }; }
    if (p.endsWith('/sessions')) data = { status: 'ok', sessions: [] };
    if (p === '/api/config') data = { status: 'ok', config: { executionTarget: { runtimeMode: 'api', apiProvider: 'openai', apiModel: 'test' } } };
    if (p === '/api/assistant/chat') { requests.push({ headers: req.headers(), body: req.postDataJSON() }); data = { status: 'ok', sessionId: 'session1', assistantMessage: { content: 'Answer' } }; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }); });
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700);
  await page.locator('#navItemAssistant').click();
  await page.locator('#commandInput').fill('Hello'); await page.locator('#commandBarForm').dispatchEvent('submit');
  await page.waitForTimeout(300); assert.equal(requests.length, 1); assert.equal(requests[0].headers['x-aion-csrf'], 'test-csrf'); assert.equal(requests[0].body.projectId, 'aion'); assert.equal(requests[0].body.prompt, 'Hello');
  await page.locator('#btnNewProject').click(); if (process.env.AION_UI_CAPTURE) await page.screenshot({ path: process.env.AION_UI_CAPTURE }); await page.locator('#newProjectName').fill('Example project'); await page.locator('#newProjectForm').dispatchEvent('submit');
  await page.waitForTimeout(200); assert.equal(projects.length, 1); assert.equal(projects[0].body.name, 'Example project'); assert.equal(projects[0].headers['x-aion-csrf'], 'test-csrf');
  await page.locator('#projectManage summary').click(); if (process.env.AION_MANAGE_CAPTURE) await page.screenshot({ path: process.env.AION_MANAGE_CAPTURE }); await page.locator('#projectRename').fill('Renamed'); await page.locator('#projectRenameForm').dispatchEvent('submit'); await page.waitForTimeout(200); assert.equal(updates[0].name, 'Renamed');
  await page.locator('#projectArchive').click(); await page.waitForTimeout(200); assert.equal(updates[1].archived, true);
  await page.locator('#projectFolderPath').fill('C:\\projects'); await page.locator('#projectFolderForm').dispatchEvent('submit'); await page.waitForTimeout(200); assert.equal(folders[0].path, 'C:\\projects');
  authenticated = false; await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
  assert.equal(await page.locator('#pairingModal').evaluate((el) => getComputedStyle(el).display), 'none');
  assert.equal(await page.locator('#settingsModal').evaluate((el) => el.classList.contains('active')), true);
  assert.equal(await page.locator('#settingsPanel-security').evaluate((el) => el.classList.contains('active')), true);
});
