import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { handleRequest } from '../src/routes/router.js';

describe('Milestone 5: Context-Aware Dashboards (Desktop & Mobile)', () => {
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

  // ========================================================================
  // 1. Desktop & Mobile Dashboard DOM Structure (public/index.html)
  // ========================================================================
  describe('Dashboard DOM Structure in index.html', () => {
    const html = fs.readFileSync('public/index.html', 'utf8');

    test('renders hero header with network state connection badge', () => {
      assert.ok(html.includes('id="canvasConnectionBadge"'), 'Must have canvasConnectionBadge');
      assert.ok(html.includes('id="canvasConnectionText"'), 'Must have canvasConnectionText');
      assert.ok(html.includes('device-connection-badge'), 'Must use device-connection-badge class');
    });

    test('renders 1-Click Mobile Setup Card with onboarding controls', () => {
      assert.ok(html.includes('id="mobileSetupCard"'), 'Must have mobileSetupCard container');
      assert.ok(html.includes('id="btnToggleMobileSetup"'), 'Must have collapsible toggle button');
      assert.ok(html.includes('id="mobileSetupChevron"'), 'Must have chevron animation element');
      assert.ok(html.includes('id="btnEnablePushNotifications"'), 'Must have Enable Push Notifications button');
      assert.ok(html.includes('id="btnInstallAionRunner"'), 'Must have Install AION Runner link');
      assert.ok(html.includes('/api/ios/profile.mobileconfig'), 'AION Runner links to iOS mobileconfig endpoint');
    });

    test('renders Local Telemetry Deck with CPU, RAM, and Disk metrics', () => {
      assert.ok(html.includes('id="localTelemetrySection"'), 'Must have localTelemetrySection container');
      assert.ok(html.includes('id="btnRefreshLocalTelemetry"'), 'Must have refresh telemetry button');
      assert.ok(html.includes('id="telemCpuVal"'), 'Must have telemCpuVal');
      assert.ok(html.includes('id="telemCpuBar"'), 'Must have telemCpuBar');
      assert.ok(html.includes('id="telemCpuPill"'), 'Must have telemCpuPill');
      assert.ok(html.includes('id="telemMemVal"'), 'Must have telemMemVal');
      assert.ok(html.includes('id="telemMemBar"'), 'Must have telemMemBar');
      assert.ok(html.includes('id="telemDiskVal"'), 'Must have telemDiskVal');
      assert.ok(html.includes('id="telemDiskBar"'), 'Must have telemDiskBar');
    });

    test('renders Remote Quick Actions row with View Screen and Test WoL', () => {
      assert.ok(html.includes('id="remoteActionsSection"'), 'Must have remoteActionsSection container');
      assert.ok(html.includes('id="btnRemoteViewScreen"'), 'Must have btnRemoteViewScreen for RustDesk');
      assert.ok(html.includes('id="btnRemoteTestWol"'), 'Must have btnRemoteTestWol for WoL magic packet');
    });

    test('renders Clean Running Apps Manager with Simple vs Advanced segmented control', () => {
      assert.ok(html.includes('id="desktopAppsSection"'), 'Must have desktopAppsSection');
      assert.ok(html.includes('id="appsCountBadge"'), 'Must have appsCountBadge');
      assert.ok(html.includes('id="btnAppModeSimple"'), 'Must have Simple mode button');
      assert.ok(html.includes('id="btnAppModeAdvanced"'), 'Must have Advanced mode button');
      assert.ok(html.includes('id="btnRefreshProcesses"'), 'Must have refresh processes button');
      assert.ok(html.includes('id="canvasProcessesList"'), 'Must have canvasProcessesList container');
    });

    test('renders Mobile Companion Deck with telemetry and action tools', () => {
      assert.ok(html.includes('id="mobileCompanionDeck"'), 'Must have mobileCompanionDeck container');
      assert.ok(html.includes('id="btnPingPhone"'), 'Must have Ping / Find Phone button');
      assert.ok(html.includes('id="toggleMobileWakeLock"'), 'Must have Keep Screen Awake switch');
      assert.ok(html.includes('id="formPhoneUrl"'), 'Must have Open URL on Phone form');
      assert.ok(html.includes('id="formPhoneClip"'), 'Must have Push Clipboard to Phone form');
      assert.ok(html.includes('id="mobileBatteryLevel"'), 'Must have mobileBatteryLevel');
      assert.ok(html.includes('id="mobileBatteryBadge"'), 'Must have mobileBatteryBadge');
      assert.ok(html.includes('id="mobileRouteValue"'), 'Must have mobileRouteValue');
      assert.ok(html.includes('id="mobileWakeState"'), 'Must have mobileWakeState');
      assert.ok(html.includes('id="mobileLastSeen"'), 'Must have mobileLastSeen');
    });
  });

  // ========================================================================
  // 2. Apple-Grade CSS Architecture (public/css/app.css)
  // ========================================================================
  describe('Apple-Grade CSS Styling in app.css', () => {
    const css = fs.readFileSync('public/css/app.css', 'utf8');

    test('defines network connection badges (.lan and .mesh)', () => {
      assert.ok(css.includes('.device-connection-badge'), 'Must define .device-connection-badge');
      assert.ok(css.includes('.device-connection-badge.mesh'), 'Must define .device-connection-badge.mesh');
      assert.ok(css.includes('.device-connection-badge.lan'), 'Must define .device-connection-badge.lan');
    });

    test('defines collapsible mobile setup card animations', () => {
      assert.ok(css.includes('.mobile-setup-card'), 'Must define .mobile-setup-card');
      assert.ok(css.includes('.mobile-setup-card.collapsed'), 'Must define .mobile-setup-card.collapsed');
      assert.ok(css.includes('.chevron-icon'), 'Must define .chevron-icon');
    });

    test('defines telemetry cards and progress bars', () => {
      assert.ok(css.includes('.telemetry-grid'), 'Must define .telemetry-grid');
      assert.ok(css.includes('.telemetry-card'), 'Must define .telemetry-card');
      assert.ok(css.includes('.telemetry-bar-wrap'), 'Must define .telemetry-bar-wrap');
      assert.ok(css.includes('.telemetry-bar-fill'), 'Must define .telemetry-bar-fill');
    });

    test('defines remote action cards for RustDesk and WoL', () => {
      assert.ok(css.includes('.remote-actions-row'), 'Must define .remote-actions-row');
      assert.ok(css.includes('.remote-action-card'), 'Must define .remote-action-card');
      assert.ok(css.includes('.remote-action-icon'), 'Must define .remote-action-icon');
    });

    test('defines app manager mode toggle and instant kill styles', () => {
      assert.ok(css.includes('.app-mode-segmented'), 'Must define .app-mode-segmented');
      assert.ok(css.includes('.app-mode-btn'), 'Must define .app-mode-btn');
      assert.ok(css.includes('.app-mode-btn.active'), 'Must define .app-mode-btn.active');
      assert.ok(css.includes('.app-kill-btn'), 'Must define .app-kill-btn');
      assert.ok(css.includes('.app-row.removing'), 'Must define .app-row.removing');
      assert.ok(css.includes('.app-cpu-badge'), 'Must define .app-cpu-badge');
      assert.ok(css.includes('.app-ram-badge'), 'Must define .app-ram-badge');
    });
  });

  // ========================================================================
  // 3. Client Logic & Controller Exports (public/js/devices.js & app.js)
  // ========================================================================
  describe('Client Module Exports & Device Classification', () => {
    test('public/js/devices.js exports required dashboard functions', async () => {
      const devModule = await import('../public/js/devices.js');
      assert.equal(typeof devModule.fetchDevices, 'function');
      assert.equal(typeof devModule.fetchLocalTelemetry, 'function');
      assert.equal(typeof devModule.fetchRunningProcesses, 'function');
      assert.equal(typeof devModule.killApp, 'function');
      assert.equal(typeof devModule.wakeDevice, 'function');
      assert.equal(typeof devModule.setAppMode, 'function');
      assert.equal(typeof devModule.getAppMode, 'function');
      assert.equal(typeof devModule.isMobileDevice, 'function');
      assert.equal(typeof devModule.getDeviceIconName, 'function');
      assert.equal(typeof devModule.renderRunningProcesses, 'function');
      assert.equal(typeof devModule.renderMobileCompanionDeck, 'function');
    });

    test('isMobileDevice correctly classifies mobile vs desktop nodes', async () => {
      const { isMobileDevice } = await import('../public/js/devices.js');

      // Mobile devices
      assert.equal(isMobileDevice({ type: 'phone', os: 'iOS' }), true);
      assert.equal(isMobileDevice({ type: 'tablet', os: 'iPadOS' }), true);
      assert.equal(isMobileDevice({ type: 'mobile', os: 'Android' }), true);
      assert.equal(isMobileDevice({ type: 'iphone', os: 'iOS' }), true);
      assert.equal(isMobileDevice({ type: 'desktop', os: 'iOS' }), true);

      // Desktop & Server devices
      assert.equal(isMobileDevice({ type: 'desktop', os: 'Windows' }), false);
      assert.equal(isMobileDevice({ type: 'laptop', os: 'Windows' }), false);
      assert.equal(isMobileDevice({ type: 'server', os: 'Linux' }), false);
      assert.equal(isMobileDevice({ type: 'desktop', os: 'macOS' }), false);
      assert.equal(isMobileDevice(null), false);
    });

    test('getDeviceIconName returns appropriate SVG icon names', async () => {
      const { getDeviceIconName } = await import('../public/js/devices.js');

      assert.equal(getDeviceIconName('laptop'), 'laptop');
      assert.equal(getDeviceIconName('phone'), 'phone');
      assert.equal(getDeviceIconName('tablet'), 'tablet');
      assert.equal(getDeviceIconName('server'), 'server');
      assert.equal(getDeviceIconName('desktop'), 'desktop');
      assert.equal(getDeviceIconName('other'), 'desktop');
    });

    test('setAppMode updates appMode state', async () => {
      const { setAppMode, getAppMode } = await import('../public/js/devices.js');

      setAppMode('advanced');
      assert.equal(getAppMode(), 'advanced');

      setAppMode('simple');
      assert.equal(getAppMode(), 'simple');
    });

    test('public/js/app.js exports mobile setup card controllers', async () => {
      const appModule = await import('../public/js/app.js');
      assert.equal(typeof appModule.setupMobileOnboardingCard, 'function');
      assert.equal(typeof appModule.enableMobilePushNotifications, 'function');
    });
  });

  // ========================================================================
  // 4. iOS 18 Transparent PWA Icons
  // ========================================================================
  describe('iOS 18 Transparent PWA Icon Verification', () => {
    function verifyPngTransparency(filePath) {
      assert.ok(fs.existsSync(filePath), `${filePath} must exist`);
      const buf = fs.readFileSync(filePath);

      let offset = 8;
      let width = 0;
      let height = 0;
      const idatChunks = [];

      while (offset < buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        if (type === 'IHDR') {
          width = buf.readUInt32BE(offset + 8);
          height = buf.readUInt32BE(offset + 12);
        } else if (type === 'IDAT') {
          idatChunks.push(buf.subarray(offset + 8, offset + 8 + len));
        }
        offset += 12 + len;
      }

      assert.equal(width, 180, 'PWA touch icon width must be 180px');
      assert.equal(height, 180, 'PWA touch icon height must be 180px');

      const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
      // First pixel at (0, 0): byte 0 is filter type, bytes 1-4 are RGBA
      const alpha = decompressed[4];
      assert.equal(alpha, 0, 'Background pixel alpha must be 0 (fully transparent for iOS 18 theming)');
    }

    test('public/apple-touch-icon.png has 100% transparent background', () => {
      verifyPngTransparency('public/apple-touch-icon.png');
    });

    test('public/brand/apple-touch-icon.png has 100% transparent background', () => {
      verifyPngTransparency('public/brand/apple-touch-icon.png');
    });
  });

  // ========================================================================
  // 5. Backend HTTP Endpoints Integration for Dashboards
  // ========================================================================
  describe('Backend HTTP Endpoints Integration', () => {
    test('GET /api/system/telemetry returns live CPU, Memory, and Disk stats', async () => {
      const res = await fetch(`${baseUrl}/api/system/telemetry`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');

      assert.ok(data.cpu, 'Telemetry must contain cpu');
      assert.equal(typeof data.cpu.percent, 'number');

      assert.ok(data.memory, 'Telemetry must contain memory');
      assert.equal(typeof data.memory.usedMb, 'number');
      assert.equal(typeof data.memory.totalMb, 'number');
      assert.equal(typeof data.memory.freeMb, 'number');
      assert.equal(typeof data.memory.percent, 'number');

      assert.ok(data.disk, 'Telemetry must contain disk');
      assert.equal(typeof data.disk.usedGb, 'number');
      assert.equal(typeof data.disk.totalGb, 'number');
      assert.equal(typeof data.disk.freeGb, 'number');
      assert.equal(typeof data.disk.percent, 'number');
    });

    test('GET /api/system/apps returns grouped applications list', async () => {
      const res = await fetch(`${baseUrl}/api/system/apps`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(Array.isArray(data.apps), 'apps must be an array');

      if (data.apps.length > 0) {
        const app = data.apps[0];
        assert.ok(app.name, 'App item must have name');
        assert.ok(Array.isArray(app.pids), 'App item must have pids array');
        assert.equal(typeof app.memoryMb, 'number');
      }
    });

    test('POST /api/system/apps/kill accepts app name', async () => {
      const res = await fetch(`${baseUrl}/api/system/apps/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'NonExistentAppTest_12345' }),
      });
      // Should handle request cleanly without crashing server (400 if not found, 200 on kill)
      assert.ok([200, 400, 404, 500].includes(res.status));
      const data = await res.json();
      assert.ok(data);
    });

    test('GET /api/devices returns local node with network metadata', async () => {
      const res = await fetch(`${baseUrl}/api/devices`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(Array.isArray(data.devices));
      assert.ok(data.devices.length >= 1, 'Must contain at least local device');

      const localDev = data.devices.find((d) => d.id === 'local' || d.isLocal === true);
      assert.ok(localDev, 'Local device must exist in devices list');
      assert.equal(localDev.isLocal, true);
      assert.ok(localDev.name);
      assert.ok(localDev.os);
    });

    test('GET /api/push/vapid-public-key returns VAPID key for mobile onboarding', async () => {
      const res = await fetch(`${baseUrl}/api/push/vapid-public-key`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.publicKey !== undefined);
    });
  });
});
