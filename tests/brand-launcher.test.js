import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { handleRequest } from '../src/routes/router.js';
import * as launcher from '../src/launcher.js';

describe('Brand Asset Integration & Standalone Launcher', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(handleRequest);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('verifies all brand vector and raster icon files exist on disk', () => {
    const requiredAssets = [
      'public/brand/icon-light.svg',
      'public/brand/icon-dark.svg',
      'public/brand/wordmark-light.svg',
      'public/brand/wordmark-dark.svg',
      'public/brand/logo-dark-ico.svg',
      'public/brand/logo-light-ico.svg',
      'public/brand/titlelogo-dark.svg',
      'public/brand/titlelogo-light.svg',
      'public/brand/aion.ico',
      'public/brand/apple-touch-icon.png',
      'public/brand/icon-1024.png',
      'public/brand/icon-512.png',
      'public/brand/icon-192.png',
      'public/brand/icon-32.png',
      'public/brand/icon-16.png',
      'public/apple-touch-icon.png',
      'public/icon-512.png',
      'public/icon-192.png',
      'public/favicon-32x32.png',
      'public/favicon-16x16.png',
    ];

    for (const asset of requiredAssets) {
      assert.ok(fs.existsSync(asset), `Brand asset missing on disk: ${asset}`);
      const stats = fs.statSync(asset);
      assert.ok(stats.size > 0, `Brand asset must not be empty: ${asset}`);
    }
  });

  test('serves brand assets over HTTP with correct MIME content-types', async () => {
    // 1. SVG
    const svgRes = await fetch(`${baseUrl}/brand/icon-light.svg`);
    assert.equal(svgRes.status, 200);
    assert.equal(svgRes.headers.get('content-type'), 'image/svg+xml');

    const wordmarkRes = await fetch(`${baseUrl}/brand/wordmark-dark.svg`);
    assert.equal(wordmarkRes.status, 200);
    assert.equal(wordmarkRes.headers.get('content-type'), 'image/svg+xml');

    // 2. PNG
    const pngRes = await fetch(`${baseUrl}/brand/icon-512.png`);
    assert.equal(pngRes.status, 200);
    assert.equal(pngRes.headers.get('content-type'), 'image/png');

    // 3. ICO
    const icoRes = await fetch(`${baseUrl}/brand/aion.ico`);
    assert.equal(icoRes.status, 200);
    assert.equal(icoRes.headers.get('content-type'), 'image/x-icon');
  });

  test('verifies public/index.html wires brand favicon tags and sidebar logo', () => {
    const html = fs.readFileSync('public/index.html', 'utf8');

    // Icon tags
    assert.ok(html.includes('href="/brand/logo-dark-ico.svg"'), 'Missing logo-dark-ico.svg link icon tag');
    assert.ok(html.includes('href="/brand/icon-32.png"'), 'Missing icon-32.png link icon tag');
    assert.ok(html.includes('href="/brand/icon-16.png"'), 'Missing icon-16.png link icon tag');
    assert.ok(html.includes('href="/brand/aion.ico"'), 'Missing aion.ico shortcut icon tag');
    assert.ok(html.includes('href="/brand/apple-touch-icon.png"'), 'Missing apple-touch-icon tag');

    // Sidebar & Modal brand elements
    assert.ok(html.includes('brand-logo-group'), 'Sidebar must contain brand-logo-group');
    assert.ok(html.includes('brand-mark-light'), 'Sidebar must contain brand-mark-light');
    assert.ok(html.includes('brand-mark-dark'), 'Sidebar must contain brand-mark-dark');
    assert.ok(html.includes('brand-wordmark-light'), 'Sidebar must contain brand-wordmark-light');
    assert.ok(html.includes('brand-wordmark-dark'), 'Sidebar must contain brand-wordmark-dark');
  });

  test('verifies public/css/app.css implements theme switching for brand assets', () => {
    const css = fs.readFileSync('public/css/app.css', 'utf8');

    assert.ok(css.includes('.brand-logo-group'), 'Missing .brand-logo-group CSS rules');
    assert.ok(css.includes('.brand-mark'), 'Missing .brand-mark CSS rules');
    assert.ok(css.includes('.brand-wordmark'), 'Missing .brand-wordmark CSS rules');
    assert.ok(css.includes('.brand-mark-light'), 'Missing .brand-mark-light default rule');
    assert.ok(css.includes('.brand-mark-dark'), 'Missing .brand-mark-dark default rule');

    // Light theme overrides
    assert.ok(css.includes('[data-theme="macos-light"] .brand-mark-light'), 'Missing light theme rule for brand mark');
    assert.ok(css.includes('[data-theme="macos-light"] .brand-mark-dark'), 'Missing light theme rule for dark brand mark');
  });

  test('verifies standalone launcher exports and browser detection', async () => {
    assert.equal(typeof launcher.isDaemonRunning, 'function');
    assert.equal(typeof launcher.ensureDaemon, 'function');
    assert.equal(typeof launcher.findBrowserBinary, 'function');
    assert.equal(typeof launcher.resolveProfileDir, 'function');
    assert.equal(typeof launcher.launchWindow, 'function');

    const profile = launcher.resolveProfileDir();
    assert.ok(typeof profile === 'string' && profile.length > 0);

    const isRunning = await launcher.isDaemonRunning(server.address().port);
    assert.equal(isRunning, true, 'isDaemonRunning should report true for active test server');

    const isInactive = await launcher.isDaemonRunning(59999);
    assert.equal(isInactive, false, 'isDaemonRunning should report false for closed port');
  });

  test('verifies Windows and Linux installer scripts and source files', () => {
    // Windows C# sources & build script
    assert.ok(fs.existsSync('scripts/win/Setup.cs'), 'scripts/win/Setup.cs missing');
    assert.ok(fs.existsSync('scripts/win/Uninstall.cs'), 'scripts/win/Uninstall.cs missing');
    assert.ok(fs.existsSync('scripts/build-win-exe.ps1'), 'scripts/build-win-exe.ps1 missing');

    const setupCs = fs.readFileSync('scripts/win/Setup.cs', 'utf8');
    assert.ok(setupCs.includes('AionDaemon'), 'Setup.cs must register AionDaemon scheduled task');
    assert.ok(setupCs.includes('install-manifest.json'), 'Setup.cs must generate install-manifest.json');
    assert.ok(setupCs.includes('installedTailscale'), 'Setup.cs must record installedTailscale flag');
    assert.ok(setupCs.includes('installedNode'), 'Setup.cs must record installedNode flag');

    const uninstallCs = fs.readFileSync('scripts/win/Uninstall.cs', 'utf8');
    assert.ok(uninstallCs.includes('installedTailscale'), 'Uninstall.cs must check installedTailscale before uninstalling');

    // Linux installer & uninstaller scripts
    assert.ok(fs.existsSync('scripts/install.sh'), 'scripts/install.sh missing');
    assert.ok(fs.existsSync('scripts/uninstall.sh'), 'scripts/uninstall.sh missing');

    const installSh = fs.readFileSync('scripts/install.sh', 'utf8');
    assert.ok(installSh.includes('install-manifest.json'), 'install.sh must generate install-manifest.json');
    assert.ok(installSh.includes('INSTALLED_TAILSCALE'), 'install.sh must record INSTALLED_TAILSCALE');
    assert.ok(installSh.includes('aion.service'), 'install.sh must configure aion.service');
    assert.ok(installSh.includes('launcher.js'), 'install.sh must wire launcher.js');

    const uninstallSh = fs.readFileSync('scripts/uninstall.sh', 'utf8');
    assert.ok(uninstallSh.includes('installedTailscale'), 'uninstall.sh must respect installedTailscale');

    // Compiled Windows binary verification
    if (process.platform === 'win32') {
      assert.ok(fs.existsSync('dist/AION-Setup.exe'), 'dist/AION-Setup.exe must exist');
      const stats = fs.statSync('dist/AION-Setup.exe');
      assert.ok(stats.size > 50000, 'dist/AION-Setup.exe must contain embedded payload (>50KB)');
    }
  });
});
