import http from 'node:http';
import { connectMobileGateway } from './mobile-pinned-channel.js';

// This boundary is not an authorization layer. Routes must still authenticate
// the device and enforce capabilities at the gateway.
export async function startMobileForwarder({ gateway, expectedHost, allowedPaths, maxBody = 65536, maxResponse = 1048576, deadlineMs = 10000, maxConcurrent = 16 }) {
  if (!gateway || !/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(expectedHost || '') || !Array.isArray(allowedPaths) || !allowedPaths.length || allowedPaths.some(p => !/^\/[a-zA-Z0-9/_-]+$/.test(p) || p.startsWith('/api/auth/local-session')) || !Number.isInteger(maxBody) || maxBody < 1 || maxBody > 1048576 || !Number.isInteger(maxResponse) || maxResponse < 1 || maxResponse > 4194304 || !Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 30000 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 64) throw new Error('Invalid mobile forwarder configuration');
  let active = 0, closing = false;
  const sockets = new Set(), backends = new Set();
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: deadlineMs, headersTimeout: deadlineMs }, async (req, res) => {
    const fail = code => { if (!res.headersSent) res.writeHead(code, { 'cache-control': 'no-store', connection: 'close' }); if (!res.writableEnded) res.end(); };
    if (closing || active >= maxConcurrent) return fail(503);
    active++;
    let backend, timer, expired = false;
    try {
      const names = req.rawHeaders.filter((_, i) => i % 2 === 0).map(x => x.toLowerCase());
      const url = new URL(req.url, 'http://local.invalid');
      if (req.headers.host !== expectedHost || !req.url.startsWith('/') || req.url.startsWith('//') || !allowedPaths.includes(url.pathname) || url.pathname !== req.url.split('?')[0] || names.some((n, i) => names.indexOf(n) !== i) || req.headers['transfer-encoding'] || req.headers.upgrade || req.headers.expect || req.headers['x-aion-local-secret'] || /(?:^|;\s*)aion_bootstrap=/i.test(req.headers.cookie || '') || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return fail(400);
      const declared = req.headers['content-length'];
      if (declared && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maxBody)) return fail(413);
      timer = setTimeout(() => { expired = true; if (backend) backend.destroy(); fail(504); req.destroy(); }, deadlineMs);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > maxBody) return fail(413); chunks.push(chunk); }
      if (closing) return fail(503);
      backend = await connectMobileGateway(gateway);
      if (closing || expired || res.destroyed) { backend.destroy(); return fail(503); }
      backends.add(backend);
      const headers = {};
      for (const name of ['accept', 'accept-language', 'authorization', 'content-type', 'cookie', 'origin', 'referer', 'user-agent', 'x-aion-csrf']) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
      headers.host = expectedHost; headers.connection = 'close'; headers['content-length'] = String(size);
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => backend;
      await new Promise(resolve => {
        const upstream = http.request({ host: '127.0.0.1', port: gateway.port, method: req.method, path: req.url, headers, agent }, response => {
          let count = 0; const output = [];
          response.on('data', chunk => { count += chunk.length; if (count > maxResponse) { response.destroy(); fail(502); } else output.push(chunk); });
          response.on('end', () => { if (!res.writableEnded) { const safe = {}; for (const name of ['content-type', 'cache-control', 'set-cookie', 'location', 'content-security-policy', 'x-content-type-options']) if (response.headers[name] !== undefined) safe[name] = response.headers[name]; res.writeHead(response.statusCode, safe); res.end(Buffer.concat(output)); } resolve(); });
          response.on('error', () => { fail(502); resolve(); });
          response.on('close', () => { if (!response.complete) { fail(502); resolve(); } });
        });
        upstream.on('error', () => { fail(502); resolve(); });
        upstream.end(Buffer.concat(chunks));
      });
    } catch { fail(502); }
    finally { clearTimeout(timer); if (backend) { backends.delete(backend); backend.destroy(); } active--; }
  });
  server.on('connection', socket => { sockets.add(socket); socket.setTimeout(deadlineMs, () => socket.destroy()); socket.on('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('checkContinue', (_req, res) => { res.writeHead(417, { connection: 'close' }); res.end(); });
  server.on('checkExpectation', (_req, res) => { res.writeHead(417, { connection: 'close' }); res.end(); });
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('connect', (_req, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  return { port: server.address().port, async close() { if (closing) return; closing = true; for (const socket of sockets) socket.destroy(); for (const socket of backends) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
