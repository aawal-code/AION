import http from 'http';
import v8 from 'v8';
import vm from 'vm';
import { handleRequest } from './routes/router.js';
import { logEvent, closeAllSseClients } from './services/sse.js';

// Enforce strict memory constraints (<50MB RAM combined)
v8.setFlagsFromString('--optimize-for-size --max-old-space-size=32 --expose_gc');
const runGC = vm.runInNewContext('gc');
if (typeof runGC === 'function') {
  setTimeout(() => { try { runGC(); } catch {} }, 1500).unref();
  setInterval(() => { try { runGC(); } catch {} }, 30000).unref();
}

const PORT = parseInt(process.env.PORT, 10) || 5050;

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

server.listen(PORT, '0.0.0.0', () => {
  logEvent('SYSTEM', `AION Daemon online on port ${PORT}`);
  console.log(`\n>>> AION CORE ONLINE: http://localhost:${PORT}`);
});

export { server };
