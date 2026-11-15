import http from 'http';
import { handleRequest } from './routes/router.js';
import { logEvent, closeAllSseClients } from './services/sse.js';
import { loadConfig } from './services/config.js';
import { setResourcePolicy } from './services/telemetry.js';

const PORT = parseInt(process.env.PORT, 10) || 5050;
const HOST = process.env.AION_BIND_HOST || '127.0.0.1';
setResourcePolicy(loadConfig().resourcePolicy || 'balanced');

const server = http.createServer(handleRequest);

// Process-level unhandled rejection / exception guards to safeguard daemon longevity
process.on('uncaughtException', (err) => {
  logEvent('FATAL', `Uncaught exception: ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logEvent('FATAL', `Unhandled rejection: ${reason instanceof Error ? (reason.stack || reason.message) : reason}`);
});

// Graceful shutdown handling
function shutdown(signal) {
  logEvent('SYSTEM', `Received ${signal}, initiating graceful shutdown...`);
  closeAllSseClients();
  server.close(() => {
    logEvent('SYSTEM', 'AION Daemon stopped cleanly');
    process.exit(0);
  });
  // Force exit after 3 seconds if connections linger
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const app = server;

app.listen(PORT, HOST, () => {
  logEvent('SYSTEM', `AION Daemon online on port ${PORT}`);
  console.log(`\n>>> AION CORE ONLINE: http://${HOST}:${PORT}`);
});

export { server, app };
