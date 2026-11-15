import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { X509Certificate, createHash } from 'node:crypto';
import { authorizeTransportPeer, isTransportPeerAuthorized, listApprovedTransportCertificates } from './identity-store.js';
import { applyInboundEvent, acknowledgeOutboundEvent, listOutboundEvents } from './replication-store.js';
import { getTransportIdentity } from './transport-identity.js';
import { applyFileEvent } from './file-sync.js';

const MAX_FRAME = 64 * 1024;
const AUTH_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 60_000;
const EXPORTER_LABEL = 'AION/TLS channel binding v1';
const EXPORTER_CONTEXT = Buffer.from('aion-host-transport-v1');
const fingerprint = (certificate) => createHash('sha256').update(new X509Certificate(certificate).raw).digest('hex');
const channelBinding = (socket) => socket.exportKeyingMaterial(32, EXPORTER_LABEL, EXPORTER_CONTEXT);

function fail(socket, message) { socket.destroy(new Error(message)); }
function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length > MAX_FRAME) throw new Error('Transport message exceeds the configured limit');
  const header = Buffer.allocUnsafe(4); header.writeUInt32BE(body.length); return Buffer.concat([header, body]);
}
function validateEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.eventId !== 'string' || event.eventId.length > 128 || typeof event.originHostId !== 'string' || event.originHostId.length > 128 || typeof event.recordId !== 'string' || event.recordId.length > 512 || typeof event.recordType !== 'string' || event.recordType.length > 128 || !Number.isInteger(event.revision) || event.revision < 1) throw new Error('Invalid replication event');
  if (Buffer.byteLength(JSON.stringify(event.payload ?? {})) > MAX_FRAME / 2) throw new Error('Replication payload exceeds the configured limit');
}

export class SecureConnection extends EventEmitter {
  constructor(socket, { localDeviceId, expectedPeerFingerprint = null }) {
    super(); this.socket = socket; this.localDeviceId = localDeviceId; this.expectedPeerFingerprint = expectedPeerFingerprint; this.context = null; this.pending = new Map(); this.header = Buffer.alloc(4); this.headerBytes = 0; this.body = null; this.bodyBytes = 0; this.writeQueue = Promise.resolve(); this.authenticated = false;
    socket.setTimeout(AUTH_TIMEOUT_MS, () => fail(socket, 'Transport authentication timed out'));
    socket.on('data', (chunk) => { socket.pause(); this.consume(chunk).then(() => { if (!socket.destroyed) socket.resume(); }, (error) => fail(socket, error.message)); });
    socket.on('error', (error) => this.rejectPending(error));
    socket.on('close', () => { this.rejectPending(new Error('Transport connection closed')); this.emit('close'); });
  }
  rejectPending(error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
  send(message) {
    const writing = this.writeQueue.then(() => this.writeMessage(message));
    this.writeQueue = writing.catch(() => {});
    return writing;
  }
  async writeMessage(message) {
    if (this.socket.destroyed) throw new Error('Transport connection is closed');
    if (this.socket.write(frame(message))) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => { this.socket.off('drain', onDrain); this.socket.off('error', onError); this.socket.off('close', onClose); };
      const onDrain = () => { cleanup(); resolve(); };
      const onError = (error) => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error('Transport connection closed')); };
      this.socket.once('drain', onDrain); this.socket.once('error', onError); this.socket.once('close', onClose);
      if (this.socket.destroyed) onClose();
    });
  }
  async sendAuth(identity) { await this.send({ type: 'auth', deviceId: this.localDeviceId, signature: identity.signChannel(channelBinding(this.socket)) }); }
  async consume(chunk) {
    let offset = 0;
    while (offset < chunk.length && !this.socket.destroyed) {
      if (!this.body) {
        const count = Math.min(4 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count); this.headerBytes += count; offset += count;
        if (this.headerBytes < 4) continue;
        const length = this.header.readUInt32BE(0); this.headerBytes = 0;
        if (!length || length > MAX_FRAME) throw new Error('Invalid transport frame size');
        this.body = Buffer.allocUnsafe(length); this.bodyBytes = 0;
      }
      const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
      chunk.copy(this.body, this.bodyBytes, offset, offset + count); this.bodyBytes += count; offset += count;
      if (this.bodyBytes !== this.body.length) continue;
      const body = this.body; this.body = null; this.bodyBytes = 0;
      let message; try { message = JSON.parse(body.toString('utf8')); } catch { throw new Error('Invalid transport JSON'); }
      await this.handle(message);
    }
  }
  async handle(message) {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid transport message');
    if (message.type === 'auth') {
      if (this.authenticated || typeof message.deviceId !== 'string' || typeof message.signature !== 'string') throw new Error('Invalid transport authentication');
      const peer = this.socket.getPeerCertificate(true); if (!peer?.raw) throw new Error('Peer certificate is unavailable');
      const certificate = new X509Certificate(peer.raw).toString();
      if (this.expectedPeerFingerprint && fingerprint(certificate) !== this.expectedPeerFingerprint) throw new Error('Peer certificate pin does not match');
      this.context = await authorizeTransportPeer({ deviceId: message.deviceId, certificate, exporter: channelBinding(this.socket), signature: message.signature });
      if (!this.context) throw new Error('Peer transport authorization failed');
      this.authenticated = true; this.socket.setTimeout(IDLE_TIMEOUT_MS, () => fail(this.socket, 'Idle transport connection timed out')); this.emit('authenticated', this.context); return;
    }
    if (!this.authenticated) throw new Error('Protected message received before authentication');
    // Re-authorize each protected operation so an already-open connection loses
    // access as soon as the device is revoked or its grants change.
    const peer = this.socket.getPeerCertificate(true); const certificate = new X509Certificate(peer.raw).toString();
    // The exporter-bound proof is verified at connection authentication. Each
    // protected frame rechecks persistent revocation and capability state.
    if (!await isTransportPeerAuthorized({ deviceId: this.context.deviceId, certificate })) throw new Error('Peer authorization was revoked');
    if (message.type === 'event') { validateEvent(message.event); const result = await applyInboundEvent(message.event); if (result.status === 'applied') await applyFileEvent(message.event); await this.send({ type: 'ack', eventId: message.event.eventId, status: result.status }); return; }
    if (message.type === 'ack') { const pending = this.pending.get(message.eventId); if (pending) { this.pending.delete(message.eventId); pending.resolve(message.status); } return; }
    throw new Error('Unsupported transport message');
  }
  async deliverPending() {
    if (!this.authenticated) throw new Error('Transport is not authenticated');
    const events = await listOutboundEvents(100);
    for (const event of events) {
      const status = await new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(event.eventId); reject(new Error('Replication acknowledgement timed out')); }, AUTH_TIMEOUT_MS); this.pending.set(event.eventId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } }); this.send({ type: 'event', event }).catch((error) => { const pending = this.pending.get(event.eventId); if (pending) { this.pending.delete(event.eventId); pending.reject(error); } }); });
      if (['applied', 'duplicate', 'conflict'].includes(status)) await acknowledgeOutboundEvent(event.eventId); else throw new Error('Invalid replication acknowledgement');
    }
    return events.length;
  }
  close() { this.socket.end(); }
}

async function authenticate(connection, identity) {
  const authenticated = new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); connection.off('authenticated', onAuthenticated); connection.off('close', onClose); };
    const onAuthenticated = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('Peer closed during authentication')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Peer authentication timed out')); }, AUTH_TIMEOUT_MS);
    connection.once('authenticated', onAuthenticated); connection.once('close', onClose);
  });
  await Promise.all([connection.sendAuth(identity), authenticated]);
  return connection;
}

export async function startHostTransport({ port = 0, localDeviceId, hostId = 'local', maxConnections = 8 } = {}) {
  if (!localDeviceId) throw new Error('A local approved device id is required');
  const identity = await getTransportIdentity(hostId); const trusted = await listApprovedTransportCertificates();
  if (!trusted.length) throw new Error('No Owner-approved peer certificates are available');
  const connections = new Set();
  const server = tls.createServer({ cert: identity.certificate, key: identity.key, ca: trusted, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }, async (socket) => {
    if (connections.size >= maxConnections) return fail(socket, 'Transport connection limit reached');
    const connection = new SecureConnection(socket, { localDeviceId }); connections.add(connection); connection.once('close', () => connections.delete(connection));
    try { await authenticate(connection, identity); } catch (error) { fail(socket, error.message); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: server.address().port, close: async () => { for (const connection of connections) connection.close(); await new Promise((resolve) => server.close(() => resolve())); } };
}

export async function connectHostTransport({ host = '127.0.0.1', port, localDeviceId, expectedPeerCertificate, hostId = 'local' } = {}) {
  if (!port || !localDeviceId || !expectedPeerCertificate) throw new Error('A peer port, local device id, and pinned peer certificate are required');
  const identity = await getTransportIdentity(hostId); const expected = fingerprint(expectedPeerCertificate);
  const socket = tls.connect({ host, port, cert: identity.certificate, key: identity.key, ca: [expectedPeerCertificate], rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', checkServerIdentity: (_hostname, cert) => fingerprint(new X509Certificate(cert.raw).toString()) === expected ? undefined : new Error('Peer certificate pin does not match') });
  await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
  const connection = new SecureConnection(socket, { localDeviceId, expectedPeerFingerprint: expected }); await authenticate(connection, identity); return connection;
}
