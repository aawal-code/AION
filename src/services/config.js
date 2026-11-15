import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = path.resolve('data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  deviceName: os.hostname() || 'AION Host',
  deviceRole: 'Desktop',
  executionTarget: {
    runtimeMode: 'cli', // 'cli' | 'api'
    cliProfile: 'agy',
    apiProvider: 'cerebras',
    apiModel: 'llama3.3-70b',
  },
  byocliEnabled: {},
  telemetryDeck: {
    cards: ['cpu', 'memory', 'disk', 'gpu', 'network', 'uptime'],
    order: ['cpu', 'memory', 'disk', 'gpu', 'network', 'uptime'],
  },
  theme: 'dark',
};

/**
 * Loads configuration from data/config.json with safe fallbacks
 */
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          executionTarget: {
            ...DEFAULT_CONFIG.executionTarget,
            ...(parsed.executionTarget || {}),
          },
          byocliEnabled: {
            ...DEFAULT_CONFIG.byocliEnabled,
            ...(parsed.byocliEnabled || {}),
          },
          telemetryDeck: {
            ...DEFAULT_CONFIG.telemetryDeck,
            ...(parsed.telemetryDeck || {}),
            cards: Array.isArray(parsed.telemetryDeck?.cards)
              ? parsed.telemetryDeck.cards
              : DEFAULT_CONFIG.telemetryDeck.cards,
            order: Array.isArray(parsed.telemetryDeck?.order)
              ? parsed.telemetryDeck.order
              : DEFAULT_CONFIG.telemetryDeck.order,
          },
        };
      }
    }
  } catch (err) {
    console.error('[Config] Error reading config.json:', err.message);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Atomically updates and persists config to data/config.json
 */
export function saveConfig(updates = {}) {
  try {
    const current = loadConfig();
    const updated = {
      ...current,
      ...updates,
      executionTarget: {
        ...current.executionTarget,
        ...(updates?.executionTarget || {}),
      },
      byocliEnabled: {
        ...current.byocliEnabled,
        ...(updates?.byocliEnabled || {}),
      },
      telemetryDeck: {
        ...current.telemetryDeck,
        ...(updates?.telemetryDeck || {}),
        cards: Array.isArray(updates?.telemetryDeck?.cards)
          ? updates.telemetryDeck.cards
          : current.telemetryDeck?.cards || DEFAULT_CONFIG.telemetryDeck.cards,
        order: Array.isArray(updates?.telemetryDeck?.order)
          ? updates.telemetryDeck.order
          : current.telemetryDeck?.order || DEFAULT_CONFIG.telemetryDeck.order,
      },
    };

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const tmpPath = `${CONFIG_PATH}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf8');
    fs.renameSync(tmpPath, CONFIG_PATH);
    return updated;
  } catch (err) {
    console.error('[Config] Error writing config.json:', err.message);
    throw err;
  }
}

/**
 * Returns current configuration snapshot
 */
export function getConfig() {
  return loadConfig();
}

/**
 * Convenience helper to update execution target
 */
export function updateExecutionTarget(targetUpdates) {
  return saveConfig({ executionTarget: targetUpdates });
}
