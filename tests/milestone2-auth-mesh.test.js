import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleRequest } from '../src/routes/router.js';
import {
  getRollingPinInfo,
  getPairingPin,
  regeneratePairingPin,
  verifyPin,
  isLocalhost,
  pairDevice,
  getTrustedDevices,
  revokeDevice,
  validateToken,
  _setRollingPinStateForTests,
  PIN_CYCLE_DURATION_MS,
  PIN_GRACE_PERIOD_MS,
} from '../src/services/auth.js';
import {
  parseTailscaleStatus,
  getMeshStatus,
} from '../src/services/network.js';

describe('Milestone 2: Rolling Auth & Mesh State (Security)', () => {
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

  // =========================================================================
  // 1. The Rolling PIN Authenticator
  // =========================================================================
  describe('Rolling PIN Authenticator (120s Cycle & 15s Grace Period)', () => {
    test('initializes 4-digit PIN with 120s cycle and positive remaining time', () => {
      const pinInfo = getRollingPinInfo();
      assert.ok(pinInfo);
      assert.match(pinInfo.currentPin, /^\d{4}$/, 'currentPin must be 4 digits');
      assert.ok(typeof pinInfo.expiresAt === 'string', 'expiresAt must be an ISO string');

      const expiresMs = new Date(pinInfo.expiresAt).getTime();
      assert.ok(expiresMs > Date.now(), 'expiresAt must be in the future');
      assert.ok(
        pinInfo.milliseconds_remaining > 0 && pinInfo.milliseconds_remaining <= PIN_CYCLE_DURATION_MS,
        'milliseconds_remaining must be between 0 and 120000ms'
      );
      assert.equal(pinInfo.millisecondsRemaining, pinInfo.milliseconds_remaining);
    });

    test('verifyPin accepts current active PIN and rejects malformed inputs', () => {
      const pinInfo = getRollingPinInfo();
      assert.strictEqual(verifyPin(pinInfo.currentPin), true);
      assert.strictEqual(verifyPin(''), false);
      assert.strictEqual(verifyPin('123'), false);
      assert.strictEqual(verifyPin('12345'), false);
      assert.strictEqual(verifyPin('abcd'), false);
      assert.strictEqual(verifyPin(null), false);
    });

    test('15-second grace period: accepts preceding PIN within 15s of cycle refresh', () => {
      const baseTime = Date.now();
      const oldPin = '5555';
      const newPin = '6666';

      // Set old PIN as expired 5 seconds ago
      const oldExpiresAt = new Date(baseTime - 5000).toISOString();
      const newExpiresAt = new Date(baseTime + 115000).toISOString();

      _setRollingPinStateForTests({
        currentPin: newPin,
        expiresAt: newExpiresAt,
        previousPin: oldPin,
        previousExpiresAt: oldExpiresAt,
      });

      // At baseTime (5s after old PIN expired), both old PIN and new PIN must be valid
      assert.strictEqual(verifyPin(oldPin, baseTime), true, 'Old PIN must be accepted within 15s grace');
      assert.strictEqual(verifyPin(newPin, baseTime), true, 'New PIN must be accepted');
      assert.strictEqual(verifyPin('9999', baseTime), false, 'Wrong PIN must be rejected');
    });

    test('15-second grace period: rejects preceding PIN after 15s have elapsed', () => {
      const baseTime = Date.now();
      const oldPin = '7777';
      const newPin = '8888';

      // Set old PIN as expired 16 seconds ago (past the 15s grace period)
      const oldExpiresAt = new Date(baseTime - 16000).toISOString();
      const newExpiresAt = new Date(baseTime + 104000).toISOString();

      _setRollingPinStateForTests({
        currentPin: newPin,
        expiresAt: newExpiresAt,
        previousPin: oldPin,
        previousExpiresAt: oldExpiresAt,
      });

      // At baseTime, old PIN expired 16s ago (> 15s grace), so it MUST be rejected
      assert.strictEqual(verifyPin(oldPin, baseTime), false, 'Old PIN must be rejected after 15s grace expires');
      assert.strictEqual(verifyPin(newPin, baseTime), true, 'New PIN must remain valid');
    });

    test('regeneratePairingPin forces an immediate cycle with 120s expiry', () => {
      const pinBefore = getPairingPin();
      const pinAfter = regeneratePairingPin();

      assert.match(pinAfter, /^\d{4}$/);
      assert.strictEqual(verifyPin(pinAfter), true);

      const info = getRollingPinInfo();
      assert.strictEqual(info.currentPin, pinAfter);
      assert.ok(info.milliseconds_remaining > 115000 && info.milliseconds_remaining <= 120000);
    });

    test('GET /api/auth/pin HTTP endpoint returns rolling PIN telemetry', async () => {
      const res = await fetch(`${baseUrl}/api/auth/pin`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/);

      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.match(data.currentPin, /^\d{4}$/);
      assert.ok(typeof data.expiresAt === 'string');
      assert.ok(typeof data.milliseconds_remaining === 'number');
      assert.ok(data.milliseconds_remaining > 0 && data.milliseconds_remaining <= 120000);
    });
  });

  // =========================================================================
  // 2. Persistent Cryptographic Device Tokens
  // =========================================================================
  describe('Persistent Cryptographic Device Tokens & Localhost Bypass', () => {
    test('isLocalhost identifies loopback IPs and requests with localhost Host header', () => {
      // Loopback IP addresses
      assert.strictEqual(isLocalhost({ socket: { remoteAddress: '127.0.0.1' } }), true);
      assert.strictEqual(isLocalhost({ socket: { remoteAddress: '::1' } }), true);
      assert.strictEqual(isLocalhost({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
      assert.strictEqual(isLocalhost({ socket: { remoteAddress: 'localhost' } }), true);

      // Remote IP with localhost Host header -> must bypass PIN gate
      assert.strictEqual(
        isLocalhost({
          socket: { remoteAddress: '192.168.1.100' },
          headers: { host: 'localhost:5050' },
        }),
        true
      );
      assert.strictEqual(
        isLocalhost({
          socket: { remoteAddress: '100.64.0.5' },
          headers: { host: '127.0.0.1:5050' },
        }),
        true
      );
      assert.strictEqual(
        isLocalhost({
          socket: { remoteAddress: '10.0.0.2' },
          headers: { host: 'localhost' },
        }),
        true
      );

      // Remote IP with remote Host header -> not localhost
      assert.strictEqual(
        isLocalhost({
          socket: { remoteAddress: '192.168.1.100' },
          headers: { host: '192.168.1.50:5050' },
        }),
        false
      );
      assert.strictEqual(
        isLocalhost({
          socket: { remoteAddress: '100.127.64.25' },
          headers: { host: 'aion.tailscale.net:5050' },
        }),
        false
      );
    });

    test('pairDevice generates secure 64-character token and stores metadata', () => {
      const pin = getPairingPin();
      const pairRes = pairDevice({
        pin,
        deviceName: 'iPad Pro Companion',
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
        ip: '192.168.1.75',
        remember: true,
      });

      assert.strictEqual(pairRes.success, true);
      assert.ok(pairRes.token);
      assert.strictEqual(pairRes.token.length, 64, 'Token must be exactly 64 hexadecimal characters');
      assert.match(pairRes.token, /^[0-9a-f]{64}$/i, 'Token must be valid SHA-256 hex string');
      assert.ok(pairRes.deviceId);

      // Validate token
      assert.strictEqual(validateToken(pairRes.token), true);
      assert.strictEqual(validateToken('non-existent-token-1234567890'), false);

      // Verify stored metadata in data/trusted-devices.json
      const devices = getTrustedDevices();
      const stored = devices.find((d) => d.id === pairRes.deviceId);
      assert.ok(stored, 'Device must be present in trusted devices list');
      assert.strictEqual(stored.name, 'iPad Pro Companion');
      assert.strictEqual(stored.userAgent, 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)');
      assert.strictEqual(stored.ip, '192.168.1.75');
      assert.ok(stored.createdAt);
      assert.ok(stored.timestamp);
      assert.strictEqual(stored.remember, true);
    });

    test('GET /api/auth/devices HTTP endpoint lists remembered devices', async () => {
      const res = await fetch(`${baseUrl}/api/auth/devices`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(Array.isArray(data.devices));
      assert.ok(data.devices.length > 0);

      // Ensure no raw tokenHash is leaked to the client
      for (const dev of data.devices) {
        assert.strictEqual(dev.tokenHash, undefined, 'tokenHash must never be exposed');
        assert.ok(dev.id);
        assert.ok(dev.name);
      }
    });

    test('DELETE /api/auth/devices/:id instantly revokes access', async () => {
      const pin = getPairingPin();
      const pairRes = pairDevice({
        pin,
        deviceName: 'Temporary Device To Revoke',
        userAgent: 'curl/8.0',
        ip: '10.0.0.99',
      });

      assert.strictEqual(pairRes.success, true);
      assert.strictEqual(validateToken(pairRes.token), true);

      // Revoke via DELETE /api/auth/devices/:id
      const delRes = await fetch(`${baseUrl}/api/auth/devices/${pairRes.deviceId}`, {
        method: 'DELETE',
      });
      assert.strictEqual(delRes.status, 200);
      const delData = await delRes.json();
      assert.strictEqual(delData.status, 'ok');
      assert.strictEqual(delData.success, true);

      // Token must now be completely revoked
      assert.strictEqual(validateToken(pairRes.token), false);
    });
  });

  // =========================================================================
  // 3. Tailscale Mesh State Polling
  // =========================================================================
  describe('Tailscale Mesh State Polling Service', () => {
    test('parseTailscaleStatus parses active Running mesh state with IPv4, IPv6 and hostname', () => {
      const mockRunningJson = JSON.stringify({
        BackendState: 'Running',
        TailscaleIPs: ['100.127.64.25', 'fd7a:115c:a1e0::da3a:401a'],
        Self: {
          HostName: 'aion-primary-pc',
          DNSName: 'aion-primary-pc.tailnet.ts.net.',
          Online: true,
          TailscaleIPs: ['100.127.64.25', 'fd7a:115c:a1e0::da3a:401a'],
        },
      });

      const parsed = parseTailscaleStatus(mockRunningJson);
      assert.strictEqual(parsed.connected, true);
      assert.strictEqual(parsed.ipv4, '100.127.64.25');
      assert.strictEqual(parsed.ipv6, 'fd7a:115c:a1e0::da3a:401a');
      assert.strictEqual(parsed.hostname, 'aion-primary-pc');
    });

    test('parseTailscaleStatus returns clean disconnected state for Stopped/Offline mesh', () => {
      const mockStoppedJson = JSON.stringify({
        BackendState: 'Stopped',
        TailscaleIPs: [],
        Self: {
          HostName: 'my-pc',
          Online: false,
          TailscaleIPs: [],
        },
      });

      const parsed = parseTailscaleStatus(mockStoppedJson);
      assert.strictEqual(parsed.connected, false);
      assert.strictEqual(parsed.ipv4, null);
      assert.strictEqual(parsed.ipv6, null);
    });

    test('parseTailscaleStatus fails gracefully on empty, invalid, or error outputs', () => {
      const emptyRes = parseTailscaleStatus('');
      assert.strictEqual(emptyRes.connected, false);
      assert.strictEqual(emptyRes.ipv4, null);
      assert.strictEqual(emptyRes.ipv6, null);
      assert.strictEqual(emptyRes.hostname, null);

      const invalidJsonRes = parseTailscaleStatus('Failed to connect to Tailscale daemon');
      assert.strictEqual(invalidJsonRes.connected, false);
      assert.strictEqual(invalidJsonRes.ipv4, null);
      assert.strictEqual(invalidJsonRes.ipv6, null);
      assert.strictEqual(invalidJsonRes.hostname, null);
    });

    test('getMeshStatus resolves cleanly without throwing even if Tailscale is offline', async () => {
      const mesh = await getMeshStatus();
      assert.ok(typeof mesh === 'object');
      assert.ok(typeof mesh.connected === 'boolean');
      // If connected on host, verify addresses
      if (mesh.connected) {
        assert.ok(typeof mesh.ipv4 === 'string');
        assert.ok(mesh.ipv4.includes('.'));
      }
    });

    test('GET /api/network/mesh HTTP endpoint returns mesh telemetry JSON', async () => {
      const res = await fetch(`${baseUrl}/api/network/mesh`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/);

      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(typeof data.connected === 'boolean');
      assert.ok('ipv4' in data);
      assert.ok('ipv6' in data);
      assert.ok('hostname' in data);
    });
  });
});
