import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

test('Master spec §1/§2: real WebView2 private page uses child IPC and blocks loopback', { skip: process.platform !== 'win32', timeout: 45000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aion-private-webview-'));
  const csc = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const candidates = [process.env.AION_BUILD_CACHE, ...fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('AION-DevPreview-')).map(n => path.join(os.tmpdir(), n, 'cache'))].filter(Boolean);
  const cache = candidates.find(dir => ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll'].every(name => fs.existsSync(path.join(dir, name))));
  assert.ok(cache, 'verified WebView2 build dependencies are required');
  for (const name of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) fs.copyFileSync(path.join(cache, name), path.join(tmp, name));
  const exe = path.join(tmp, 'WebViewHarness.exe');
  const build = spawnSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', `/r:${path.join(tmp, 'Microsoft.Web.WebView2.Core.dll')}`, `/r:${path.join(tmp, 'Microsoft.Web.WebView2.WinForms.dll')}`, path.resolve('tests/fixtures/private-webview/PrivateWebViewHarness.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  let connections = 0;
  const attacker = http.createServer((req, res) => { res.end('unexpected'); });
  attacker.on('connection', () => { connections++; });
  attacker.listen(0, '127.0.0.1'); await once(attacker, 'listening');
  let child;
  t.after(async () => { if (child && child.exitCode === null) child.kill(); await new Promise(resolve => attacker.close(resolve)); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
  for (const mode of ['exit', 'disconnect', 'crash']) {
    child = spawn(exe, [path.resolve('public'), path.resolve('tests/fixtures/private-webview/backend.mjs'), process.execPath, path.join(tmp, `profile-${mode}`), path.join(tmp, `identity-${mode}.sqlite`), String(attacker.address().port), mode], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'exit');
    if (mode === 'crash') assert.notEqual(code, 0, 'crash scenario must terminate unexpectedly');
    else assert.equal(code, 0, `${mode}: harness exited ${code}\n${stdout}\n${stderr}`);
    assert.match(stdout, /WEBVIEW_OWNER_OK/);
    assert.match(stdout, /WEBVIEW_MUTATION_BLOCKED/);
    if (mode !== 'crash') assert.match(stdout, /WEBVIEW_DISCONNECTED/);
    for (const probe of ['/probe', '/worker', '/service-worker']) assert.ok(stdout.includes(`NETWORK_BLOCKED ${probe}\n`) || stdout.includes(`NETWORK_BLOCKED ${probe}\r\n`), `${probe} loopback request was intercepted`);
    if (mode === 'disconnect') assert.match(stdout, /BACKEND_ALIVE/);
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (mode === 'crash') {
      const pid = Number(/BACKEND_PID (\d+)/.exec(stdout)?.[1]); assert.ok(pid);
      assert.throws(() => process.kill(pid, 0), 'backend must exit after the parent pipe closes');
    }
  }
  assert.equal(connections, 0, 'the loopback listener received no connection during or after the WebView shell');
});
