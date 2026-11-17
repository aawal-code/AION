import assert from 'node:assert/strict';
import { execFileSync, fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import https from 'node:https';
import net from 'node:net';
import test from 'node:test';
import { getMobileTailscaleCertificate } from '../src/services/mobile-tailscale-certificate.js';

// Opt in only on a development tailnet with no existing Serve configuration.
test('Master spec §1/§2: demonstrate same-user certificate access defeats raw TCP port takeover protection', { skip: process.env.AION_TEST_TAILSCALE_TAKEOVER !== '1', timeout: 30000 }, async t => {
  const cli = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  const status = args => JSON.parse(execFileSync(cli, args, { encoding: 'utf8', timeout: 3000, windowsHide: true }));
  assert.deepEqual(status(['serve', 'status', '--json']), {}, 'refuse to modify existing Serve configuration');
  const ip = status(['status', '--json']).Self.TailscaleIPs.find(net.isIPv4);
  const pair = await getMobileTailscaleCertificate();
  let server = https.createServer({ cert: pair.cert, key: pair.key }, (req, res) => { req.resume(); res.end('ok'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port, external = 32443;
  const serve = spawn(cli, ['serve', '--tcp=' + external, 'tcp://127.0.0.1:' + port], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  serve.stderr.resume(); let attacker;
  t.after(async () => {
    if (attacker?.connected) attacker.disconnect();
    if (attacker && attacker.exitCode === null) await once(attacker, 'exit');
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (serve.exitCode === null) { const done = once(serve, 'exit'); serve.kill(); await done; }
    for (let i = 0; i < 30; i++) { if (!Object.keys(status(['serve', 'status', '--json'])).length) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.fail('Serve mapping was not removed');
  });
  let configured = false;
  for (let i = 0; i < 30; i++) { const s = status(['serve', 'status', '--json']); if (s.TCP?.[external] || Object.values(s.Foreground || {}).some(entry => entry.TCP?.[external])) { configured = true; break; } await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(configured, 'foreground Serve mapping failed to start');
  const send = () => new Promise((resolve, reject) => {
    const req = https.request({ host: ip, port: external, servername: pair.hostname, method: 'POST', headers: { cookie: 'aion_session=synthetic', authorization: 'Bearer synthetic' }, timeout: 3000 }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end('synthetic-body');
  });
  assert.equal(await send(), 200);
  await new Promise(resolve => server.close(resolve));
  attacker = fork(new URL('./fixtures/tailscale-certificate-attacker.js', import.meta.url), [String(port)], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  assert.equal((await once(attacker, 'message'))[0].type, 'ready');
  const received = once(attacker, 'message');
  assert.equal(await send(), 200);
  assert.deepEqual((await received)[0], { type: 'received', cookie: true, authorization: true, body: true });
});
