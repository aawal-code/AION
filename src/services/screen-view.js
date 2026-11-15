import fs from 'fs';
import path from 'path';
import os from 'os';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const SCREEN_VIEW_CONFIG_FILE = path.join(DATA_DIR, 'screen-view.json');

/**
 * Searches candidate filesystem paths for RustDesk executable
 */
function findRustDeskBinary() {
  const isWin = process.platform === 'win32';
  const candidates = [];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    if (localAppData) {
      candidates.push({ path: path.join(localAppData, 'AION', 'rustdesk', 'rustdesk.exe'), portable: true });
    }
    candidates.push({ path: path.resolve('rustdesk', 'rustdesk.exe'), portable: true });
    candidates.push({ path: path.join(programFiles, 'RustDesk', 'rustdesk.exe'), portable: false });
    candidates.push({ path: path.join(programFilesX86, 'RustDesk', 'rustdesk.exe'), portable: false });
  } else {
    const home = process.env.HOME || os.homedir();
    candidates.push({ path: '/usr/bin/rustdesk', portable: false });
    candidates.push({ path: '/usr/local/bin/rustdesk', portable: false });
    candidates.push({ path: path.join(home, '.local', 'bin', 'rustdesk'), portable: true });
    candidates.push({ path: path.resolve('rustdesk', 'rustdesk'), portable: true });
  }

  for (const item of candidates) {
    try {
      if (fs.existsSync(item.path)) {
        return item;
      }
    } catch {}
  }

  return null;
}

/**
 * Parses RustDesk ID from default config file (RustDesk.toml)
 */
function readRustDeskIdFromConfig() {
  const isWin = process.platform === 'win32';
  const configPaths = [];

  if (isWin) {
    const appData = process.env.APPDATA || '';
    if (appData) {
      configPaths.push(path.join(appData, 'RustDesk', 'config', 'RustDesk.toml'));
      configPaths.push(path.join(appData, 'RustDesk', 'config', 'RustDesk2.toml'));
    }
  } else {
    const home = process.env.HOME || os.homedir();
    configPaths.push(path.join(home, '.config', 'rustdesk', 'RustDesk.toml'));
    configPaths.push(path.join(home, '.config', 'rustdesk', 'RustDesk2.toml'));
  }

  for (const conf of configPaths) {
    try {
      if (fs.existsSync(conf)) {
        const content = fs.readFileSync(conf, 'utf8');
        // Match: id = '123456789' or id = "123456789"
        const match = content.match(/\bid\s*=\s*['"]?([0-9a-zA-Z_-]+)['"]?/);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Loads manual overrides or stored setup configuration from data/screen-view.json
 */
function loadStoredScreenViewConfig() {
  try {
    if (fs.existsSync(SCREEN_VIEW_CONFIG_FILE)) {
      const raw = fs.readFileSync(SCREEN_VIEW_CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    logEvent('WARN', `Failed reading screen-view.json: ${err.message}`);
  }
  return null;
}

/**
 * Saves screen-view configuration to data/screen-view.json
 */
export function saveScreenViewConfig(config) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const existing = loadStoredScreenViewConfig() || {};
    const merged = { ...existing, ...config, updatedAt: new Date().toISOString() };
    fs.writeFileSync(SCREEN_VIEW_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (err) {
    logEvent('ERROR', `Failed saving screen-view.json: ${err.message}`);
    return null;
  }
}

/**
 * Returns complete local Screen View / RustDesk readiness status
 */
export function getScreenViewStatus() {
  const binary = findRustDeskBinary();
  const config = loadStoredScreenViewConfig();
  const parsedId = readRustDeskIdFromConfig();

  const rustDeskId = config?.rustDeskId || parsedId || null;
  const isInstalled = Boolean(binary || config?.installed || rustDeskId);
  const isPortable = binary ? binary.portable : Boolean(config?.portable);
  const binPath = binary ? binary.path : config?.path || null;

  return {
    installed: isInstalled,
    portable: isPortable,
    path: binPath,
    rustDeskId,
    ready: Boolean(isInstalled),
    status: isInstalled ? 'ready' : 'not_installed',
  };
}

/**
 * Builds rustdesk:// URI scheme link for connecting to remote peer
 */
export function getPeerScreenViewUrl(peerIpOrId) {
  if (!peerIpOrId) return '';
  const clean = String(peerIpOrId).trim().replace(/^rustdesk:\/\//i, '');
  return `rustdesk://${clean}`;
}
