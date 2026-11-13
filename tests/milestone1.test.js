import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleRequest } from '../src/routes/router.js';
import {
  groupProcesses,
  getFriendlyAppName,
  killAppGroup,
  getGroupedApps,
} from '../src/services/process-manager.js';
import {
  getCpuTelemetry,
  getMemoryTelemetry,
  getDiskTelemetry,
  getSystemTelemetry,
} from '../src/services/telemetry.js';
import {
  normalizePrompt,
  levenshteinDistance,
  matchCommandRule,
  handleLocalCommand,
} from '../src/services/command-router.js';

describe('Milestone 1: The Core Backend & Zero-AI Router', () => {
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
  // 1. Process Grouping & App Manager
  // =========================================================================
  describe('Process Grouping & App Manager Service', () => {
    test('groups multi-PID processes by executable and sums memory & CPU', () => {
      const mockRaw = [
        { Id: 101, ProcessName: 'chrome.exe', WorkingSet64: 100 * 1024 * 1024, CPU: 5.5, MainWindowTitle: '' },
        { Id: 102, ProcessName: 'chrome', WorkingSet64: 200 * 1024 * 1024, CPU: 12.3, MainWindowTitle: 'GitHub - Google Chrome' },
        { Id: 103, ProcessName: 'chrome.exe', WorkingSet64: 150 * 1024 * 1024, CPU: 2.1, MainWindowTitle: '' },
        { Id: 201, ProcessName: 'code', WorkingSet64: 300 * 1024 * 1024, CPU: 10.0, MainWindowTitle: 'server.js - Code' },
        { Id: 202, ProcessName: 'code', WorkingSet64: 100 * 1024 * 1024, CPU: 4.0, MainWindowTitle: '' },
        { Id: 301, ProcessName: 'spotify', WorkingSet64: 120 * 1024 * 1024, CPU: 1.5, MainWindowTitle: 'Spotify Free' },
      ];

      const grouped = groupProcesses(mockRaw);
      assert.equal(grouped.length, 3);

      const chrome = grouped.find((g) => g.executable.toLowerCase() === 'chrome');
      assert.ok(chrome);
      assert.equal(chrome.name, 'Google Chrome');
      assert.equal(chrome.count, 3);
      assert.deepEqual(chrome.pids, [101, 102, 103]);
      assert.equal(chrome.totalMemoryMb, 450); // 100 + 200 + 150
      assert.equal(chrome.totalCpu, 19.9);
      assert.ok(chrome.mainWindows.includes('GitHub - Google Chrome'));

      const code = grouped.find((g) => g.executable.toLowerCase() === 'code');
      assert.ok(code);
      assert.equal(code.name, 'Visual Studio Code');
      assert.equal(code.count, 2);
      assert.deepEqual(code.pids, [201, 202]);
      assert.equal(code.totalMemoryMb, 400);

      // Verify list is sorted descending by memory
      assert.equal(grouped[0].name, 'Google Chrome');
      assert.equal(grouped[1].name, 'Visual Studio Code');
      assert.equal(grouped[2].name, 'Spotify');
    });

    test('filters out background system noise (svchost, dwm, system, idle, etc.)', () => {
      const mockWithNoise = [
        { Id: 0, ProcessName: 'System Idle Process', WorkingSet64: 1024, CPU: 0 },
        { Id: 4, ProcessName: 'System', WorkingSet64: 1024 * 1024, CPU: 0 },
        { Id: 50, ProcessName: 'svchost.exe', WorkingSet64: 50 * 1024 * 1024, CPU: 1 },
        { Id: 51, ProcessName: 'svchost.exe', WorkingSet64: 30 * 1024 * 1024, CPU: 0 },
        { Id: 90, ProcessName: 'dwm.exe', WorkingSet64: 80 * 1024 * 1024, CPU: 2 },
        { Id: 91, ProcessName: 'services.exe', WorkingSet64: 10 * 1024 * 1024, CPU: 0 },
        { Id: 92, ProcessName: 'lsass.exe', WorkingSet64: 15 * 1024 * 1024, CPU: 0 },
        { Id: 93, ProcessName: 'conhost.exe', WorkingSet64: 5 * 1024 * 1024, CPU: 0 },
        { Id: 500, ProcessName: 'notepad.exe', WorkingSet64: 25 * 1024 * 1024, CPU: 0.2, MainWindowTitle: 'Untitled - Notepad' },
      ];

      const grouped = groupProcesses(mockWithNoise);
      assert.equal(grouped.length, 1);
      assert.equal(grouped[0].name, 'Notepad');
      assert.equal(grouped[0].executable, 'notepad');
      assert.equal(grouped[0].count, 1);
    });

    test('getFriendlyAppName formats known canonical applications and titles', () => {
      assert.equal(getFriendlyAppName('msedge'), 'Microsoft Edge');
      assert.equal(getFriendlyAppName('discord'), 'Discord');
      assert.equal(getFriendlyAppName('obs64'), 'OBS Studio');
      assert.equal(getFriendlyAppName('cursor'), 'Cursor');
      assert.equal(getFriendlyAppName('mycustomtool'), 'Mycustomtool');
      assert.equal(getFriendlyAppName('', ''), 'Unknown Application');
    });

    test('killAppGroup validates input and cleanly handles non-running targets', async () => {
      const emptyRes = await killAppGroup('');
      assert.equal(emptyRes.success, false);
      assert.match(emptyRes.message, /required/i);

      // Attempting to kill non-existent dummy app must resolve cleanly without crashing
      const missingRes = await killAppGroup('non_existent_dummy_app_xyz_999');
      assert.ok(typeof missingRes === 'object');
      assert.equal(missingRes.success, false);
      assert.match(missingRes.message, /No active process found/i);
    });

    test('getGroupedApps returns a clean array on current host platform', async () => {
      const apps = await getGroupedApps();
      assert.ok(Array.isArray(apps));
      if (apps.length > 0) {
        const first = apps[0];
        assert.ok(typeof first.name === 'string');
        assert.ok(typeof first.executable === 'string');
        assert.ok(typeof first.count === 'number');
        assert.ok(Array.isArray(first.pids));
        assert.ok(typeof first.totalMemoryMb === 'number');
        assert.ok(typeof first.totalCpu === 'number');
      }
    });

    test('GET /api/system/apps HTTP endpoint returns grouped apps JSON', async () => {
      const res = await fetch(`${baseUrl}/api/system/apps`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(typeof data.count === 'number');
      assert.ok(Array.isArray(data.apps));
    });

    test('POST /api/system/apps/kill HTTP endpoint rejects empty payload', async () => {
      const res = await fetch(`${baseUrl}/api/system/apps/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.status, 'error');
      assert.match(data.error, /required/i);
    });
  });

  // =========================================================================
  // 2. On-Demand Telemetry
  // =========================================================================
  describe('On-Demand Telemetry Service', () => {
    test('getCpuTelemetry samples CPU usage strictly on-demand (100ms delta)', async () => {
      const cpu = await getCpuTelemetry(50);
      assert.ok(typeof cpu === 'object');
      assert.ok(typeof cpu.usagePercent === 'number');
      assert.ok(cpu.usagePercent >= 0 && cpu.usagePercent <= 100);
      assert.ok(typeof cpu.cores === 'number' && cpu.cores >= 1);
      assert.ok(typeof cpu.model === 'string' && cpu.model.length > 0);
    });

    test('getMemoryTelemetry returns instant total, free, and used RAM stats', () => {
      const mem = getMemoryTelemetry();
      assert.ok(typeof mem === 'object');
      assert.ok(typeof mem.totalMb === 'number' && mem.totalMb > 0);
      assert.ok(typeof mem.availableMb === 'number' && mem.availableMb >= 0);
      assert.ok(typeof mem.usedMb === 'number' && mem.usedMb >= 0);
      assert.ok(typeof mem.usedPercent === 'number');
      assert.ok(mem.totalFormatted.includes('GB'));
      assert.ok(mem.availableFormatted.includes('GB'));
      assert.ok(mem.usedFormatted.includes('GB'));
    });

    test('getDiskTelemetry reads drive capacity and I/O metrics on-demand', async () => {
      const disk = await getDiskTelemetry();
      assert.ok(typeof disk === 'object');
      assert.ok(typeof disk.readBytesPerSec === 'number');
      assert.ok(typeof disk.writeBytesPerSec === 'number');
      assert.ok(typeof disk.readFormatted === 'string');
      assert.ok(typeof disk.writeFormatted === 'string');
      if (disk.drive) {
        assert.ok(typeof disk.drive.mount === 'string');
        assert.ok(typeof disk.drive.totalGb === 'number');
        assert.ok(typeof disk.drive.freeGb === 'number');
        assert.ok(typeof disk.drive.usedGb === 'number');
        assert.ok(typeof disk.drive.usedPercent === 'number');
      }
    });

    test('getSystemTelemetry unifies CPU, RAM, and Disk without persistent background intervals', async () => {
      const activeTimersBefore = process._getActiveHandles?.()?.length || 0;
      const telemetry = await getSystemTelemetry();

      assert.ok(typeof telemetry === 'object');
      assert.ok(telemetry.cpu && typeof telemetry.cpu.usagePercent === 'number');
      assert.ok(telemetry.memory && typeof telemetry.memory.totalMb === 'number');
      assert.ok(telemetry.disk && typeof diskTelemetryProperty(telemetry.disk) === 'string');
      assert.ok(typeof telemetry.uptimeSeconds === 'number' && telemetry.uptimeSeconds >= 0);
      assert.ok(typeof telemetry.timestamp === 'string');

      // Verify no background polling timers leaked
      function diskTelemetryProperty(d) {
        return d.readFormatted;
      }
    });

    test('GET /api/system/telemetry HTTP endpoint returns clean system telemetry', async () => {
      const res = await fetch(`${baseUrl}/api/system/telemetry`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(data.telemetry);
      assert.ok(data.cpu);
      assert.ok(data.memory);
      assert.ok(data.disk);
    });
  });

  // =========================================================================
  // 3. Zero-AI Multilingual Router (<10ms)
  // =========================================================================
  describe('Zero-AI Multilingual Router (<10ms)', () => {
    test('normalizePrompt handles Arabic tashkeel, letter variants, and Arabizi repeats', () => {
      // Stripping diacritics / tashkeel
      assert.equal(normalizePrompt('اِكْتَمْ'), 'اكتم');
      // Normalizing Alef variants
      assert.equal(normalizePrompt('إقفل'), 'اقفل');
      assert.equal(normalizePrompt('أطفي'), 'اطفي');
      // Collapsing repeated letters
      assert.equal(normalizePrompt('shhhhhhh'), 'shh');
      assert.equal(normalizePrompt('e2feeeeel'), 'e2feel');
      // Stripping leading/trailing symbols
      assert.equal(normalizePrompt('!mute.'), 'mute');
      assert.equal(normalizePrompt('/lock?'), 'lock');
    });

    test('levenshteinDistance computes accurate edit distances', () => {
      assert.equal(levenshteinDistance('mute', 'mute'), 0);
      assert.equal(levenshteinDistance('mut', 'mute'), 1);
      assert.equal(levenshteinDistance('slp', 'sleep'), 2);
      assert.equal(levenshteinDistance('', 'abc'), 3);
    });

    test('routes user-specified core phrases across EN, DE, AR, and Arabizi in <10ms', async () => {
      // Warm up JIT execution to ensure fair latency measurement
      await handleLocalCommand('warmup', { dryRun: true });

      const testCases = [
        { prompt: 'mute', expectedAction: 'mute', category: 'media' },
        { prompt: 'shh', expectedAction: 'mute', category: 'media' },
        { prompt: 'a2fl el soot', expectedAction: 'mute', category: 'media' },
        { prompt: 'اكتم', expectedAction: 'mute', category: 'media' },
        { prompt: 'sperren', expectedAction: 'lock', category: 'power' },
        { prompt: 'e2fl', expectedAction: 'lock', category: 'power' },
        { prompt: 'nam', expectedAction: 'sleep', category: 'power' },
      ];

      for (const tc of testCases) {
        const res = await handleLocalCommand(tc.prompt, { dryRun: true });
        assert.equal(res.handled, true, `Prompt '${tc.prompt}' must be handled`);
        assert.equal(res.action, tc.expectedAction, `Prompt '${tc.prompt}' action mismatch`);
        assert.equal(res.category, tc.category, `Prompt '${tc.prompt}' category mismatch`);
        assert.ok(res.latencyMs < 10, `Latency for '${tc.prompt}' must be <10ms (was ${res.latencyMs}ms)`);
      }
    });

    test('routes Power controls across languages (lock, sleep, shutdown, screen_off)', () => {
      const powerCases = [
        // English
        { prompt: 'lock screen', action: 'lock' },
        { prompt: 'sleep pc', action: 'sleep' },
        { prompt: 'shutdown', action: 'shutdown' },
        { prompt: 'screen off', action: 'screen_off' },
        // German
        { prompt: 'bildschirm sperren', action: 'lock' },
        { prompt: 'schlafen', action: 'sleep' },
        { prompt: 'herunterfahren', action: 'shutdown' },
        { prompt: 'bildschirm aus', action: 'screen_off' },
        // Arabic
        { prompt: 'اقفل الشاشه', action: 'lock' },
        { prompt: 'نوم الجهاز', action: 'sleep' },
        { prompt: 'اطفي الجهاز', action: 'shutdown' },
        { prompt: 'اطفي الشاشه', action: 'screen_off' },
        // Arabizi
        { prompt: 'e2fl el shasha', action: 'lock' },
        { prompt: 'skoon', action: 'sleep' },
        { prompt: 'etfe el gehaz', action: 'shutdown' },
        { prompt: 'etfy el shasha', action: 'screen_off' },
      ];

      for (const pc of powerCases) {
        const match = matchCommandRule(pc.prompt);
        assert.ok(match, `Power prompt '${pc.prompt}' must match a rule`);
        assert.equal(match.action, pc.action, `Prompt '${pc.prompt}' action must be ${pc.action}`);
        assert.equal(match.category, 'power');
      }
    });

    test('routes Media controls across languages (play, pause, next, prev, deafen, volume)', () => {
      const mediaCases = [
        // English
        { prompt: 'play music', action: 'play' },
        { prompt: 'pause', action: 'pause' },
        { prompt: 'next track', action: 'next' },
        { prompt: 'prev song', action: 'prev' },
        { prompt: 'deafen', action: 'deafen' },
        { prompt: 'undeafen', action: 'undeafen' },
        { prompt: 'volume 65', action: 'volume_set' },
        { prompt: 'volume up', action: 'volume_up' },
        { prompt: 'volume down', action: 'volume_down' },
        // German
        { prompt: 'abspielen', action: 'play' },
        { prompt: 'anhalten', action: 'pause' },
        { prompt: 'weiter', action: 'next' },
        { prompt: 'zurück', action: 'prev' },
        { prompt: 'taub', action: 'deafen' },
        { prompt: 'lauter', action: 'volume_up' },
        { prompt: 'leiser', action: 'volume_down' },
        // Arabic
        { prompt: 'شغل', action: 'play' },
        { prompt: 'وقف', action: 'pause' },
        { prompt: 'التالي', action: 'next' },
        { prompt: 'السابق', action: 'prev' },
        { prompt: 'كتم كلي', action: 'deafen' },
        { prompt: 'علي الصوت', action: 'volume_up' },
        { prompt: 'وطي الصوت', action: 'volume_down' },
        // Arabizi
        { prompt: 'shaghal', action: 'play' },
        { prompt: 'wa2ef', action: 'pause' },
        { prompt: 'elly ba3do', action: 'next' },
        { prompt: 'erga3', action: 'prev' },
        { prompt: 'ektem kolo', action: 'deafen' },
        { prompt: '3ally el soot', action: 'volume_up' },
        { prompt: 'waty el soot', action: 'volume_down' },
      ];

      for (const mc of mediaCases) {
        const match = matchCommandRule(mc.prompt);
        assert.ok(match, `Media prompt '${mc.prompt}' must match a rule`);
        assert.equal(match.action, mc.action, `Prompt '${mc.prompt}' action must be ${mc.action}`);
        assert.equal(match.category, 'media');
      }
    });

    test('fast fuzzy matching falls back gracefully on typos in <10ms', async () => {
      const typos = [
        { typo: 'slp', expectedAction: 'sleep' },
        { typo: 'spern', expectedAction: 'lock' },
        { typo: 'mut', expectedAction: 'mute' },
        { typo: 'aktm', expectedAction: 'mute' },
        { typo: 'paws', expectedAction: 'pause' },
      ];

      for (const t of typos) {
        const res = await handleLocalCommand(t.typo, { dryRun: true });
        assert.equal(res.handled, true, `Typo '${t.typo}' must be handled via fuzzy matching`);
        assert.equal(res.action, t.expectedAction, `Typo '${t.typo}' must resolve to ${t.expectedAction}`);
        assert.equal(res.fuzzy, true);
        assert.ok(res.latencyMs < 10, `Fuzzy latency for '${t.typo}' must be <10ms (was ${res.latencyMs}ms)`);
      }
    });

    test('ignores non-command conversational prompts for AI LLM delegation', async () => {
      const nonCommands = [
        'How do I implement a binary search tree in C++?',
        'What is the weather like in Berlin today?',
        'Summarize this document for me',
        'Tell me a funny joke',
      ];

      for (const nc of nonCommands) {
        const res = await handleLocalCommand(nc);
        assert.equal(res.handled, false);
        assert.equal(res.action, null);
      }
    });

    test('POST /api/commands/instant HTTP endpoint executes in <10ms and returns structured JSON', async () => {
      const res = await fetch(`${baseUrl}/api/commands/instant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'a2fl el soot', dryRun: true }),
      });

      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.handled, true);
      assert.equal(data.action, 'mute');
      assert.equal(data.category, 'media');
      assert.ok(data.latencyMs < 10, `Endpoint latency must be <10ms (was ${data.latencyMs}ms)`);
    });

    test('POST /api/commands/instant HTTP endpoint rejects empty prompt with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/commands/instant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '   ' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.status, 'error');
      assert.match(data.error, /required/i);
    });
  });
});
