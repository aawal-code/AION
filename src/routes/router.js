import fs from 'fs';
import path from 'path';
import { handleSseConnection, logEvent } from '../services/sse.js';
import { sanitizeCommand, InvalidCommandError } from '../utils/sanitizer.js';
import { executeWorkstationCommand } from '../services/os.js';
import { executeAiPrompt } from '../services/ai-bridge.js';
import { getSyncStatus, addFolder, pairDevice } from '../services/syncthing.js';

function readJsonBody(req, maxSize = 1024 * 1024) {
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
      } catch (e) {
        const err = new Error('Invalid JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * Central HTTP request dispatcher matching routes cleanly
 */
export async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.writeHead(200).end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = parsedUrl.pathname;

  // 1. Live SSE Logs Stream
  if (urlPath === '/api/logs' && req.method === 'GET') {
    return handleSseConnection(req, res);
  }

  // 2. Hardware / OS Actions Dispatcher
  if (urlPath === '/api/command' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 64 * 1024);
      const { action, target } = sanitizeCommand(body.action, body.target);
      const result = await executeWorkstationCommand(action, target);
      return sendJson(res, 200, { status: 'ok', ...result });
    } catch (err) {
      if (err instanceof InvalidCommandError) {
        return sendJson(res, err.statusCode || 400, { status: 'error', error: err.message });
      }
      const statusCode = err.statusCode || 500;
      return sendJson(res, statusCode, { status: 'error', error: err.message });
    }
  }

  // 3. Antigravity AI Bridge
  if (urlPath === '/api/ai' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 1024 * 1024);
      const prompt = body?.prompt;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return sendJson(res, 400, {
          status: 'error',
          error: 'A non-empty "prompt" string is required',
        });
      }
      const result = await executeAiPrompt(prompt);
      return sendJson(res, 200, result);
    } catch (err) {
      const statusCode = err.statusCode || 400;
      return sendJson(res, statusCode, { status: 'error', error: err.message });
    }
  }

  // 4. Syncthing Peer Sync Management
  if (urlPath.startsWith('/api/sync')) {
    if (urlPath === '/api/sync/status' && req.method === 'GET') {
      try {
        const statusData = await getSyncStatus();
        return sendJson(res, 200, statusData);
      } catch (err) {
        logEvent('ERROR', `Syncthing status error: ${err.message}`);
        return sendJson(res, err.statusCode || 502, { status: 'error', error: err.message });
      }
    }

    if (urlPath === '/api/sync/folder' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const folderData = await addFolder(body);
        return sendJson(res, 200, folderData);
      } catch (err) {
        logEvent('ERROR', `Add folder failed: ${err.message}`);
        return sendJson(res, err.statusCode || 500, { status: 'error', error: err.message });
      }
    }

    if (urlPath === '/api/sync/device' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 256 * 1024);
        const deviceData = await pairDevice(body);
        return sendJson(res, 200, deviceData);
      } catch (err) {
        logEvent('ERROR', `Pair device failed: ${err.message}`);
        return sendJson(res, err.statusCode || 500, { status: 'error', error: err.message });
      }
    }

    return sendJson(res, 404, { status: 'error', error: 'Unknown sync endpoint' });
  }

  // 5. Client PWA Surface
  if ((urlPath === '/' || urlPath === '/index.html') && req.method === 'GET') {
    const indexPath = path.resolve('public', 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        return sendText(res, 404, 'PWA missing');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Fallthrough 404
  return sendJson(res, 404, { status: 'error', error: 'Not Found' });
}
