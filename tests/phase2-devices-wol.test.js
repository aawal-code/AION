import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleRequest } from '../src/routes/router.js';
import { classifyChassis, updateDevice, getDevicesList, loadRegistry } from '../src/services/devices.js';
import { buildMagicPacket, calculateBroadcastAddress } from '../src/services/wol.js';
import { parseProcesses } from '../src/services/os.js';
import { sanitizeCommand } from '../src/utils/sanitizer.js';

describe('Phase 2: Device Classification, WoL & Extended Controls', () => {
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

  describe('Device Classification Logic', () => {
    test('accurately classifies SMBIOS chassis codes', () => {
      // Desktop / Tower types
      assert.equal(classifyChassis(3), 'desktop', 'Chassis 3 should be desktop');
      assert.equal(classifyChassis(4), 'desktop', 'Chassis 4 should be desktop');
      assert.equal(classifyChassis(6), 'desktop', 'Chassis 6 should be desktop');
      assert.equal(classifyChassis(7), 'desktop', 'Chassis 7 should be desktop');

      // Laptop / Portable types
      assert.equal(classifyChassis(8), 'laptop', 'Chassis 8 should be laptop');
      assert.equal(classifyChassis(9), 'laptop', 'Chassis 9 should be laptop');
      assert.equal(classifyChassis(10), 'laptop', 'Chassis 10 should be laptop');
      assert.equal(classifyChassis(14), 'laptop', 'Chassis 14 should be laptop');
      assert.equal(classifyChassis(30), 'laptop', 'Chassis 30 should be laptop');

      // Server / Rackmount types
      assert.equal(classifyChassis(23), 'server', 'Chassis 23 should be server');
      assert.equal(classifyChassis(28), 'server', 'Chassis 28 should be server');

      // Default fallback
      assert.equal(classifyChassis('invalid'), 'desktop');
      assert.equal(classifyChassis(null), 'desktop');
    });

    test('device overrides persist and update properly', async () => {
      const updated = await updateDevice('test-device-1', {
        name: 'Living Room PC',
        type: 'desktop',
        mac: 'AA-BB-CC-DD-EE-FF',
        lanIp: '192.168.1.150',
      });

      assert.equal(updated.name, 'Living Room PC');
      assert.equal(updated.type, 'desktop');
      assert.equal(updated.mac, 'AA:BB:CC:DD:EE:FF');
      assert.equal(updated.lanIp, '192.168.1.150');

      const registry = loadRegistry();
      assert.ok(registry.devices['test-device-1']);
      assert.equal(registry.devices['test-device-1'].name, 'Living Room PC');
    });
  });

  describe('Wake-on-LAN Magic Packet Builder', () => {
    test('builds standard 102-byte AMD Magic Packet Buffer', () => {
      const mac = '74:56:3C:2E:D6:BA';
      const packet = buildMagicPacket(mac);

      assert.equal(packet.length, 102, 'Magic packet must be exactly 102 bytes');

      // First 6 bytes must be 0xFF
      for (let i = 0; i < 6; i++) {
        assert.equal(packet[i], 0xff, `Byte ${i} must be 0xFF`);
      }

      // 16 repetitions of 6-byte target MAC
      const expectedMacBytes = Buffer.from('74563C2ED6BA', 'hex');
      for (let rep = 0; rep < 16; rep++) {
        const offset = 6 + rep * 6;
        const slice = packet.subarray(offset, offset + 6);
        assert.deepEqual(slice, expectedMacBytes, `MAC repetition ${rep} mismatch`);
      }
    });

    test('supports various MAC formatting delimiters and rejects malformed addresses', () => {
      assert.doesNotThrow(() => buildMagicPacket('00-11-22-33-44-55'));
      assert.doesNotThrow(() => buildMagicPacket('00:11:22:33:44:55'));
      assert.doesNotThrow(() => buildMagicPacket('001122334455'));

      assert.throws(() => buildMagicPacket(''));
      assert.throws(() => buildMagicPacket('00:11:22:33:44')); // Too short
      assert.throws(() => buildMagicPacket('00:11:22:33:44:55:66')); // Too long
      assert.throws(() => buildMagicPacket('00:11:22:33:44:ZZ')); // Invalid hex
    });

    test('calculates subnet broadcast address accurately', () => {
      assert.equal(calculateBroadcastAddress('192.168.1.50', '255.255.255.0'), '192.168.1.255');
      assert.equal(calculateBroadcastAddress('10.0.0.5', '255.0.0.0'), '10.255.255.255');
      assert.equal(calculateBroadcastAddress('172.16.5.10', '255.255.0.0'), '172.16.255.255');
    });
  });

  describe('Process Parser & Sanitizer Extensions', () => {
    test('sanitizer permits screen_off and shutdown actions', () => {
      assert.doesNotThrow(() => sanitizeCommand('screen_off'));
      assert.doesNotThrow(() => sanitizeCommand('shutdown'));
    });

    test('parses Windows raw processes and filters kernel/system entries', () => {
      const mockWindows = JSON.stringify([
        { Id: 101, ProcessName: 'System', MainWindowTitle: '', WorkingSet64: 200 * 1024 * 1024 },
        { Id: 102, ProcessName: 'svchost', MainWindowTitle: '', WorkingSet64: 150 * 1024 * 1024 },
        { Id: 201, ProcessName: 'chrome', MainWindowTitle: 'GitHub - Google Chrome', WorkingSet64: 450 * 1024 * 1024 },
        { Id: 202, ProcessName: 'Code', MainWindowTitle: 'aion - Visual Studio Code', WorkingSet64: 320 * 1024 * 1024 },
        { Id: 203, ProcessName: 'Spotify', MainWindowTitle: 'Spotify Free', WorkingSet64: 180 * 1024 * 1024 },
      ]);

      const parsed = parseProcesses(mockWindows, 'win32');
      assert.equal(parsed.length, 3);
      assert.equal(parsed[0].name, 'Google Chrome');
      assert.equal(parsed[0].memoryMb, 450);
      assert.equal(parsed[1].name, 'Visual Studio Code');
      assert.equal(parsed[2].name, 'Spotify');
    });

    test('parses Linux ps process output cleanly', () => {
      const mockLinux = `
 100 10240 systemd /sbin/init
 200 450560 chrome /opt/google/chrome/chrome
 300 204800 spotify /snap/bin/spotify
      `;

      const parsed = parseProcesses(mockLinux, 'linux');
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].name, 'Google Chrome');
      assert.equal(parsed[0].memoryMb, 440);
      assert.equal(parsed[1].name, 'Spotify');
    });
  });

  describe('HTTP Endpoints Integration', () => {
    test('GET /api/devices returns node list with local node first', async () => {
      const res = await fetch(`${baseUrl}/api/devices`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(Array.isArray(data.devices));
      assert.ok(data.devices.length >= 1);
      const local = data.devices[0];
      assert.equal(local.isLocal, true);
      assert.ok(local.id === 'local');
      assert.ok(local.mac);
    });

    test('PATCH /api/devices/:id updates friendly device info', async () => {
      const res = await fetch(`${baseUrl}/api/devices/local`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Primary Workstation', type: 'desktop' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.device.name, 'Primary Workstation');
      assert.equal(data.device.type, 'desktop');
    });

    test('GET /api/system/wol returns valid WoL adapter diagnostic payload', async () => {
      const res = await fetch(`${baseUrl}/api/system/wol`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(typeof data.supported, 'boolean');
      assert.equal(typeof data.enabled, 'boolean');
      assert.equal(typeof data.fastStartupBlocking, 'boolean');
      assert.ok(typeof data.mac === 'string');
    });

    test('POST /api/devices/:id/wake broadcasts UDP packet for configured device', async () => {
      const res = await fetch(`${baseUrl}/api/devices/local/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: '74:56:3C:2E:D6:BA' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.broadcasts));
    });

    test('GET /api/system/processes returns top running processes', async () => {
      const res = await fetch(`${baseUrl}/api/system/processes`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(Array.isArray(data.processes));
      if (data.processes.length > 0) {
        const first = data.processes[0];
        assert.ok(typeof first.pid === 'number');
        assert.ok(typeof first.name === 'string');
        assert.ok(typeof first.memoryMb === 'number');
      }
    });
  });
});
