// Isolated test backend. It opens no TCP listener and accepts one read-only
// operation over stdin. The synthetic Owner is authenticated using real AION
// Ed25519 challenge/session and capability checks.
import crypto from 'node:crypto';
import { enrollInitialOwner, createChallenge, authenticateChallenge, authorize, createDevice, revokeSession } from '../../../src/services/identity-store.js';
import { listAuthorizedIdentityDevices } from '../../../src/services/identity-api.js';
import { serveNativeIpc } from '../../../src/services/native-ipc-channel.js';
const keys = crypto.generateKeyPairSync('ed25519');
const owner = await enrollInitialOwner({ name: 'IPC synthetic owner', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) });
const challenge = await createChallenge(owner.deviceId);
const session = await authenticateChallenge({ challengeId: challenge.challengeId, signature: crypto.sign(null, Buffer.from(challenge.signingPayload), keys.privateKey).toString('base64url') });
// Exercise the same role and revocation boundary as the HTTP endpoint.
if (await listAuthorizedIdentityDevices('invalid-token')) throw new Error('Invalid session authorized');
const actor = await authorize(session.token, 'identity:manage');
const limitedKeys = crypto.generateKeyPairSync('ed25519');
const limited = await createDevice({ name: 'IPC limited fixture', role: 'limited', publicKey: limitedKeys.publicKey.export({ type: 'spki', format: 'pem' }) }, actor);
const limitedChallenge = await createChallenge(limited.id);
const limitedSession = await authenticateChallenge({ challengeId: limitedChallenge.challengeId, signature: crypto.sign(null, Buffer.from(limitedChallenge.signingPayload), limitedKeys.privateKey).toString('base64url') });
if (await listAuthorizedIdentityDevices(limitedSession.token)) throw new Error('Limited session authorized');
const secondChallenge = await createChallenge(owner.deviceId);
const secondSession = await authenticateChallenge({ challengeId: secondChallenge.challengeId, signature: crypto.sign(null, Buffer.from(secondChallenge.signingPayload), keys.privateKey).toString('base64url') });
await revokeSession(secondSession.sessionId, actor);
if (await listAuthorizedIdentityDevices(secondSession.token)) throw new Error('Revoked session authorized');
process.stdout.write('READY\n');
process.stdin.once('close', () => {
  if (process.env.AION_SLICE_KEEP_ON_DISCONNECT === '1') setInterval(() => {}, 1000);
});
serveNativeIpc(process.stdin, process.stdout, async (method, _payload, signal) => {
  if (method !== 'identity.devices' || signal.aborted) throw new Error('Unsupported operation');
  const devices = await listAuthorizedIdentityDevices(session.token);
  if (!devices || signal.aborted) throw new Error('Not authorized');
  return { status: 'ok', devices };
});
