import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { handleRequest } from '../src/routes/router.js';
import {
  checkEthernetConnected,
  getBatteryTelemetry,
  applyLidAction,
  setLaptopMode,
  pollLaptopMode,
  getLaptopModeState,
  _resetLaptopModeForTests,
} from '../src/services/telemetry.js';

describe('Laptop Auto-Modes & Telemetry Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    _resetLaptopModeForTests();
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
    _resetLaptopModeForTests();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('Sensors & Telemetry Engine', () => {
    test('checkEthernetConnected returns boolean status without crashing', () => {
      const isConnected = checkEthernetConnected();
      assert.equal(typeof isConnected, 'boolean');
    });

    test('getBatteryTelemetry returns valid battery and AC power contract', async () => {
      const telem = await getBatteryTelemetry();
      assert.equal(typeof telem.hasBattery, 'boolean');
      assert.equal(typeof telem.percent, 'number');
      assert.ok(telem.percent >= 0 && telem.percent <= 100);
      assert.equal(typeof telem.acPower, 'boolean');
      assert.equal(typeof telem.charging, 'boolean');
      assert.equal(typeof telem.batteryStatus, 'number');
    });

    test('applyLidAction executes safely without throwing on valid modes', async () => {
      const homeRes = await applyLidAction('Home');
      assert.equal(homeRes.success, true);
      assert.equal(homeRes.mode, 'Home');

      const awayRes = await applyLidAction('Away');
      assert.equal(awayRes.success, true);
      assert.equal(awayRes.mode, 'Away');
    });
  });

  describe('Laptop Mode State Engine & Auto Logic', () => {
    test('setLaptopMode accepts Home, Away, and Auto', async () => {
      const stateHome = await setLaptopMode('Home');
      assert.equal(stateHome.mode, 'Home');
      assert.equal(stateHome.effectiveMode, 'Home');

      const stateAway = await setLaptopMode('Away');
      assert.equal(stateAway.mode, 'Away');
      assert.equal(stateAway.effectiveMode, 'Away');

      const stateAuto = await setLaptopMode('Auto');
      assert.equal(stateAuto.mode, 'Auto');
      assert.ok(['Home', 'Away'].includes(stateAuto.effectiveMode));
    });

    test('setLaptopMode rejects invalid mode with descriptive error', async () => {
      await assert.rejects(
        () => setLaptopMode('InvalidModeXYZ'),
        /Invalid laptop mode/
      );
      await assert.rejects(
        () => setLaptopMode(''),
        /Laptop mode must be/
      );
    });

    test('pollLaptopMode dynamically determines effectiveMode in Auto', async () => {
      await setLaptopMode('Auto');
      const state = await pollLaptopMode();
      assert.equal(state.mode, 'Auto');
      const expected = (state.ethernet && state.acPower) ? 'Home' : 'Away';
      assert.equal(state.effectiveMode, expected);
    });
  });

  describe('HTTP REST Endpoints', () => {
    test('GET /api/system/laptop-mode returns current mode snapshot', async () => {
      const res = await fetch(`${baseUrl}/api/system/laptop-mode`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(['Home', 'Away', 'Auto'].includes(data.mode));
      assert.ok(['Home', 'Away'].includes(data.effectiveMode));
      assert.equal(typeof data.ethernet, 'boolean');
      assert.equal(typeof data.acPower, 'boolean');
      assert.ok(data.battery);
    });

    test('POST /api/system/laptop-mode updates mode cleanly', async () => {
      const resHome = await fetch(`${baseUrl}/api/system/laptop-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'Home' }),
      });
      assert.equal(resHome.status, 200);
      const dataHome = await resHome.json();
      assert.equal(dataHome.status, 'ok');
      assert.equal(dataHome.mode, 'Home');
      assert.equal(dataHome.effectiveMode, 'Home');

      const resAway = await fetch(`${baseUrl}/api/system/laptop-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'Away' }),
      });
      assert.equal(resAway.status, 200);
      const dataAway = await resAway.json();
      assert.equal(dataAway.status, 'ok');
      assert.equal(dataAway.mode, 'Away');
      assert.equal(dataAway.effectiveMode, 'Away');
    });

    test('POST /api/system/laptop-mode rejects invalid payloads with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/system/laptop-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'GamingMode' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.status, 'error');
      assert.match(data.error, /Invalid laptop mode/);
    });

    test('GET /api/system/telemetry includes laptopMode and battery telemetry', async () => {
      const res = await fetch(`${baseUrl}/api/system/telemetry`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(data.laptopMode);
      assert.ok(data.battery);
    });
  });

  describe('Frontend DOM Structure & Integration', () => {
    const html = fs.readFileSync('public/index.html', 'utf8');

    test('renders Settings General tab Laptop Auto-Modes group and segmented controls', () => {
      assert.ok(html.includes('id="settingsLaptopModeGroup"'), 'Must have settingsLaptopModeGroup');
      assert.ok(html.includes('id="laptopModeSegmented"'), 'Must have laptopModeSegmented');
      assert.ok(html.includes('data-laptop-mode="Home"'), 'Must have Home option');
      assert.ok(html.includes('data-laptop-mode="Away"'), 'Must have Away option');
      assert.ok(html.includes('data-laptop-mode="Auto"'), 'Must have Auto option');
      assert.ok(html.includes('id="settingsLaptopEffectiveState"'), 'Must have settingsLaptopEffectiveState badge');
    });

    test('renders Local Telemetry Deck with swappable Disk and Battery cards', () => {
      assert.ok(html.includes('id="telemDiskCard"'), 'Must have telemDiskCard container');
      assert.ok(html.includes('id="telemBatteryCard"'), 'Must have telemBatteryCard container');
      assert.ok(html.includes('id="telemBatteryVal"'), 'Must have telemBatteryVal element');
      assert.ok(html.includes('id="telemBatteryBar"'), 'Must have telemBatteryBar element');
      assert.ok(html.includes('id="telemBatteryPill"'), 'Must have telemBatteryPill element');
      assert.ok(html.includes('id="telemBatteryMeta"'), 'Must have telemBatteryMeta element');
    });
  });
});
