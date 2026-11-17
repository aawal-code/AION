import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
test('Master spec §3/§5: a delayed project response cannot replace the selected conversation', { skip: !fs.existsSync(chrome), timeout: 30000 }, async t => {
  const root = path.resolve('public');
  const server = http.createServer((req, res) => {
    const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    try { const ext = path.extname(file); res.setHeader('content-type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data = { status: 'ok' };
    if (pathname === '/api/auth/status') data = { status: 'ok', authenticated: true, initialized: true };
    if (pathname === '/api/devices') data = { status: 'ok', devices: [] };
    if (pathname === '/api/assistant/projects') data = { status: 'ok', projects: [{ id: 'aion', name: 'AION' }, { id: 'p1', name: 'First project' }, { id: 'p2', name: 'Second project' }] };
    if (pathname === '/api/assistant/projects/p1/sessions') { await new Promise(resolve => setTimeout(resolve, 700)); data = { status: 'ok', sessions: [{ id: 's1', title: 'First chat', mode: 'ask' }] }; }
    if (pathname === '/api/assistant/projects/p2/sessions') data = { status: 'ok', sessions: [{ id: 's2', title: 'Second chat', mode: 'ask' }, { id: 's3', title: 'Another chat', mode: 'ask' }] };
    if (pathname === '/api/assistant/projects/aion/sessions') data = { status: 'ok', sessions: [] };
    if (pathname === '/api/assistant/sessions/s1/messages') data = { status: 'ok', messages: [{ role: 'assistant', content: 'First answer' }] };
    if (pathname === '/api/assistant/sessions/s2/messages') data = { status: 'ok', messages: [{ role: 'assistant', content: 'Second answer' }] };
    if (pathname === '/api/assistant/sessions/s3/messages') data = { status: 'ok', messages: [{ role: 'assistant', content: 'Another answer' }] };
    if (pathname.endsWith('/folders')) data = { status: 'ok', folders: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#navItemAssistant').click();
  await page.getByRole('button', { name: 'First project' }).click();
  await page.getByRole('button', { name: 'Second project' }).click();
  await page.getByText('Second answer', { exact: true }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(await page.getByText('First answer', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Second answer', { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Second chat' }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Another chat' }).focus();
  await page.keyboard.press('Enter');
  await page.getByText('Another answer', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Another chat' }).getAttribute('aria-pressed'), 'true');
});
