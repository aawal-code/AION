/**
 * AION Desktop Application Launcher
 * Ensures the background daemon on port 5050 is running silently, then launches
 * AION in a chromeless standalone desktop app window (--app=http://localhost:5050)
 * with its own taskbar instance, separate user-data profile, and zero browser chrome.
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_PORT = parseInt(process.env.PORT || '5050', 10);
export const DEFAULT_URL = `http://localhost:${DEFAULT_PORT}`;

/**
 * Checks if AION daemon is already active and responding to HTTP requests
 * @param {number} port
 * @param {string} host
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export function isDaemonRunning(port = DEFAULT_PORT, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host,
        port,
        path: '/',
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Spawns the AION background server silently if not already running
 * @param {number} port
 * @param {number} maxWaitMs
 * @returns {Promise<boolean>}
 */
export async function ensureDaemon(port = DEFAULT_PORT, maxWaitMs = 5000) {
  const alreadyRunning = await isDaemonRunning(port);
  if (alreadyRunning) {
    return true;
  }

  const serverScript = path.resolve(__dirname, 'server.js');
  const projectRoot = path.resolve(__dirname, '..');

  if (!fs.existsSync(serverScript)) {
    throw new Error(`Server script not found at ${serverScript}`);
  }

  // Launch detached node process
  const child = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
  });

  child.unref();

  // Poll until port responds or timeout reached
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isDaemonRunning(port)) {
      return true;
    }
  }

  return false;
}

/**
 * Discovers an available Chromium-based browser executable for --app mode
 * @returns {string|null} Full binary path or null if none found
 */
export function findBrowserBinary() {
  const platform = process.platform;

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const candidates = [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ];

    // Check fixed candidates
    for (const bin of candidates) {
      if (fs.existsSync(bin)) return bin;
    }

    // Check EdgeCore subdirectories (e.g. C:\Program Files (x86)\Microsoft\EdgeCore\*\msedge.exe)
    const edgeCoreRoot = path.join(programFilesX86, 'Microsoft', 'EdgeCore');
    if (fs.existsSync(edgeCoreRoot)) {
      try {
        const subdirs = fs.readdirSync(edgeCoreRoot);
        for (const sub of subdirs) {
          const edgeExe = path.join(edgeCoreRoot, sub, 'msedge.exe');
          if (fs.existsSync(edgeExe)) return edgeExe;
        }
      } catch {
        // Ignore read errors
      }
    }

    return null;
  }

  if (platform === 'linux') {
    const candidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/brave-browser',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    ];

    for (const bin of candidates) {
      if (fs.existsSync(bin)) return bin;
    }

    return null;
  }

  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];

    for (const bin of candidates) {
      if (fs.existsSync(bin)) return bin;
    }

    return null;
  }

  return null;
}

/**
 * Resolves or creates a dedicated isolated user-data-dir for the AION app window
 * @returns {string}
 */
export function resolveProfileDir() {
  let baseDir;
  if (process.platform === 'win32') {
    baseDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'AION');
  } else if (process.platform === 'darwin') {
    baseDir = path.join(process.env.HOME || os.tmpdir(), 'Library', 'Application Support', 'AION');
  } else {
    baseDir = path.join(process.env.HOME || os.tmpdir(), '.local', 'share', 'aion');
  }

  const profileDir = path.join(baseDir, 'browser-profile');
  try {
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
  } catch {
    return path.join(os.tmpdir(), 'aion-browser-profile');
  }
  return profileDir;
}

/**
 * Launches AION in a standalone chromeless application window
 * @param {string} url
 * @returns {boolean}
 */
export function launchWindow(url = DEFAULT_URL) {
  // On Windows, prefer the native AION.exe desktop application over browser app mode
  if (process.platform === 'win32') {
    const nativeCandidates = [
      path.resolve(__dirname, '..', 'dist', 'AION.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'AION', 'AION.exe'),
      path.resolve(__dirname, '..', 'AION.exe'),
    ];
    for (const exe of nativeCandidates) {
      if (fs.existsSync(exe)) {
        const child = spawn(exe, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          cwd: path.dirname(exe),
        });
        child.unref();
        return true;
      }
    }
  }

  const browserBin = findBrowserBinary();
  const profileDir = resolveProfileDir();

  if (browserBin) {
    const args = [
      `--app=${url}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1200,820',
      '--disable-component-update',
      '--app-auto-launched',
    ];

    const child = spawn(browserBin, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  }

  // Fallback to standard system default handler
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }

  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

/**
 * Main execution routine
 */
export async function main() {
  const args = process.argv.slice(2);
  const daemonOnly = args.includes('--daemon-only') || args.includes('--no-open');
  const targetPort = DEFAULT_PORT;
  const targetUrl = args.find((a) => a.startsWith('--url='))?.replace('--url=', '') || `http://localhost:${targetPort}`;

  const started = await ensureDaemon(targetPort);
  if (!started) {
    console.error(`[AION Launcher] Failed to connect to or start daemon on port ${targetPort}`);
    process.exit(1);
  }

  if (!daemonOnly) {
    launchWindow(targetUrl);
  }
}

// Auto-run when executed directly
const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main().catch((err) => {
    console.error('[AION Launcher Error]', err);
    process.exit(1);
  });
}
