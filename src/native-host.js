import { serveNativeIpc } from './services/native-ipc-channel.js';
import { createNativeHttpDispatcher } from './services/native-http-dispatch.js';

// This process is intended to be launched only by the native shell with
// inherited stdin/stdout pipes. It does not start the HTTP listener.
if (process.stdin.isTTY || process.stdout.isTTY) throw new Error('Native host requires inherited pipes');
const native = createNativeHttpDispatcher();
const channel = serveNativeIpc(process.stdin, process.stdout, native.dispatch);
function shutdown() { native.close(); channel.close(); process.exit(0); }
process.stdin.once('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
