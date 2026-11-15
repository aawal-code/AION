import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleRequest, getClientIp, isTailscaleClient, getMobileGatewayHtml } from '../src/routes/router.js';

describe('Zero-Cloud Mobile Bridge & Setup Gateway Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(handleRequest);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('Tailscale Mesh IP & Client Classifier Logic', () => {
    test('getClientIp normalizes IPv4, IPv6, and forwarded headers', () => {
      const mockReqForwarded = {
        headers: { 'x-forwarded-for': '::ffff:192.168.1.45, 10.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
      };
      assert.equal(getClientIp(mockReqForwarded), '192.168.1.45');

      const mockReqSocket = {
        headers: {},
        socket: { remoteAddress: '::ffff:100.85.120.4' },
      };
      assert.equal(getClientIp(mockReqSocket), '100.85.120.4');

      assert.equal(getClientIp(null), '');
    });

    test('isTailscaleClient accurately identifies Tailscale CGNAT and IPv6 ranges', () => {
      // Tailscale IPv4
      assert.equal(isTailscaleClient({ headers: {}, socket: { remoteAddress: '100.64.0.1' } }), true);
      assert.equal(isTailscaleClient({ headers: { 'x-forwarded-for': '100.115.82.9' }, socket: {} }), true);
      assert.equal(isTailscaleClient({ headers: {}, socket: { remoteAddress: '::ffff:100.101.200.5' } }), true);

      // Tailscale IPv6
      assert.equal(isTailscaleClient({ headers: {}, socket: { remoteAddress: 'fd7a:115c:a1e0::1' } }), true);
      assert.equal(isTailscaleClient({ headers: { 'x-forwarded-for': 'FD7A:115C:A1E0:0000:0000:0000:0000:0002' }, socket: {} }), true);

      // Non-Tailscale IPs
      assert.equal(isTailscaleClient({ headers: {}, socket: { remoteAddress: '192.168.1.100' } }), false);
      assert.equal(isTailscaleClient({ headers: {}, socket: { remoteAddress: '10.0.0.5' } }), false);
      assert.equal(isTailscaleClient({ headers: {}, socket: { remoteAddress: '172.16.0.2' } }), false);
      assert.equal(isTailscaleClient({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), false);
    });

    test('getMobileGatewayHtml renders sleek dark UI with direct store links', () => {
      const html = getMobileGatewayHtml({ headers: {}, socket: { remoteAddress: '192.168.1.55' } });
      assert.ok(html.includes('AION'), 'Should contain AION brand');
      assert.ok(html.includes('Zero-Cloud Gateway'), 'Should identify as Zero-Cloud Gateway');
      assert.ok(
        html.includes('https://apps.apple.com/app/tailscale/id1470494297'),
        'Must include direct iOS App Store URL'
      );
      assert.ok(
        html.includes('https://play.google.com/store/apps/details?id=com.tailscale.ipn'),
        'Must include direct Google Play Store URL'
      );
      assert.ok(html.includes('/setup?check=1'), 'Must include auto-polling script endpoint');
    });
  });

  describe('GET /setup HTTP Bridge Route', () => {
    test('renders Mobile Gateway Screen on local Wi-Fi client (non-Tailscale)', async () => {
      const res = await fetch(`${baseUrl}/setup`, {
        headers: {
          'x-forwarded-for': '192.168.1.120',
        },
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type')?.includes('text/html'));
      const text = await res.text();
      assert.ok(text.includes('AION Mobile Gateway'));
      assert.ok(text.includes('192.168.1.120'));
    });

    test('GET /setup?check=1 returns JSON mesh status for LAN client', async () => {
      const res = await fetch(`${baseUrl}/setup?check=1`, {
        headers: {
          'x-forwarded-for': '192.168.1.120',
        },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.isTailscale, false);
      assert.equal(data.clientIp, '192.168.1.120');
    });

    test('GET /setup?check=1 returns isTailscale: true for Tailscale client', async () => {
      const res = await fetch(`${baseUrl}/setup?check=1`, {
        headers: {
          'x-forwarded-for': '100.95.20.10',
        },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.isTailscale, true);
      assert.equal(data.clientIp, '100.95.20.10');
    });

    test('GET /setup redirects Tailscale mesh client directly to / with HTTP 302', async () => {
      const res = await fetch(`${baseUrl}/setup`, {
        headers: {
          'x-forwarded-for': '100.95.20.10',
        },
        redirect: 'manual', // do not follow redirect
      });

      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/');
    });
  });
});
