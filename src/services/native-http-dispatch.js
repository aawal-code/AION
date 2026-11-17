import crypto from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { handleRequest } from '../routes/router.js';
import { getIdentityStatus, issueDesktopBootstrap } from './identity-store.js';

// Only the native child entry point may expose this dispatcher over inherited
// process pipes. It never listens on a TCP or named network endpoint.
export const NATIVE_ORIGIN = 'https://aion-private.invalid';
let traceCount = 0;
const trace = (id, stage) => { if (process.env.AION_PRIVATE_IPC_DEV === '1' && typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) && traceCount++ < 2000) process.stderr.write(`AION_TRACE node ${process.hrtime.bigint()} ${id} ${stage}\n`); };
const MAX_ACTIVE = 8, MAX_BODY = 32 * 1024, MAX_READ = 24 * 1024, MAX_WRITE = 1024 * 1024;
const ALLOWED_HEADERS = new Set(['accept', 'content-type', 'cookie', 'origin', 'x-aion-csrf']);

function requestFrom(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid request');
  if (Object.keys(payload).some(k => !['method', 'path', 'headers', 'body'].includes(k))) throw new Error('Invalid request');
  const { method, path, headers = {}, body = '' } = payload;
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) || typeof path !== 'string' || path.length > 2048 || !path.startsWith('/api/') || path.startsWith('//') || path.includes('#')) throw new Error('Invalid request');
  const parsed = new URL(path, NATIVE_ORIGIN);
  if (parsed.origin !== NATIVE_ORIGIN || !parsed.pathname.startsWith('/api/') || parsed.pathname === '/api/auth/local-session') throw new Error('Invalid request');
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || typeof body !== 'string' || body.length > Math.ceil(MAX_BODY / 3) * 4) throw new Error('Invalid request');
  const raw = Buffer.from(body, 'base64');
  if (raw.length > MAX_BODY || raw.toString('base64') !== body) throw new Error('Invalid request');
  const clean = { host: 'aion-private.invalid' };
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!ALLOWED_HEADERS.has(lower) || Object.hasOwn(clean, lower) || typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value)) throw new Error('Invalid request');
    clean[lower] = value;
  }
  const req = Readable.from(raw.length ? [raw] : []);
  req.method = method; req.url = parsed.pathname + parsed.search; req.headers = clean; req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function responseStream() {
  const res = new PassThrough({ highWaterMark: 16 * 1024 });
  const headers = Object.create(null);
  let resolveHeaders;
  const ready = new Promise(resolve => { resolveHeaders = resolve; });
  res.statusCode = 200; res.headersSent = false;
  res.setHeader = (name, value) => { if (res.headersSent) throw new Error('Headers already sent'); headers[String(name).toLowerCase()] = value; };
  res.getHeader = name => headers[String(name).toLowerCase()];
  res.writeHead = (status, values = {}) => {
    if (res.headersSent || !Number.isInteger(status) || status < 100 || status > 599) throw new Error('Invalid response');
    res.statusCode = status;
    for (const [name, value] of Object.entries(values)) res.setHeader(name, value);
    res.headersSent = true; resolveHeaders(); return res;
  };
  const originalWrite = res.write.bind(res), originalEnd = res.end.bind(res);
  res.write = (chunk, ...args) => {
    if (!res.headersSent) res.writeHead(res.statusCode);
    if (Buffer.byteLength(chunk) > MAX_WRITE) { res.destroy(new Error('Response write limit exceeded')); return false; }
    return originalWrite(chunk, ...args);
  };
  res.end = (chunk, ...args) => {
    if (!res.headersSent) res.writeHead(res.statusCode);
    if (chunk != null && Buffer.byteLength(chunk) > MAX_WRITE) { res.destroy(new Error('Response write limit exceeded')); return res; }
    return chunk == null ? originalEnd(...args) : originalEnd(chunk, ...args);
  };
  const state = { failed: false };
  res.on('error', () => { state.failed = true; resolveHeaders(); });
  res.once('close', () => { if (!res.writableEnded) state.failed = true; resolveHeaders(); });
  return { res, headers, ready, state };
}

export function createNativeHttpDispatcher() {
  const active = new Map();
  let bootstrapped = false, closed = false;
  function finish(id) { const item = active.get(id); if (!item) return; clearTimeout(item.timer); active.delete(id); item.res.destroy(); }
  function touch(id) { const item = active.get(id); if (!item) return; clearTimeout(item.timer); item.timer = setTimeout(() => finish(id), 60000); item.timer.unref(); }
  function close() { closed = true; for (const id of active.keys()) finish(id); }

  async function dispatch(method, payload, signal, requestId) {
    trace(requestId, `received_${method.replace('.', '_')}`);
    if (closed || signal?.aborted) throw new Error('IPC unavailable');
    if (method === 'desktop.bootstrap') {
      if (bootstrapped || payload != null) throw new Error('Invalid bootstrap');
      bootstrapped = true;
      const state = await getIdentityStatus();
      if (state.initialized) return { initialized: true };
      const session = await issueDesktopBootstrap();
      return { initialized: false, bootstrap: session.token, csrf: crypto.randomBytes(32).toString('base64url') };
    }
    if (method === 'http.open') {
      if (!bootstrapped || active.size >= MAX_ACTIVE) throw new Error('IPC unavailable');
      const req = requestFrom(payload), item = responseStream(), id = requestId || crypto.randomUUID();
      if (active.has(id)) throw new Error('Duplicate response');
      req.aionTrace = stage => trace(requestId, stage);
      active.set(id, item); touch(id);
      const abort = () => finish(id); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const isProbe = process.env.AION_PRIVATE_IPC_DEV === '1' && process.env.AION_IPC_RESPONSE_PROBE === '1' && req.method === 'GET' && ['/api/_dev/response', '/api/_dev/stream', '/api/_dev/oversized', '/api/_dev/stalled', '/api/_dev/noheaders'].includes(req.url);
      Promise.resolve().then(async () => {
        if (!isProbe) return handleRequest(req, item.res, NATIVE_ORIGIN);
        if (req.url.endsWith('/noheaders')) return;
        item.res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        if (req.url.endsWith('/stalled')) { item.res.once('close', () => trace(requestId, 'probe_stalled_closed')); return; }
        if (req.url.endsWith('/oversized')) {
          const chunk = Buffer.alloc(16 * 1024, 120);
          for (let i = 0; i < 65 && !item.res.destroyed; i++) {
            if (!item.res.write(chunk)) await new Promise(resolve => { item.res.once('drain', resolve); item.res.once('close', resolve); });
          }
          if (!item.res.destroyed) item.res.end();
        } else if (req.url.endsWith('/stream')) item.res.write('{"probe":"fixed"}');
        else item.res.end('{"probe":"fixed"}');
      }).catch(() => {
        if (!item.res.headersSent && !item.res.destroyed) { item.res.writeHead(500, { 'content-type': 'application/json' }); item.res.end('{"status":"error","error":"Request failed"}'); }
        else item.res.destroy();
      });
      trace(requestId, 'router_started'); await item.ready; trace(requestId, `headers_${item.res.statusCode}`); await new Promise(resolve => setImmediate(resolve)); signal?.removeEventListener('abort', abort);
      if (signal?.aborted || !active.has(id) || item.res.destroyed) { finish(id); throw new Error('IPC unavailable'); }
      if (item.res.writableFinished && item.res.readableLength <= MAX_READ) {
        const buffered = item.res.readableLength ? item.res.read(item.res.readableLength) : null;
        const result = { id, status: item.res.statusCode, headers: item.headers, data: buffered ? Buffer.from(buffered).toString('base64') : '', done: true };
        finish(id); return result;
      }
      return { id, status: item.res.statusCode, headers: item.headers };
    }
    if (method === 'http.cancel') {
      if (!payload || typeof payload.id !== 'string' || Object.keys(payload).length !== 1) throw new Error('Invalid request');
      finish(payload.id); return { cancelled: true };
    }
    if (method === 'http.read') {
      if (!payload || typeof payload.id !== 'string' || Object.keys(payload).length !== 1) throw new Error('Invalid request');
      const item = active.get(payload.id); if (!item) throw new Error('Unknown response');
      touch(payload.id);
      if (!item.res.readableLength && !item.res.readableEnded && !item.res.destroyed) {
        await new Promise(resolve => {
          let timer;
          const done = () => { clearTimeout(timer); item.res.off('readable', done); item.res.off('end', done); item.res.off('close', done); signal?.removeEventListener('abort', done); resolve(); };
          item.res.once('readable', done); item.res.once('end', done); item.res.once('close', done); signal?.addEventListener('abort', done, { once: true }); timer = setTimeout(done, 750);
        });
      }
      if (signal?.aborted) { finish(payload.id); throw new Error('IPC unavailable'); }
      const chunk = item.res.readableLength ? item.res.read(Math.min(item.res.readableLength, MAX_READ)) : null;
      if (chunk) return { data: Buffer.from(chunk).toString('base64'), done: false };
      if (item.state.failed || (item.res.destroyed && !item.res.writableEnded)) { finish(payload.id); throw new Error('Response interrupted'); }
      if (item.res.readableEnded || item.res.destroyed) { finish(payload.id); return { data: '', done: true }; }
      return { data: '', done: false };
    }
    throw new Error('Unsupported operation');
  }
  return { dispatch, close };
}
