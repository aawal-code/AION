/**
 * AION Smart Devices & Full PC Controls Manager
 * macOS/iPadOS Split-Pane Desktop Layout & Clean Device Registry Controller
 */

import { t } from './i18n.js';
import { getSvgIcon } from './icons.js';
import { showToast } from './app.js';
import { addActivity, getState, subscribe } from './state.js';

let cachedDevices = [];
let cachedWol = null;
let cachedProcesses = [];
let selectedDeviceId = 'local'; // 'all' | 'assistant' | device.id
let showAllProcesses = false;
let editingDeviceId = null;

// ==========================================================================
// Silent Data Fetching (Never spam toasts on background refreshes)
// ==========================================================================

export async function fetchDevices() {
  try {
    const res = await fetch('/api/devices');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok' && Array.isArray(data.devices)) {
      cachedDevices = data.devices;
      // Default to local device if none selected or previous no longer exists
      if (!selectedDeviceId || selectedDeviceId === 'local' || !cachedDevices.some(d => d.id === selectedDeviceId)) {
        if (selectedDeviceId !== 'all' && selectedDeviceId !== 'assistant') {
          selectedDeviceId = cachedDevices[0]?.id || 'local';
        }
      }
      renderAll();
    }
  } catch (err) {
    // Graceful background silence
    console.debug('[AION Devices] Background fetch silent error:', err.message);
  }
}

export async function fetchWolStatus() {
  try {
    const res = await fetch('/api/system/wol');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok') {
      cachedWol = data;
      renderDeviceCanvasHeader();
      renderSettingsWol();
    }
  } catch (err) {
    console.debug('[AION WoL] Background fetch silent error:', err.message);
  }
}

export function renderSettingsWol() {
  const badge = document.getElementById('settingsWolStatusBadge');
  const btn = document.getElementById('btnEnableWol');
  if (!badge) return;

  if (!cachedWol || !cachedWol.supported) {
    badge.textContent = 'Not Supported';
    badge.style.color = 'var(--text-tertiary)';
    if (btn) btn.style.display = 'none';
    return;
  }

  if (cachedWol.enabled) {
    badge.textContent = t('wolBadge') || 'Enabled';
    badge.style.color = 'var(--color-success)';
    if (btn) btn.style.display = 'none';
  } else if (cachedWol.fastStartupBlocking) {
    badge.textContent = t('wolFastStartupWarn') || 'Fast Startup Blocking';
    badge.style.color = 'var(--color-warning)';
    if (btn) btn.style.display = 'inline-flex';
  } else {
    badge.textContent = t('wolDisabled') || 'Disabled';
    badge.style.color = 'var(--color-warning)';
    if (btn) btn.style.display = 'inline-flex';
  }
}

export async function fetchRunningProcesses() {
  try {
    const res = await fetch('/api/system/processes');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok' && Array.isArray(data.processes)) {
      cachedProcesses = data.processes;
      renderRunningProcesses();
    }
  } catch (err) {
    console.debug('[AION Processes] Background fetch silent error:', err.message);
  }
}

// ==========================================================================
// User-Triggered Actions (Explicit feedback with toasts)
// ==========================================================================

export async function executeControlAction(action, target = '') {
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, target }),
    });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      if (action === 'screen_off') {
        showToast(t('actionScreenOffDesc'), 'screenOff');
        addActivity(t('actionScreenOff'), t('actionScreenOffDesc'), 'screenOff');
      } else if (action === 'shutdown') {
        showToast(t('actionShutdownDesc'), 'shutdown');
        addActivity(t('actionShutdown'), t('actionShutdownDesc'), 'shutdown');
      } else if (action === 'sleep') {
        showToast(t('activitySleepDone'), 'moon');
        addActivity(t('actionSleep'), t('activitySleepDone'), 'moon');
      } else if (action === 'lock') {
        showToast(t('activityLockDone'), 'lock');
        addActivity(t('actionLock'), t('activityLockDone'), 'lock');
      } else if (action === 'kill_process') {
        showToast(t('activityKillDone', { target }), 'power');
        addActivity(t('actionQuit'), t('activityKillDone', { target }), 'power');
        setTimeout(() => fetchRunningProcesses(), 1200);
      }
    } else {
      showToast(data.error || 'Action failed', 'close');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'close');
  }
}

export async function wakeDevice(deviceId, mac = '') {
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac }),
    });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      showToast(t('wakeSent', { target: deviceId }), 'wake');
      addActivity(t('btnWake'), t('wakeSent', { target: deviceId }), 'wake');
    } else {
      showToast(data.error || 'Wake failed', 'close');
    }
  } catch (err) {
    showToast(`Wake error: ${err.message}`, 'close');
  }
}

export async function enableSystemWol() {
  try {
    const res = await fetch('/api/system/wol/enable', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      showToast(t('wolEnabledSuccess'), 'check');
      addActivity('Wake-on-LAN', t('wolEnabledSuccess'), 'check');
      await fetchWolStatus();
    } else {
      showToast(data.error || 'Failed to enable WoL in OS', 'close');
    }
  } catch (err) {
    showToast(`WoL error: ${err.message}`, 'close');
  }
}

export async function saveDeviceEdit(id, patch) {
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      showToast(t('toastSettingsSaved'), 'check');
      addActivity(t('editDeviceTitle'), `${data.device.name} updated`, 'edit');
      await fetchDevices();
      closeEditModal();
    } else {
      showToast(data.error || 'Failed updating device', 'close');
    }
  } catch (err) {
    showToast(`Update error: ${err.message}`, 'close');
  }
}

// ==========================================================================
// Device Navigation & Selection
// ==========================================================================

export function selectDevice(id) {
  selectedDeviceId = id;
  renderAll();

  // Close mobile sidebar if open
  closeMobileSidebar();
}

function getSelectedDevice() {
  return cachedDevices.find((d) => d.id === selectedDeviceId) || cachedDevices[0] || null;
}

export function getDeviceIconName(type) {
  const t = (type || '').toLowerCase();
  if (t === 'laptop') return 'laptop';
  if (t === 'server') return 'server';
  if (t === 'phone') return 'phone';
  if (t === 'tablet') return 'tablet';
  return 'desktop';
}

// ==========================================================================
// Master UI Rendering
// ==========================================================================

export function renderAll() {
  renderSidebarDevices();
  renderActiveCanvasView();
}

function renderSidebarDevices() {
  const listEl = document.getElementById('sidebarDevicesList');
  const countEl = document.getElementById('sidebarDeviceCount');
  const allDevicesBtn = document.getElementById('navItemAllDevices');
  const assistantBtn = document.getElementById('navItemAssistant');

  if (countEl) countEl.textContent = String(cachedDevices.length);

  // Active state for static nav items
  if (allDevicesBtn) allDevicesBtn.classList.toggle('active', selectedDeviceId === 'all');
  if (assistantBtn) assistantBtn.classList.toggle('active', selectedDeviceId === 'assistant');

  if (!listEl) return;

  listEl.innerHTML = cachedDevices
    .map((dev) => {
      const isSelected = dev.id === selectedDeviceId;
      const isOnline = dev.online !== false;
      const iconName = getDeviceIconName(dev.type);

      return `
      <button class="sidebar-device-item ${isSelected ? 'active' : ''}" data-device-id="${dev.id}" type="button">
        <span class="device-dot ${isOnline ? 'online' : 'offline'}"></span>
        <span class="sidebar-device-icon">${getSvgIcon(iconName, 'icon-sm')}</span>
        <span class="sidebar-device-name">${escapeHtml(dev.name)}</span>
      </button>
    `;
    })
    .join('');

  listEl.querySelectorAll('.sidebar-device-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-device-id');
      if (id) selectDevice(id);
    });
  });
}

function renderActiveCanvasView() {
  const deviceView = document.getElementById('canvasDeviceView');
  const allDevicesView = document.getElementById('canvasAllDevicesView');
  const chatView = document.getElementById('canvasChatView');

  if (selectedDeviceId === 'all') {
    if (deviceView) deviceView.style.display = 'none';
    if (chatView) chatView.style.display = 'none';
    if (allDevicesView) {
      allDevicesView.style.display = 'block';
      renderAllDevicesCards();
    }
  } else if (selectedDeviceId === 'assistant') {
    if (deviceView) deviceView.style.display = 'none';
    if (allDevicesView) allDevicesView.style.display = 'none';
    if (chatView) chatView.style.display = 'block';
  } else {
    if (allDevicesView) allDevicesView.style.display = 'none';
    if (chatView) chatView.style.display = 'none';
    if (deviceView) {
      deviceView.style.display = 'block';
      renderDeviceCanvasHeader();
      renderRunningProcesses();
      renderCompactActivity();
    }
  }
}

function renderDeviceCanvasHeader() {
  const dev = getSelectedDevice();
  if (!dev) return;

  const nameEl = document.getElementById('canvasDeviceName');
  const subtitleEl = document.getElementById('canvasDeviceSubtitle');
  const statusPill = document.getElementById('canvasDeviceStatusPill');
  const statusText = document.getElementById('canvasDeviceStatusText');
  const wakeBtn = document.getElementById('btnCanvasWake');
  const mobileTopTitle = document.getElementById('mobileTopTitle');

  if (nameEl) nameEl.textContent = dev.name;
  if (mobileTopTitle) mobileTopTitle.textContent = dev.name;

  // Build clean non-jargon subtitle
  const typeLabel = t(`deviceType${capitalize(dev.type)}`) || dev.type;
  const osLabel = dev.os || 'OS';
  const wolReady = (dev.isLocal && cachedWol?.enabled) || (!dev.isLocal && dev.mac);
  const wolText = wolReady ? t('wolBadge') : '';
  const parts = [typeLabel, osLabel, wolText].filter(Boolean);

  if (subtitleEl) subtitleEl.textContent = parts.join(' • ');

  // Status Indicator
  const isOnline = dev.online !== false;
  if (statusPill) {
    statusPill.className = `device-status-pill ${isOnline ? 'online' : 'offline'}`;
  }
  if (statusText) {
    statusText.textContent = isOnline ? t('statusConnected') : t('statusOffline');
  }

  // Wake Button visibility
  if (wakeBtn) {
    if (!isOnline && dev.mac) {
      wakeBtn.style.display = 'inline-flex';
      wakeBtn.onclick = () => wakeDevice(dev.id, dev.mac);
    } else {
      wakeBtn.style.display = 'none';
    }
  }

  // Edit Button click handler
  const editBtn = document.getElementById('btnEditCurrentDevice');
  if (editBtn) {
    editBtn.onclick = () => openEditModal(dev);
  }
}

// ==========================================================================
// Section 2: Running Apps (Clean borderless rows, max 6 with toggle)
// ==========================================================================

export function renderRunningProcesses() {
  const container = document.getElementById('canvasProcessesList');
  const toggleBtn = document.getElementById('btnToggleAllProcesses');
  if (!container) return;

  if (cachedProcesses.length === 0) {
    container.innerHTML = `<div class="empty-state-row">${t('noRunningApps')}</div>`;
    if (toggleBtn) toggleBtn.style.display = 'none';
    return;
  }

  if (toggleBtn) {
    if (cachedProcesses.length > 6) {
      toggleBtn.style.display = 'inline-block';
      toggleBtn.textContent = showAllProcesses
        ? 'Show less'
        : `Show all (${cachedProcesses.length})`;
    } else {
      toggleBtn.style.display = 'none';
    }
  }

  const visible = showAllProcesses ? cachedProcesses : cachedProcesses.slice(0, 6);

  container.innerHTML = visible
    .map(
      (proc) => `
    <div class="app-row">
      <div class="app-row-main">
        <div class="app-icon-box">
          ${getSvgIcon('cpu', 'icon-sm')}
        </div>
        <div class="app-names">
          <div class="app-friendly-name">${escapeHtml(proc.name)}</div>
          <div class="app-sub-detail">${escapeHtml(proc.processName)}.exe</div>
        </div>
      </div>
      <div class="app-row-actions">
        <span class="app-ram-badge">${proc.memoryMb} MB</span>
        <button class="app-quit-btn" data-target="${escapeHtml(proc.processName)}" title="${t('btnQuitApp')}" type="button">
          ${t('btnQuitApp')}
        </button>
      </div>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('.app-quit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target) executeControlAction('kill_process', target);
    });
  });
}

// ==========================================================================
// Section 3: Recent Activity (Compact 3 most recent actions)
// ==========================================================================

export function renderCompactActivity() {
  const container = document.getElementById('canvasActivityList');
  if (!container) return;

  const state = getState();
  const feed = (state.activityFeed || []).slice(0, 3);

  if (feed.length === 0) {
    container.innerHTML = `<div class="empty-state-row">${t('activityEmpty')}</div>`;
    return;
  }

  container.innerHTML = feed
    .map(
      (item) => `
    <div class="activity-compact-row">
      <div class="activity-compact-icon">
        ${getSvgIcon(item.iconType || 'activity', 'icon-sm')}
      </div>
      <div class="activity-compact-content">
        <div class="activity-compact-title">${escapeHtml(item.title)}</div>
        ${item.desc ? `<div class="activity-compact-desc">${escapeHtml(item.desc)}</div>` : ''}
      </div>
      <div class="activity-compact-time">${item.time}</div>
    </div>
  `
    )
    .join('');
}

// ==========================================================================
// All Devices Overview Grid (Canvas View B)
// ==========================================================================

function renderAllDevicesCards() {
  const container = document.getElementById('allDevicesCardsGrid');
  if (!container) return;

  if (cachedDevices.length === 0) {
    container.innerHTML = `<div class="empty-state-row">No devices registered.</div>`;
    return;
  }

  container.innerHTML = cachedDevices
    .map((dev) => {
      const isOnline = dev.online !== false;
      const iconName = getDeviceIconName(dev.type);

      return `
      <div class="glass-card all-devices-card">
        <div class="all-devices-card-top">
          <div class="all-devices-avatar">
            ${getSvgIcon(iconName, 'icon-lg')}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <h3 style="font-size: 16px; font-weight: 600;">${escapeHtml(dev.name)}</h3>
              <span class="device-status-pill ${isOnline ? 'online' : 'offline'}">
                <span class="status-dot"></span>
                <span>${isOnline ? t('statusConnected') : t('statusOffline')}</span>
              </span>
            </div>
            <div style="font-size: 12.5px; color: var(--text-secondary); margin-top: 2px;">
              ${escapeHtml(dev.os || 'OS')} &bull; ${dev.type.toUpperCase()}
            </div>
          </div>
        </div>

        <div class="device-meta-row" style="margin-top: 12px;">
          ${dev.mac ? `<div class="device-meta-pill"><span>MAC</span> ${escapeHtml(dev.mac)}</div>` : ''}
          ${dev.lanIp ? `<div class="device-meta-pill"><span>LAN</span> ${escapeHtml(dev.lanIp)}</div>` : ''}
          ${dev.tailscaleIp ? `<div class="device-meta-pill"><span>Mesh</span> ${escapeHtml(dev.tailscaleIp)}</div>` : ''}
        </div>

        <div style="display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;">
          ${!isOnline && dev.mac ? `
            <button class="btn-primary" data-wake-id="${dev.id}" data-wake-mac="${dev.mac}" type="button" style="padding: 6px 14px; font-size: 12px;">
              ${getSvgIcon('wake', 'icon-sm')}
              <span>${t('btnWake')}</span>
            </button>
          ` : ''}
          <button class="btn-secondary" data-open-id="${dev.id}" type="button" style="padding: 6px 14px; font-size: 12px;">
            Open Controls
          </button>
        </div>
      </div>
    `;
    })
    .join('');

  container.querySelectorAll('[data-open-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-open-id');
      if (id) selectDevice(id);
    });
  });

  container.querySelectorAll('[data-wake-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-wake-id');
      const mac = btn.getAttribute('data-wake-mac');
      if (id) wakeDevice(id, mac);
    });
  });
}

// ==========================================================================
// Safe Confirm Modal & Edit Modal
// ==========================================================================

let confirmActionFn = null;

export function openConfirmModal(title, prompt, onConfirm) {
  const modal = document.getElementById('actionConfirmModal');
  const titleEl = document.getElementById('confirmModalTitle');
  const promptEl = document.getElementById('confirmModalPrompt');
  if (!modal) return;

  if (titleEl) titleEl.textContent = title;
  if (promptEl) promptEl.textContent = prompt;
  confirmActionFn = onConfirm;

  modal.classList.add('active');
}

export function openEditModal(device) {
  editingDeviceId = device.id;
  const modal = document.getElementById('deviceEditModal');
  if (!modal) return;

  const nameInput = document.getElementById('editDevName');
  const typeSelect = document.getElementById('editDevType');
  const macInput = document.getElementById('editDevMac');
  const lanInput = document.getElementById('editDevLanIp');
  const tsInput = document.getElementById('editDevTsIp');

  if (nameInput) nameInput.value = device.name || '';
  if (typeSelect) typeSelect.value = (device.type || 'desktop').toLowerCase();
  if (macInput) macInput.value = device.mac || '';
  if (lanInput) lanInput.value = device.lanIp || '';
  if (tsInput) tsInput.value = device.tailscaleIp || '';

  modal.classList.add('active');
}

export function closeEditModal() {
  editingDeviceId = null;
  const modal = document.getElementById('deviceEditModal');
  modal?.classList.remove('active');
}

// ==========================================================================
// Mobile Sidebar Drawer Controls
// ==========================================================================

export function openMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar?.classList.add('open');
  backdrop?.classList.add('active');
}

export function closeMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar?.classList.remove('open');
  backdrop?.classList.remove('active');
}

// ==========================================================================
// Initialization & Event Wiring
// ==========================================================================

export function initDevicesModule() {
  // Static Nav Clicks
  document.getElementById('navItemAllDevices')?.addEventListener('click', () => {
    selectDevice('all');
  });

  document.getElementById('navItemAssistant')?.addEventListener('click', () => {
    selectDevice('assistant');
  });

  // Mobile Drawer Toggle
  document.getElementById('btnToggleSidebarMobile')?.addEventListener('click', openMobileSidebar);
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeMobileSidebar);

  // Power & Display Tiles
  document.getElementById('tileLock')?.addEventListener('click', () => {
    executeControlAction('lock');
  });

  document.getElementById('tileScreenOff')?.addEventListener('click', () => {
    executeControlAction('screen_off');
  });

  document.getElementById('tileSleep')?.addEventListener('click', () => {
    openConfirmModal(t('confirmSleepTitle'), t('confirmSleepPrompt'), () => {
      executeControlAction('sleep');
    });
  });

  document.getElementById('tileShutdown')?.addEventListener('click', () => {
    openConfirmModal(t('confirmShutdownTitle'), t('confirmShutdownPrompt'), () => {
      executeControlAction('shutdown');
    });
  });

  // Running Apps Show All Toggle
  document.getElementById('btnToggleAllProcesses')?.addEventListener('click', () => {
    showAllProcesses = !showAllProcesses;
    renderRunningProcesses();
  });

  // Edit Device Modal Actions
  document.getElementById('btnEditDevCancel')?.addEventListener('click', closeEditModal);
  document.getElementById('btnEditDevSave')?.addEventListener('click', () => {
    if (!editingDeviceId) return;
    const name = document.getElementById('editDevName')?.value?.trim();
    const type = document.getElementById('editDevType')?.value?.trim();
    const mac = document.getElementById('editDevMac')?.value?.trim();
    const lanIp = document.getElementById('editDevLanIp')?.value?.trim();
    const tailscaleIp = document.getElementById('editDevTsIp')?.value?.trim();

    saveDeviceEdit(editingDeviceId, { name, type, mac, lanIp, tailscaleIp });
  });

  // Action Confirmation Modal Actions
  document.getElementById('confirmModalCancel')?.addEventListener('click', () => {
    document.getElementById('actionConfirmModal')?.classList.remove('active');
    confirmActionFn = null;
  });

  document.getElementById('confirmModalOk')?.addEventListener('click', () => {
    document.getElementById('actionConfirmModal')?.classList.remove('active');
    if (confirmActionFn) {
      confirmActionFn();
      confirmActionFn = null;
    }
  });

  // WoL Enable Button in Settings
  document.getElementById('btnEnableWol')?.addEventListener('click', () => {
    enableSystemWol();
  });

  // Subscribe to activity updates so recent activity re-renders
  subscribe((state, key) => {
    if (key === 'activityFeed') {
      renderCompactActivity();
    }
  });

  // Initial Fetches
  fetchDevices();
  fetchWolStatus();
  fetchRunningProcesses();

  // Periodic silent refresh of processes
  setInterval(() => {
    fetchRunningProcesses();
  }, 12000);
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

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { renderAll as renderDevicesView };
