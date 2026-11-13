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
    badge.title = 'No physical network adapter supporting Wake-on-LAN was detected.';
    badge.style.color = 'var(--text-tertiary)';
    if (btn) btn.style.display = 'none';
    return;
  }

  const state = cachedWol.state || (cachedWol.enabled ? (cachedWol.fastStartupBlocking ? 'fast_startup_blocked' : 'os_ready') : 'disabled');

  if (state === 'os_ready') {
    badge.textContent = t('wolOsReady') || 'OS Ready (Verify BIOS)';
    badge.title = t('wolTooltipBios') || 'Adapter WoL is active and Fast Startup is disabled. Ensure WoL is enabled in UEFI/BIOS.';
    badge.style.color = 'var(--color-success)';
    if (btn) btn.style.display = 'none';
  } else if (state === 'fast_startup_blocked') {
    badge.textContent = t('wolFastStartupWarn') || 'Fast Startup Blocking';
    badge.title = 'Windows Fast Startup blocks WoL magic packets on hybrid shutdown. Click below to disable Fast Startup.';
    badge.style.color = 'var(--color-warning)';
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.textContent = t('btnEnableWol') || 'Enable in Windows';
    }
  } else {
    badge.textContent = t('wolDisabled') || 'Disabled in OS';
    badge.title = 'Wake on Magic Packet is not currently enabled on the active physical network adapter.';
    badge.style.color = 'var(--color-warning)';
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.textContent = t('btnEnableWol') || 'Enable in Windows';
    }
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

if (typeof window !== 'undefined') {
  window.aionSelectDevice = selectDevice;
}

function getSelectedDevice() {
  return cachedDevices.find((d) => d.id === selectedDeviceId) || cachedDevices[0] || null;
}

export function isMobileDevice(dev) {
  if (!dev) return false;
  const t = (dev.type || '').toLowerCase();
  const os = (dev.os || '').toLowerCase();
  return (
    ['phone', 'mobile', 'tablet', 'ipad', 'iphone', 'android'].includes(t) ||
    ['ios', 'android', 'ipados'].includes(os)
  );
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
      const dev = getSelectedDevice();
      renderDeviceCanvasHeader();

      const desktopPower = document.getElementById('desktopPowerSection');
      const desktopMedia = document.getElementById('mediaDeckSection');
      const desktopApps = document.getElementById('desktopAppsSection');
      const mobileCompanion = document.getElementById('mobileCompanionDeck');

      if (isMobileDevice(dev)) {
        if (desktopPower) desktopPower.style.display = 'none';
        if (desktopMedia) desktopMedia.style.display = 'none';
        if (desktopApps) desktopApps.style.display = 'none';
        if (mobileCompanion) {
          mobileCompanion.style.display = 'block';
          renderMobileCompanionDeck(dev);
        }
      } else {
        if (desktopPower) desktopPower.style.display = 'block';
        if (desktopMedia) desktopMedia.style.display = 'block';
        if (desktopApps) desktopApps.style.display = 'block';
        if (mobileCompanion) mobileCompanion.style.display = 'none';
        renderRunningProcesses();
      }

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
  const wolText = wolReady && !isMobileDevice(dev) ? t('wolBadge') : '';
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

  // View Screen Button (for Desktop / Laptop nodes)
  const viewScreenBtn = document.getElementById('btnCanvasViewScreen');
  if (viewScreenBtn) {
    if (!isMobileDevice(dev)) {
      viewScreenBtn.style.display = 'inline-flex';
      viewScreenBtn.onclick = () => {
        const target = dev.tailscaleIp || dev.lanIp || dev.id;
        window.location.href = `rustdesk://${target}`;
      };
    } else {
      viewScreenBtn.style.display = 'none';
    }
  }

  // Wake Button visibility (only for desktop / PC nodes with MAC)
  if (wakeBtn) {
    if (!isOnline && dev.mac && !isMobileDevice(dev)) {
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
// Mobile Companion Deck Controller
// ==========================================================================

export async function sendMobileCommand(deviceId, action, payload = {}) {
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') {
      showToast(data.error || 'Failed sending command to device', 'close');
      return false;
    }
    return true;
  } catch (err) {
    showToast(`Command error: ${err.message}`, 'close');
    return false;
  }
}

export function renderMobileCompanionDeck(dev) {
  if (!dev) return;

  const batteryEl = document.getElementById('mobileBatteryLevel');
  const batteryBadge = document.getElementById('mobileBatteryBadge');
  const routeVal = document.getElementById('mobileRouteValue');
  const wakeState = document.getElementById('mobileWakeState');
  const lastSeenEl = document.getElementById('mobileLastSeen');
  const wakeToggle = document.getElementById('toggleMobileWakeLock');

  const telem = dev.telemetry || null;

  // 1. Battery Telemetry
  if (batteryEl && batteryBadge) {
    if (telem && typeof telem.battery === 'number' && !isNaN(telem.battery)) {
      batteryEl.textContent = `${Math.round(telem.battery)}%`;
      if (telem.charging === true) {
        batteryBadge.textContent = t('mobileCharging') || 'Charging';
        batteryBadge.className = 'mobile-pill-badge charging';
      } else if (telem.charging === false) {
        batteryBadge.textContent = t('mobileDischarging') || 'On Battery';
        batteryBadge.className = 'mobile-pill-badge';
      } else {
        batteryBadge.textContent = '--';
        batteryBadge.className = 'mobile-pill-badge';
      }
    } else {
      batteryEl.textContent = '--%';
      batteryBadge.textContent = dev.os?.toLowerCase().includes('ios') ? 'iOS Sandbox' : '--';
      batteryBadge.className = 'mobile-pill-badge';
    }
  }

  // 2. Connection Route
  if (routeVal) {
    const route = telem?.route || (dev.tailscaleIp ? 'mesh' : 'lan');
    routeVal.textContent = route === 'lan' ? (t('mobileRouteLan') || 'Direct LAN / Wi-Fi') : (t('mobileRouteMesh') || 'Tailscale Mesh');
  }

  // 3. Screen Wake Lock
  if (wakeState) {
    const isActive = Boolean(telem?.wakeLock);
    wakeState.textContent = isActive ? (t('mobileWakeActive') || 'Active (Always On)') : (t('mobileWakeNormal') || 'Normal Timeout');
  }
  if (wakeToggle) {
    wakeToggle.checked = Boolean(telem?.wakeLock);
  }

  // 4. Last Seen
  if (lastSeenEl) {
    if (telem?.updatedAt) {
      lastSeenEl.textContent = formatLastSeen(telem.updatedAt);
    } else if (dev.lastSeen) {
      lastSeenEl.textContent = formatLastSeen(dev.lastSeen);
    } else {
      lastSeenEl.textContent = dev.online !== false ? (t('mobileJustNow') || 'Active now') : (t('statusOffline') || 'Offline');
    }
  }
}

function formatLastSeen(isoStr) {
  if (!isoStr) return t('mobileJustNow') || 'Active now';
  try {
    const diffSec = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diffSec < 45) return t('mobileJustNow') || 'Active now';
    if (diffSec < 3600) return `${Math.max(1, Math.round(diffSec / 60))}m ago`;
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
    return new Date(isoStr).toLocaleDateString();
  } catch {
    return t('mobileJustNow') || 'Active now';
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
          ${!isMobileDevice(dev) ? `
            <button class="btn-secondary" data-view-screen-target="${escapeHtml(dev.tailscaleIp || dev.lanIp || dev.id)}" type="button" style="padding: 6px 14px; font-size: 12px;">
              ${getSvgIcon('desktop', 'icon-sm')}
              <span>${t('btnViewScreen')}</span>
            </button>
          ` : ''}
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

  container.querySelectorAll('[data-view-screen-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view-screen-target');
      if (target) window.location.href = `rustdesk://${target}`;
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

  // Mobile Companion Actions
  // 1. Ping / Find Phone
  document.getElementById('btnPingPhone')?.addEventListener('click', async () => {
    const dev = getSelectedDevice();
    if (!dev) return;
    const ok = await sendMobileCommand(dev.id, 'ping');
    if (ok) {
      showToast(t('pingSent', { name: dev.name }) || `Ping sent to ${dev.name}`, 'bell');
      addActivity(t('btnPingPhone') || 'Find Phone', t('pingSent', { name: dev.name }) || `Ping sent to ${dev.name}`, 'activity');
    }
  });

  // 2. Keep Screen Awake Switch
  document.getElementById('toggleMobileWakeLock')?.addEventListener('change', async (e) => {
    const dev = getSelectedDevice();
    if (!dev) return;
    const enabled = e.target.checked;
    const ok = await sendMobileCommand(dev.id, 'wake_lock', { enabled });
    if (ok) {
      showToast(enabled ? 'Screen awake enabled' : 'Screen awake disabled', 'sun');
      addActivity(t('mobileScreenWake') || 'Screen Wake', enabled ? 'Always On' : 'Normal', 'sun');
      if (dev.telemetry) dev.telemetry.wakeLock = enabled;
      renderMobileCompanionDeck(dev);
    } else {
      e.target.checked = !enabled;
    }
  });

  // 3. Open URL on Phone
  document.getElementById('formPhoneUrl')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dev = getSelectedDevice();
    if (!dev) return;
    const input = document.getElementById('phoneUrlInput');
    const url = input?.value?.trim();
    if (!url) return;

    const ok = await sendMobileCommand(dev.id, 'open_url', { url });
    if (ok) {
      showToast(t('urlSent', { name: dev.name }) || `URL sent to ${dev.name}`, 'link');
      addActivity(t('btnOpenOnPhone') || 'Open URL', url, 'link');
      if (input) input.value = '';
    }
  });

  // 4. Push Clipboard to Phone
  document.getElementById('formPhoneClip')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dev = getSelectedDevice();
    if (!dev) return;
    const input = document.getElementById('phoneClipInput');
    const text = input?.value?.trim();
    if (!text) return;

    const ok = await sendMobileCommand(dev.id, 'clipboard', { text });
    if (ok) {
      showToast(t('clipSent', { name: dev.name }) || `Clipboard sent to ${dev.name}`, 'clipboard');
      addActivity(t('btnPushClip') || 'Push Text', text.slice(0, 32), 'clipboard');
      if (input) input.value = '';
    }
  });

  // 5. Apple Shortcuts Triggers
  document.querySelectorAll('.shortcut-tile').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const shortcutName = btn.getAttribute('data-shortcut');
      if (!shortcutName) return;
      const dev = getSelectedDevice();
      const shortcutUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}`;
      const isMobileClient = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;

      if (isMobileClient) {
        window.location.href = shortcutUrl;
      } else if (dev && isMobileDevice(dev)) {
        await sendMobileCommand(dev.id, 'open_url', { url: shortcutUrl });
        showToast(`Shortcut '${shortcutName}' sent to ${dev.name}`, 'activity');
      } else {
        window.location.href = shortcutUrl;
      }
    });
  });

  // 6. Setup Guide Accordion Toggle
  document.getElementById('btnToggleShortcutsGuide')?.addEventListener('click', () => {
    const body = document.getElementById('shortcutsGuideBody');
    const chevron = document.getElementById('shortcutsGuideChevron');
    if (!body) return;
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'block' : 'none';
    chevron?.classList.toggle('open', isHidden);
  });

  // 7. Refresh Telemetry Button
  document.getElementById('btnRefreshMobileTelemetry')?.addEventListener('click', async () => {
    await fetchDevices();
    showToast('Telemetry refreshed', 'check');
  });

  // 8. 1-Tap Web Push Notifications Activation
  document.getElementById('btnEnablePushNotify')?.addEventListener('click', async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast('Push notifications not supported on this browser', 'alert');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('Push permission denied', 'alert');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch('/api/push/vapid-public-key');
      const keyData = await keyRes.json();
      if (!keyData.publicKey) {
        showToast('Failed to retrieve VAPID key', 'alert');
        return;
      }
      const appKey = urlBase64ToUint8Array(keyData.publicKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub, deviceId: selectedDeviceId }),
      });
      showToast('Web Push successfully enabled!', 'activity');
    } catch (err) {
      showToast(`Push activation error: ${err.message}`, 'alert');
    }
  });

  // 9. Get 'AION Runner' Shortcut
  document.getElementById('btnGetRunnerShortcut')?.addEventListener('click', () => {
    const shortcutUrl = 'shortcuts://import-shortcut?name=AION%20Runner';
    window.location.href = shortcutUrl;
    showToast("Opening 'AION Runner' shortcut in Apple Shortcuts...", 'activity');
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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export { renderAll as renderDevicesView };
