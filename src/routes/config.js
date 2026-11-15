import { loadConfig, saveConfig } from '../services/config.js';

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify(data));
}

/**
 * GET /api/config
 * Returns full configuration snapshot
 */
export async function handleGetConfig(req, res) {
  try {
    const config = loadConfig();
    return sendJson(res, 200, { status: 'ok', config });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', error: err.message });
  }
}

/**
 * POST /api/config
 * Atomically updates and persists configuration
 */
export async function handlePostConfig(req, res) {
  try {
    let bodyStr = '';
    for await (const chunk of req) {
      bodyStr += chunk;
    }
    const body = bodyStr ? JSON.parse(bodyStr) : {};
    const updated = saveConfig(body);
    return sendJson(res, 200, { status: 'ok', config: updated });
  } catch (err) {
    return sendJson(res, 400, { status: 'error', error: err.message });
  }
}
