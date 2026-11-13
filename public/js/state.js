/**
 * AION State Management Store
 * Clean modular ES6 reactive store with localStorage persistence
 */

const STORAGE_KEYS = {
  THEME: 'aion_theme',
  CUSTOM_COLORS: 'aion_custom_colors',
  DEV_MODE: 'aion_dev_mode',
  ACTIVITY: 'aion_activity_feed',
};

// Initial State defaults
const state = {
  activeTab: 'devices',
  theme: 'macos-dark',
  customColors: {
    bg: null,
    surface: null,
    accent: null,
  },
  devMode: false,
  activityFeed: [],
  chatMessages: [
    {
      id: 'init-1',
      role: 'assistant',
      text: 'Hello. I am AION, your personal workstation assistant. You can control this computer, check synchronization, or ask any question.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      error: false,
    },
  ],
  syncthing: {
    online: true,
    devices: [],
    folders: [],
    myID: 'Local Station',
  },
  logs: [],
  logFilter: 'ALL',
  isMicListening: false,
  isAssistantBusy: false,
  updateInfo: {
    checking: false,
    updateAvailable: false,
    currentVersion: '1.0.0',
    latestVersion: '1.0.0',
    message: '',
  },
  nodeMeta: {
    nodeVersion: 'Node.js v20+',
    platform: typeof navigator !== 'undefined' && navigator.userAgent.includes('Win') ? 'Windows' : 'Linux / Unix',
    port: (typeof window !== 'undefined' && window.location?.port) || '5050',
    memory: '~32 MB',
    uptime: 'Active',
  },
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(key, value) {
  listeners.forEach((listener) => {
    try {
      listener(state, key, value);
    } catch (e) {
      console.error('[AION State Listener Error]', e);
    }
  });
}

// ==========================================
// Tab Navigation
// ==========================================
export function setActiveTab(tab) {
  if (['devices', 'chat', 'settings'].includes(tab)) {
    state.activeTab = tab;
    notify('activeTab', tab);
  }
}

// ==========================================
// Theme & Custom Colors Persistence
// ==========================================
export function setTheme(themeName) {
  state.theme = themeName;
  try {
    localStorage.setItem(STORAGE_KEYS.THEME, themeName);
  } catch {}

  document.documentElement.setAttribute('data-theme', themeName);
  notify('theme', themeName);
}

export function setCustomColor(key, hex) {
  if (!['bg', 'surface', 'accent'].includes(key)) return;
  state.customColors[key] = hex;

  try {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_COLORS, JSON.stringify(state.customColors));
  } catch {}

  applyCustomColorsToDom();
  notify('customColors', state.customColors);
}

export function resetCustomColors() {
  state.customColors = { bg: null, surface: null, accent: null };
  try {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_COLORS);
  } catch {}

  applyCustomColorsToDom();
  notify('customColors', state.customColors);
}

export function applyCustomColorsToDom() {
  const root = document.documentElement;
  if (state.customColors.bg) {
    root.style.setProperty('--custom-bg', state.customColors.bg);
  } else {
    root.style.removeProperty('--custom-bg');
  }

  if (state.customColors.surface) {
    // Generate translucent variant if hex provided
    const hex = state.customColors.surface;
    const rgba = hexToRgba(hex, 0.76);
    root.style.setProperty('--custom-surface', rgba);
  } else {
    root.style.removeProperty('--custom-surface');
  }

  if (state.customColors.accent) {
    root.style.setProperty('--custom-accent', state.customColors.accent);
  } else {
    root.style.removeProperty('--custom-accent');
  }
}

function hexToRgba(hex, alpha = 0.75) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ==========================================
// Developer Mode
// ==========================================
export function setDevMode(enabled) {
  state.devMode = Boolean(enabled);
  try {
    localStorage.setItem(STORAGE_KEYS.DEV_MODE, state.devMode ? 'true' : 'false');
  } catch {}

  document.documentElement.setAttribute('data-dev-mode', state.devMode ? 'true' : 'false');
  notify('devMode', state.devMode);
}

// ==========================================
// Human Activity Feed
// ==========================================
export function addActivity(title, desc = '', iconType = 'info') {
  const item = {
    id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    title,
    desc,
    iconType,
  };

  state.activityFeed.unshift(item);
  if (state.activityFeed.length > 50) {
    state.activityFeed.pop();
  }

  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVITY, JSON.stringify(state.activityFeed.slice(0, 20)));
  } catch {}

  notify('activityFeed', state.activityFeed);
}

// ==========================================
// Chat Messages
// ==========================================
export function addChatMessage(role, text, error = false) {
  const msg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    role,
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    error,
  };

  state.chatMessages.push(msg);
  notify('chatMessages', state.chatMessages);
  return msg;
}

export function setAssistantBusy(busy) {
  state.isAssistantBusy = Boolean(busy);
  notify('isAssistantBusy', state.isAssistantBusy);
}

// ==========================================
// Syncthing Mesh
// ==========================================
export function setSyncthingData(data) {
  state.syncthing = { ...state.syncthing, ...data };
  notify('syncthing', state.syncthing);
}

// ==========================================
// Developer SSE Logs
// ==========================================
export function addLog(level, message) {
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    level: level.toUpperCase(),
    message,
  };

  state.logs.push(entry);
  if (state.logs.length > 300) {
    state.logs.shift();
  }

  notify('logs', state.logs);
}

export function clearLogs() {
  state.logs = [];
  notify('logs', state.logs);
}

export function setLogFilter(filter) {
  state.logFilter = filter;
  notify('logFilter', filter);
}

// ==========================================
// Mic Dictation
// ==========================================
export function setMicListening(isListening) {
  state.isMicListening = Boolean(isListening);
  notify('isMicListening', state.isMicListening);
}

// ==========================================
// System Updates
// ==========================================
export function setUpdateInfo(info) {
  state.updateInfo = { ...state.updateInfo, ...info };
  notify('updateInfo', state.updateInfo);
}

// ==========================================
// Store Initialization
// ==========================================
export function initState() {
  // 1. Theme
  try {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    if (savedTheme) {
      state.theme = savedTheme;
    }
  } catch {}
  document.documentElement.setAttribute('data-theme', state.theme);

  // 2. Custom Colors
  try {
    const savedColors = localStorage.getItem(STORAGE_KEYS.CUSTOM_COLORS);
    if (savedColors) {
      state.customColors = JSON.parse(savedColors);
    }
  } catch {}
  applyCustomColorsToDom();

  // 3. Dev Mode
  try {
    const savedDev = localStorage.getItem(STORAGE_KEYS.DEV_MODE);
    if (savedDev !== null) {
      state.devMode = savedDev === 'true';
    }
  } catch {}
  document.documentElement.setAttribute('data-dev-mode', state.devMode ? 'true' : 'false');

  // 4. Activity Feed
  try {
    const savedAct = localStorage.getItem(STORAGE_KEYS.ACTIVITY);
    if (savedAct) {
      state.activityFeed = JSON.parse(savedAct);
    }
  } catch {}

  if (state.activityFeed.length === 0) {
    addActivity('AION Started', 'System node initialized cleanly', 'check');
  }
}
