import https from 'node:https';
import crypto from 'node:crypto';
import { handleRequest } from '../routes/router.js';
import { readJsonBody, sendJson } from '../routes/auth.js';
import { authenticateChallenge, createBrowserChallenge, claimBrowserPairingInvitation, getBrowserPairingChallenge, getBrowserPairingStatus } from './identity-store.js';
import { getMobileTailscaleCertificate } from './mobile-tailscale-certificate.js';

// This listener is not started automatically. Serve must not point at it until
// lifecycle ownership, origin and end-to-end checks have succeeded.
export async function startMobileGateway({ certificateProvider = getMobileTailscaleCertificate, port = 0, externalPort = 443 } = {}) {
  const initial = await certificateProvider();
  if (!initial.hostname || !initial.cert || !initial.key || !Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(externalPort) || externalPort < 1 || externalPort > 65535) throw new Error('Invalid mobile gateway configuration');
  const host = initial.hostname, authority = externalPort === 443 ? host : `${host}:${externalPort}`, origin = `https://${authority}`;
  let closed = false, attempts = 0, windowStart = Date.now();
  const sockets = new Set();
  const server = https.createServer({ cert: initial.cert, key: initial.key, minVersion: 'TLSv1.2', maxHeaderSize: 16384, headersTimeout: 10000, requestTimeout: 15000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status, error) => sendJson(res, status, { status: 'error', error });
    try {
      if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== origin) || req.url.length > 2048 || !req.url.startsWith('/') || req.url.startsWith('//') || req.headers.upgrade || req.headers['transfer-encoding'] || (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > 65536))) return fail(400, 'Invalid request');
      const url = new URL(req.url, origin), pathname = url.pathname;
      const pairing = ['/api/mobile/pairing/challenge', '/api/mobile/pairing/claim', '/api/mobile/pairing/status'];
      const login = ['/api/auth/challenge', '/api/auth/authenticate'];
      if (pairing.includes(pathname) || login.includes(pathname)) {
        if (req.method !== 'POST' || req.headers.origin !== origin || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return fail(403, 'Same-origin JSON request required');
        if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); attempts = 0; }
        if (++attempts > 120) return fail(429, 'Too many requests');
        const body = await readJsonBody(req, 16384);
        if (pathname === '/api/auth/challenge') return sendJson(res, 200, { status: 'ok', ...(await createBrowserChallenge(body.deviceId)) });
        if (pathname === '/api/auth/authenticate') {
          const result = await authenticateChallenge(body, { browserOnly: true }), csrf = crypto.randomBytes(32).toString('base64url');
          res.setHeader('Set-Cookie', [`aion_session=${result.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1200`, `aion_csrf=${csrf}; Secure; SameSite=Strict; Path=/; Max-Age=1200`]);
          return sendJson(res, 200, { status: 'ok', deviceId: result.deviceId, role: result.role, expiresAt: result.expiresAt });
        }
        if (pathname.endsWith('/challenge')) return sendJson(res, 200, { status: 'ok', ...(await getBrowserPairingChallenge(body.invitationId, host)) });
        if (pathname.endsWith('/claim')) return sendJson(res, 202, { status: 'ok', ...(await claimBrowserPairingInvitation({ ...body, hostname: host })) });
        return sendJson(res, 200, { ...(await getBrowserPairingStatus({ ...body, hostname: host })) });
      }
      const safeApi = (pathname === '/api/assistant/projects' && req.method === 'GET') || (/^\/api\/assistant\/projects\/[a-zA-Z0-9_-]+\/sessions$/.test(pathname) && req.method === 'GET') || (pathname === '/api/assistant/sessions' && req.method === 'POST') || (/^\/api\/assistant\/sessions\/[a-zA-Z0-9_-]+\/messages$/.test(pathname) && req.method === 'GET') || (pathname === '/api/assistant/chat/stream' && req.method === 'POST') || (pathname === '/api/devices' && req.method === 'GET');
      if (!safeApi) return fail(404, 'Not available');
      return await handleRequest(req, res, origin);
    } catch { return fail(400, 'Request rejected'); }
  });
  server.maxConnections = 32;
  server.on('connection', socket => { sockets.add(socket); socket.setTimeout(30000, () => socket.destroy()); socket.once('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('connect', (_req, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  let expiry = Date.parse(initial.expiresAt);
  const renewal = setInterval(async () => {
    if (closed) return;
    try { const next = await certificateProvider(); if (next.hostname !== host || Date.parse(next.expiresAt) <= Date.now()) throw new Error('Certificate changed host or expired'); server.setSecureContext({ key: next.key, cert: next.cert, minVersion: 'TLSv1.2' }); expiry = Date.parse(next.expiresAt); }
    catch { if (!Number.isFinite(expiry) || expiry <= Date.now() + 3600000) void close(); }
  }, 12 * 60 * 60 * 1000); renewal.unref();
  async function close() { if (closed) return; closed = true; clearInterval(renewal); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
  return { host, port: server.address().port, close };
}
