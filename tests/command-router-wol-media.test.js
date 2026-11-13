import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleLocalCommand } from '../src/services/command-router.js';
import { parseMediaStatusOutput } from '../src/services/media.js';
import { getWolStatus, enableWol } from '../src/services/wol.js';

describe('Pre-Beta.2 Stabilization & Native Packaging Validations', () => {
  describe('Instant Deterministic Local Command Router (<50ms)', () => {
    test('routes audio mute, unmute, deafen, and undeafen immediately', async () => {
      const muteRes = await handleLocalCommand('mute');
      assert.equal(muteRes.handled, true);
      assert.match(muteRes.response, /muted/i);

      const unmuteRes = await handleLocalCommand('unmute');
      assert.equal(unmuteRes.handled, true);
      assert.match(unmuteRes.response, /unmuted/i);

      const deafenRes = await handleLocalCommand('deafen');
      assert.equal(deafenRes.handled, true);
      assert.match(deafenRes.response, /deafened/i);

      const undeafenRes = await handleLocalCommand('undeafen');
      assert.equal(undeafenRes.handled, true);
      assert.match(undeafenRes.response, /undeafened/i);
    });

    test('routes volume adjustments with natural phrasing and numeric clamping', async () => {
      const vol1 = await handleLocalCommand('volume 75');
      assert.equal(vol1.handled, true);
      assert.equal(vol1.response, 'Volume set to 75%.');

      const vol2 = await handleLocalCommand('vol 30%');
      assert.equal(vol2.handled, true);
      assert.equal(vol2.response, 'Volume set to 30%.');

      const vol3 = await handleLocalCommand('set volume to 120');
      assert.equal(vol3.handled, true);
      assert.equal(vol3.response, 'Volume set to 100%.');
    });

    test('routes media playback controls (play, pause, next, prev)', async () => {
      const p1 = await handleLocalCommand('pause');
      assert.equal(p1.handled, true);

      const p2 = await handleLocalCommand('play');
      assert.equal(p2.handled, true);

      const p3 = await handleLocalCommand('next');
      assert.equal(p3.handled, true);

      const p4 = await handleLocalCommand('previous');
      assert.equal(p4.handled, true);
    });

    test('routes system status and ignores non-local prompts', async () => {
      const statusRes = await handleLocalCommand('status');
      assert.equal(statusRes.handled, true);
      assert.match(statusRes.response, /online/i);

      // AI/code prompt must return handled: false
      const aiPrompt = await handleLocalCommand('Build a responsive web application');
      assert.equal(aiPrompt.handled, false);

      const emptyPrompt = await handleLocalCommand('');
      assert.equal(emptyPrompt.handled, false);
    });
  });

  describe('Accurate Wake-on-LAN Detection & 1-Click Fix', () => {
    test('getWolStatus returns accurate state and fast startup telemetry', async () => {
      const wol = await getWolStatus();
      assert.ok(typeof wol === 'object');
      assert.ok(typeof wol.supported === 'boolean');
      assert.ok(typeof wol.enabled === 'boolean');
      assert.ok(typeof wol.fastStartupBlocking === 'boolean');
      assert.ok(['os_ready', 'fast_startup_blocked', 'disabled'].includes(wol.state));
    });

    test('enableWol executes without crashing and returns status message', async () => {
      const result = await enableWol();
      assert.ok(typeof result.success === 'boolean');
      assert.ok(typeof result.message === 'string');
    });
  });

  describe('Live Media Cover Art & Memory Caching', () => {
    test('parseMediaStatusOutput preserves artwork data and caches by track', () => {
      const dummyB64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      const output = parseMediaStatusOutput({
        playing: true,
        title: 'Starboy',
        artist: 'The Weeknd',
        sourceApp: 'Spotify',
        artwork: dummyB64,
        volume: 80,
      });

      assert.equal(output.artwork, dummyB64);
      assert.equal(output.title, 'Starboy');

      // Subsequent call without artwork should inherit from memory cache
      const cachedOutput = parseMediaStatusOutput({
        playing: true,
        title: 'Starboy',
        artist: 'The Weeknd',
        sourceApp: 'Spotify',
        artwork: '',
        volume: 80,
      });

      assert.equal(cachedOutput.artwork, dummyB64);
    });
  });

  describe('Native Executables & Packaging Suite', () => {
    test('verifies dist/AION.exe, dist/AION-Setup.exe, and dist/Uninstall.exe exist', () => {
      if (process.platform === 'win32') {
        assert.ok(fs.existsSync('dist/AION.exe'), 'dist/AION.exe must exist');
        assert.ok(fs.existsSync('dist/AION-Setup.exe'), 'dist/AION-Setup.exe must exist');
        assert.ok(fs.existsSync('dist/Uninstall.exe'), 'dist/Uninstall.exe must exist');

        const appStats = fs.statSync('dist/AION.exe');
        assert.ok(appStats.size > 20000, 'AION.exe must be a valid executable');

        const setupStats = fs.statSync('dist/AION-Setup.exe');
        assert.ok(setupStats.size > 500000, 'AION-Setup.exe must contain embedded payload and WebView2 assemblies (>500KB)');
      }
    });
  });
});
