import { getGroupedApps, killAppGroup } from '../services/process-manager.js';
import { getSystemTelemetry } from '../services/telemetry.js';
import { logEvent } from '../services/sse.js';

/**
 * Utility to read and parse JSON body with payload size guard
 */
export function readJsonBody(req, maxSize = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('error', (err) => reject(new Error(`Request stream error: ${err.message}`)));
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxSize) {
        req.destroy();
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const err = new Error('Invalid JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
  });
}

/**
 * Utility to send JSON response
 */
export function sendJson(res, statusCode, data) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * GET /api/system/apps
 * Returns clean grouped list of user-facing running applications
 */
export async function handleGetApps(req, res) {
  try {
    const apps = await getGroupedApps();
    return sendJson(res, 200, {
      status: 'ok',
      count: apps.length,
      apps,
    });
  } catch (err) {
    logEvent('ERROR', `Failed to fetch grouped apps: ${err.message}`);
    return sendJson(res, 500, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * POST /api/system/apps/kill
 * Accepts { app | name | executable } and terminates entire process tree instantly
 */
export async function handleKillApp(req, res) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const target = body.app || body.name || body.executable || body.target;

    if (!target || typeof target !== 'string' || !target.trim()) {
      return sendJson(res, 400, {
        status: 'error',
        error: 'Application name or executable identifier is required',
      });
    }

    const result = await killAppGroup(target.trim());
    const statusCode = result.success ? 200 : (result.notFound ? 404 : 400);

    return sendJson(res, statusCode, {
      status: result.success ? 'ok' : 'error',
      ...result,
    });
  } catch (err) {
    logEvent('ERROR', `Kill app failed: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return sendJson(res, statusCode, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * GET /api/system/telemetry
 * On-demand live CPU, RAM, and Disk I/O telemetry
 */
export async function handleGetTelemetry(req, res) {
  try {
    const telemetry = await getSystemTelemetry();
    return sendJson(res, 200, {
      status: 'ok',
      telemetry,
      cpu: telemetry.cpu,
      memory: telemetry.memory,
      disk: telemetry.disk,
      uptimeSeconds: telemetry.uptimeSeconds,
      timestamp: telemetry.timestamp,
    });
  } catch (err) {
    logEvent('ERROR', `System telemetry error: ${err.message}`);
    return sendJson(res, 500, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * Dispatcher for /api/system/* routes handled by this module
 */
export async function handleSystemRoutes(req, res, urlPath) {
  if (urlPath === '/api/system/apps' && req.method === 'GET') {
    return handleGetApps(req, res);
  }

  if (urlPath === '/api/system/apps/kill' && req.method === 'POST') {
    return handleKillApp(req, res);
  }

  if (urlPath === '/api/system/telemetry' && req.method === 'GET') {
    return handleGetTelemetry(req, res);
  }

  return false;
}
