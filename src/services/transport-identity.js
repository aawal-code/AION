import 'reflect-metadata';
import { createHash, createPrivateKey, webcrypto, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as x509 from '@peculiar/x509';
import { protectedData } from './vault.js';

const identityPath = () => process.env.AION_TRANSPORT_IDENTITY_PATH || path.resolve('data/transport-identity.dpapi');
let cached;
const fingerprint = (certificate) => createHash('sha256').update(certificate).digest('hex');

export async function getTransportIdentity(hostId = 'local') {
  if (cached) return cached;
  const file = identityPath(); fs.mkdirSync(path.dirname(file), { recursive: true });
  let record;
  try { if (fs.existsSync(file)) record = JSON.parse(protectedData(fs.readFileSync(file), true).toString('utf8')); } catch { throw new Error('Protected transport identity is unavailable; encrypted host transport is disabled'); }
  if (!record || Date.parse(record.notAfter) - Date.now() < 14 * 24 * 60 * 60_000) {
    if (process.platform !== 'win32') throw new Error('Protected transport identity is only available on Windows');
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const certificate = await x509.X509CertificateGenerator.createSelfSigned({ name: `CN=AION ${hostId}`, keys, signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 60_000), notAfter: new Date(Date.now() + 365 * 24 * 60 * 60_000), extensions: [new x509.BasicConstraintsExtension(false, undefined, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true)] });
    record = { certificate: certificate.toString('pem'), privateKey: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64'), notAfter: certificate.notAfter.toISOString() };
    const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, protectedData(Buffer.from(JSON.stringify(record)))); fs.renameSync(temp, file);
  }
  const certificate = record.certificate; const key = createPrivateKey({ key: Buffer.from(record.privateKey, 'base64'), format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' });
  const parsed = new X509Certificate(certificate); if (Date.parse(parsed.validTo) <= Date.now()) throw new Error('Transport certificate is expired');
  cached = { certificate, key, fingerprint: fingerprint(certificate), notAfter: parsed.validTo }; return cached;
}
export function resetTransportIdentityForTests() { cached = null; }
