import {
  getScreenStatus,
  getScreenSnapshot,
  sendScreenMouse,
  sendScreenClick,
  sendScreenKey,
  sendScreenHotkey,
} from '../services/screen-control.js';
import { readJsonBody, sendJson } from './router.js';

/**
 * Handles all interactive workstation screen control routes
 */
export async function handleScreenRoutes(req, res, urlPath) {
  if (urlPath === '/api/screen/status' && req.method === 'GET') {
    const status = getScreenStatus();
    return sendJson(res, 200, status);
  }

  if (urlPath === '/api/screen/snapshot' && req.method === 'GET') {
    const snapshot = await getScreenSnapshot();
    return sendJson(res, 200, snapshot);
  }

  if (urlPath === '/api/screen/mouse' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const result = await sendScreenMouse(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { status: 'error', error: err.message });
    }
  }

  if (urlPath === '/api/screen/click' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const result = await sendScreenClick(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { status: 'error', error: err.message });
    }
  }

  if (urlPath === '/api/screen/key' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const result = await sendScreenKey(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { status: 'error', error: err.message });
    }
  }

  if (urlPath === '/api/screen/hotkey' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const result = await sendScreenHotkey(body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { status: 'error', error: err.message });
    }
  }

  return false;
}
