import crypto from 'node:crypto';
import { extractToken, isLocalhost, verifyLocalAuthSecret } from '../services/auth.js';
import {
  authenticateChallenge, authorize, createChallenge, createDevice, enrollInitialOwner,
  getDesktopBootstrapContext, getIdentityStatus, issueDesktopBootstrap, listAuditEvents,
  listDevices, listPairingInvitations, listSessions, recoverOwner, revokeDevice, revokeSession, rotateRecoveryKey,
  createPairingInvitation, claimPairingInvitation, approvePairingInvitation, getPairingInvitationStatus,
} from '../services/identity-store.js';

export function readJsonBody(req, maxSize = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('error', (error) => reject(new Error(`Request stream error: ${error.message}`)));
    req.on('data', (chunk) => { body += chunk; if (body.length > maxSize) { req.destroy(); reject(Object.assign(new Error('Payload too large'), { statusCode: 413 })); } });
    req.on('end', () => { if (!body.trim()) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 })); } });
  });
}
export function sendJson(res, statusCode, data) { if (!res.writableEnded) { res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } }
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
const csrfCookie = (value, maxAge) => `aion_csrf=${encodeURIComponent(value)}; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
const clearCookie = (name) => `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export function getCookie(req, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(req.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
export function verifyCsrf(req) {
  const cookieValue = getCookie(req, 'aion_csrf'); const headerValue = req.headers?.['x-aion-csrf'];
  if (!cookieValue || typeof headerValue !== 'string') return false;
  const left = Buffer.from(cookieValue), right = Buffer.from(headerValue);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
async function identityContext(req, capability) { return authorize(extractToken(req), capability); }
async function bootstrapContext(req) { return getDesktopBootstrapContext(getCookie(req, 'aion_bootstrap')); }
function error(res, err) { return sendJson(res, err.statusCode || 400, { status: 'error', error: err.message || 'Security operation failed' }); }

async function localSession(req, res) {
  const host = String(req.headers.host || '');
  const proxied = Object.keys(req.headers).some((name) => name === 'forwarded' || name.startsWith('x-forwarded-') || name.startsWith('tailscale-user-'));
  if (proxied || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return sendJson(res, 401, { status: 'error', error: 'Native desktop enrollment requires a direct loopback request' });
  if (!isLocalhost(req) || !verifyLocalAuthSecret(req)) return sendJson(res, 401, { status: 'error', error: 'Verified native desktop authentication required' });
  try {
    const session = await issueDesktopBootstrap(); const csrf = crypto.randomBytes(32).toString('base64url');
    res.setHeader('Set-Cookie', [cookie('aion_bootstrap', session.token, 300), csrfCookie(csrf, 300)]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><meta charset="utf-8"><script>location.replace("/")</script>');
  } catch (err) { error(res, err); }
}
async function authenticate(req, res) {
  try {
    const result = await authenticateChallenge(await readJsonBody(req)); const csrf = crypto.randomBytes(32).toString('base64url');
    res.setHeader('Set-Cookie', [cookie('aion_session', result.token, 20 * 60), csrfCookie(csrf, 20 * 60), clearCookie('aion_bootstrap')]);
    return sendJson(res, 200, { status: 'ok', deviceId: result.deviceId, role: result.role, expiresAt: result.expiresAt });
  } catch (err) { return error(res, err); }
}
async function protectedAction(req, res, action) {
  try {
    const body = await readJsonBody(req);
    if (action === 'enroll-owner') {
      if (!(await bootstrapContext(req))) return sendJson(res, 401, { status: 'error', error: 'Native desktop enrollment session required' });
      return sendJson(res, 201, { status: 'ok', ...(await enrollInitialOwner(body)) });
    }
    if (action === 'recover-owner') {
      if (!(await bootstrapContext(req))) return sendJson(res, 401, { status: 'error', error: 'Native desktop recovery session required' });
      return sendJson(res, 200, { status: 'ok', ...(await recoverOwner(body)) });
    }
    const actor = await identityContext(req, 'identity:manage');
    if (!actor) return sendJson(res, 403, { status: 'error', error: 'Owner authorization required' });
    if (action === 'enroll-device') return sendJson(res, 201, { status: 'ok', ...(await createDevice(body, actor)) });
    if (action === 'rotate-recovery') return sendJson(res, 200, { status: 'ok', ...(await rotateRecoveryKey(actor)) });
    if (action === 'revoke-session') { await revokeSession(body.sessionId, actor); return sendJson(res, 200, { status: 'ok' }); }
  } catch (err) { return error(res, err); }
}

export async function handleAuthRoutes(req, res, urlPath) {
  if (urlPath === '/api/auth/local-session' && req.method === 'GET') return localSession(req, res);
  if (urlPath === '/api/auth/status' && req.method === 'GET') {
    try { const state = await getIdentityStatus(); const context = await identityContext(req, 'devices:read'); return sendJson(res, 200, { status: 'ok', ...state, authenticated: Boolean(context), role: context?.role || null, deviceId: context?.deviceId || null }); } catch (err) { return error(res, err); }
  }
  if (urlPath === '/api/auth/challenge' && req.method === 'POST') { try { return sendJson(res, 200, { status: 'ok', ...(await createChallenge((await readJsonBody(req)).deviceId)) }); } catch (err) { return error(res, err); } }
  if (urlPath === '/api/auth/authenticate' && req.method === 'POST') return authenticate(req, res);
  if (urlPath === '/api/auth/pairing/claim' && req.method === 'POST') { try { return sendJson(res, 202, { status: 'ok', ...(await claimPairingInvitation(await readJsonBody(req))) }); } catch (err) { return error(res, err); } }
  const pairingStatus = urlPath.match(/^\/api\/auth\/pairing\/([^/]+)\/status$/);
  if (pairingStatus && req.method === 'GET') { try { return sendJson(res, 200, { status: 'ok', ...(await getPairingInvitationStatus(decodeURIComponent(pairingStatus[1]))) }); } catch (err) { return error(res, err); } }
  if (urlPath === '/api/auth/pairing/invitations' && req.method === 'POST') { const actor = await identityContext(req, 'identity:manage'); if (!actor) return sendJson(res, 403, { status: 'error', error: 'Owner authorization required' }); try { return sendJson(res, 201, { status: 'ok', ...(await createPairingInvitation(actor)) }); } catch (err) { return error(res, err); } }
  if (urlPath === '/api/auth/pairing/invitations' && req.method === 'GET') { const actor = await identityContext(req, 'identity:manage'); return actor ? sendJson(res, 200, { status: 'ok', invitations: await listPairingInvitations() }) : sendJson(res, 403, { status: 'error', error: 'Owner authorization required' }); }
  const pairingApproval = urlPath.match(/^\/api\/auth\/pairing\/([^/]+)\/approve$/);
  if (pairingApproval && req.method === 'POST') { const actor = await identityContext(req, 'identity:manage'); if (!actor) return sendJson(res, 403, { status: 'error', error: 'Owner authorization required' }); try { return sendJson(res, 201, { status: 'ok', ...(await approvePairingInvitation({ ...(await readJsonBody(req)), invitationId: decodeURIComponent(pairingApproval[1]) }, actor)) }); } catch (err) { return error(res, err); } }
  if (urlPath === '/api/auth/enroll-owner' && req.method === 'POST') return protectedAction(req, res, 'enroll-owner');
  if (urlPath === '/api/auth/recover-owner' && req.method === 'POST') return protectedAction(req, res, 'recover-owner');
  if (urlPath === '/api/auth/enroll-device' && req.method === 'POST') return protectedAction(req, res, 'enroll-device');
  if (urlPath === '/api/auth/recovery/rotate' && req.method === 'POST') return protectedAction(req, res, 'rotate-recovery');
  if (urlPath === '/api/auth/sessions/revoke' && req.method === 'POST') return protectedAction(req, res, 'revoke-session');
  if (urlPath === '/api/auth/devices' && req.method === 'GET') { const actor = await identityContext(req, 'identity:manage'); return actor ? sendJson(res, 200, { status: 'ok', devices: await listDevices() }) : sendJson(res, 403, { status: 'error', error: 'Owner authorization required' }); }
  if (urlPath === '/api/auth/sessions' && req.method === 'GET') { const actor = await identityContext(req, 'identity:manage'); return actor ? sendJson(res, 200, { status: 'ok', sessions: await listSessions() }) : sendJson(res, 403, { status: 'error', error: 'Owner authorization required' }); }
  if (urlPath === '/api/auth/audit' && req.method === 'GET') { const actor = await identityContext(req, 'identity:manage'); return actor ? sendJson(res, 200, { status: 'ok', events: await listAuditEvents() }) : sendJson(res, 403, { status: 'error', error: 'Owner authorization required' }); }
  const revoke = urlPath.match(/^\/api\/auth\/devices\/([^/]+)$/);
  if (revoke && req.method === 'DELETE') { const actor = await identityContext(req, 'identity:manage'); if (!actor) return sendJson(res, 403, { status: 'error', error: 'Owner authorization required' }); try { await revokeDevice(decodeURIComponent(revoke[1]), actor); return sendJson(res, 200, { status: 'ok' }); } catch (err) { return error(res, err); } }
  return false;
}
