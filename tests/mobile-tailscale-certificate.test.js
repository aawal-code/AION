import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createPrivateKey, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { once } from 'node:events';
import test from 'node:test';
import * as x509 from '@peculiar/x509';
import { chromium } from 'playwright';
import { getMobileTailscaleCertificate, parseTailscaleCertificatePair } from '../src/services/mobile-tailscale-certificate.js';

test('Master spec §1/§2: Tailscale certificate is bound to the expected host and key', async () => {
  const name = 'example.example.ts.net', algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({ name: 'CN=' + name, keys, signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 86400000), extensions: [new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: name }])] });
  const key = createPrivateKey({ key: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' });
  const pair = cert.toString('pem') + '\n' + key;
  assert.ok(parseTailscaleCertificatePair(pair, name).key);
  assert.throws(() => parseTailscaleCertificatePair(pair, 'other.example.ts.net'));
  assert.throws(() => parseTailscaleCertificatePair(pair, name, 2 * 86400000));
  assert.throws(() => parseTailscaleCertificatePair(pair + key, name));
  assert.throws(() => parseTailscaleCertificatePair(pair, '--invalid'));
});

test('Master spec §1/§2: installed Tailscale certificate is trusted by Chromium', { skip: process.env.AION_TEST_TAILSCALE_CERT !== '1', timeout: 90000 }, async t => {
  const pair = await getMobileTailscaleCertificate();
  assert.match(pair.hostname, /\.ts\.net$/);
  assert.ok(pair.key);
  const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert.ok(fs.existsSync(executablePath), 'Chrome is required for the standard trust-store check');
  const server = https.createServer({ cert: pair.cert, key: pair.key }, (_req, res) => res.end('AION certificate verification'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, executablePath, args: [`--host-resolver-rules=MAP ${pair.hostname} 127.0.0.1`, '--no-proxy-server'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`https://${pair.hostname}:${server.address().port}/`, { timeout: 15000 });
  assert.equal(await page.locator('body').innerText(), 'AION certificate verification');
});
