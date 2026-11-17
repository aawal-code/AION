import assert from 'node:assert/strict';
import test from 'node:test';
import { getTailscaleHttpsStatus, parseTailscaleStatus } from '../src/services/network.js';

test('Master spec §1/§3: cached Tailscale addresses do not imply an online host', () => {
  const status = parseTailscaleStatus(JSON.stringify({ BackendState: 'Running', Self: { Online: false, HostName: 'example-pc', DNSName: 'example-pc.example.ts.net.', TailscaleIPs: ['100.64.0.10'] } }));
  assert.equal(status.connected, false);
  assert.equal(status.hostname, 'example-pc');
  assert.equal(status.dnsName, 'example-pc.example.ts.net');
  assert.equal(status.ipv4, '100.64.0.10');
});

test('Master spec §1/§2: no remote URL is advertised before a gateway is verified', async () => {
  const status = await getTailscaleHttpsStatus();
  assert.equal(status.supported, false);
  assert.equal(status.httpsUrl, null);
  assert.equal(status.httpUrl, null);
});

test('Master spec §1/§3: Tailscale connection requires a running backend and online self', () => {
  assert.equal(parseTailscaleStatus(JSON.stringify({ BackendState: 'Running', Self: { Online: true } })).connected, true);
  assert.equal(parseTailscaleStatus(JSON.stringify({ BackendState: 'Stopped', Self: { Online: true } })).connected, false);
  assert.equal(parseTailscaleStatus(JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.64.0.10'] } })).connected, false);
});
