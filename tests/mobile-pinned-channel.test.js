import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import test from 'node:test';
import * as x509 from '@peculiar/x509';
import { connectMobileGateway } from '../src/services/mobile-pinned-channel.js';

async function identity() {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({ name: 'CN=AION test', keys, signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 60000), extensions: [new x509.BasicConstraintsExtension(false, undefined, true)] });
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  return { certificate: cert.toString('pem'), key: createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' }), fingerprint: createHash('sha256').update(Buffer.from(cert.rawData)).digest('hex') };
}
async function listen(server, port = 0) { server.listen(port, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function close(server) { await new Promise(resolve => server.close(resolve)); }

test('Master spec §1/§2: gateway replacement receives no authenticated application bytes', async () => {
  const trusted = await identity(), other = await identity();
  let received = '';
  const legitimate = tls.createServer({ key: trusted.key, cert: trusted.certificate }, socket => socket.on('data', data => { received += data; socket.end(); }));
  const port = await listen(legitimate);
  const options = { port, certificate: trusted.certificate, fingerprint: trusted.fingerprint };
  const channel = await connectMobileGateway(options);
  channel.end('Cookie: test-session\r\n'); await once(channel, 'close');
  assert.match(received, /test-session/);
  await close(legitimate);
  let leaked = false;
  const impostor = tls.createServer({ key: other.key, cert: other.certificate }, socket => socket.on('data', () => { leaked = true; }));
  await listen(impostor, port);
  await assert.rejects(connectMobileGateway(options));
  await close(impostor);
  assert.equal(leaked, false);
  let raw = Buffer.alloc(0);
  const plain = net.createServer(socket => { socket.on('data', data => { raw = Buffer.concat([raw, data]); socket.destroy(); }); });
  await listen(plain, port);
  await assert.rejects(connectMobileGateway(options));
  await close(plain);
  assert.equal(raw.includes(Buffer.from('test-session')), false);
});
