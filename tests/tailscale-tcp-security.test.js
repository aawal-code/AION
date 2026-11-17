import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createPrivateKey, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import https from 'node:https';
import net from 'node:net';
import test from 'node:test';
import * as x509 from '@peculiar/x509';

// Opt-in: changes a foreground Serve mapping and requires an empty Serve config.
test('Master spec §1/§2: raw Serve TCP protects credentials against backend port takeover', { skip: process.env.AION_TEST_TAILSCALE_TCP !== '1', timeout: 20000 }, async t => {
  const cli = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  const read = args => JSON.parse(execFileSync(cli, args, { encoding: 'utf8', timeout: 3000, windowsHide: true }));
  assert.deepEqual(read(['serve', 'status', '--json']), {}, 'refuse to modify existing Serve configuration');
  const status = read(['status', '--json']);
  assert.equal(status.BackendState, 'Running');
  const ip = status.Self.TailscaleIPs.find(x => net.isIPv4(x));
  assert.ok(ip);
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({ name: 'CN=mobile-test.invalid', keys, signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 60000), extensions: [new x509.BasicConstraintsExtension(false, undefined, true), new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: 'mobile-test.invalid' }])] });
  const key = createPrivateKey({ key: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' });
  let target = https.createServer({ cert: cert.toString('pem'), key }, (req, res) => { req.resume(); res.end('verified'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const port = target.address().port, external = 32443;
  const child = spawn(cli, ['serve', '--tcp=' + external, 'tcp://127.0.0.1:' + port], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let error = ''; for (const output of [child.stdout, child.stderr]) output.on('data', chunk => { error += chunk.toString().slice(0, 1024); });
  t.after(async () => {
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    if (target.listening) await new Promise(resolve => target.close(resolve));
    for (let i = 0; i < 30; i++) { if (Object.keys(read(['serve', 'status', '--json'])).length === 0) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.fail('Foreground Serve mapping remained after process exit');
  });
  let configured = false;
  for (let i = 0; i < 30; i++) { if (child.exitCode !== null) break; const state = read(['serve', 'status', '--json']); if (state.TCP?.[external] || Object.values(state.Foreground || {}).some(entry => entry.TCP?.[external])) { configured = true; break; } await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(configured, `Serve did not start: ${error}`);
  const send = () => new Promise((resolve, reject) => { const request = https.request({ host: ip, port: external, servername: 'mobile-test.invalid', ca: cert.toString('pem'), method: 'POST', headers: { cookie: 'aion_session=synthetic-secret', authorization: 'Bearer synthetic-secret' }, timeout: 3000 }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('timeout', () => request.destroy(new Error('timeout'))); request.on('error', reject); request.end('synthetic-secret-body'); });
  assert.equal(await send(), 200);
  await new Promise(resolve => target.close(resolve));
  let received = Buffer.alloc(0);
  target = net.createServer(socket => socket.on('data', chunk => { received = Buffer.concat([received, chunk]); socket.destroy(); }));
  target.listen(port, '127.0.0.1'); await once(target, 'listening');
  await assert.rejects(send());
  assert.equal(received.includes(Buffer.from('synthetic-secret')), false);
  await new Promise(resolve => target.close(resolve));
  const otherKeys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const otherCert = await x509.X509CertificateGenerator.createSelfSigned({ name: 'CN=mobile-test.invalid', keys: otherKeys, signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 60000), extensions: [new x509.BasicConstraintsExtension(false, undefined, true), new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: 'mobile-test.invalid' }])] });
  const otherKey = createPrivateKey({ key: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', otherKeys.privateKey)), format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' });
  let requests = 0;
  target = https.createServer({ cert: otherCert.toString('pem'), key: otherKey }, (_req, res) => { requests++; res.end(); });
  target.listen(port, '127.0.0.1'); await once(target, 'listening');
  const failures = await Promise.allSettled(Array.from({ length: 4 }, send));
  assert.ok(failures.every(result => result.status === 'rejected'));
  assert.equal(requests, 0);
});
