/**
 * AION Core Application Controller
 * Apple-grade Modular UI Architecture
 * Wires UI shell cleanly to existing backend endpoints with clean placeholders.
 */

import {
  getState,
  subscribe,
  setActiveTab,
  setTheme,
  setCustomColor,
  resetCustomColors,
  setDevMode,
  addActivity,
  addChatMessage,
  setAssistantBusy,
  setSyncthingData,
  addLog,
  clearLogs,
  setLogFilter,
  setMicListening,
  setUpdateInfo,
  initState,
} from './state.js';

import {
  t,
  getLanguage,
  setLanguage,
  initLanguage,
  updateDomTranslations,
} from './i18n.js';

import { getSvgIcon } from './icons.js';
import { initDevicesModule, fetchRunningProcesses, renderDevicesView, selectDevice } from './devices.js';

// ==========================================================================
// Service Worker Live Controller Reload (Mobile / Desktop PWA Auto-Refresh)
// ==========================================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

// ==========================================================================
// Toast Notification Utility
// ==========================================================================
export function showToast(message, iconName = 'check') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `
    <span style="color: var(--color-success);">${getSvgIcon(iconName, 'icon-sm')}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px) scale(0.95)';
    toast.style.transition = 'all 0.25s var(--ease-spring)';
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

// ==========================================================================
// Settings Modal (macOS Preferences Dialog)
// ==========================================================================
function setupSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const btnOpen = document.getElementById('btnOpenSettings');
  const btnMobile = document.getElementById('btnMobileSettings');
  const btnClose = document.getElementById('btnCloseSettings');

  function openSettings() {
    modal?.classList.add('active');
  }

  function closeSettings() {
    modal?.classList.remove('active');
  }

  btnOpen?.addEventListener('click', openSettings);
  btnMobile?.addEventListener('click', openSettings);
  btnClose?.addEventListener('click', closeSettings);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeSettings();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) {
      closeSettings();
    }
  });
}

// ==========================================================================
// Navigation & Tab Switching
// ==========================================================================
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-segmented-btn');
  const indicator = document.querySelector('.nav-segmented-indicator');

  function updateIndicator(activeBtn) {
    if (!activeBtn || !indicator) return;
    const isRtl = document.documentElement.dir === 'rtl';
    const parentRect = activeBtn.parentElement.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();

    const left = btnRect.left - parentRect.left;
    const width = btnRect.width;

    indicator.style.width = `${width}px`;
    indicator.style.transform = `translateX(${left - 3}px)`;
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) {
        setActiveTab(tab);
      }
    });
  });

  // Observe activeTab in state
  subscribe((state, key) => {
    if (key === 'activeTab' || !key) {
      const currentTab = state.activeTab;

      // Update button classes
      navButtons.forEach((btn) => {
        const isMatch = btn.getAttribute('data-tab') === currentTab;
        btn.classList.toggle('active', isMatch);
        if (isMatch) {
          updateIndicator(btn);
        }
      });

      // Update view sections
      document.querySelectorAll('.view-section').forEach((section) => {
        const matches = section.id === `view-${currentTab}`;
        if (matches) {
          section.classList.add('active');
        } else {
          section.classList.remove('active');
        }
      });
    }
  });

  // Window resize & language flip indicator updates
  window.addEventListener('resize', () => {
    const activeBtn = document.querySelector('.nav-segmented-btn.active');
    updateIndicator(activeBtn);
  });

  window.addEventListener('aion:languagechange', () => {
    setTimeout(() => {
      const activeBtn = document.querySelector('.nav-segmented-btn.active');
      updateIndicator(activeBtn);
    }, 50);
  });
}

// ==========================================================================
// Workstation Quick Actions (/api/command)
// ==========================================================================
async function dispatchOsCommand(action, target = '') {
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target }),
    });

    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      if (action === 'lock') {
        showToast(t('activityLockDone'), 'lock');
        addActivity(t('actionLock'), t('activityLockDone'), 'lock');
      } else if (action === 'sleep') {
        showToast(t('activitySleepDone'), 'moon');
        addActivity(t('actionSleep'), t('activitySleepDone'), 'moon');
      } else if (action === 'kill_process') {
        showToast(t('activityKillDone', { target }), 'x');
        addActivity(t('actionQuit'), t('activityKillDone', { target }), 'power');
      }
      return data;
    } else {
      const err = data.error || data.message || 'Action failed';
      showToast(err, 'close');
      addActivity('Action Failed', err, 'close');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'close');
    addActivity('Command Error', err.message, 'close');
  }
}

function setupWorkstationActions() {
  const btnLock = document.getElementById('btnActionLock');
  const btnSleep = document.getElementById('btnActionSleep');
  const btnQuit = document.getElementById('btnActionQuit');

  if (btnLock) {
    btnLock.addEventListener('click', () => dispatchOsCommand('lock'));
  }

  if (btnSleep) {
    btnSleep.addEventListener('click', () => dispatchOsCommand('sleep'));
  }

  // Quit App Modal
  const modal = document.getElementById('quitModal');
  const modalInput = document.getElementById('quitModalInput');
  const modalCancel = document.getElementById('quitModalCancel');
  const modalConfirm = document.getElementById('quitModalConfirm');

  if (btnQuit && modal) {
    btnQuit.addEventListener('click', () => {
      modal.classList.add('active');
      if (modalInput) {
        modalInput.value = '';
        setTimeout(() => modalInput.focus(), 100);
      }
    });

    modalCancel?.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    modalConfirm?.addEventListener('click', () => {
      const target = modalInput?.value?.trim();
      if (target) {
        dispatchOsCommand('kill_process', target);
      }
      modal.classList.remove('active');
    });

    modalInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        modalConfirm.click();
      } else if (e.key === 'Escape') {
        modalCancel.click();
      }
    });
  }
}

// ==========================================================================
// Syncthing Peer Sync Polling (/api/sync/status)
// ==========================================================================
async function fetchSyncStatus() {
  try {
    const res = await fetch('/api/sync/status');
    if (!res.ok) return;
    const data = await res.json();
    setSyncthingData({
      online: true,
      data,
    });
    renderSyncthingCard(data);
  } catch {
    renderSyncthingCard(null);
  }
}

function renderSyncthingCard(data) {
  const container = document.getElementById('syncPeersList');
  if (!container) return;

  if (!data || !data.system) {
    container.innerHTML = `
      <div class="sync-peer-item">
        <span class="sync-peer-name">${getSvgIcon('devices', 'icon-sm')} ${t('meshNoPeers')}</span>
        <span class="sync-peer-status">${t('meshStatusSynced')}</span>
      </div>
    `;
    return;
  }

  const myId = data.system.myID ? `${data.system.myID.slice(0, 7)}...` : 'Local';
  container.innerHTML = `
    <div class="sync-peer-item">
      <span class="sync-peer-name">${getSvgIcon('devices', 'icon-sm')} Station (${myId})</span>
      <span class="sync-peer-status" style="color: var(--color-success);">${t('meshStatusSynced')}</span>
    </div>
  `;
}

// ==========================================================================
// Human Activity Feed Renderer
// ==========================================================================
function renderActivityFeed(feed) {
  const list = document.getElementById('activityFeedList');
  if (!list) return;

  if (!feed || feed.length === 0) {
    list.innerHTML = `<div class="activity-empty">${t('activityEmpty')}</div>`;
    return;
  }

  list.innerHTML = feed
    .map(
      (item) => `
    <div class="activity-item">
      <div class="activity-icon-box">
        ${getSvgIcon(item.iconType || 'activity', 'icon-sm')}
      </div>
      <div class="activity-content">
        <div class="activity-title">${item.title}</div>
        ${item.desc ? `<div class="activity-desc">${item.desc}</div>` : ''}
      </div>
      <div class="activity-time">${item.time}</div>
    </div>
  `
    )
    .join('');
}

// ==========================================================================
// Chat & Assistant Logic (/api/ai)
// ==========================================================================
function renderChatMessages(messages) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  container.innerHTML = messages
    .map((msg) => {
      const isUser = msg.role === 'user';
      return `
      <div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}">
        <div class="chat-bubble-text">${escapeHtml(msg.text)}</div>
        <div class="chat-bubble-time">${msg.time}</div>
      </div>
    `;
    })
    .join('');

  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function handleSendMessage(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;

  const state = getState();
  if (state.isAssistantBusy) return;

  // Add user message to state
  addChatMessage('user', text);

  // If in another tab/view, switch to assistant
  setActiveTab('chat');
  selectDevice('assistant');

  // Quick Command Intercept (Human Friendly)
  const lower = text.toLowerCase();
  if (lower === 'lock' || lower === 'lock screen' || lower === 'قفل الشاشة' || lower === 'bildschirm sperren') {
    await dispatchOsCommand('lock');
    addChatMessage('assistant', t('activityLockDone'));
    return;
  }
  if (lower === 'sleep' || lower === 'sleep mode' || lower === 'وضع السكون' || lower === 'ruhezustand') {
    await dispatchOsCommand('sleep');
    addChatMessage('assistant', t('activitySleepDone'));
    return;
  }

  // Send to AI Bridge (/api/ai)
  setAssistantBusy(true);
  showTypingIndicator(true);

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text }),
    });

    const data = await res.json();
    showTypingIndicator(false);
    setAssistantBusy(false);

    if (res.ok && data.response) {
      addChatMessage('assistant', data.response);
      addActivity(t('chatAssistant'), t('activityChatSent'), 'chat');
    } else {
      const err = data.error || t('chatError');
      addChatMessage('assistant', err, true);
    }
  } catch (err) {
    showTypingIndicator(false);
    setAssistantBusy(false);
    addChatMessage('assistant', `${t('chatError')} (${err.message})`, true);
  }
}

function showTypingIndicator(show) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  const existing = document.getElementById('typingIndicator');
  if (show && !existing) {
    const ind = document.createElement('div');
    ind.id = 'typingIndicator';
    ind.className = 'typing-indicator';
    ind.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    container.appendChild(ind);
    container.scrollTop = container.scrollHeight;
  } else if (!show && existing) {
    existing.remove();
  }
}

function setupChatPromptChips() {
  document.querySelectorAll('.prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      const input = document.getElementById('commandInput');
      if (input) {
        input.value = prompt;
        input.focus();
      }
      handleSendMessage(prompt);
    });
  });
}

// ==========================================================================
// Unified Bottom Command Bar
// ==========================================================================
function setupCommandBar() {
  const form = document.getElementById('commandBarForm');
  const input = document.getElementById('commandInput');
  const micBtn = document.getElementById('commandMicBtn');

  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value;
      input.value = '';
      handleSendMessage(val);
    });
  }

  // Voice Dictation (Web Speech API)
  if (micBtn && input) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setMicListening(true);
        micBtn.classList.add('recording');
        input.setAttribute('placeholder', t('micListening'));
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        input.value = transcript;
        setTimeout(() => handleSendMessage(transcript), 300);
      };

      recognition.onerror = () => {
        setMicListening(false);
        micBtn.classList.remove('recording');
        input.setAttribute('placeholder', t('commandPlaceholder'));
      };

      recognition.onend = () => {
        setMicListening(false);
        micBtn.classList.remove('recording');
        input.setAttribute('placeholder', t('commandPlaceholder'));
      };

      micBtn.addEventListener('click', () => {
        const state = getState();
        if (state.isMicListening) {
          recognition.stop();
        } else {
          recognition.lang = getLanguage() === 'ar' ? 'ar-SA' : getLanguage() === 'de' ? 'de-DE' : 'en-US';
          recognition.start();
        }
      });
    } else {
      micBtn.addEventListener('click', () => {
        showToast(t('micNotSupported'), 'close');
      });
    }
  }
}

// ==========================================================================
// Settings: Language Switcher
// ==========================================================================
function setupLanguageSwitcher() {
  const btns = document.querySelectorAll('.lang-btn');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      if (lang) {
        setLanguage(lang);
        updateLangButtons();
      }
    });
  });

  function updateLangButtons() {
    const cur = getLanguage();
    btns.forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-lang') === cur);
    });
  }

  updateLangButtons();
}

// ==========================================================================
// Settings: Theme Presets & Color Pickers
// ==========================================================================
const THEME_PRESETS = [
  { id: 'macos-dark', nameKey: 'themeMacosDark', bg: '#141517', accent: '#0a84ff', mode: 'Dark' },
  { id: 'macos-light', nameKey: 'themeMacosLight', bg: '#f5f5f7', accent: '#0071e3', mode: 'Light' },
  { id: 'oled-midnight', nameKey: 'themeOledMidnight', bg: '#000000', accent: '#388bfd', mode: 'OLED' },
  { id: 'space-gray', nameKey: 'themeSpaceGray', bg: '#18191c', accent: '#38bdf8', mode: 'Dark' },
  { id: 'silver-birch', nameKey: 'themeSilverBirch', bg: '#edf0f4', accent: '#4f46e5', mode: 'Light' },
  { id: 'titanium-sunset', nameKey: 'themeTitaniumSunset', bg: '#1c1815', accent: '#f59e0b', mode: 'Dark' },
  { id: 'alpine-glacier', nameKey: 'themeAlpineGlacier', bg: '#eef6fc', accent: '#0284c7', mode: 'Light' },
  { id: 'pacific-blue', nameKey: 'themePacificBlue', bg: '#0a1322', accent: '#00b4d8', mode: 'Dark' },
  { id: 'forest-evergreen', nameKey: 'themeForestEvergreen', bg: '#0c1611', accent: '#10b981', mode: 'Dark' },
  { id: 'royal-purple', nameKey: 'themeRoyalPurple', bg: '#120b1b', accent: '#a855f7', mode: 'Dark' },
];

function setupThemePresets() {
  const container = document.getElementById('themePresetsGrid');
  if (!container) return;

  function renderPresets() {
    const currentTheme = getState().theme;
    container.innerHTML = THEME_PRESETS.map((p) => `
      <button class="theme-preset-card ${p.id === currentTheme ? 'active' : ''}" data-theme-id="${p.id}">
        <div class="preset-swatch">
          <div class="preset-swatch-half-left" style="background: ${p.bg};"></div>
          <div class="preset-swatch-half-right" style="background: ${p.accent};"></div>
        </div>
        <div class="preset-info">
          <span class="preset-name">${t(p.nameKey)}</span>
          <span class="preset-category">${p.mode}</span>
        </div>
      </button>
    `).join('');

    container.querySelectorAll('.theme-preset-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-theme-id');
        if (id) {
          setTheme(id);
          renderPresets();
          showToast(`${t('sectionAppearance')}: ${t(THEME_PRESETS.find(x => x.id === id).nameKey)}`);
        }
      });
    });
  }

  renderPresets();
  window.addEventListener('aion:languagechange', renderPresets);
}

function setupColorPickers() {
  const inputBg = document.getElementById('colorPickerBg');
  const labelBg = document.getElementById('colorLabelBg');
  const inputSurface = document.getElementById('colorPickerSurface');
  const labelSurface = document.getElementById('colorLabelSurface');
  const inputAccent = document.getElementById('colorPickerAccent');
  const labelAccent = document.getElementById('colorLabelAccent');
  const resetBtn = document.getElementById('btnResetColors');

  function syncValues() {
    const { customColors } = getState();
    if (inputBg && labelBg) {
      inputBg.value = customColors.bg || '#141517';
      labelBg.textContent = customColors.bg || 'Default';
    }
    if (inputSurface && labelSurface) {
      inputSurface.value = customColors.surface || '#1e1f23';
      labelSurface.textContent = customColors.surface || 'Default';
    }
    if (inputAccent && labelAccent) {
      inputAccent.value = customColors.accent || '#0a84ff';
      labelAccent.textContent = customColors.accent || 'Default';
    }
  }

  inputBg?.addEventListener('input', (e) => {
    setCustomColor('bg', e.target.value);
    if (labelBg) labelBg.textContent = e.target.value;
  });

  inputSurface?.addEventListener('input', (e) => {
    setCustomColor('surface', e.target.value);
    if (labelSurface) labelSurface.textContent = e.target.value;
  });

  inputAccent?.addEventListener('input', (e) => {
    setCustomColor('accent', e.target.value);
    if (labelAccent) labelAccent.textContent = e.target.value;
  });

  resetBtn?.addEventListener('click', () => {
    resetCustomColors();
    syncValues();
    showToast(t('resetColors'));
  });

  syncValues();
}

// ==========================================
// Settings: Developer Mode Toggle & Controls
// ==========================================
function setupDeveloperMode() {
  const toggle = document.getElementById('devModeToggle');
  const devContainer = document.getElementById('devModeContainer');

  function updateDevVisibility(enabled) {
    if (toggle) toggle.checked = enabled;
    if (devContainer) {
      devContainer.classList.toggle('active', enabled);
    }
  }

  toggle?.addEventListener('change', (e) => {
    setDevMode(e.target.checked);
  });

  subscribe((state, key) => {
    if (key === 'devMode' || !key) {
      updateDevVisibility(state.devMode);
    }
  });

  // Setup SSE Event Stream (/api/logs)
  setupSseLogs();

  // Setup Updater Controls
  setupUpdateControls();
}

function setupSseLogs() {
  const logsContainer = document.getElementById('devConsoleLogs');
  const clearBtn = document.getElementById('devClearLogsBtn');
  const filterPills = document.querySelectorAll('.dev-filter-pill');

  function renderLogs() {
    if (!logsContainer) return;
    const { logs, logFilter } = getState();
    const filtered = logFilter === 'ALL' ? logs : logs.filter((l) => l.level === logFilter);

    if (filtered.length === 0) {
      logsContainer.innerHTML = `<div style="color: var(--text-tertiary); padding: 12px 0;">${t('devLogsEmpty')}</div>`;
      return;
    }

    logsContainer.innerHTML = filtered
      .map(
        (l) => `
      <div class="log-entry">
        <span class="log-time">[${l.time}]</span>
        <span class="log-level log-level-${l.level}">${l.level}</span>
        <span class="log-msg">${escapeHtml(l.message)}</span>
      </div>
    `
      )
      .join('');

    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  // Connect EventSource to /api/logs
  try {
    const sse = new EventSource('/api/logs');
    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.level && data.message) {
          addLog(data.level, data.message);
          renderLogs();
        }
      } catch {
        addLog('INFO', event.data);
        renderLogs();
      }
    };
    sse.onerror = () => {
      // Clean fallback if SSE temporarily unavailable
    };
  } catch {}

  clearBtn?.addEventListener('click', () => {
    clearLogs();
    renderLogs();
  });

  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const filter = pill.getAttribute('data-filter');
      if (filter) {
        setLogFilter(filter);
        filterPills.forEach((p) => p.classList.toggle('active', p === pill));
        renderLogs();
      }
    });
  });
}

function setupUpdateControls() {
  const checkBtn = document.getElementById('btnCheckUpdates');
  const applyBtn = document.getElementById('btnApplyUpdate');
  const statusLabel = document.getElementById('updateStatusLabel');
  const versionTag = document.getElementById('updaterVersionTag');

  checkBtn?.addEventListener('click', async () => {
    if (!statusLabel) return;
    statusLabel.textContent = t('updateChecking');

    try {
      const res = await fetch('/api/system/update/check');
      const data = await res.json();

      if (res.ok && data.status === 'ok') {
        if (versionTag && data.currentVersion) {
          versionTag.textContent = `v${data.currentVersion}`;
        }

        if (data.updateAvailable) {
          statusLabel.textContent = t('updateAvailable', { version: data.latestVersion });
          if (applyBtn) applyBtn.style.display = 'inline-flex';
        } else {
          statusLabel.textContent = t('updateUpToDate', { version: data.currentVersion });
          if (applyBtn) applyBtn.style.display = 'none';
        }
      } else {
        statusLabel.textContent = data.message || t('updateError');
      }
    } catch (err) {
      statusLabel.textContent = `${t('updateError')} (${err.message})`;
    }
  });

  applyBtn?.addEventListener('click', async () => {
    if (!statusLabel) return;
    statusLabel.textContent = t('updateApplying');

    try {
      const res = await fetch('/api/system/update/apply', { method: 'POST' });
      const data = await res.json();
      showToast(data.message || 'Update initiated', 'refresh');
    } catch (err) {
      showToast(`Update error: ${err.message}`, 'close');
    }
  });
}

// ==========================================================================
// App Master Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Language & State
  initLanguage();
  initState();

  // 2. Navigation & Settings Modal
  setupNavigation();
  setupSettingsModal();

  // 3. Workstation Quick Actions
  setupWorkstationActions();

  // 4. Activity Feed & Chat
  const state = getState();
  renderActivityFeed(state.activityFeed);
  renderChatMessages(state.chatMessages);
  setupChatPromptChips();
  setupCommandBar();

  // 5. Settings: Language, Themes, Color Pickers, Developer Mode
  setupLanguageSwitcher();
  setupThemePresets();
  setupColorPickers();
  setupDeveloperMode();

  // 6. Smart Devices, WoL & Running Processes (Phase 2)
  initDevicesModule();
  document.getElementById('btnRefreshProcesses')?.addEventListener('click', () => {
    fetchRunningProcesses();
  });

  // 7. Syncthing Peer Status
  fetchSyncStatus();

  // 8. Re-render devices on language change
  window.addEventListener('aion:languagechange', () => {
    renderDevicesView();
  });

  // 9. Subscribe to dynamic state updates
  subscribe((currentState, key) => {
    if (key === 'activityFeed') {
      renderActivityFeed(currentState.activityFeed);
    }
    if (key === 'chatMessages') {
      renderChatMessages(currentState.chatMessages);
    }
  });
});
