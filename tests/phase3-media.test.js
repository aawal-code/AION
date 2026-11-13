import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleRequest } from '../src/routes/router.js';
import { sanitizeMediaAction, InvalidCommandError } from '../src/utils/sanitizer.js';
import { parseMediaStatusOutput, getMediaStatus, controlMedia, _resetMediaStateForTests } from '../src/services/media.js';

describe('Phase 3: Live Media Session & Audio Deck', () => {
  describe('Sanitizer & Action Validation', () => {
    test('permits valid media actions with appropriate values', () => {
      assert.deepEqual(sanitizeMediaAction('play_pause'), { action: 'play_pause', value: undefined });
      assert.deepEqual(sanitizeMediaAction('next'), { action: 'next', value: undefined });
      assert.deepEqual(sanitizeMediaAction('prev'), { action: 'prev', value: undefined });
      assert.deepEqual(sanitizeMediaAction('volume', 45), { action: 'volume', value: 45 });
      assert.deepEqual(sanitizeMediaAction('volume', '75'), { action: 'volume', value: 75 });
      assert.deepEqual(sanitizeMediaAction('volume', 0), { action: 'volume', value: 0 });
      assert.deepEqual(sanitizeMediaAction('volume', 100), { action: 'volume', value: 100 });
      assert.deepEqual(sanitizeMediaAction('mute', true), { action: 'mute', value: true });
      assert.deepEqual(sanitizeMediaAction('mute', false), { action: 'mute', value: false });
      assert.deepEqual(sanitizeMediaAction('deafen', true), { action: 'deafen', value: true });
      assert.deepEqual(sanitizeMediaAction('deafen', false), { action: 'deafen', value: false });
      assert.deepEqual(sanitizeMediaAction('mute'), { action: 'mute', value: undefined });
      assert.deepEqual(sanitizeMediaAction('deafen'), { action: 'deafen', value: undefined });
    });

    test('rejects disallowed or unknown media actions', () => {
      assert.throws(() => sanitizeMediaAction('restart_audio'), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction(''), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction(null), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('shuffle'), InvalidCommandError);
    });

    test('rejects shell metacharacters in action', () => {
      assert.throws(() => sanitizeMediaAction('play_pause; echo hack'), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('volume && calc'), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('mute | dir'), InvalidCommandError);
    });

    test('rejects invalid or out-of-bounds volume values', () => {
      assert.throws(() => sanitizeMediaAction('volume', -1), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('volume', 101), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('volume', 'not_a_number'), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('volume', NaN), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('volume', Infinity), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('volume', null), InvalidCommandError);
      assert.throws(() => sanitizeMediaAction('volume', undefined), InvalidCommandError);
    });
  });

  describe('Media Payload Parsing & State Normalization', () => {
    test('parses full media payload accurately', () => {
      const parsed = parseMediaStatusOutput({
        playing: true,
        title: 'Starboy',
        artist: 'The Weeknd',
        sourceApp: 'Spotify.exe',
        volume: 72,
        muted: false,
      });

      assert.equal(parsed.playing, true);
      assert.equal(parsed.title, 'Starboy');
      assert.equal(parsed.artist, 'The Weeknd');
      assert.equal(parsed.sourceApp, 'Spotify.exe');
      assert.equal(parsed.volume, 72);
      assert.equal(parsed.muted, false);
      assert.equal(parsed.deafened, false);
    });

    test('handles empty or missing media payloads gracefully with sensible defaults', () => {
      const parsedNull = parseMediaStatusOutput(null);
      assert.equal(parsedNull.playing, false);
      assert.equal(parsedNull.title, '');
      assert.equal(parsedNull.artist, '');
      assert.equal(parsedNull.sourceApp, '');
      assert.equal(parsedNull.volume, 50);
      assert.equal(parsedNull.muted, false);

      const parsedEmpty = parseMediaStatusOutput({});
      assert.equal(parsedEmpty.playing, false);
      assert.equal(parsedEmpty.title, '');
      assert.equal(parsedEmpty.artist, '');
      assert.equal(parsedEmpty.sourceApp, '');
      assert.equal(parsedEmpty.volume, 0);
      assert.equal(parsedEmpty.muted, false);
    });

    test('clamps volume values strictly between 0 and 100', () => {
      const low = parseMediaStatusOutput({ volume: -50 });
      assert.equal(low.volume, 0);

      const high = parseMediaStatusOutput({ volume: 250 });
      assert.equal(high.volume, 100);

      const rounded = parseMediaStatusOutput({ volume: 83.7 });
      assert.equal(rounded.volume, 84);
    });
  });

  describe('HTTP Endpoints Integration', () => {
    let server;
    let baseUrl;

    before(async () => {
      _resetMediaStateForTests();
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

    test('GET /api/media/status returns valid media telemetry payload', async () => {
      const res = await fetch(`${baseUrl}/api/media/status`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /json/);

      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(typeof data.playing, 'boolean');
      assert.equal(typeof data.title, 'string');
      assert.equal(typeof data.artist, 'string');
      assert.equal(typeof data.sourceApp, 'string');
      assert.equal(typeof data.volume, 'number');
      assert.ok(data.volume >= 0 && data.volume <= 100);
      assert.equal(typeof data.muted, 'boolean');
      assert.equal(typeof data.deafened, 'boolean');
    });

    test('POST /api/media/control sets volume cleanly', async () => {
      const res = await fetch(`${baseUrl}/api/media/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'volume', value: 85 }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.volume, 85);
    });

    test('POST /api/media/control handles deafen toggle and simultaneous mute', async () => {
      // 1. Deafen
      const resDeafen = await fetch(`${baseUrl}/api/media/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deafen', value: true }),
      });

      assert.equal(resDeafen.status, 200);
      const deafData = await resDeafen.json();
      assert.equal(deafData.status, 'ok');
      assert.equal(deafData.deafened, true);
      assert.equal(deafData.muted, true);

      // 2. Undeafen
      const resUndeafen = await fetch(`${baseUrl}/api/media/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deafen', value: false }),
      });

      assert.equal(resUndeafen.status, 200);
      const undeafData = await resUndeafen.json();
      assert.equal(undeafData.status, 'ok');
      assert.equal(undeafData.deafened, false);
    });

    test('POST /api/media/control rejects invalid action with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/media/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hack_soundcard' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.status, 'error');
      assert.match(data.error, /Disallowed media action/);
    });

    test('POST /api/media/control rejects invalid volume value with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/media/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'volume', value: 999 }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.status, 'error');
      assert.match(data.error, /Volume value must be between 0 and 100/);
    });
  });
});
