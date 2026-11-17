import https from 'node:https';
import { getMobileTailscaleCertificate } from '../../src/services/mobile-tailscale-certificate.js';

// Isolated test process: never send certificate material to the parent.
const pair = await getMobileTailscaleCertificate();
const server = https.createServer({ cert: pair.cert, key: pair.key }, (req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    process.send({ type: 'received', cookie: req.headers.cookie === 'aion_session=synthetic', authorization: req.headers.authorization === 'Bearer synthetic', body: body === 'synthetic-body' });
    res.end('ok');
  });
});
server.listen(Number(process.argv[2]), '127.0.0.1', () => process.send({ type: 'ready' }));
process.on('disconnect', () => server.close(() => process.exit(0)));
