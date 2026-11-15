import { serveNativeIpc } from '../../src/services/native-ipc-channel.js';

serveNativeIpc(process.stdin, process.stdout, async (method, payload, signal) => {
  if (method === 'echo') return payload;
  if (method === 'wait') {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return null;
  }
  throw new Error('Unsupported operation');
});
