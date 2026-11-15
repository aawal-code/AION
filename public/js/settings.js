/**
 * AION Settings & Preferences Module
 * Preferences Modal: profile, network, credentials, security, and interface.
 */
import { initSecurity, loadSecurityPanel } from './security.js';

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
    installed: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    path: 'codex',
    sandboxMode: 'Strict',
    description: 'Autonomous code synthesis CLI',
    installed: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    path: 'gemini',
    sandboxMode: 'Prompt',
    description: 'Google Developer AI tooling',
    installed: false,
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
    id: 'agy',
    name: 'Antigravity CLI',
    command: 'agy',
    path: 'agy',
    sandboxMode: 'Prompt',
    description: 'Google Deepmind agent runtime',
    installed: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode CLI',
    command: 'opencode',
    path: 'opencode',
    sandboxMode: 'Strict',
    description: 'Open source agentic code assistant',
    installed: false,
  },
  {
    id: 'ollama',
    name: 'Ollama Local LLM',
    command: 'ollama',
    path: 'http://localhost:11434',
    sandboxMode: 'Unrestricted',
    description: 'Local on-device model runner',
    installed: false,
    running: false,
  },
];

// Default Supported API Key Providers
const API_PROVIDERS = [
  { id: 'cerebras', name: 'Cerebras Inference', placeholder: 'csk-...' },
  { id: 'anthropic', name: 'Anthropic Claude', placeholder: 'sk-ant-api03-...' },
  { id: 'openai', name: 'OpenAI (GPT-4o)', placeholder: 'sk-proj-...' },
  { id: 'gemini', name: 'Google Gemini', placeholder: 'AIzaSy...' },
  { id: 'groq', name: 'Groq Cloud', placeholder: 'gsk_...' },
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
  renderApiVault();
  renderByocliGrid();
  loadInterfaceSettings();
  loadSecurityPanel();
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

  const body = document.getElementById('settingsModalBody');
  if (body) body.scrollTop = 0;
}

// ==========================================================================
// 1. General & Device Profile & Laptop Auto-Modes
// ==========================================================================

export async function fetchLaptopMode() {
  const badge = document.getElementById('settingsLaptopEffectiveState');
  const buttons = document.querySelectorAll('#laptopModeSegmented [data-laptop-mode]');

  try {
    const res = await fetch('/api/system/laptop-mode');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status !== 'ok') return;

    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.laptopMode.toLowerCase() === (data.mode || 'auto').toLowerCase());
    });

    if (badge) {
      const mode = data.mode || 'Auto';
      const effective = data.effectiveMode || 'Away';
      const net = data.ethernet ? 'Ethernet' : 'Wi-Fi';
      const pwr = data.acPower ? 'AC' : 'Battery';
      badge.textContent = `${mode} • Effective: ${effective} (${net}, ${pwr})`;
      badge.className = `sidebar-badge ${effective === 'Home' ? 'badge-success' : 'badge-warning'}`;
      badge.style.background = effective === 'Home' ? 'var(--color-success-subtle, rgba(34, 197, 94, 0.15))' : 'var(--color-warning-subtle, rgba(245, 158, 11, 0.15))';
      badge.style.color = effective === 'Home' ? 'var(--color-success, #22c55e)' : 'var(--color-warning, #f59e0b)';
    }
  } catch (err) {
    console.debug('[AION Settings] fetchLaptopMode error:', err.message);
  }
}

export async function setLaptopModeState(targetMode) {
  const badge = document.getElementById('settingsLaptopEffectiveState');
  const buttons = document.querySelectorAll('#laptopModeSegmented [data-laptop-mode]');

  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.laptopMode.toLowerCase() === targetMode.toLowerCase());
  });

  try {
    const res = await fetch('/api/system/laptop-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: targetMode }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (badge && data.status === 'ok') {
      const mode = data.mode || targetMode;
      const effective = data.effectiveMode || 'Away';
      const net = data.ethernet ? 'Ethernet' : 'Wi-Fi';
      const pwr = data.acPower ? 'AC' : 'Battery';
      badge.textContent = `${mode} • Effective: ${effective} (${net}, ${pwr})`;
      badge.className = `sidebar-badge ${effective === 'Home' ? 'badge-success' : 'badge-warning'}`;
      badge.style.background = effective === 'Home' ? 'var(--color-success-subtle, rgba(34, 197, 94, 0.15))' : 'var(--color-warning-subtle, rgba(245, 158, 11, 0.15))';
      badge.style.color = effective === 'Home' ? 'var(--color-success, #22c55e)' : 'var(--color-warning, #f59e0b)';
    }
    showToast(`Laptop mode set to ${targetMode}`, 'check');
  } catch (err) {
    showToast('Failed to set laptop mode', 'close');
  }
}

export function updateLaptopModeVisibility() {
  const roleSelect = document.getElementById('settingsDeviceRole');
  const laptopGroup = document.getElementById('settingsLaptopModeGroup');
  if (!laptopGroup) return;

  const isLaptop = roleSelect && roleSelect.value && roleSelect.value.toLowerCase() === 'laptop';
  laptopGroup.style.display = isLaptop ? 'block' : 'none';

  if (isLaptop) {
    fetchLaptopMode();
  }
}

export async function loadGeneralProfile() {
  const nameInput = document.getElementById('settingsDeviceName');
  const roleSelect = document.getElementById('settingsDeviceRole');

  let savedName = localStorage.getItem('aion_device_name');
  if (!savedName || savedName === 'localhost' || savedName === '127.0.0.1') {
    try {
      const res = await fetch('/api/capabilities');
      if (res.ok) {
        const data = await res.json();
        if (data.capabilities && data.capabilities.hostname) {
          savedName = data.capabilities.hostname;
          localStorage.setItem('aion_device_name', savedName);
        }
      }
    } catch (_) {}
  }
  if (!savedName) savedName = 'AION Host';
  const savedRole = localStorage.getItem('aion_device_role') || 'Desktop';

  if (nameInput) nameInput.value = savedName;
  if (roleSelect) {
    roleSelect.value = savedRole;
    updateLaptopModeVisibility();
  }

  const canvasTitle = document.getElementById('canvasDeviceName');
  if (canvasTitle && (!canvasTitle.textContent || canvasTitle.textContent === 'localhost')) {
    canvasTitle.textContent = savedName;
  }
}

export async function saveGeneralProfile() {
  const nameInput = document.getElementById('settingsDeviceName');
  const roleSelect = document.getElementById('settingsDeviceRole');

  let newName = '';
  if (nameInput && nameInput.value.trim()) {
    newName = nameInput.value.trim();
    localStorage.setItem('aion_device_name', newName);

    const canvasTitle = document.getElementById('canvasDeviceName');
    if (canvasTitle) canvasTitle.textContent = newName;
  }

  const newRole = roleSelect ? roleSelect.value : 'Desktop';
  if (roleSelect) {
    localStorage.setItem('aion_device_role', newRole);
    updateLaptopModeVisibility();
  }

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceName: newName || undefined,
        deviceRole: newRole,
      }),
    });
  } catch (_) {}

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
      badgeEl.textContent = isConnected ? 'Tailscale connected' : 'Tailscale offline';
      badgeEl.className = `sidebar-badge ${isConnected ? 'badge-success' : 'badge-neutral'}`;
      badgeEl.style.background = isConnected ? 'var(--color-success-subtle)' : 'var(--surface-hover)';
      badgeEl.style.color = isConnected ? 'var(--color-success)' : 'var(--text-secondary)';
    }

    if (ipv4El) ipv4El.textContent = data.ipv4 || 'Not assigned';
    if (ipv6El) ipv6El.textContent = data.ipv6 || 'Not assigned';
    if (hostEl) hostEl.textContent = data.hostname || 'localhost';
  } catch {
    if (badgeEl) {
      badgeEl.textContent = 'Status unavailable';
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

// This compatibility accessor never reads browser storage. Credentials remain
// exclusively in the platform-protected service vault.
export function getApiVault() { return {}; }

export async function saveApiKey(provider, key) {
  try {
    const response = await fetch('/api/assistant/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AION-CSRF': decodeURIComponent((document.cookie.split('; ').find((part) => part.startsWith('aion_csrf=')) || '').slice(10)) },
      body: JSON.stringify({ provider, key: key || '' }),
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Credential update failed');
    await renderApiVault();
    showToast(`${provider} key updated`, 'check');
  } catch (error) { showToast(error.message || 'Credential update failed', 'alert'); }
}

export async function renderApiVault() {
  const container = document.getElementById('apiVaultList');
  if (!container) return;
  let vault = {};
  try {
    const response = await fetch('/api/assistant/vault');
    if (!response.ok) throw new Error((await response.json()).error || 'Vault unavailable');
    vault = (await response.json()).vault || {};
  } catch (error) { container.textContent = `${error.message}. Sign in as an Owner to manage protected credentials.`; return; }

  container.innerHTML = API_PROVIDERS.map((provider) => {
    const entry = vault[provider.id] || {};
    const hasKey = Boolean(entry.configured);

    return `
      <div class="api-vault-item">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${provider.name}</span>
            <span class="sidebar-badge" style="font-size: 10px; background: ${hasKey ? 'var(--color-success-subtle)' : 'var(--surface-active)'}; color: ${hasKey ? 'var(--color-success)' : 'var(--text-tertiary)'};">
              ${hasKey ? 'Configured' : 'Missing'}
            </span>
          </div>
          <span style="font-size: 11.5px; color: var(--text-secondary);">${entry.masked || 'Not configured'}</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <input class="modal-input api-key-entry" data-provider="${provider.id}" type="password" autocomplete="off" placeholder="${provider.placeholder}" aria-label="${provider.name} credential" style="width: 150px; padding: 4px 8px; font-size: 11.5px;">
          <button class="btn-secondary btn-set-api-key" data-provider="${provider.id}" style="padding: 4px 10px; font-size: 11.5px;" type="button">Save</button>
          ${hasKey ? `<button class="btn-secondary btn-clear-api-key" data-provider="${provider.id}" style="padding: 4px 8px; font-size: 11.5px; color: var(--color-danger);" type="button">Remove</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Wire buttons
  container.querySelectorAll('.btn-set-api-key').forEach((btn) => {
    btn.addEventListener('click', () => {
      const providerId = btn.getAttribute('data-provider');
      const input = container.querySelector(`.api-key-entry[data-provider="${providerId}"]`);
      if (input?.value) saveApiKey(providerId, input.value);
    });
  });

  container.querySelectorAll('.btn-clear-api-key').forEach((btn) => {
    btn.addEventListener('click', () => {
      const providerId = btn.getAttribute('data-provider');
      saveApiKey(providerId, '');
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

export function getByocliEnabledMap() {
  try {
    const raw = localStorage.getItem('aion_byocli_enabled');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveByocliEnabled(id, isEnabled) {
  const map = getByocliEnabledMap();
  map[id] = Boolean(isEnabled);
  localStorage.setItem('aion_byocli_enabled', JSON.stringify(map));
}

let cachedCliStatus = null;
let isFetchingCliStatus = false;

export async function fetchCliStatus(force = false) {
  if (cachedCliStatus && !force) return cachedCliStatus;
  if (isFetchingCliStatus) return cachedCliStatus;
  isFetchingCliStatus = true;
  try {
    const profiles = getByocliProfiles();
    const customCommands = profiles
      .map((p) => p.command || p.id)
      .filter((cmd) => !['claude', 'codex', 'gemini', 'cursor', 'agy', 'opencode', 'ollama'].includes(cmd));
    const query = customCommands.length ? `?tools=${encodeURIComponent(customCommands.join(','))}` : '';
    const res = await fetch(`/api/cli/status${query}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok' && data.tools) {
        cachedCliStatus = data.tools;
      }
    }
  } catch (err) {
    console.warn('Failed to query CLI status:', err);
  } finally {
    isFetchingCliStatus = false;
  }
  return cachedCliStatus;
}

export async function renderByocliGrid() {
  const container = document.getElementById('byocliGrid');
  if (!container) return;

  const cliTools = await fetchCliStatus();
  const profiles = getByocliProfiles();
  const enabledMap = getByocliEnabledMap();

  container.innerHTML = profiles
    .map((profile) => {
      const toolInfo = cliTools ? cliTools[profile.command || profile.id] : null;
      const isOllama = profile.id === 'ollama';
      const isInstalled = toolInfo ? Boolean(toolInfo.installed) : false;
      const isRunning = toolInfo ? Boolean(toolInfo.running) : false;
      const detectedPath = toolInfo?.path || profile.path;
      const isEnabled = enabledMap[profile.id] !== false; // Default enabled

      let badgeHtml = '';
      if (!isEnabled) {
        badgeHtml = `<span class="byocli-badge">Disabled</span>`;
      } else if (isOllama) {
        badgeHtml = isRunning
          ? `<span class="byocli-badge active">Online</span>`
          : `<span class="byocli-badge badge-offline">Offline</span>`;
      } else if (isInstalled) {
        badgeHtml = `<span class="byocli-badge active">Installed</span>`;
      } else {
        badgeHtml = `<span class="byocli-badge badge-missing">Missing</span>`;
      }

      const pathDisplay = isOllama
        ? 'http://localhost:11434'
        : isInstalled
          ? escapeHtml(detectedPath)
          : `<span style="color: var(--text-tertiary); font-style: italic;">Not found in PATH (${escapeHtml(profile.command || profile.id)})</span>`;

      return `
      <div class="byocli-card ${isEnabled ? '' : 'disabled'}" data-profile-id="${escapeHtml(profile.id)}">
        <div class="byocli-header">
          <span class="byocli-title">
            <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            ${escapeHtml(profile.name)}
          </span>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${badgeHtml}
            <label class="byocli-switch" title="Toggle ${escapeHtml(profile.name)}">
              <input type="checkbox" class="byocli-toggle" data-profile-id="${escapeHtml(profile.id)}" ${isEnabled ? 'checked' : ''}>
              <span class="byocli-switch-slider"></span>
            </label>
          </div>
        </div>
        <span class="byocli-path">${pathDisplay}</span>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;">
          <label style="font-size: 11.5px; color: var(--text-secondary); white-space: nowrap;">Sandbox:</label>
          <select class="byocli-mode-select" data-profile-id="${escapeHtml(profile.id)}" ${isEnabled ? '' : 'disabled'}>
            <option value="Strict" ${profile.sandboxMode === 'Strict' ? 'selected' : ''}>Strict (Ask Every Run)</option>
            <option value="Prompt" ${profile.sandboxMode === 'Prompt' ? 'selected' : ''}>Prompt (Ask On Write)</option>
            <option value="Unrestricted" ${profile.sandboxMode === 'Unrestricted' ? 'selected' : ''}>Unrestricted (Direct)</option>
          </select>
        </div>
      </div>
    `;
    })
    .join('');

  // Wire On/Off toggles
  container.querySelectorAll('.byocli-toggle').forEach((toggle) => {
    toggle.addEventListener('change', (e) => {
      const profileId = toggle.getAttribute('data-profile-id');
      const isChecked = e.target.checked;
      saveByocliEnabled(profileId, isChecked);
      const card = container.querySelector(`.byocli-card[data-profile-id="${profileId}"]`);
      if (card) {
        card.classList.toggle('disabled', !isChecked);
        const modeSelect = card.querySelector('.byocli-mode-select');
        if (modeSelect) modeSelect.disabled = !isChecked;
      }
      const profile = profiles.find((p) => p.id === profileId);
      const name = profile ? profile.name : profileId;
      showToast(`${name} ${isChecked ? 'enabled' : 'disabled'}`, 'check');
      renderByocliGrid();
    });
  });

  // Wire mode select change
  container.querySelectorAll('.byocli-mode-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      const profileId = select.getAttribute('data-profile-id');
      const newMode = e.target.value;
      const allProfiles = getByocliProfiles();
      const target = allProfiles.find((p) => p.id === profileId);
      if (target) {
        target.sandboxMode = newMode;
        saveByocliProfiles(allProfiles);
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
  updateDynamicThemeMeta(savedMode);
  loadResourcePolicy();
}

async function loadResourcePolicy() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    const policy = (await response.json()).config?.resourcePolicy || 'balanced';
    document.querySelectorAll('.resource-policy-btn').forEach((button) => button.classList.toggle('active', button.dataset.resourcePolicy === policy));
    const intervals = { eco: '60 seconds', balanced: '30 seconds', performance: '15 seconds' };
    const effect = document.getElementById('resourcePolicyEffect');
    if (effect) effect.textContent = `${policy[0].toUpperCase()}${policy.slice(1)} checks laptop power/network state every ${intervals[policy]}; it creates no extra daemon or idle worker.`;
  } catch (_) {}
}

async function setResourcePolicy(mode) {
  try {
    const csrf = decodeURIComponent((document.cookie.split('; ').find((part) => part.startsWith('aion_csrf=')) || '').slice(10));
    const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AION-CSRF': csrf }, body: JSON.stringify({ resourcePolicy: mode }) });
    if (!response.ok) throw new Error((await response.json()).error || 'Resource policy update failed');
    await loadResourcePolicy(); showToast(`Resource policy set to ${mode}`, 'check');
  } catch (error) { showToast(error.message || 'Resource policy update failed', 'alert'); }
}

export function updateDynamicThemeMeta(mode) {
  if (typeof document === 'undefined') return;
  const isLight = mode === 'light';
  const themeColor = isLight ? '#ffffff' : '#0b1120';
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = themeColor;

  let manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) {
    manifestLink.href = `/manifest.json?theme=${encodeURIComponent(mode)}`;
  }

  let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleIcon) {
    appleIcon.href = isLight ? '/brand/icon-light.svg' : '/brand/apple-touch-icon.png';
  }
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

  updateDynamicThemeMeta(mode);
  showToast(`Theme set to ${mode}`, 'sun');
}

// ==========================================================================
// Initialization & Global Event Wiring
// ==========================================================================

let settingsInitialized = false;
export function initSettings() {
  if (settingsInitialized) return; settingsInitialized = true;
  // Modal open triggers
  document.getElementById('btnOpenSettings')?.addEventListener('click', () => openSettings('general'));
  document.getElementById('btnMobileSettings')?.addEventListener('click', () => openSettings('general'));
  document.getElementById('btnOpenSecurityFromNetwork')?.addEventListener('click', () => { switchTab('security'); loadSecurityPanel(); });
  window.aionOpenSecurity = () => openSettings('security');

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

  initSecurity();
  window.addEventListener('aion:authenticated', () => { if (document.getElementById('settingsModal')?.classList.contains('active')) renderApiVault(); });

  // General Save Button
  document.getElementById('btnSaveGeneralProfile')?.addEventListener('click', saveGeneralProfile);

  // Device Role change listener (Laptop Auto-Modes visibility toggle)
  document.getElementById('settingsDeviceRole')?.addEventListener('change', updateLaptopModeVisibility);

  // Laptop Mode Segmented buttons [ Home | Away | Auto ]
  document.querySelectorAll('#laptopModeSegmented [data-laptop-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-laptop-mode');
      if (mode) setLaptopModeState(mode);
    });
  });

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

  document.querySelectorAll('.resource-policy-btn').forEach((btn) => btn.addEventListener('click', () => setResourcePolicy(btn.dataset.resourcePolicy)));
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
