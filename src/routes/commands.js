import { handleLocalCommand } from '../services/command-router.js';
import { logEvent } from '../services/sse.js';
import { isAuthenticated, validateToken, verifyPin } from '../services/auth.js';
import { spawnCliProcess } from '../services/execution-engine.js';

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
 * POST /api/commands/instant
 * Zero-AI deterministic instant router executing OS & media commands in <10ms
 */
export async function handleInstantCommand(req, res) {
  try {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, {
        status: 'error',
        error: 'Authentication required',
      });
    }

    const body = await readJsonBody(req, 64 * 1024);

    if (body.deviceId && body.deviceId !== 'local') {
      return sendJson(res, 400, {
        status: 'error',
        error: `Instant local command router only accepts 'local' device target, received: '${body.deviceId}'`,
      });
    }

    const prompt = body.prompt || body.command || body.text;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return sendJson(res, 400, {
        status: 'error',
        error: 'A non-empty prompt or command string is required',
      });
    }

    const options = {
      dryRun: Boolean(body.dryRun || process.env.AION_TEST_MODE === '1'),
    };

    const result = await handleLocalCommand(prompt, options);

    return sendJson(res, 200, {
      status: 'ok',
      ...result,
    });
  } catch (err) {
    logEvent('ERROR', `Instant command router error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return sendJson(res, statusCode, {
      status: 'error',
      error: err.message,
    });
  }
}

/**
 * POST /api/runner and POST /api/commands/runner
 * Executes commands in active workspace with authentication & streaming output
 */
export async function handleRunnerCommand(req, res) {
  logEvent('SECURITY', 'Deprecated runner endpoint rejected');
  return sendJson(res, 410, {
    status: 'disabled',
    error: 'Arbitrary command execution is disabled pending an approved, sandboxed task runner.',
  });
}

/**
 * Dispatcher for /api/commands/* routes handled by this module
 */
export async function handleCommandsRoutes(req, res, urlPath) {
  if (urlPath === '/api/commands/instant' && req.method === 'POST') {
    return handleInstantCommand(req, res);
  }

  if (urlPath === '/api/commands/runner' || urlPath === '/api/runner') {
    return handleRunnerCommand(req, res);
  }

  return false;
}
