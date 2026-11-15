import fs from 'fs';
import path from 'path';

const LOG_FILE = path.resolve('aion.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB rolling limit to enforce low disk/RAM footprint
const sseClients = new Set();

/**
 * Dispatches real-time log event to all connected SSE clients and appends to rolling log file
 */
export function logEvent(source, msg) {
  const line = `[${new Date().toISOString()}] [${source}] ${msg}\n`;

  for (const client of sseClients) {
    try {
      client.write(`data: ${JSON.stringify({ log: line })}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }

  fs.stat(LOG_FILE, (err, stats) => {
    if (!err && stats.size > MAX_LOG_SIZE) {
      const backupFile = `${LOG_FILE}.1`;
      fs.rename(LOG_FILE, backupFile, () => {
        fs.appendFile(LOG_FILE, line, () => {});
      });
    } else {
      fs.appendFile(LOG_FILE, line, () => {});
    }
  });
}

/**
 * Handles incoming SSE connections without external dependencies or polling
 */
export function handleSseConnection(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    if (fs.existsSync(LOG_FILE)) {
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      const lines = content.trim().split(/\r?\n/).slice(-25).join('\n') + '\n';
      if (lines.trim()) {
        res.write(`data: ${JSON.stringify({ log: lines })}\n\n`);
      }
    }
  } catch (err) {
    logEvent('ERROR', `Initial log read error: ${err.message}`);
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

export function getClientCount() {
  return sseClients.size;
}

export function closeAllSseClients() {
  for (const client of sseClients) {
    try {
      client.end();
    } catch {}
  }
  sseClients.clear();
}
