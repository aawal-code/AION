import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Milestone 3: The Native Shell & Install Pipeline', () => {
  const rootDir = path.resolve('.');

  // =========================================================================
  // 1. Supervisor App (scripts/win/AionApp.cs)
  // =========================================================================
  describe('Supervisor App Architecture (AionApp.cs)', () => {
    const aionAppPath = path.join(rootDir, 'scripts', 'win', 'AionApp.cs');

    test('verifies AionApp.cs exists and contains Windows Kernel Job Object P/Invoke', () => {
      assert.ok(fs.existsSync(aionAppPath), 'scripts/win/AionApp.cs must exist');
      const code = fs.readFileSync(aionAppPath, 'utf8');

      assert.ok(
        code.includes('CreateJobObject'),
        'Must import CreateJobObject from kernel32.dll'
      );
      assert.ok(
        code.includes('SetInformationJobObject'),
        'Must import SetInformationJobObject from kernel32.dll'
      );
      assert.ok(
        code.includes('AssignProcessToJobObject'),
        'Must import AssignProcessToJobObject from kernel32.dll'
      );
      assert.ok(
        code.includes('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE'),
        'Must define JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000) to bind child process lifetime'
      );
    });

    test('enforces single-instance execution via named Mutex and restore broadcast', () => {
      const code = fs.readFileSync(aionAppPath, 'utf8');

      assert.ok(
        code.includes('Global\\AION_Desktop_SingleInstance') || code.includes('Global\\\\AION_Desktop_SingleInstance'),
        'Must use named Mutex Global\\AION_Desktop_SingleInstance'
      );
      assert.ok(
        code.includes('singleInstanceMutex'),
        'Must allocate singleInstanceMutex'
      );
      assert.ok(
        code.includes('WM_AION_RESTORE') || code.includes('RegisterWindowMessage'),
        'Must register window restore message for cross-instance signalling'
      );
      assert.ok(
        code.includes('SetForegroundWindow'),
        'Must restore and bring original window to foreground on duplicate launch'
      );
    });

    test('configures native dark WebView2 host and hides default context menus', () => {
      const code = fs.readFileSync(aionAppPath, 'utf8');

      assert.ok(
        code.includes('AreDefaultContextMenusEnabled = false'),
        'Must disable default browser context menus in WebView2 settings'
      );
      assert.ok(
        code.includes('DwmSetWindowAttribute'),
        'Must set dark DWM titlebar attribute'
      );
      assert.ok(
        code.includes('Color.FromArgb(11, 17, 32)'),
        'Must use dark background theme (#0b1120)'
      );
    });

    test('creates System Tray NotifyIcon with dark context menu and actions', () => {
      const code = fs.readFileSync(aionAppPath, 'utf8');

      assert.ok(code.includes('NotifyIcon'), 'Must instantiate System Tray NotifyIcon');
      assert.ok(code.includes('DarkMenuRenderer'), 'Must use custom DarkMenuRenderer');
      assert.ok(code.includes('"Open AION"'), 'Must have Open AION menu item');
      assert.ok(code.includes('"Restart Core"'), 'Must have Restart Core menu item');
      assert.ok(code.includes('"Exit"'), 'Must have Exit menu item');
    });
  });

  // =========================================================================
  // 2. Setup Wizard (scripts/win/Setup.cs)
  // =========================================================================
  describe('Setup Wizard Architecture (Setup.cs)', () => {
    const setupPath = path.join(rootDir, 'scripts', 'win', 'Setup.cs');

    test('verifies Setup.cs exists with 560x440 dark WinForms dialog geometry', () => {
      assert.ok(fs.existsSync(setupPath), 'scripts/win/Setup.cs must exist');
      const code = fs.readFileSync(setupPath, 'utf8');

      assert.ok(
        code.includes('560, 440') || code.includes('560,440'),
        'Setup wizard window size must be exactly 560x440'
      );
      assert.ok(
        code.includes('Color.FromArgb(11, 17, 32)'),
        'Must use dark background theme (#0b1120)'
      );
    });

    test('Screen 1 (Identity): contains Device Name and Role selector', () => {
      const code = fs.readFileSync(setupPath, 'utf8');

      assert.ok(
        code.includes('Environment.MachineName'),
        'Device name input must be pre-filled with machine name'
      );
      assert.ok(
        code.includes('rbDesktop') && code.includes('rbLaptop'),
        'Must provide Desktop and Laptop radio selectors'
      );
    });

    test('Screen 2 (Config): contains Tailscale Auth Key, Startup, and Shortcut toggles', () => {
      const code = fs.readFileSync(setupPath, 'utf8');

      assert.ok(
        code.includes('txtTailscaleAuthKey'),
        'Must provide Tailscale auth key text box'
      );
      assert.ok(
        code.includes('chkStartup'),
        'Must provide Windows Startup checkbox toggle'
      );
      assert.ok(
        code.includes('chkShortcuts'),
        'Must provide Desktop/Start Menu shortcut checkbox toggle'
      );
    });

    test('Screen 3 (Install): uses live progress bar and sanitized ZipArchive extraction', () => {
      const code = fs.readFileSync(setupPath, 'utf8');

      assert.ok(code.includes('ProgressBar'), 'Must have live ProgressBar control');
      assert.ok(
        code.includes('ZipArchive') && code.includes('ExtractToFile'),
        'Must extract payload via ZipArchive'
      );
      assert.ok(
        code.includes('SanitizeZipEntryRelativePath') || code.includes('Zone.Identifier'),
        'Must sanitize zip entry paths against NTFS streams and path format crashes'
      );
    });

    test('Screen 4 (Done): writes device-identity.json and install-manifest.json', () => {
      const code = fs.readFileSync(setupPath, 'utf8');

      assert.ok(
        code.includes('device-identity.json'),
        'Must write data/device-identity.json with configured identity'
      );
      assert.ok(
        code.includes('install-manifest.json'),
        'Must write data/install-manifest.json tracking installation metadata'
      );
    });
  });

  // =========================================================================
  // 3. Uninstaller (scripts/win/Uninstall.cs)
  // =========================================================================
  describe('Uninstaller Architecture (Uninstall.cs)', () => {
    const uninstallPath = path.join(rootDir, 'scripts', 'win', 'Uninstall.cs');

    test('verifies Uninstall.cs exists and reads data/install-manifest.json', () => {
      assert.ok(fs.existsSync(uninstallPath), 'scripts/win/Uninstall.cs must exist');
      const code = fs.readFileSync(uninstallPath, 'utf8');

      assert.ok(
        code.includes('install-manifest.json'),
        'Must read install-manifest.json'
      );
      assert.ok(
        code.includes('KillRunningProcesses'),
        'Must safely terminate active AION processes'
      );
      assert.ok(
        code.includes('advfirewall firewall delete rule name=\\"AION Core\\"') || code.includes('advfirewall firewall delete rule'),
        'Must remove port 5050 firewall rule'
      );
      assert.ok(
        code.includes('Software\\Microsoft\\Windows\\CurrentVersion\\Run') || code.includes('DeleteValue("AION"'),
        'Must clean startup registry entries'
      );
      assert.ok(
        code.includes('TriggerDelayedSelfDelete') || code.includes('rmdir /s /q'),
        'Must perform delayed recursive deletion of %LocalAppData%\\AION'
      );
    });
  });

  // =========================================================================
  // 4. Compiled Executables Suite Verification
  // =========================================================================
  describe('Compiled Executables Suite (dist/)', () => {
    const distDir = path.join(rootDir, 'dist');
    const aionExe = path.join(distDir, 'AION.exe');
    const setupExe = path.join(distDir, 'AION-Setup.exe');
    const uninstallExe = path.join(distDir, 'Uninstall.exe');

    test('dist/AION.exe exists, is non-empty, and has valid PE header', () => {
      assert.ok(fs.existsSync(aionExe), 'dist/AION.exe must exist');
      const stat = fs.statSync(aionExe);
      assert.ok(stat.size > 10000, 'AION.exe must be a compiled binary > 10KB');

      // Verify Windows PE 'MZ' magic bytes
      const fd = fs.openSync(aionExe, 'r');
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      assert.equal(buf.toString('ascii'), 'MZ', 'AION.exe must be a valid PE executable');
    });

    test('dist/AION-Setup.exe exists, is non-empty, and has valid PE header', () => {
      assert.ok(fs.existsSync(setupExe), 'dist/AION-Setup.exe must exist');
      const stat = fs.statSync(setupExe);
      assert.ok(stat.size > 500000, 'AION-Setup.exe must contain embedded payload > 500KB');

      const fd = fs.openSync(setupExe, 'r');
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      assert.equal(buf.toString('ascii'), 'MZ', 'AION-Setup.exe must be a valid PE executable');
    });

    test('dist/Uninstall.exe exists, is non-empty, and has valid PE header', () => {
      assert.ok(fs.existsSync(uninstallExe), 'dist/Uninstall.exe must exist');
      const stat = fs.statSync(uninstallExe);
      assert.ok(stat.size > 10000, 'Uninstall.exe must be a compiled binary > 10KB');

      const fd = fs.openSync(uninstallExe, 'r');
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      assert.equal(buf.toString('ascii'), 'MZ', 'Uninstall.exe must be a valid PE executable');
    });

    test('WebView2 companion runtime DLLs exist in dist/', () => {
      assert.ok(fs.existsSync(path.join(distDir, 'Microsoft.Web.WebView2.Core.dll')));
      assert.ok(fs.existsSync(path.join(distDir, 'Microsoft.Web.WebView2.WinForms.dll')));
      assert.ok(fs.existsSync(path.join(distDir, 'WebView2Loader.dll')));
    });
  });
});
