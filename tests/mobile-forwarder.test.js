import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, webcrypto } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import test from 'node:test';
import * as x509 from '@peculiar/x509';

async function identity() {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }, keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({ name: 'CN=test', keys, signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 60000), extensions: [new x509.BasicConstraintsExtension(false, undefined, true)] });
  return { certificate: cert.toString('pem'), key: createPrivateKey({ key: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' }), fingerprint: createHash('sha256').update(Buffer.from(cert.rawData)).digest('hex') };
}
async function listen(server, port = 0) { server.listen(port, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function close(server) { await new Promise(resolve => server.close(resolve)); }
function request(port, body = 'secret-body', headers = {}) { return new Promise((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port, path: '/mobile', method: 'POST', headers: { host: 'mobile.example', cookie: 'aion_session=secret-cookie', authorization: 'Bearer secret-token', ...headers } }, res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text })); }); req.on('error', reject); req.end(body); }); }

test('Master spec §1/§2: authenticated forwarding and replacement fail closed', async t => {
  const id = await identity(), other = await identity(); let seen = [];
  let gateway = http.createServer(); // HTTPS parser on an authenticated TLS server
  const createGateway = identity => {
    const server = tls.createServer({ key: identity.key, cert: identity.certificate }, socket => gateway.emit('connection', socket));
    return server;
  };
  gateway.on('request', (req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { seen.push({ body, headers: req.headers }); if (body === 'large-response') res.end('x'.repeat(1025)); else if (body === 'stall') return; else if (body === 'crash') req.socket.destroy(); else res.end('ok'); }); });
  let listener = createGateway(id); const port = await listen(listener);
  const child = fork(new URL('./fixtures/mobile-forwarder-process.js', import.meta.url), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { child.kill(); listener.close(); gateway.close(); });
  child.send({ type: 'start', options: { gateway: { port, certificate: id.certificate, fingerprint: id.fingerprint }, expectedHost: 'mobile.example', allowedPaths: ['/mobile'], maxBody: 128, maxResponse: 1024, deadlineMs: 500 } });
  const [ready] = await once(child, 'message'); assert.equal(ready.type, 'ready');
  assert.deepEqual(await request(ready.port), { status: 200, text: 'ok' });
  assert.equal(seen[0].body, 'secret-body'); assert.equal(seen[0].headers.cookie, 'aion_session=secret-cookie');
  assert.equal((await request(ready.port, 'x'.repeat(129))).status, 413);
  assert.equal((await request(ready.port, 'x', { cookie: 'aion_bootstrap=secret' })).status, 400);
  assert.equal((await request(ready.port, 'large-response')).status, 502);
  assert.equal((await request(ready.port, 'crash')).status, 502);
  assert.equal((await request(ready.port, 'stall')).status, 504);
  await close(listener); seen = []; listener = createGateway(other); await listen(listener, port);
  assert.equal((await request(ready.port)).status, 502); assert.equal(seen.length, 0);
  await close(listener);
  let bytes = Buffer.alloc(0);
  listener = net.createServer(socket => socket.on('data', data => { bytes = Buffer.concat([bytes, data]); socket.destroy(); })); await listen(listener, port);
  assert.equal((await request(ready.port)).status, 502);
  for (const secret of ['secret-body', 'secret-cookie', 'secret-token']) assert.equal(bytes.includes(Buffer.from(secret)), false);
  await close(listener); listener = createGateway(id); await listen(listener, port);
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => request(ready.port))); assert.ok(concurrent.every(r => r.status === 200));
  child.send({ type: 'stop' }); await once(child, 'exit'); await assert.rejects(request(ready.port));
});
