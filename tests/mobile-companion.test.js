import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleRequest } from '../src/routes/router.js';
import {
  enqueueDeviceCommand,
  dequeueDeviceCommands,
  waitForDeviceCommands,
  setDeviceTelemetry,
  getDeviceTelemetry,
  clearDeviceQueues,
  getDevicesList,
  getDeviceById,
} from '../src/services/devices.js';

describe('Mobile Companion Deck & Telemetry Channel', () => {
  let server;
  let baseUrl;

  before(async () => {
    clearDeviceQueues();
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
    clearDeviceQueues();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('In-Memory Device Command Queue Service', () => {
    test('enqueues and dequeues commands for target device', () => {
      const devId = 'phone-node-1';
      const cmd1 = enqueueDeviceCommand(devId, 'ping');
      assert.ok(cmd1.id.startsWith('cmd-'), 'Command id should start with cmd-');
      assert.equal(cmd1.action, 'ping');

      const cmd2 = enqueueDeviceCommand(devId, 'open_url', { url: 'https://aion.local' });
      assert.equal(cmd2.action, 'open_url');
      assert.equal(cmd2.payload.url, 'https://aion.local');

      const pending = dequeueDeviceCommands(devId);
      assert.equal(pending.length, 2, 'Should dequeue 2 commands');
      assert.equal(pending[0].action, 'ping');
      assert.equal(pending[1].action, 'open_url');

      const empty = dequeueDeviceCommands(devId);
      assert.equal(empty.length, 0, 'Queue should now be empty');
    });

    test('waitForDeviceCommands returns immediately if queue has commands', async () => {
      const devId = 'phone-node-2';
      enqueueDeviceCommand(devId, 'clipboard', { text: 'Hello from PC' });

      const cmds = await waitForDeviceCommands(devId, 1000);
      assert.equal(cmds.length, 1);
      assert.equal(cmds[0].action, 'clipboard');
      assert.equal(cmds[0].payload.text, 'Hello from PC');
    });

    test('waitForDeviceCommands resolves on new command arrival', async () => {
      const devId = 'phone-node-3';

      const waitPromise = waitForDeviceCommands(devId, 2000);
      setTimeout(() => {
        enqueueDeviceCommand(devId, 'wake_lock', { enabled: true });
      }, 50);

      const cmds = await waitPromise;
      assert.equal(cmds.length, 1);
      assert.equal(cmds[0].action, 'wake_lock');
      assert.equal(cmds[0].payload.enabled, true);
    });

    test('waitForDeviceCommands times out cleanly if no command sent', async () => {
      const devId = 'phone-node-timeout';
      const start = Date.now();
      const cmds = await waitForDeviceCommands(devId, 100);
      const elapsed = Date.now() - start;

      assert.equal(cmds.length, 0);
      assert.ok(elapsed >= 90, `Should wait ~100ms, elapsed: ${elapsed}`);
    });
  });

  describe('Mobile Telemetry Store Service', () => {
    test('stores and retrieves battery, charging, route, and wakeLock status', () => {
      const devId = 'phone-node-telem';
      const telem = setDeviceTelemetry(devId, {
        battery: 88,
        charging: true,
        wakeLock: true,
        route: 'mesh',
      });

      assert.equal(telem.battery, 88);
      assert.equal(telem.charging, true);
      assert.equal(telem.wakeLock, true);
      assert.equal(telem.route, 'mesh');
      assert.ok(telem.updatedAt);

      const retrieved = getDeviceTelemetry(devId);
      assert.deepEqual(retrieved, telem);
    });

    test('attaches telemetry to device list and marks active mobile nodes online', async () => {
      const devId = 'ts-localhost'; // Defined in devices.json as "Abdulaziz's iPhone"
      setDeviceTelemetry(devId, {
        battery: 95,
        charging: false,
        wakeLock: false,
        route: 'lan',
      });

      const list = await getDevicesList();
      const phoneDev = list.find((d) => d.id === devId);
      assert.ok(phoneDev, 'Should find iPhone peer');
      assert.ok(phoneDev.telemetry, 'Should have telemetry attached');
      assert.equal(phoneDev.telemetry.battery, 95);
      assert.equal(phoneDev.online, true, 'Recent telemetry should mark phone online');
    });
  });

  describe('HTTP REST Endpoints Integration', () => {
    test('POST /api/devices/:id/command enqueues command and returns JSON', async () => {
      const res = await fetch(`${baseUrl}/api/devices/iphone-1/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(data.command);
      assert.equal(data.command.action, 'ping');
    });

    test('POST /api/devices/:id/command rejects empty action', async () => {
      const res = await fetch(`${baseUrl}/api/devices/iphone-1/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.status, 'error');
    });

    test('GET /api/devices/:id/events dequeues enqueued commands', async () => {
      // Enqueue a command first
      await fetch(`${baseUrl}/api/devices/iphone-test-events/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open_url', url: 'https://aion.network' }),
      });

      // Dequeue via events endpoint
      const res = await fetch(`${baseUrl}/api/devices/iphone-test-events/events?wait=false`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.commands.length, 1);
      assert.equal(data.commands[0].action, 'open_url');
      assert.equal(data.commands[0].payload.url, 'https://aion.network');
    });

    test('POST & GET /api/devices/:id/telemetry stores and serves telemetry', async () => {
      const devId = 'iphone-telemetry-test';
      const postRes = await fetch(`${baseUrl}/api/devices/${devId}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battery: 74, charging: true, wakeLock: true, route: 'mesh' }),
      });

      assert.equal(postRes.status, 200);
      const postData = await postRes.json();
      assert.equal(postData.status, 'ok');
      assert.equal(postData.telemetry.battery, 74);
      assert.equal(postData.telemetry.charging, true);

      // GET verification
      const getRes = await fetch(`${baseUrl}/api/devices/${devId}/telemetry`);
      assert.equal(getRes.status, 200);
      const getData = await getRes.json();
      assert.equal(getData.status, 'ok');
      assert.equal(getData.telemetry.battery, 74);
    });

    test('GET /api/devices includes clientIp for mobile node auto-discovery', async () => {
      const res = await fetch(`${baseUrl}/api/devices`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(Array.isArray(data.devices));
      assert.ok('clientIp' in data, 'Response should provide clientIp');
    });
  });
});
