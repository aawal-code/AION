/**
 * AION True AnyDesk-Style Interactive Remote Desktop Controller
 * Low-latency frame relay, normalized coordinate mapping, mouse/touch synthesis, hotkey toolbar.
 */

let isStreaming = false;
let frameTimer = null;
let fpsFrames = 0;
let lastFpsUpdate = Date.now();
let currentFps = 12;
let lastLatency = 35;
let isMouseDown = false;
let lastMoveSent = 0;

export function initScreenControl() {
  const modal = document.getElementById('modalScreenViewer');
  const openBtn = document.getElementById('btnOpenScreenModal');
  const btnRemoteView = document.getElementById('btnRemoteViewScreen');
  const btnRefreshSnapshot = document.getElementById('btnRefreshScreenSnapshot');
  const snapshotContainer = document.querySelector('.screen-preview-container');
  const closeBtn = document.getElementById('btnCloseScreenModal');
  const exitBtn = document.getElementById('btnExitRemoteScreen');
  const imgEl = document.getElementById('screenModalImg');
  const inputEl = document.getElementById('screenKeystrokeInput');
  const sendKeyBtn = document.getElementById('btnSendKeystroke');
  const refreshModalBtn = document.getElementById('btnRefreshModalScreen');

  // Open Remote Screen Viewer
  openBtn?.addEventListener('click', () => openScreenViewer());
  btnRemoteView?.addEventListener('click', () => openScreenViewer());
  snapshotContainer?.addEventListener('click', () => openScreenViewer());

  // Close / Exit Remote
  closeBtn?.addEventListener('click', () => closeScreenViewer());
  exitBtn?.addEventListener('click', () => closeScreenViewer());
  refreshModalBtn?.addEventListener('click', () => captureSingleFrame());

  // Quick snapshot in card
  btnRefreshSnapshot?.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshCardSnapshot();
  });

  // Hotkey toolbar buttons
  document.querySelectorAll('.screen-hotkey-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hotkey = btn.dataset.hotkey;
      if (hotkey) sendHotkey(hotkey);
    });
  });

  // Direct keystroke submission
  sendKeyBtn?.addEventListener('click', () => {
    if (inputEl && inputEl.value) {
      sendKeystrokes(inputEl.value);
      inputEl.value = '';
    }
  });

  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputEl.value) {
        sendKeystrokes(inputEl.value);
        inputEl.value = '';
      }
    }
  });

  // Global Keydown Capture when Remote Viewer is active
  window.addEventListener('keydown', (e) => {
    if (!isStreaming) return;
    if (document.activeElement === inputEl) return;

    if (e.key === 'Escape') {
      closeScreenViewer();
      return;
    }

    if (['Tab', 'Backspace', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      sendHotkey(e.key.toLowerCase());
    }
  });

  // Surface Mouse & Touch Interaction
  if (imgEl) {
    // Prevent browser native context menu on desktop surface
    imgEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const coords = getNormalizedCoords(e, imgEl);
      sendMouseEvent('rightclick', coords.normX, coords.normY, 'right');
    });

    imgEl.addEventListener('click', (e) => {
      const coords = getNormalizedCoords(e, imgEl);
      sendMouseEvent('click', coords.normX, coords.normY, 'left');
    });

    imgEl.addEventListener('dblclick', (e) => {
      const coords = getNormalizedCoords(e, imgEl);
      sendMouseEvent('dblclick', coords.normX, coords.normY, 'left');
    });

    imgEl.addEventListener('mousedown', (e) => {
      if (e.button === 2) return; // Right click handled by contextmenu
      isMouseDown = true;
      const coords = getNormalizedCoords(e, imgEl);
      sendMouseEvent('down', coords.normX, coords.normY, 'left');
    });

    window.addEventListener('mouseup', (e) => {
      if (!isMouseDown) return;
      isMouseDown = false;
      if (isStreaming && imgEl) {
        const coords = getNormalizedCoords(e, imgEl);
        sendMouseEvent('up', coords.normX, coords.normY, 'left');
      }
    });

    imgEl.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;
      const now = Date.now();
      if (now - lastMoveSent < 60) return; // 60ms drag throttle
      lastMoveSent = now;
      const coords = getNormalizedCoords(e, imgEl);
      sendMouseEvent('move', coords.normX, coords.normY, 'left');
    });

    imgEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      sendMouseEvent('wheel', 0, 0, 'left', e.deltaY);
    }, { passive: false });

    // Touch Support for Mobile (iPhone)
    imgEl.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const coords = getNormalizedCoords(e.touches[0], imgEl);
      sendMouseEvent('down', coords.normX, coords.normY, 'left');
    }, { passive: true });

    imgEl.addEventListener('touchmove', (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const now = Date.now();
      if (now - lastMoveSent < 60) return;
      lastMoveSent = now;
      const coords = getNormalizedCoords(e.touches[0], imgEl);
      sendMouseEvent('move', coords.normX, coords.normY, 'left');
    }, { passive: true });

    imgEl.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        const coords = getNormalizedCoords(e.changedTouches[0], imgEl);
        sendMouseEvent('up', coords.normX, coords.normY, 'left');
        sendMouseEvent('click', coords.normX, coords.normY, 'left');
      }
    }, { passive: true });
  }
}

/**
 * Calculates normalized coordinates (0.0 to 1.0) inside an image element
 */
function getNormalizedCoords(e, imgEl) {
  if (!imgEl) return { normX: 0.5, normY: 0.5 };
  const rect = imgEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { normX: 0.5, normY: 0.5 };

  const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
  const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

  const normX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const normY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

  return { normX, normY };
}

/**
 * Dispatches normalized mouse events to the backend screen controller
 */
async function sendMouseEvent(action, normX, normY, button = 'left', deltaY = 0) {
  try {
    await fetch('/api/screen/mouse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, normX, normY, button, deltaY }),
    });
  } catch (err) {
    console.debug('[ScreenControl] Mouse event failed:', err.message);
  }
}

/**
 * Sends keystroke text to the workstation
 */
export async function sendKeystrokes(text) {
  try {
    await fetch('/api/screen/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.debug('[ScreenControl] Send keystroke failed:', err.message);
  }
}

/**
 * Dispatches system hotkey (Win, Alt+Tab, Ctrl+C, Ctrl+V, Esc, Enter)
 */
export async function sendHotkey(hotkey) {
  try {
    await fetch('/api/screen/hotkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotkey }),
    });
  } catch (err) {
    console.debug('[ScreenControl] Hotkey failed:', err.message);
  }
}

/**
 * Opens full-viewport remote desktop viewer and starts frame loop
 */
export function openScreenViewer() {
  const modal = document.getElementById('modalScreenViewer');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.classList.add('screen-viewer-active');
  isStreaming = true;
  fpsFrames = 0;
  lastFpsUpdate = Date.now();
  startFrameLoop();
}

/**
 * Closes remote desktop viewer and immediately stops frame polling
 */
export function closeScreenViewer() {
  const modal = document.getElementById('modalScreenViewer');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('screen-viewer-active');
  isStreaming = false;
  if (frameTimer) {
    clearTimeout(frameTimer);
    frameTimer = null;
  }
}

/**
 * Continuous low-latency frame loop (10-15 FPS active, paused when closed)
 */
async function startFrameLoop() {
  if (!isStreaming) return;

  const t0 = performance.now();
  try {
    const res = await fetch('/api/screen/snapshot');
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok' && data.image) {
        const img = document.getElementById('screenModalImg');
        if (img && isStreaming) {
          img.src = data.image;
        }
      }
    }
  } catch (err) {
    console.debug('[ScreenControl] Frame capture error:', err.message);
  }

  const roundTrip = Math.round(performance.now() - t0);
  lastLatency = roundTrip;
  fpsFrames++;

  const now = Date.now();
  if (now - lastFpsUpdate >= 1000) {
    currentFps = Math.max(1, Math.round((fpsFrames * 1000) / (now - lastFpsUpdate)));
    fpsFrames = 0;
    lastFpsUpdate = now;

    const fpsBadge = document.getElementById('screenFpsBadge');
    if (fpsBadge) {
      fpsBadge.textContent = `${currentFps} FPS • ${lastLatency}ms`;
    }
  }

  if (isStreaming) {
    // Dynamic sleep to target 12-15 FPS without saturating CPU
    const delay = Math.max(20, 80 - roundTrip);
    frameTimer = setTimeout(startFrameLoop, delay);
  }
}

/**
 * Fetches a single frame for the dashboard preview card
 */
export async function refreshCardSnapshot() {
  try {
    const res = await fetch('/api/screen/snapshot');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok' && data.image) {
      const cardImg = document.getElementById('screenSnapshotImg');
      const placeholder = document.getElementById('screenSnapshotPlaceholder');
      if (cardImg) {
        cardImg.src = data.image;
        cardImg.style.display = 'block';
      }
      if (placeholder) {
        placeholder.style.display = 'none';
      }
    }
  } catch (err) {
    console.debug('[ScreenControl] Card snapshot error:', err.message);
  }
}

async function captureSingleFrame() {
  const t0 = performance.now();
  await refreshCardSnapshot();
  const img = document.getElementById('screenModalImg');
  const cardImg = document.getElementById('screenSnapshotImg');
  if (img && cardImg && cardImg.src) {
    img.src = cardImg.src;
  }
  const latency = Math.round(performance.now() - t0);
  const fpsBadge = document.getElementById('screenFpsBadge');
  if (fpsBadge) {
    fpsBadge.textContent = `1 FPS • ${latency}ms`;
  }
}

if (typeof window !== 'undefined') {
  window.aionOpenScreenViewer = openScreenViewer;
  window.aionCloseScreenViewer = closeScreenViewer;
}
