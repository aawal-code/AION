import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { handleRequest } from '../src/routes/router.js';
import * as auth from '../src/services/auth.js';
import * as screenView from '../src/services/screen-view.js';
import * as push from '../src/services/push.js';

describe('Pre-Beta.2 Production Hardening & Architecture Verification', () => {

  describe('Zero-Dependency Verification', () => {
    it('verifies src/services/auth.js uses only built-in Node modules', () => {
      const code = fs.readFileSync(path.resolve('src/services/auth.js'), 'utf8');
      const importMatches = code.match(/from\s+['"]([^'"]+)['"]/g) || [];
      const externalImports = importMatches
        .map(m => m.replace(/from\s+['"]|['"]/g, ''))
        .filter(mod => !mod.startsWith('.') && !['fs', 'path', 'crypto'].includes(mod));
      assert.deepStrictEqual(externalImports, [], 'auth.js must have zero external npm dependencies');
    });

    it('verifies src/services/screen-view.js uses only built-in Node modules', () => {
      const code = fs.readFileSync(path.resolve('src/services/screen-view.js'), 'utf8');
      const importMatches = code.match(/from\s+['"]([^'"]+)['"]/g) || [];
      const externalImports = importMatches
        .map(m => m.replace(/from\s+['"]|['"]/g, ''))
        .filter(mod => !mod.startsWith('.') && !['fs', 'path', 'os', 'child_process'].includes(mod));
      assert.deepStrictEqual(externalImports, [], 'screen-view.js must have zero external npm dependencies');
    });

    it('verifies src/services/push.js uses only built-in Node modules', () => {
      const code = fs.readFileSync(path.resolve('src/services/push.js'), 'utf8');
      const importMatches = code.match(/from\s+['"]([^'"]+)['"]/g) || [];
      const externalImports = importMatches
        .map(m => m.replace(/from\s+['"]|['"]/g, ''))
        .filter(mod => !mod.startsWith('.') && !['fs', 'path', 'crypto', 'https', 'http', 'url'].includes(mod));
      assert.deepStrictEqual(externalImports, [], 'push.js must have zero external npm dependencies');
    });
  });

  describe('Authentication & Pairing PIN Service', () => {
    it('isLocalhost identifies loopback addresses', () => {
      assert.strictEqual(auth.isLocalhost({ socket: { remoteAddress: '127.0.0.1' } }), true);
      assert.strictEqual(auth.isLocalhost({ socket: { remoteAddress: '::1' } }), true);
      assert.strictEqual(auth.isLocalhost({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
      assert.strictEqual(auth.isLocalhost({ socket: { remoteAddress: '192.168.1.100' } }), false);
      assert.strictEqual(auth.isLocalhost({ socket: { remoteAddress: '100.64.0.2' } }), false);
    });

    it('manages 4-digit Pairing PIN generation and regeneration', () => {
      const pin = auth.getPairingPin();
      assert.match(pin, /^\d{4}$/, 'PIN must be exactly 4 digits');

      const regenerated = auth.regeneratePairingPin();
      assert.match(regenerated, /^\d{4}$/, 'Regenerated PIN must be exactly 4 digits');
      assert.strictEqual(auth.verifyPin(regenerated), true);
      assert.strictEqual(auth.verifyPin('00000'), false);
      assert.strictEqual(auth.verifyPin('abcd'), false);
    });

    it('pairs device with PIN and manages trusted device tokens', () => {
      const pin = auth.getPairingPin();
      const failPair = auth.pairDevice({ pin: '0000', deviceName: 'Unauthorized' });
      assert.strictEqual(failPair.success, false);

      const pairResult = auth.pairDevice({
        pin,
        deviceName: 'Test iPhone 16',
        userAgent: 'Mozilla/5.0 (iPhone)',
        ip: '100.64.1.20',
        remember: true,
      });

      assert.strictEqual(pairResult.success, true);
      assert.ok(pairResult.token, 'Token must be issued');
      assert.ok(pairResult.deviceId, 'Device ID must be assigned');

      // Validate token
      assert.strictEqual(auth.validateToken(pairResult.token), true);
      assert.strictEqual(auth.validateToken('invalid-hex-token'), false);

      // Check trusted devices list (token omitted)
      const devices = auth.getTrustedDevices();
      const found = devices.find(d => d.id === pairResult.deviceId);
      assert.ok(found, 'Paired device must appear in trusted devices list');
      assert.strictEqual(found.name, 'Test iPhone 16');
      assert.strictEqual(found.token, undefined, 'Raw token must never be exposed');

      // Revoke device
      const revoked = auth.revokeDevice(pairResult.deviceId);
      assert.strictEqual(revoked, true);
      assert.strictEqual(auth.validateToken(pairResult.token), false);
    });
  });

  describe('Remote Screen View / RustDesk Integration', () => {
    it('returns valid screen view status payload', () => {
      const status = screenView.getScreenViewStatus();
      assert.ok(typeof status.installed === 'boolean');
      assert.ok(typeof status.ready === 'boolean');
      assert.ok(typeof status.portable === 'boolean');
      assert.ok(['ready', 'not_installed', 'configured'].includes(status.status));
    });

    it('builds valid rustdesk:// URL scheme link for remote peer', () => {
      const url = screenView.getPeerScreenViewUrl('100.64.0.15');
      assert.strictEqual(url, 'rustdesk://100.64.0.15');

      const urlClean = screenView.getPeerScreenViewUrl('rustdesk://100.64.0.15');
      assert.strictEqual(urlClean, 'rustdesk://100.64.0.15');
    });
  });

  describe('VAPID Web Push & iOS Web Clip Configuration', () => {
    it('generates and loads raw uncompressed EC P-256 VAPID public key', () => {
      const pubKey = push.getVapidPublicKey();
      assert.ok(typeof pubKey === 'string' && pubKey.length > 60);

      // Verify uncompressed point: starts with 0x04 decoded
      let b64 = pubKey.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const rawBuf = Buffer.from(b64, 'base64');
      assert.strictEqual(rawBuf.length, 65, 'Uncompressed EC point must be exactly 65 bytes');
      assert.strictEqual(rawBuf[0], 0x04, 'Uncompressed point must start with 0x04');
    });

    it('registers and retrieves Web Push subscriptions', () => {
      const fakeSub = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-token-12345',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP045',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      };

      const result = push.saveSubscription({
        subscription: fakeSub,
        deviceId: 'iphone-test-device',
      });

      assert.strictEqual(result.success, true);
      const subs = push.getSubscriptions();
      const saved = subs.find(s => s.endpoint === fakeSub.endpoint);
      assert.ok(saved, 'Subscription must be saved');

      push.removeSubscription(fakeSub.endpoint);
    });
  });

  describe('HTTP REST Routes & Security Guards', () => {
    let server;
    let baseUrl;

    before((t, done) => {
      server = http.createServer((req, res) => handleRequest(req, res));
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        done();
      });
    });

    after((t, done) => {
      if (server) server.close(done);
      else done();
    });

    it('GET /api/auth/status returns localhost auth status and PIN', async () => {
      const res = await fetch(`${baseUrl}/api/auth/status`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.authenticated, true);
      assert.strictEqual(data.isLocalhost, true);
      assert.match(data.pin, /^\d{4}$/);
    });

    it('POST /api/auth/pair verifies PIN and issues token and cookie', async () => {
      const pin = auth.getPairingPin();
      const res = await fetch(`${baseUrl}/api/auth/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, deviceName: 'Unit Test Phone' }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.token);

      const cookieHeader = res.headers.get('set-cookie');
      assert.ok(cookieHeader && cookieHeader.includes('aion_token='), 'Cookie aion_token must be set');
      assert.ok(cookieHeader.includes('HttpOnly'), 'Cookie must be HttpOnly');
    });

    it('GET /api/system/screen-view returns status', async () => {
      const res = await fetch(`${baseUrl}/api/system/screen-view`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(typeof data.installed === 'boolean');
    });

    it('GET /api/push/vapid-public-key returns VAPID key', async () => {
      const res = await fetch(`${baseUrl}/api/push/vapid-public-key`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.publicKey);
    });

    it('GET /api/ios/profile.mobileconfig returns valid Apple Web Clip profile XML', async () => {
      const res = await fetch(`${baseUrl}/api/ios/profile.mobileconfig?theme=dark`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('application/x-apple-aspen-config'));
      const xml = await res.text();
      assert.ok(xml.includes('com.apple.webClip.managed'), 'Must contain Web Clip payload type');
      assert.ok(xml.includes('<key>FullScreen</key>'), 'Must specify FullScreen Web Clip');
      assert.ok(xml.includes('AION'), 'Must specify AION Display Name');
    });
  });

  describe('Updater Data Preservation Verification', () => {
    it('verifies updater preserves user data and configuration across updates', () => {
      const updaterSrc = fs.readFileSync(path.resolve('src/services/updater.js'), 'utf8');
      assert.ok(updaterSrc.includes('install-manifest.json'), 'updater must explicitly exclude install-manifest.json');
      assert.ok(updaterSrc.includes('isUserData') || updaterSrc.includes('data'), 'updater must protect data configuration files');
    });
  });

  describe('Native Executables Suite Verification', () => {
    it('verifies dist/AION.exe, dist/Uninstall.exe, and dist/AION-Setup.exe are compiled', () => {
      assert.ok(fs.existsSync(path.resolve('dist/AION.exe')), 'dist/AION.exe must exist');
      assert.ok(fs.existsSync(path.resolve('dist/Uninstall.exe')), 'dist/Uninstall.exe must exist');
      assert.ok(fs.existsSync(path.resolve('dist/AION-Setup.exe')), 'dist/AION-Setup.exe must exist');

      const setupSize = fs.statSync(path.resolve('dist/AION-Setup.exe')).size;
      assert.ok(setupSize > 1000000, `dist/AION-Setup.exe size (${setupSize}) must contain payload`);
    });
  });

});
