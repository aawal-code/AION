import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { handleRequest } from '../src/routes/router.js';

describe('Modular Frontend Architecture & Static Routing', () => {
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

  test('verifies modular file layout existence', () => {
    assert.ok(fs.existsSync('public/index.html'), 'public/index.html must exist');
    assert.ok(fs.existsSync('public/css/tokens.css'), 'public/css/tokens.css must exist');
    assert.ok(fs.existsSync('public/css/app.css'), 'public/css/app.css must exist');
    assert.ok(fs.existsSync('public/js/i18n.js'), 'public/js/i18n.js must exist');
    assert.ok(fs.existsSync('public/js/state.js'), 'public/js/state.js must exist');
    assert.ok(fs.existsSync('public/js/app.js'), 'public/js/app.js must exist');
    assert.ok(fs.existsSync('public/js/devices.js'), 'public/js/devices.js must exist');
    assert.ok(fs.existsSync('public/js/icons.js'), 'public/js/icons.js must exist');
  });

  test('serves index.html with text/html content-type and no-cache header', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.match(res.headers.get('cache-control') || '', /no-cache/);
    const text = await res.text();
    assert.ok(text.includes('<!DOCTYPE html>'));
    assert.ok(text.includes('Manrope'));
    assert.ok(text.includes('Cairo'));
    assert.ok(!text.includes('SYSTEMS CONSOLE'), 'Zero cyberpunk branding');
    assert.ok(text.includes('app-layout'), 'Full-viewport split pane layout');
    assert.ok(text.includes('app-sidebar'), 'Left 240px sidebar');
    assert.ok(text.includes('app-canvas'), 'Right main canvas');
    assert.ok(text.includes('tileLock'));
    assert.ok(text.includes('tileScreenOff'));
    assert.ok(text.includes('tileSleep'));
    assert.ok(text.includes('tileShutdown'));
    assert.ok(text.includes('settingsModal'));
  });

  test('serves .css files with text/css content-type and no-cache header', async () => {
    const res1 = await fetch(`${baseUrl}/css/tokens.css`);
    assert.equal(res1.status, 200);
    assert.match(res1.headers.get('content-type'), /^text\/css/);
    assert.match(res1.headers.get('cache-control') || '', /no-cache/);
    const css1 = await res1.text();
    assert.ok(css1.includes('--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)'));

    const res2 = await fetch(`${baseUrl}/css/app.css`);
    assert.equal(res2.status, 200);
    assert.match(res2.headers.get('content-type'), /^text\/css/);
    assert.match(res2.headers.get('cache-control') || '', /no-cache/);
  });

  test('serves .js files with application/javascript content-type and no-cache header', async () => {
    const files = ['/js/app.js', '/js/devices.js', '/js/state.js', '/js/i18n.js', '/js/icons.js'];
    for (const file of files) {
      const res = await fetch(`${baseUrl}${file}`);
      assert.equal(res.status, 200, `Failed loading ${file}`);
      assert.match(res.headers.get('content-type'), /^application\/javascript/);
      assert.match(res.headers.get('cache-control') || '', /no-cache/);
    }
  });

  test('verifies Service Worker v3 and network-first configuration', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    assert.ok(sw.includes('aion-shell-v3'), 'Service Worker must use aion-shell-v3 cache');
    assert.ok(sw.includes('fetch(event.request)'), 'Network-first fetch strategy');
    assert.ok(sw.includes('caches.delete'), 'Purges older caches on activate');
    assert.ok(sw.includes('self.skipWaiting()'), 'Calls self.skipWaiting() immediately in install');
    assert.ok(sw.includes('event.waitUntil(clients.claim())'), 'Calls event.waitUntil(clients.claim()) in activate');

    const appJs = fs.readFileSync('public/js/app.js', 'utf8');
    assert.ok(appJs.includes("navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload())"), 'Listens to controllerchange in app.js');
  });

  test('serves .svg files with image/svg+xml content-type', async () => {
    const res = await fetch(`${baseUrl}/icon.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  });

  test('serves .json and manifest files with correct headers for mobile PWA', async () => {
    const res = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /json/);
    assert.equal(res.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, max-age=0');

    const swRes = await fetch(`${baseUrl}/sw.js`);
    assert.equal(swRes.status, 200);
    assert.equal(swRes.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, max-age=0');
    assert.equal(swRes.headers.get('service-worker-allowed'), '/');
  });

  test('verifies 10 Apple-inspired themes present in tokens.css', () => {
    const css = fs.readFileSync('public/css/tokens.css', 'utf8');
    const themes = [
      'macos-light',
      'macos-dark',
      'oled-midnight',
      'space-gray',
      'silver-birch',
      'titanium-sunset',
      'alpine-glacier',
      'pacific-blue',
      'forest-evergreen',
      'royal-purple',
    ];

    themes.forEach((theme) => {
      assert.ok(css.includes(`[data-theme="${theme}"]`), `Theme ${theme} missing in tokens.css`);
    });
  });

  test('verifies live custom color variables defined in tokens.css', () => {
    const css = fs.readFileSync('public/css/tokens.css', 'utf8');
    assert.ok(css.includes('--custom-bg'));
    assert.ok(css.includes('--custom-surface'));
    assert.ok(css.includes('--custom-accent'));
  });

  test('verifies plain-language translations across EN, AR, and DE in i18n.js', () => {
    const i18n = fs.readFileSync('public/js/i18n.js', 'utf8');
    assert.ok(i18n.includes('en: {'));
    assert.ok(i18n.includes('ar: {'));
    assert.ok(i18n.includes('de: {'));

    // Check natural phrasing
    assert.ok(i18n.includes('Lock Screen'));
    assert.ok(i18n.includes('قفل الشاشة'));
    assert.ok(i18n.includes('Bildschirm sperren'));

    // Check absence of emojis in i18n texts
    assert.ok(!/[🎮🚀💻🤖🔥⚡]/.test(i18n), 'Found emoji in i18n phrasing');
  });
});
