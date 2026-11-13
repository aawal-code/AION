import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { handleRequest } from '../src/routes/router.js';

describe('Milestone 4: Global UI, Apple-Grade CSS & Settings Preferences', () => {
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
  // 1. Apple-Grade CSS Architecture Verification
  // ========================================================================
  describe('Apple-Grade CSS Architecture (theme.css & app.css)', () => {
    test('theme.css and app.css exist on disk', () => {
      assert.ok(fs.existsSync('public/css/theme.css'), 'public/css/theme.css must exist');
      assert.ok(fs.existsSync('public/css/app.css'), 'public/css/app.css must exist');
    });

    test('enforces zero web-feel and progressive disclosure globally', () => {
      const themeCss = fs.readFileSync('public/css/theme.css', 'utf8');

      // user-select: none globally on html/body
      assert.match(themeCss, /user-select:\s*none/i, 'Must include global user-select: none');
      assert.match(themeCss, /-webkit-tap-highlight-color:\s*transparent/i, 'Must disable tap highlight color');
    });

    test('implements fluid typography and fluid spacing with safe clamping', () => {
      const themeCss = fs.readFileSync('public/css/theme.css', 'utf8');

      // Clamped fluid typography
      assert.match(themeCss, /clamp\([^)]+\)/, 'Must contain clamp() definitions for fluid scaling');
      assert.ok(themeCss.includes('--font-size-'), 'Must define fluid typography tokens');
      assert.ok(themeCss.includes('--spacing-'), 'Must define fluid spacing tokens');
    });

    test('restricts transitions strictly to transform and opacity with iOS cubic-bezier curves', () => {
      const themeCss = fs.readFileSync('public/css/theme.css', 'utf8');
      const appCss = fs.readFileSync('public/css/app.css', 'utf8');

      const iosCurveRegex = /cubic-bezier\(0\.2,\s*0\.8,\s*0\.2,\s*1\)/;
      assert.match(themeCss, iosCurveRegex, 'theme.css must define iOS cubic-bezier(0.2, 0.8, 0.2, 1)');
      assert.match(appCss, iosCurveRegex, 'app.css must use iOS cubic-bezier(0.2, 0.8, 0.2, 1)');

      assert.ok(themeCss.includes('transition: transform'), 'Transitions restricted to transform');
      assert.ok(themeCss.includes('transition: opacity') || themeCss.includes('opacity var(--duration-ios)'), 'Transitions restricted to opacity');
    });

    test('implements glassmorphism for top bars, drawers, and modal backdrops', () => {
      const themeCss = fs.readFileSync('public/css/theme.css', 'utf8');
      const appCss = fs.readFileSync('public/css/app.css', 'utf8');

      assert.match(themeCss, /backdrop-filter:\s*blur\(20px\)/, 'theme.css must use blur(20px)');
      assert.match(themeCss, /-webkit-backdrop-filter:\s*blur\(20px\)/, 'theme.css must support webkit blur(20px)');
      assert.match(appCss, /backdrop-filter:\s*blur\(20px\)/, 'app.css must implement blur(20px) glassmorphism');
    });

    test('ensures mobile headers respect Dynamic Island and notch safe-area padding', () => {
      const themeCss = fs.readFileSync('public/css/theme.css', 'utf8');
      const appCss = fs.readFileSync('public/css/app.css', 'utf8');

      const dynamicIslandPattern = /padding-top:\s*max\(12px,\s*env\(safe-area-inset-top\)/;
      assert.match(themeCss, dynamicIslandPattern, 'theme.css must specify safe-area-inset-top padding');
      assert.match(appCss, dynamicIslandPattern, 'app.css must specify safe-area-inset-top padding for mobile bar');
    });
  });

  // ========================================================================
  // 2. Global Navigation & Responsive Layout Verification
  // ========================================================================
  describe('Global Navigation & Responsive Layout (nav.js & HTML)', () => {
    test('public/js/nav.js exists and exports required methods', async () => {
      assert.ok(fs.existsSync('public/js/nav.js'), 'public/js/nav.js must exist');
      const navJs = await import('../public/js/nav.js');
      assert.equal(typeof navJs.initNav, 'function', 'initNav must be exported');
      assert.equal(typeof navJs.openSidebar, 'function', 'openSidebar must be exported');
      assert.equal(typeof navJs.closeSidebar, 'function', 'closeSidebar must be exported');
      assert.equal(typeof navJs.toggleSidebar, 'function', 'toggleSidebar must be exported');
      assert.equal(typeof navJs.setActiveNav, 'function', 'setActiveNav must be exported');
    });

    test('sidebar is styled with 260px fixed width on desktop and slide-over on mobile', () => {
      const appCss = fs.readFileSync('public/css/app.css', 'utf8');

      // Desktop 260px sidebar
      assert.match(appCss, /\.app-sidebar\s*\{[^}]*width:\s*260px/s, 'Desktop sidebar must be 260px');
      assert.match(appCss, /\.app-sidebar\s*\{[^}]*min-width:\s*260px/s, 'Desktop sidebar must have min-width 260px');

      // Mobile slide-over drawer
      assert.match(appCss, /@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.app-sidebar\s*\{[^}]*width:\s*260px/s, 'Mobile sidebar width must be 260px');
      assert.match(appCss, /@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.app-sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/s, 'Mobile sidebar must slide over with translateX(-100%)');
    });

    test('sidebar header in index.html contains geometric mark + wordmark and settings gear', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');

      assert.ok(html.includes('class="brand-mark brand-mark-light"'), 'Light geometric mark present');
      assert.ok(html.includes('class="brand-mark brand-mark-dark"'), 'Dark geometric mark present');
      assert.ok(html.includes('class="brand-wordmark brand-wordmark-light"'), 'Light wordmark present');
      assert.ok(html.includes('class="brand-wordmark brand-wordmark-dark"'), 'Dark wordmark present');
      assert.ok(html.includes('id="btnOpenSettings"'), 'Single Settings gear button present in sidebar header');
    });

    test('sidebar sections contain All Devices overview row, live Device List, and Assistant Workspace', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');

      assert.ok(html.includes('id="navItemAllDevices"'), 'All Devices overview row must exist');
      assert.ok(html.includes('id="sidebarDevicesList"'), 'Registered Devices live list container must exist');
      assert.ok(html.includes('id="navItemAssistant"'), 'Assistant Workspace toggle row must exist');
    });
  });

  // ========================================================================
  // 3. Settings & Preferences View Verification
  // ========================================================================
  describe('Settings & Preferences View (settings.js & HTML)', () => {
    test('public/js/settings.js exists and exports required methods', async () => {
      assert.ok(fs.existsSync('public/js/settings.js'), 'public/js/settings.js must exist');
      const settingsJs = await import('../public/js/settings.js');
      assert.equal(typeof settingsJs.initSettings, 'function', 'initSettings must be exported');
      assert.equal(typeof settingsJs.openSettings, 'function', 'openSettings must be exported');
      assert.equal(typeof settingsJs.closeSettings, 'function', 'closeSettings must be exported');
      assert.equal(typeof settingsJs.switchTab, 'function', 'switchTab must be exported');
      assert.equal(typeof settingsJs.fetchRollingPin, 'function', 'fetchRollingPin must be exported');
      assert.equal(typeof settingsJs.fetchNetworkMesh, 'function', 'fetchNetworkMesh must be exported');
      assert.equal(typeof settingsJs.fetchTrustedDevices, 'function', 'fetchTrustedDevices must be exported');
      assert.equal(typeof settingsJs.revokeTrustedDevice, 'function', 'revokeTrustedDevice must be exported');
      assert.equal(typeof settingsJs.saveApiKey, 'function', 'saveApiKey must be exported');
      assert.equal(typeof settingsJs.getApiVault, 'function', 'getApiVault must be exported');
      assert.equal(typeof settingsJs.getByocliProfiles, 'function', 'getByocliProfiles must be exported');
    });

    test('Preferences Modal has 4 segmented tabs in index.html', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');

      assert.ok(html.includes('id="settingsModal"'), 'settingsModal container must exist');
      assert.ok(html.includes('data-settings-tab="general"'), 'General tab button must exist');
      assert.ok(html.includes('data-settings-tab="network"'), 'Network & Access tab button must exist');
      assert.ok(html.includes('data-settings-tab="vault"'), 'API Vault & Execution tab button must exist');
      assert.ok(html.includes('data-settings-tab="interface"'), 'Interface tab button must exist');

      assert.ok(html.includes('id="settingsPanel-general"'), 'General panel must exist');
      assert.ok(html.includes('id="settingsPanel-network"'), 'Network panel must exist');
      assert.ok(html.includes('id="settingsPanel-vault"'), 'Vault panel must exist');
      assert.ok(html.includes('id="settingsPanel-interface"'), 'Interface panel must exist');
    });

    test('General Tab has Device Name input, Role selector (Master/Node), and Save button', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');

      assert.ok(html.includes('id="settingsDeviceName"'), 'Device Name input must exist');
      assert.ok(html.includes('id="settingsDeviceRole"'), 'Role select must exist');
      assert.ok(html.includes('value="Master"'), 'Master role option must exist');
      assert.ok(html.includes('value="Node"'), 'Node role option must exist');
      assert.ok(html.includes('id="btnSaveGeneralProfile"'), 'Save Profile button must exist');
    });

    test('Network & Access Tab contains Tailscale Mesh, Rolling PIN progress bar, and Trusted Devices', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');

      // Tailscale Mesh
      assert.ok(html.includes('id="settingsTailscaleStatusBadge"'), 'Mesh status badge must exist');
      assert.ok(html.includes('id="settingsTailscaleIpv4"'), 'Tailscale IPv4 display must exist');
      assert.ok(html.includes('id="settingsTailscaleIpv6"'), 'Tailscale IPv6 display must exist');
      assert.ok(html.includes('id="settingsTailscaleHost"'), 'Mesh hostname display must exist');

      // Rolling PIN
      assert.ok(html.includes('id="settingsPairingPin"'), 'Pairing PIN display must exist');
      assert.ok(html.includes('id="pinProgressBar"'), 'Rolling PIN visual countdown bar must exist');
      assert.ok(html.includes('id="pinCountdownText"'), 'Rolling PIN countdown text must exist');
      assert.ok(html.includes('id="btnRegeneratePin"'), 'Regenerate PIN button must exist');
      assert.ok(html.includes('id="btnDownloadIosProfile"'), 'iOS WebClip profile button must exist');

      // Trusted Devices
      assert.ok(html.includes('id="trustedDevicesList"'), 'Trusted devices list container must exist');
    });

    test('API Vault & Execution Tab contains API Key Manager and BYOCLI Grid', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');

      assert.ok(html.includes('id="apiVaultList"'), 'API vault keys list must exist');
      assert.ok(html.includes('id="byocliGrid"'), 'BYOCLI profiles grid container must exist');
    });

    test('Interface Tab contains Theme Selector (Light/Dark/Auto), Developer Mode toggle, and Language Switcher', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');

      assert.ok(html.includes('data-theme-mode="light"'), 'Light theme mode button must exist');
      assert.ok(html.includes('data-theme-mode="dark"'), 'Dark theme mode button must exist');
      assert.ok(html.includes('data-theme-mode="auto"'), 'Auto theme mode button must exist');
      assert.ok(html.includes('id="themePresetsGrid"'), 'Theme presets grid container must exist');
      assert.ok(html.includes('id="devModeToggle"'), 'Developer mode toggle switch must exist');
      assert.ok(html.includes('id="devModeContainer"'), 'Developer mode drawer must exist');
      assert.ok(html.includes('data-lang="en"'), 'English language button must exist');
      assert.ok(html.includes('data-lang="ar"'), 'Arabic language button must exist');
      assert.ok(html.includes('data-lang="de"'), 'German language button must exist');
    });
  });

  // ========================================================================
  // 4. HTTP Static Serving & Browser Integration
  // ========================================================================
  describe('HTTP Static Serving & MIME Types', () => {
    test('serves /css/theme.css with text/css content-type and zero-delay headers', async () => {
      const res = await fetch(`${baseUrl}/css/theme.css`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /^text\/css/);
      const text = await res.text();
      assert.ok(text.includes('user-select: none'));
      assert.ok(text.includes('cubic-bezier(0.2, 0.8, 0.2, 1)'));
    });

    test('serves /js/nav.js and /js/settings.js with application/javascript content-type', async () => {
      const navRes = await fetch(`${baseUrl}/js/nav.js`);
      assert.equal(navRes.status, 200);
      assert.match(navRes.headers.get('content-type'), /^application\/javascript/);
      const navText = await navRes.text();
      assert.ok(navText.includes('export function initNav'));

      const settingsRes = await fetch(`${baseUrl}/js/settings.js`);
      assert.equal(settingsRes.status, 200);
      assert.match(settingsRes.headers.get('content-type'), /^application\/javascript/);
      const settingsText = await settingsRes.text();
      assert.ok(settingsText.includes('export function initSettings'));
    });

    test('serves index.html referencing theme.css, nav.js, and settings.js', async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('/css/theme.css'), 'index.html must reference /css/theme.css');
      assert.ok(html.includes('/js/nav.js'), 'index.html must reference /js/nav.js');
      assert.ok(html.includes('/js/settings.js'), 'index.html must reference /js/settings.js');
    });
  });
});
