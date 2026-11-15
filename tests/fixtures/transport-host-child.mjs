import crypto from 'node:crypto';
import { enrollInitialOwner, createPairingInvitation, claimPairingInvitation, approvePairingInvitation, revokeDevice } from '../../src/services/identity-store.js';
import { getTransportIdentity } from '../../src/services/transport-identity.js';
import { startHostTransport, connectHostTransport } from '../../src/services/host-transport.js';
import { createReplicationEvent, listOutboundEvents, listRecordHeads, listRecordHistory } from '../../src/services/replication-store.js';

let owner; let identity; let listener; let connection;
function ownerKey() { return crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }); }
async function command(message) {
  if (message.type === 'init') { identity = await getTransportIdentity(message.name); owner = await enrollInitialOwner({ name: `${message.name} owner`, publicKey: ownerKey() }); return { certificate: identity.certificate, publicKey: identity.devicePublicKey, binding: identity.signCertificateBinding(), owner }; }
  if (message.type === 'pair') { const invitation = await createPairingInvitation(owner); await claimPairingInvitation({ invitationId: invitation.invitationId, name: message.peerName, publicKey: message.publicKey, transportCertificate: message.certificate, transportBindingSignature: message.binding }); return approvePairingInvitation({ invitationId: invitation.invitationId, verificationCode: invitation.verificationCode, role: 'trusted', capabilities: ['sync:replicate'] }, owner); }
  if (message.type === 'start') { listener = await startHostTransport({ port: 0, localDeviceId: message.localDeviceId, hostId: message.name }); return { port: listener.port }; }
  if (message.type === 'event') return createReplicationEvent(message.event);
  if (message.type === 'deliver') { connection = await connectHostTransport({ port: message.port, localDeviceId: message.localDeviceId, expectedPeerCertificate: message.certificate, hostId: message.name }); const delivered = await connection.deliverPending(); connection.close(); connection = null; return { delivered }; }
  if (message.type === 'pending') return { count: (await listOutboundEvents()).length };
  if (message.type === 'heads') return listRecordHeads();
  if (message.type === 'history') return listRecordHistory(message.recordId);
  if (message.type === 'revoke') { await revokeDevice(message.deviceId, owner); return { revoked: true }; }
  if (message.type === 'stop') { connection?.close(); await listener?.close(); return { stopped: true }; }
  throw new Error('Unknown fixture command');
}
process.on('message', async (message) => { try { process.send({ id: message.id, result: await command(message) }); } catch (error) { process.send({ id: message.id, error: error.message }); } });
