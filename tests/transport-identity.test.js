import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const port = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const value=s.address().port; s.close(() => resolve(value)); }); s.on('error', reject); });
test('Master spec §1/§2: independent DPAPI identities communicate only over mutually authenticated TLS', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aion-tls-'));
  try {
    process.env.AION_TRANSPORT_IDENTITY_PATH = path.join(dir, 'server.dpapi'); const serverModule = await import(`../src/services/transport-identity.js?server=${Date.now()}`); const serverIdentity = await serverModule.getTransportIdentity('server');
    process.env.AION_TRANSPORT_IDENTITY_PATH = path.join(dir, 'client.dpapi'); const clientModule = await import(`../src/services/transport-identity.js?client=${Date.now()}`); const clientIdentity = await clientModule.getTransportIdentity('client');
    assert.notEqual(serverIdentity.fingerprint, clientIdentity.fingerprint); const listenPort = await port();
    const server = tls.createServer({ cert: serverIdentity.certificate, key: serverIdentity.key, ca: [clientIdentity.certificate], requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3' }, socket => socket.end('secure'));
    await new Promise(resolve => server.listen(listenPort, '127.0.0.1', resolve));
    const value = await new Promise((resolve, reject) => { let text=''; const socket=tls.connect({ port:listenPort, host:'127.0.0.1', cert:clientIdentity.certificate, key:clientIdentity.key, ca:[serverIdentity.certificate], rejectUnauthorized:true, minVersion:'TLSv1.3', checkServerIdentity: () => undefined }); socket.on('secureConnect', () => assert.ok(socket.authorized)); socket.on('data', chunk => { text += chunk; }); socket.on('end', () => resolve(text)); socket.on('error', reject); });
    assert.equal(value, 'secure'); await new Promise(resolve => server.close(resolve)); serverModule.resetTransportIdentityForTests(); clientModule.resetTransportIdentityForTests();
  } finally { await rm(dir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }); }
});
