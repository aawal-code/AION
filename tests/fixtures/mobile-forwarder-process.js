import { startMobileForwarder } from '../../src/services/mobile-forwarder.js';
let instance;
process.on('message', async message => {
  if (message.type === 'start') {
    try { instance = await startMobileForwarder(message.options); process.send({ type: 'ready', port: instance.port }); }
    catch (error) { process.send({ type: 'error', error: error.message }); }
  }
  if (message.type === 'stop') { await instance?.close(); process.disconnect(); }
});
process.on('disconnect', async () => { await instance?.close(); process.exit(0); });
