import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
test('Master spec §1/§3: Mobile Access shows truthful status and no unusable pairing code', { skip: !fs.existsSync(chrome), timeout: 30000 }, async t => {
  const root = path.resolve('public');
  const server = http.createServer((req, res) => { const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]); try { const ext = path.extname(file); res.setHeader('content-type', ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let mesh = { status: 'ok', connected: true, hostname: 'Example PC', ipv4: '100.64.0.10', dnsName: 'example.example.ts.net', cliAvailable: true };
  let networkStatus = 200;
  await page.route('**/api/**', route => {
    const name = new URL(route.request().url()).pathname;
    let body = { status: 'ok' }, code = 200;
    if (name === '/api/auth/status') body = { status: 'ok', authenticated: true, initialized: true, role: 'owner' };
    if (name === '/api/devices') body = { status: 'ok', devices: [] };
    if (name === '/api/assistant/projects') body = { status: 'ok', projects: [] };
    if (name === '/api/network/mesh') { body = mesh; code = networkStatus; }
    return route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#navItemAllDevices').click(); await page.locator('#openMobileAccess').click();
  await page.getByText('Tailscale is connected on this PC. AION mobile access is not enabled.').waitFor();
  assert.equal(await page.locator('#mobileAccessDns').innerText(), 'example.example.ts.net');
  assert.equal(await page.locator('#mobileAccessIp').innerText(), '100.64.0.10');
  if (process.env.AION_TEST_MOBILE_PREPARATION_SCREENSHOT) await page.screenshot({ path: process.env.AION_TEST_MOBILE_PREPARATION_SCREENSHOT });
  assert.equal(await page.getByRole('button', { name: /enable mobile access/i }).count(), 0);
  assert.equal(await page.locator('#securityPairingQr').count(), 0);
  mesh = { status: 'ok', connected: false, cliAvailable: false, statusError: 'cli_not_found' };
  await page.locator('#refreshMobileAccess').click(); await page.getByText(/Tailscale command not found/).waitFor();
  networkStatus = 401; await page.locator('#refreshMobileAccess').click(); await page.getByText(/Sign in to AION to view/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#mobileAccessTitle').isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page does not overflow horizontally');
  await page.locator('#backToDevices').click(); assert.equal(await page.locator('#devicesOverview').isVisible(), true);
  await page.evaluate(() => localStorage.setItem('aion_lang', 'ar')); await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#mobileNavDevices').click(); await page.locator('#openMobileAccess').click();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.locator('#mobileAccessTitle').innerText(), 'الوصول من الهاتف والإقران');
});
