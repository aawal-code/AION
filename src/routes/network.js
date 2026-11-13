import { getMeshStatus } from '../services/network.js';
import { logEvent } from '../services/sse.js';

/**
 * Utility to send JSON response
 */
export function sendJson(res, statusCode, data) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * GET /api/network/mesh
 * Returns { connected: boolean, ipv4, ipv6, hostname }
 */
export async function handleGetMesh(req, res) {
  try {
    const mesh = await getMeshStatus();
    return sendJson(res, 200, {
      status: 'ok',
      connected: mesh.connected,
      ipv4: mesh.ipv4,
      ipv6: mesh.ipv6,
      hostname: mesh.hostname,
    });
  } catch (err) {
    logEvent('ERROR', `Network mesh query error: ${err.message}`);
    return sendJson(res, 500, {
      status: 'error',
      connected: false,
      ipv4: null,
      ipv6: null,
      hostname: null,
      error: err.message,
    });
  }
}

/**
 * Dispatcher for /api/network/* routes
 */
export async function handleNetworkRoutes(req, res, urlPath) {
  if (urlPath === '/api/network/mesh' && req.method === 'GET') {
    return handleGetMesh(req, res);
  }

  return false;
}
