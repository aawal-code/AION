import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright';

const exe = process.env.AION_TEST_NATIVE_EXE;
test('Master spec §1/§2: production shell fails closed with an occupied loopback port', { skip: process.platform !== 'win32' || !exe, timeout: 20000 }, async t => {
  assert.ok(fs.existsSync(exe), 'isolated native executable required');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-shell-containment-'));
  // A shell without its owned backend must display the fail-closed page.
  const isolatedExe = path.join(temp, 'AION.exe');
  fs.copyFileSync(exe, isolatedExe);
  for (const name of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) fs.copyFileSync(path.join(path.dirname(exe), name), path.join(temp, name));
  const profile = path.join(temp, 'profile'); fs.mkdirSync(profile);
  const sentinel = path.join(profile, 'legacy-profile-sentinel'); fs.writeFileSync(sentinel, 'preserve legacy profile');
  let connections = 0, bytes = 0; const requestLines = [];
  const listener = () => net.createServer(socket => { connections++; socket.on('data', data => { bytes += data.length; const first = data.toString('latin1').split('\r\n')[0]; if (/^(GET|POST|HEAD) \/[^ ]* HTTP\/1\.[01]$/.test(first)) requestLines.push(first); }); socket.setTimeout(250, () => socket.destroy()); });
  const attacker6 = listener(), attacker4 = listener();
  attacker6.listen({ host: '::1', port: 0, ipv6Only: true }); await once(attacker6, 'listening');
  attacker4.listen({ host: '127.0.0.1', port: attacker6.address().port }); await once(attacker4, 'listening');
  let debugPort;
  if (process.env.AION_TEST_NATIVE_SCREENSHOT) {
    const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); debugPort = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  }
  const env = { ...process.env, AION_INSTANCE_ID: `containment-${crypto.randomUUID()}`, AION_PORT: String(attacker6.address().port), AION_WEBVIEW2_DATA_PATH: profile, AION_LOCAL_AUTH_SECRET: 'synthetic-test-value-not-a-credential' };
  if (debugPort) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${debugPort}`;
  const launch = () => spawn(isolatedExe, [], { cwd: temp, windowsHide: true, stdio: 'ignore', env });
  let child = launch();
  t.after(async () => { if (child.exitCode === null) child.kill(); await Promise.all([new Promise(resolve => attacker4.close(resolve)), new Promise(resolve => attacker6.close(resolve))]); try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.equal(child.exitCode, null, 'isolated production process remains running');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve legacy profile');
  assert.ok(fs.existsSync(path.join(profile, 'private-v1')), 'separate WebView2 profile is created');
  assert.equal(connections, 0, 'occupied loopback listener was not contacted');
  if (debugPort) {
    let browser;
    try {
      for (let attempt = 0; attempt < 40 && !browser; attempt++) {
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
      }
      assert.ok(browser, 'isolated WebView2 debugging endpoint must be available');
      const page = browser.contexts().flatMap(context => context.pages())[0]; assert.ok(page, 'production WebView must expose a page');
      try { await page.locator('h1').waitFor({ timeout: 5000 }); } catch (error) { t.diagnostic(`WebView URL: ${page.url()}; document: ${(await page.content()).slice(0, 1000)}`); throw error; }
      assert.equal(await page.locator('h1').innerText(), 'AION secure startup is unavailable');
      await page.screenshot({ path: process.env.AION_TEST_NATIVE_SCREENSHOT });
      await page.evaluate(async port => { try { await fetch(`http://127.0.0.1:${port}/probe`); } catch {} }, attacker4.address().port);
      try { await page.goto(`http://127.0.0.1:${attacker4.address().port}/navigate`, { timeout: 1500 }); } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(bytes, 0, `page probe transmitted ${bytes} bytes (${requestLines.join(', ')})`);
    } finally { if (browser) await browser.close(); }
  }
  const exited = once(child, 'exit'); child.kill(); await exited;
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(bytes, 0);
  const initialConnections = connections;
  child = launch();
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.equal(child.exitCode, null, 'a second launch starts with the same isolated profile');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve legacy profile');
  assert.equal(connections, initialConnections, 'relaunch does not contact the occupied listener'); assert.equal(bytes, 0);
  const secondExit = once(child, 'exit'); child.kill(); await secondExit;
});
