import { createHash, timingSafeEqual } from 'node:crypto';
import tls from 'node:tls';

// The caller must obtain this certificate through an authenticated, instance-bound
// channel. No application bytes may be written before this promise resolves.
export function connectMobileGateway({ port, certificate, fingerprint, timeoutMs = 3000 }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof certificate !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint || '') || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new Error('Invalid gateway identity or connection parameters');
  }
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, ca: certificate, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', checkServerIdentity: (_host, peer) => {
      if (!peer.raw) return new Error('Gateway certificate missing');
      const actual = createHash('sha256').update(peer.raw).digest();
      return timingSafeEqual(actual, Buffer.from(fingerprint, 'hex')) ? undefined : new Error('Gateway certificate pin mismatch');
    } });
    let settled = false;
    const timer = setTimeout(() => fail(new Error('Gateway connection timed out')), timeoutMs);
    const fail = error => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); reject(error); };
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      if (!socket.authorized) return fail(new Error('Gateway identity was not verified'));
      settled = true; clearTimeout(timer); socket.removeListener('error', fail); resolve(socket);
    });
  });
}
