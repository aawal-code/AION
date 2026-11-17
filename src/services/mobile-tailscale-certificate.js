import { execFile } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import path from 'node:path';
import { getMeshStatus } from './network.js';

// The Tailscale daemon owns its certificate storage. AION reads the pair into
// memory through an inherited pipe and never writes the private key to disk.
export function parseTailscaleCertificatePair(output, hostname, minimumValidityMs = 0) {
  if (typeof output !== 'string' || output.length > 131072 || typeof hostname !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+\.ts\.net$/i.test(hostname)) throw new Error('Invalid Tailscale certificate response');
  const blocks = output.match(/-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g) || [];
  const certificates = blocks.filter(block => block.startsWith('-----BEGIN CERTIFICATE-----'));
  const keys = blocks.filter(block => /^-----BEGIN (?:PRIVATE KEY|EC PRIVATE KEY|RSA PRIVATE KEY)-----/.test(block));
  if (!certificates.length || keys.length !== 1 || certificates.length + keys.length !== blocks.length || output.replace(/-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g, '').trim()) throw new Error('Invalid Tailscale certificate response');
  try {
    const certificate = new X509Certificate(certificates[0]), key = createPrivateKey(keys[0]);
    if (!certificate.checkHost(hostname, { subject: 'never' }) || !certificate.checkPrivateKey(key) || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now() + minimumValidityMs) throw new Error();
    return { cert: certificates.join('\n') + '\n', key: keys[0] + '\n', expiresAt: new Date(certificate.validTo).toISOString() };
  } catch { throw new Error('Tailscale certificate identity or validity check failed'); }
}

export async function getMobileTailscaleCertificate() {
  const mesh = await getMeshStatus();
  const hostname = mesh.dnsName?.toLowerCase();
  if (!mesh.connected || !hostname || !mesh.certDomains?.some(domain => domain.toLowerCase() === hostname)) throw new Error('Tailscale is disconnected or HTTPS is unavailable for this host');
  const cli = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe') : 'tailscale';
  const output = await new Promise((resolve, reject) => execFile(cli, ['cert', '--cert-file=-', '--key-file=-', '--min-validity=168h', hostname], { timeout: 60000, maxBuffer: 131072, windowsHide: true, encoding: 'utf8' }, (err, stdout) => err ? reject(new Error('Tailscale could not provide a current HTTPS certificate')) : resolve(stdout)));
  return { hostname, ...parseTailscaleCertificatePair(output, hostname, 7 * 24 * 60 * 60 * 1000) };
}
