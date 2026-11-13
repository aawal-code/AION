/**
 * AION Settings & Preferences Module
 * 4-Tab Preferences Modal: General, Network & Access, API Vault & Execution, Interface
 */

export function showToast(message, iconName = 'check') {
  if (typeof window !== 'undefined' && typeof window.aionShowToast === 'function') {
    window.aionShowToast(message, iconName);
    return;
  }
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

let pinInterval = null;
let currentRemainingMs = 0;
let totalCycleMs = 120000; // 120 seconds cycle duration

// Default CLI Profiles for BYOCLI
const DEFAULT_BYOCLI_PROFILES = [
  {
    id: 'claude',
    name: 'Claude Code CLI',
    command: 'claude',
    path: 'claude',
    sandboxMode: 'Prompt', // Strict | Prompt | Unrestricted
    description: 'Anthropic agentic development CLI',
    installed: true,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    path: 'codex',
    sandboxMode: 'Strict',
    description: 'Autonomous code synthesis CLI',
    installed: true,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    path: 'gemini',
    sandboxMode: 'Prompt',
    description: 'Google Developer AI tooling',
    installed: true,
  },
  {
    id: 'cursor',
    name: 'Cursor Agent CLI',
    command: 'cursor',
    path: 'cursor',
    sandboxMode: 'Prompt',
    description: 'Cursor IDE agent CLI bridge',
    installed: false,
  },
  {
    id: 'ollama',
    name: 'Ollama Local LLM',
    command: 'ollama',
    path: 'http://localhost:11434',
    sandboxMode: 'Unrestricted',
    description: 'Local on-device model runner',
    installed: true,
  },
];

// Default Supported API Key Providers
const API_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic Claude', placeholder: 'sk-ant-api03-...' },
  { id: 'openai', name: 'OpenAI (GPT-4o)', placeholder: 'sk-proj-...' },
  { id: 'gemini', name: 'Google Gemini', placeholder: 'AIzaSy...' },
  { id: 'groq', name: 'Groq Cloud', placeholder: 'gsk_...' },
  { id: 'ollama', name: 'Ollama Endpoint', placeholder: 'http://localhost:11434' },
];

/**
 * Open the Preferences Modal and activate target tab
 * @param {string} tabName - 'general' | 'network' | 'vault' | 'interface'
 */
export function openSettings(tabName = 'general') {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  modal.classList.add('active');
  switchTab(tabName);

  // Load live data for settings
  loadGeneralProfile();
  fetchNetworkMesh();
  fetchRollingPin();
  fetchTrustedDevices();
  renderApiVault();
  renderByocliGrid();
  loadInterfaceSettings();
}

/**
 * Close the Preferences Modal and clean up timers
 */
export function closeSettings() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('active');

  if (pinInterval) {
    clearInterval(pinInterval);
    pinInterval = null;
  }
}

/**
 * Switch active tab inside Preferences Modal
 * @param {string} tabName - 'general' | 'network' | 'vault' | 'interface'
 */
export function switchTab(tabName) {
  const tabButtons = document.querySelectorAll('.settings-tab-btn');
  const tabPanels = document.querySelectorAll('.settings-tab-panel');

  tabButtons.forEach((btn) => {
    const isTarget = btn.getAttribute('data-settings-tab') === tabName;
    btn.classList.toggle('active', isTarget);
  });

  tabPanels.forEach((panel) => {
    const isTarget = panel.id === `settingsPanel-${tabName}`;
    panel.classList.toggle('active', isTarget);
  });
}

// ==========================================================================
// 1. General & Device Profile
// ==========================================================================

export function loadGeneralProfile() {
  const nameInput = document.getElementById('settingsDeviceName');
  const roleSelect = document.getElementById('settingsDeviceRole');

  const savedName = localStorage.getItem('aion_device_name') || window.location.hostname || 'Primary Workstation';
  const savedRole = localStorage.getItem('aion_device_role') || 'Master';

  if (nameInput) nameInput.value = savedName;
  if (roleSelect) roleSelect.value = savedRole;
}

export function saveGeneralProfile() {
  const nameInput = document.getElementById('settingsDeviceName');
  const roleSelect = document.getElementById('settingsDeviceRole');

  if (nameInput && nameInput.value.trim()) {
    const newName = nameInput.value.trim();
    localStorage.setItem('aion_device_name', newName);

    const canvasTitle = document.getElementById('canvasDeviceName');
    if (canvasTitle) canvasTitle.textContent = newName;
  }

  if (roleSelect) {
    localStorage.setItem('aion_device_role', roleSelect.value);
  }

  showToast('Device profile saved', 'check');
}

// ==========================================================================
// 2. Network & Access (Mesh Status, Rolling PIN, Trusted Devices)
// ==========================================================================

export async function fetchNetworkMesh() {
  const ipv4El = document.getElementById('settingsTailscaleIpv4');
  const ipv6El = document.getElementById('settingsTailscaleIpv6');
  const hostEl = document.getElementById('settingsTailscaleHost');
  const badgeEl = document.getElementById('settingsTailscaleStatusBadge');

  try {
    const res = await fetch('/api/network/mesh');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const isConnected = !!data.connected;
    if (badgeEl) {
      badgeEl.textContent = isConnected ? 'Connected' : 'Offline';
      badgeEl.className = `sidebar-badge ${isConnected ? 'badge-success' : 'badge-neutral'}`;
      badgeEl.style.background = isConnected ? 'var(--color-success-subtle)' : 'var(--surface-hover)';
      badgeEl.style.color = isConnected ? 'var(--color-success)' : 'var(--text-secondary)';
    }

    if (ipv4El) ipv4El.textContent = data.ipv4 || '100.x.y.z (Tailscale inactive)';
    if (ipv6El) ipv6El.textContent = data.ipv6 || 'Not assigned';
    if (hostEl) hostEl.textContent = data.hostname || 'localhost';
  } catch {
    if (badgeEl) {
      badgeEl.textContent = 'Standby';
      badgeEl.style.background = 'var(--surface-hover)';
      badgeEl.style.color = 'var(--text-secondary)';
    }
  }
}

export async function fetchRollingPin() {
  const pinEl = document.getElementById('settingsPairingPin');
  const progressBar = document.getElementById('pinProgressBar');
  const countdownEl = document.getElementById('pinCountdownText');

  try {
    const res = await fetch('/api/auth/pin');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (pinEl && data.currentPin) {
      pinEl.textContent = data.currentPin;
    }

    currentRemainingMs = typeof data.milliseconds_remaining === 'number' ? data.milliseconds_remaining : 120000;
    updatePinProgressDisplay(currentRemainingMs);

    // Start 1-second interval ticker for smooth visual bar update
    if (pinInterval) clearInterval(pinInterval);
    pinInterval = setInterval(() => {
      currentRemainingMs -= 1000;
      if (currentRemainingMs <= 0) {
        clearInterval(pinInterval);
        pinInterval = null;
        fetchRollingPin(); // Automatically re-fetch next cycled PIN
      } else {
        updatePinProgressDisplay(currentRemainingMs);
      }
    }, 1000);
  } catch (err) {
    if (pinEl) pinEl.textContent = '----';
    if (countdownEl) countdownEl.textContent = 'Auth service offline';
  }
}

function updatePinProgressDisplay(msRemaining) {
  const progressBar = document.getElementById('pinProgressBar');
  const countdownEl = document.getElementById('pinCountdownText');

  const seconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const percent = Math.max(0, Math.min(100, (msRemaining / totalCycleMs) * 100));

  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
  if (countdownEl) {
    countdownEl.textContent = `Cycles in ${seconds}s`;
  }
}

export async function regenerateRollingPin() {
  try {
    let res = await fetch('/api/auth/pin/regenerate', { method: 'POST' });
    if (!res.ok) {
      // Fallback to legacy/cycle endpoint
      res = await fetch('/api/auth/pin/cycle', { method: 'POST' });
    }
    const data = await res.json();
    showToast('Pairing PIN regenerated', 'check');
    await fetchRollingPin();
  } catch (err) {
    showToast('Could not regenerate PIN', 'close');
  }
}

export async function fetchTrustedDevices() {
  const listEl = document.getElementById('trustedDevicesList');
  if (!listEl) return;

  try {
    const res = await fetch('/api/auth/devices');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const devices = Array.isArray(data.devices) ? data.devices : [];

    if (devices.length === 0) {
      listEl.innerHTML = `<div style="font-size: 12.5px; color: var(--text-tertiary); padding: 8px 0;">No remote companion devices paired yet.</div>`;
      return;
    }

    listEl.innerHTML = devices
      .map((dev) => {
        const devName = escapeHtml(dev.name || 'Remote Device');
        const devIp = escapeHtml(dev.ip || 'Unknown IP');
        const tokenSnippet = dev.token ? `${dev.token.slice(0, 8)}...` : 'Active';
        const lastSeen = dev.lastSeen ? new Date(dev.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently';

        return `
        <div class="trusted-device-row">
          <div class="trusted-device-info">
            <span class="trusted-device-name">${devName}</span>
            <span class="trusted-device-meta">IP: ${devIp} &bull; Token: ${tokenSnippet} &bull; Seen: ${lastSeen}</span>
          </div>
          <button class="btn-revoke-device" data-device-id="${escapeHtml(dev.id)}" type="button">Revoke</button>
        </div>
      `;
      })
      .join('');

    // Wire Revoke Buttons
    listEl.querySelectorAll('.btn-revoke-device').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const devId = btn.getAttribute('data-device-id');
        if (devId) {
          await revokeTrustedDevice(devId);
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div style="font-size: 12.5px; color: var(--text-tertiary); padding: 8px 0;">Unable to load trusted devices.</div>`;
  }
}

export async function revokeTrustedDevice(deviceId) {
  try {
    const res = await fetch(`/api/auth/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      showToast('Device token revoked', 'check');
      await fetchTrustedDevices();
    } else {
      showToast('Failed to revoke device', 'close');
    }
  } catch (err) {
    showToast('Revoke error', 'close');
  }
}

// ==========================================================================
// 3. API Vault & Execution (API Keys Manager & BYOCLI Profiles)
// ==========================================================================

export function getApiVault() {
  try {
    return JSON.parse(localStorage.getItem('aion_api_vault') || '{}');
  } catch {
    return {};
  }
}

export function saveApiKey(provider, key) {
  const vault = getApiVault();
  if (key && key.trim()) {
    vault[provider] = key.trim();
  } else {
    delete vault[provider];
  }
  localStorage.setItem('aion_api_vault', JSON.stringify(vault));
  renderApiVault();
  showToast(`${provider} key updated`, 'check');
}

export function renderApiVault() {
  const container = document.getElementById('apiVaultList');
  if (!container) return;

  const vault = getApiVault();

  container.innerHTML = API_PROVIDERS.map((provider) => {
    const currentKey = vault[provider.id] || '';
    const hasKey = currentKey.length > 0;
    const masked = hasKey
      ? `${currentKey.slice(0, 6)}••••••••${currentKey.slice(-4)}`
      : 'Not configured';

    return `
      <div class="api-vault-item">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${provider.name}</span>
            <span class="sidebar-badge" style="font-size: 10px; background: ${hasKey ? 'var(--color-success-subtle)' : 'var(--surface-active)'}; color: ${hasKey ? 'var(--color-success)' : 'var(--text-tertiary)'};">
              ${hasKey ? 'Configured' : 'Missing'}
            </span>
          </div>
          <span style="font-size: 11.5px; font-family: var(--font-mono); color: var(--text-secondary);">${masked}</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn-secondary btn-set-api-key" data-provider="${provider.id}" style="padding: 4px 10px; font-size: 11.5px;" type="button">
            ${hasKey ? 'Edit' : 'Add Key'}
          </button>
          ${hasKey ? `<button class="btn-secondary btn-clear-api-key" data-provider="${provider.id}" style="padding: 4px 8px; font-size: 11.5px; color: var(--color-danger);" type="button">Remove</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Wire buttons
  container.querySelectorAll('.btn-set-api-key').forEach((btn) => {
    btn.addEventListener('click', () => {
      const providerId = btn.getAttribute('data-provider');
      const provider = API_PROVIDERS.find((p) => p.id === providerId);
      const current = vault[providerId] || '';
      const newKey = window.prompt(`Enter API Key for ${provider?.name || providerId}:`, current);
      if (newKey !== null) {
        saveApiKey(providerId, newKey);
      }
    });
  });

  container.querySelectorAll('.btn-clear-api-key').forEach((btn) => {
    btn.addEventListener('click', () => {
      const providerId = btn.getAttribute('data-provider');
      if (window.confirm(`Remove saved key for ${providerId}?`)) {
        saveApiKey(providerId, '');
      }
    });
  });
}

export function getByocliProfiles() {
  try {
    const raw = localStorage.getItem('aion_byocli_profiles');
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_BYOCLI_PROFILES;
}

export function saveByocliProfiles(profiles) {
  localStorage.setItem('aion_byocli_profiles', JSON.stringify(profiles));
  renderByocliGrid();
}

export function renderByocliGrid() {
  const container = document.getElementById('byocliGrid');
  if (!container) return;

  const profiles = getByocliProfiles();

  container.innerHTML = profiles
    .map((profile) => {
      const isInstalled = profile.installed !== false;
      return `
      <div class="byocli-card" data-profile-id="${escapeHtml(profile.id)}">
        <div class="byocli-header">
          <span class="byocli-title">
            <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            ${escapeHtml(profile.name)}
          </span>
          <span class="byocli-badge ${isInstalled ? 'active' : ''}">
            ${isInstalled ? 'Ready' : 'Custom'}
          </span>
        </div>
        <span class="byocli-path">${escapeHtml(profile.path || profile.command)}</span>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;">
          <label style="font-size: 11.5px; color: var(--text-secondary); white-space: nowrap;">Sandbox:</label>
          <select class="byocli-mode-select" data-profile-id="${escapeHtml(profile.id)}">
            <option value="Strict" ${profile.sandboxMode === 'Strict' ? 'selected' : ''}>Strict (Ask Every Run)</option>
            <option value="Prompt" ${profile.sandboxMode === 'Prompt' ? 'selected' : ''}>Prompt (Ask On Write)</option>
            <option value="Unrestricted" ${profile.sandboxMode === 'Unrestricted' ? 'selected' : ''}>Unrestricted (Direct)</option>
          </select>
        </div>
      </div>
    `;
    })
    .join('');

  // Wire mode select change
  container.querySelectorAll('.byocli-mode-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      const profileId = select.getAttribute('data-profile-id');
      const newMode = e.target.value;
      const profiles = getByocliProfiles();
      const target = profiles.find((p) => p.id === profileId);
      if (target) {
        target.sandboxMode = newMode;
        saveByocliProfiles(profiles);
        showToast(`${target.name} sandbox set to ${newMode}`, 'check');
      }
    });
  });
}

// ==========================================================================
// 4. Interface (Theme, Developer Mode, Language)
// ==========================================================================

export function loadInterfaceSettings() {
  // Developer Mode Toggle
  const devToggle = document.getElementById('devModeToggle');
  const devContainer = document.getElementById('devModeContainer');
  const isDevMode = localStorage.getItem('aion_dev_mode') === 'true';

  if (devToggle) {
    devToggle.checked = isDevMode;
  }
  if (devContainer) {
    devContainer.classList.toggle('active', isDevMode);
  }

  // Theme Mode Selector (Light / Dark / Auto)
  const savedMode = localStorage.getItem('aion_theme_mode') || 'dark';
  document.querySelectorAll('.theme-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-theme-mode') === savedMode);
  });
}

export function setThemeMode(mode) {
  localStorage.setItem('aion_theme_mode', mode);

  document.querySelectorAll('.theme-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-theme-mode') === mode);
  });

  if (mode === 'auto') {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'macos-dark' : 'macos-light');
  } else if (mode === 'light') {
    document.documentElement.setAttribute('data-theme', 'macos-light');
  } else {
    document.documentElement.setAttribute('data-theme', 'macos-dark');
  }

  showToast(`Theme set to ${mode}`, 'sun');
}

// ==========================================================================
// Initialization & Global Event Wiring
// ==========================================================================

export function initSettings() {
  // Modal open triggers
  document.getElementById('btnOpenSettings')?.addEventListener('click', () => openSettings('general'));
  document.getElementById('btnMobileSettings')?.addEventListener('click', () => openSettings('general'));

  // Modal close triggers
  document.getElementById('btnCloseSettings')?.addEventListener('click', closeSettings);

  const modal = document.getElementById('settingsModal');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeSettings();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) {
      closeSettings();
    }
  });

  // Tab switching clicks
  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-settings-tab');
      if (targetTab) switchTab(targetTab);
    });
  });

  // General Save Button
  document.getElementById('btnSaveGeneralProfile')?.addEventListener('click', saveGeneralProfile);

  // Regenerate PIN Click
  document.getElementById('btnRegeneratePin')?.addEventListener('click', regenerateRollingPin);

  // Developer Mode Toggle
  const devToggle = document.getElementById('devModeToggle');
  const devContainer = document.getElementById('devModeContainer');
  devToggle?.addEventListener('change', () => {
    const enabled = devToggle.checked;
    localStorage.setItem('aion_dev_mode', String(enabled));
    if (devContainer) devContainer.classList.toggle('active', enabled);
    showToast(enabled ? 'Developer Mode enabled' : 'Developer Mode disabled', 'terminal');
  });

  // Theme Mode Segmented buttons
  document.querySelectorAll('.theme-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-theme-mode');
      if (mode) setThemeMode(mode);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
  } else {
    initSettings();
  }
}
