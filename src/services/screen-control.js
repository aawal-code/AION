/**
 * Workstation Remote Screen Control & Snapshot Relay Service
 * Zero runtime dependencies, native Windows Forms/GDI+ capture and input synthesis.
 */

import { exec } from 'child_process';
import { getScreenViewStatus } from './screen-view.js';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';

let cachedSnapshot = null;
let lastSnapshotTime = 0;
const SNAPSHOT_CACHE_TTL_MS = 1000; // 1s cache to prevent hammering GDI+

/**
 * Returns remote screen telemetry and readiness
 */
export function getScreenStatus() {
  const rustDesk = getScreenViewStatus();
  return {
    status: 'ok',
    available: true,
    platform: process.platform,
    rustDeskId: rustDesk?.rustDeskId || null,
    rustDeskReady: rustDesk?.ready || false,
    width: 1920,
    height: 1080,
  };
}

/**
 * Captures workstation primary screen as a JPEG base64 data URI
 */
export function getScreenSnapshot() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (cachedSnapshot && now - lastSnapshotTime < SNAPSHOT_CACHE_TTL_MS) {
      return resolve({ status: 'ok', image: cachedSnapshot, cached: true });
    }

    if (!IS_WIN) {
      const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="%230f172a"/><text x="50%" y="50%" fill="%2394a3b8" font-size="28" font-family="system-ui" text-anchor="middle" dominant-baseline="middle">Live Screen Viewer (Desktop)</text></svg>`;
      return resolve({ status: 'ok', image: fallbackSvg, cached: false });
    }

    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$b = New-Object System.Drawing.Bitmap $s.Width, $s.Height',
      '$g = [System.Drawing.Graphics]::FromImage($b)',
      '$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)',
      '$ms = New-Object System.IO.MemoryStream',
      '$b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)',
      '$bytes = $ms.ToArray()',
      '$g.Dispose()',
      '$b.Dispose()',
      '$ms.Dispose()',
      '[Convert]::ToBase64String($bytes)',
    ].join('; ');

    exec(`powershell -NoProfile -Command "${script}"`, { timeout: 5000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        logEvent('WARN', `Screen snapshot capture error: ${err?.message || 'Empty response'}`);
        const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="%230f172a"/><text x="50%" y="50%" fill="%2394a3b8" font-size="28" font-family="system-ui" text-anchor="middle" dominant-baseline="middle">Screen View Ready</text></svg>`;
        return resolve({ status: 'ok', image: fallbackSvg, error: err?.message });
      }

      const b64 = stdout.trim();
      const dataUri = `data:image/jpeg;base64,${b64}`;
      cachedSnapshot = dataUri;
      lastSnapshotTime = Date.now();
      resolve({ status: 'ok', image: dataUri, cached: false });
    });
  });
}

/**
 * Simulates mouse input (clicks, drags, moves, wheel) with normalized or pixel coordinates
 */
export function sendScreenMouse({ action = 'click', normX, normY, x, y, deltaY = 0, button = 'left' }) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      return resolve({ status: 'ok', simulated: true, action, normX, normY, button });
    }

    const scriptParts = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$def = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class MouseInput {',
      '  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);',
      '}',
      '"@',
      'Add-Type -TypeDefinition $def -ErrorAction SilentlyContinue',
    ];

    if (normX !== undefined && normY !== undefined && !isNaN(normX) && !isNaN(normY)) {
      const clampedX = Math.max(0, Math.min(1, parseFloat(normX)));
      const clampedY = Math.max(0, Math.min(1, parseFloat(normY)));
      scriptParts.push(
        '$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
        `$posX = [int]($s.Width * ${clampedX})`,
        `$posY = [int]($s.Height * ${clampedY})`,
        '[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($posX, $posY)'
      );
    } else if (x !== undefined && y !== undefined) {
      const posX = Math.max(0, parseInt(x, 10) || 0);
      const posY = Math.max(0, parseInt(y, 10) || 0);
      scriptParts.push(
        `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY})`
      );
    }

    const isRight = button === 'right' || action === 'rightclick';

    switch (action) {
      case 'click':
        scriptParts.push(
          isRight
            ? '[MouseInput]::mouse_event(0x08, 0, 0, 0, 0); [MouseInput]::mouse_event(0x10, 0, 0, 0, 0)'
            : '[MouseInput]::mouse_event(0x02, 0, 0, 0, 0); [MouseInput]::mouse_event(0x04, 0, 0, 0, 0)'
        );
        break;
      case 'dblclick':
        scriptParts.push(
          '[MouseInput]::mouse_event(0x02, 0, 0, 0, 0); [MouseInput]::mouse_event(0x04, 0, 0, 0, 0)',
          '[System.Threading.Thread]::Sleep(50)',
          '[MouseInput]::mouse_event(0x02, 0, 0, 0, 0); [MouseInput]::mouse_event(0x04, 0, 0, 0, 0)'
        );
        break;
      case 'rightclick':
        scriptParts.push(
          '[MouseInput]::mouse_event(0x08, 0, 0, 0, 0); [MouseInput]::mouse_event(0x10, 0, 0, 0, 0)'
        );
        break;
      case 'down':
        scriptParts.push(
          isRight ? '[MouseInput]::mouse_event(0x08, 0, 0, 0, 0)' : '[MouseInput]::mouse_event(0x02, 0, 0, 0, 0)'
        );
        break;
      case 'up':
        scriptParts.push(
          isRight ? '[MouseInput]::mouse_event(0x10, 0, 0, 0, 0)' : '[MouseInput]::mouse_event(0x04, 0, 0, 0, 0)'
        );
        break;
      case 'wheel': {
        const wheelDelta = parseInt(deltaY, 10) || 0;
        // MOUSEEVENTF_WHEEL = 0x0800, negative scrolls down
        const winDelta = wheelDelta < 0 ? 120 : -120;
        scriptParts.push(`[MouseInput]::mouse_event(0x0800, 0, 0, ${winDelta}, 0)`);
        break;
      }
      case 'move':
      default:
        // Already repositioned cursor above
        break;
    }

    const script = scriptParts.join('; ');
    exec(`powershell -NoProfile -Command "${script}"`, { timeout: 3000 }, (err) => {
      if (err) {
        logEvent('WARN', `Mouse simulation error: ${err.message}`);
      }
      resolve({ status: 'ok', action, button });
    });
  });
}

/**
 * Simulates mouse click event at given coordinates
 */
export function sendScreenClick({ x, y, button = 'left' }) {
  return sendScreenMouse({ action: 'click', x, y, button });
}

/**
 * Executes standard workstation system hotkeys
 */
export function sendScreenHotkey({ hotkey }) {
  return new Promise((resolve) => {
    if (!hotkey) return resolve({ status: 'ok', empty: true });
    if (!IS_WIN) {
      return resolve({ status: 'ok', simulated: true, hotkey });
    }

    let sendKeySeq = null;
    switch (String(hotkey).toLowerCase()) {
      case 'win':
        sendKeySeq = '^{ESC}';
        break;
      case 'alt-tab':
        sendKeySeq = '%{TAB}';
        break;
      case 'ctrl-c':
        sendKeySeq = '^c';
        break;
      case 'ctrl-v':
        sendKeySeq = '^v';
        break;
      case 'esc':
        sendKeySeq = '{ESC}';
        break;
      case 'enter':
        sendKeySeq = '{ENTER}';
        break;
      case 'backspace':
        sendKeySeq = '{BACKSPACE}';
        break;
      case 'tab':
        sendKeySeq = '{TAB}';
        break;
      default:
        sendKeySeq = String(hotkey);
        break;
    }

    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${sendKeySeq}")`;
    exec(`powershell -NoProfile -Command "${script}"`, { timeout: 3000 }, (err) => {
      if (err) {
        logEvent('WARN', `Hotkey simulation error: ${err.message}`);
      }
      resolve({ status: 'ok', hotkey });
    });
  });
}

/**
 * Simulates keystroke input on workstation
 */
export function sendScreenKey({ key, text }) {
  return new Promise((resolve) => {
    const rawInput = key || text || '';
    if (!rawInput) return resolve({ status: 'ok', empty: true });

    if (!IS_WIN) {
      return resolve({ status: 'ok', simulated: true, key: rawInput });
    }

    // Escape curly brackets and special SendKeys characters
    const cleanKey = String(rawInput)
      .replace(/[{}]/g, '')
      .replace(/"/g, '`"');

    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${cleanKey}")`;

    exec(`powershell -NoProfile -Command "${script}"`, { timeout: 3000 }, (err) => {
      if (err) {
        logEvent('WARN', `Keystroke simulation error: ${err.message}`);
      }
      resolve({ status: 'ok', key: rawInput });
    });
  });
}
