import path from 'path';
import { exec, spawn } from 'child_process';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';

/**
 * Cross-platform workstation session locking bypassing Session 0 isolation
 * - Windows: detached unreferenced spawn of rundll32.exe user32.dll,LockWorkStation
 * - Linux: loginctl lock-session with fallbacks to Wayland/X11 lockers (swaylock, hyprlock, xdg-screensaver, gnome-screensaver)
 */
export function lockSession() {
  return new Promise((resolve, reject) => {
    if (!IS_WIN) {
      // Linux session lock chain: loginctl -> xdg-screensaver -> swaylock -> hyprlock -> desktop lockers
      const linuxCmd = 'loginctl lock-session 2>/dev/null || xdg-screensaver lock 2>/dev/null || swaylock -f 2>/dev/null || hyprlock 2>/dev/null || gnome-screensaver-command -l 2>/dev/null || cinnamon-screensaver-command -l 2>/dev/null || mate-screensaver-command -l 2>/dev/null || xflock4 2>/dev/null';
      exec(linuxCmd, (err) => {
        if (err) {
          logEvent('WARN', `Linux lock-session returned non-zero, trying direct loginctl: ${err.message}`);
          exec('loginctl lock-session', (lerr) => {
            if (lerr) {
              logEvent('ERROR', `Linux lock session failed: ${lerr.message}`);
              return reject(lerr);
            }
            resolve({ cmd: 'loginctl lock-session' });
          });
          return;
        }
        logEvent('COMMAND', 'Linux session lock dispatched');
        resolve({ cmd: linuxCmd });
      });
      return;
    }

    const system32 = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32');
    const rundll32 = path.join(system32, 'rundll32.exe');
    const cmd = `"${rundll32}" user32.dll,LockWorkStation`;

    try {
      const child = spawn(rundll32, ['user32.dll,LockWorkStation'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: system32,
      });
      child.unref();

      child.on('error', (err) => {
        logEvent('ERROR', `LockWorkStation spawn error: ${err.message}`);
        exec(cmd, (execErr) => {
          if (execErr) {
            logEvent('ERROR', `Lock fallback exec error: ${execErr.message}`);
            return reject(execErr);
          }
          resolve({ cmd });
        });
      });

      resolve({ cmd });
    } catch (err) {
      logEvent('ERROR', `Lock trigger failure: ${err.message}`);
      exec(cmd, (execErr) => {
        if (execErr) {
          logEvent('ERROR', `Lock exec fallback error: ${execErr.message}`);
          return reject(execErr);
        }
        resolve({ cmd });
      });
    }
  });
}

/**
 * Cross-platform system suspend / sleep hook
 * - Windows: rundll32.exe powrprof.dll,SetSuspendState 0,1,0
 * - Linux: systemctl suspend (with loginctl suspend fallback)
 */
export function suspendSession() {
  return new Promise((resolve, reject) => {
    const cmd = IS_WIN
      ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
      : 'systemctl suspend 2>/dev/null || loginctl suspend';

    exec(cmd, (err) => {
      if (err) {
        logEvent('ERROR', `Suspend command failed: ${err.message}`);
        return reject(err);
      }
      logEvent('COMMAND', `Suspension dispatched: ${cmd}`);
      resolve({ cmd });
    });
  });
}

/**
 * Robust process termination with flexible name matching (.exe and base)
 * Never throws unhandled raw shell errors when a process target is not currently running.
 * Returns clean { success: boolean, message: string, target: string }
 */
export function killProcess(target) {
  return new Promise((resolve) => {
    if (!target || typeof target !== 'string' || !target.trim()) {
      return resolve({
        success: false,
        message: 'Process target must be specified',
        target: target || '',
      });
    }

    const cleanTarget = target.trim();
    const isExe = cleanTarget.toLowerCase().endsWith('.exe');
    const baseName = isExe ? cleanTarget.slice(0, -4) : cleanTarget;
    const exeName = isExe ? cleanTarget : `${cleanTarget}.exe`;

    if (!IS_WIN) {
      // Unix / Linux: use pkill with clean error absorption and killall fallback
      const cmd = `pkill -f "${cleanTarget}" 2>/dev/null || killall -9 "${cleanTarget}" 2>/dev/null`;
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          // Exit code 1 on Linux/Unix means no matching process was found
          if (err.code === 1 || err.code === 127) {
            logEvent('INFO', `Process '${cleanTarget}' not running`);
            return resolve({
              success: false,
              message: `Process '${cleanTarget}' is not currently running`,
              target: cleanTarget,
            });
          }
          logEvent('WARN', `Process kill '${cleanTarget}' failed: ${err.message}`);
          return resolve({
            success: false,
            message: `Failed to terminate '${cleanTarget}': ${(stderr || err.message).trim()}`,
            target: cleanTarget,
          });
        }
        logEvent('COMMAND', `Terminated process '${cleanTarget}'`);
        return resolve({
          success: true,
          message: `Process '${cleanTarget}' terminated successfully`,
          target: cleanTarget,
        });
      });
      return;
    }

    // Windows: Check exeName first, with fallback to baseName
    const cmdExe = `taskkill /F /IM "${exeName}" /T`;
    exec(cmdExe, (err1, stdout1, stderr1) => {
      const out1 = ((stdout1 || '') + (stderr1 || '')).trim();
      const success1 = !err1 || out1.toLowerCase().includes('success');

      if (success1) {
        logEvent('COMMAND', `Terminated process '${exeName}'`);
        return resolve({
          success: true,
          message: `Process '${exeName}' terminated successfully`,
          target: cleanTarget,
        });
      }

      // If not found and baseName differs from exeName, attempt baseName
      if (baseName && baseName !== exeName) {
        const cmdBase = `taskkill /F /IM "${baseName}" /T`;
        exec(cmdBase, (err2, stdout2, stderr2) => {
          const out2 = ((stdout2 || '') + (stderr2 || '')).trim();
          const success2 = !err2 || out2.toLowerCase().includes('success');

          if (success2) {
            logEvent('COMMAND', `Terminated process '${baseName}'`);
            return resolve({
              success: true,
              message: `Process '${baseName}' terminated successfully`,
              target: cleanTarget,
            });
          }

          const isNotFound = out1.includes('not found') || out2.includes('not found');
          const msg = isNotFound
            ? `Process '${cleanTarget}' is not currently running`
            : `Unable to terminate '${cleanTarget}': ${(stderr1 || stderr2 || err1.message || '').trim()}`;

          logEvent('INFO', msg);
          return resolve({
            success: false,
            message: msg,
            target: cleanTarget,
          });
        });
        return;
      }

      const isNotFound = out1.includes('not found');
      const msg = isNotFound
        ? `Process '${cleanTarget}' is not currently running`
        : `Unable to terminate '${cleanTarget}': ${(stderr1 || err1.message || '').trim()}`;

      logEvent('INFO', msg);
      return resolve({
        success: false,
        message: msg,
        target: cleanTarget,
      });
    });
  });
}

/**
 * Turn off all monitors without sleeping the PC
 * - Windows: SendMessageW HWND_BROADCAST (0xffff) WM_SYSCOMMAND (0x0112) SC_MONITORPOWER (0xf170) 2
 * - Linux: xset dpms force off or Wayland equivalent
 */
export function turnOffScreen() {
  return new Promise((resolve, reject) => {
    const cmd = IS_WIN
      ? 'powershell -NoProfile -Command "Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class M { [DllImport(\\"\"user32.dll\\"\" )] public static extern int SendMessage(int h, int m, int w, int l); }\'; [M]::SendMessage(0xffff, 0x0112, 0xf170, 2)"'
      : 'xset dpms force off 2>/dev/null || hyprctl dispatch dpms off 2>/dev/null || wlr-randr --output 2>/dev/null';

    exec(cmd, (err) => {
      if (err) {
        logEvent('ERROR', `Turn off screen command failed: ${err.message}`);
        return reject(err);
      }
      logEvent('COMMAND', 'Monitors turned off successfully');
      resolve({ success: true, message: 'Monitors turned off', cmd });
    });
  });
}

/**
 * Clean graceful system shutdown
 * - Windows: shutdown /s /t 15 /c "AION initiated workstation shutdown"
 * - Linux: shutdown -h +1 or systemctl poweroff
 */
export function shutdownSession() {
  return new Promise((resolve, reject) => {
    const cmd = IS_WIN
      ? 'shutdown /s /t 15 /c "AION initiated workstation shutdown"'
      : 'shutdown -h +1 "AION initiated workstation shutdown" 2>/dev/null || systemctl poweroff';

    exec(cmd, (err) => {
      if (err) {
        logEvent('ERROR', `Shutdown command failed: ${err.message}`);
        return reject(err);
      }
      logEvent('COMMAND', 'Workstation shutdown dispatched');
      resolve({ success: true, message: 'Shutdown sequence initiated', cmd });
    });
  });
}

const SYSTEM_PROCESSES = new Set([
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'services',
  'lsass', 'svchost', 'fontdrvhost', 'dwm', 'conhost', 'sihost',
  'taskhostw', 'ctfmon', 'searchhost', 'startmenuexperiencehost',
  'shellexperiencehost', 'lockapp', 'securityhealthsystray', 'runtimebroker',
  'applicationframehost', 'system idle process', 'kthreadd', 'systemd', 'init'
]);

const FRIENDLY_PROCESS_NAMES = {
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  brave: 'Brave Browser',
  code: 'Visual Studio Code',
  spotify: 'Spotify',
  discord: 'Discord',
  discordcanary: 'Discord Canary',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  telegram: 'Telegram',
  steam: 'Steam',
  steamwebhelper: 'Steam',
  notepad: 'Notepad',
  calc: 'Calculator',
  calculatorapp: 'Calculator',
  antigravity: 'Antigravity IDE',
  node: 'Node.js Service',
  windowsterminal: 'Windows Terminal',
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
  explorer: 'Windows Explorer',
  syncthing: 'Syncthing Service',
  tailscale: 'Tailscale Service',
};

/**
 * Pure helper parser converting raw OS process queries into clean user-facing entries
 */
export function parseProcesses(rawData, platform = process.platform) {
  if (!rawData) return [];

  let list = [];
  if (platform === 'win32') {
    let parsed = rawData;
    if (typeof rawData === 'string') {
      try {
        parsed = JSON.parse(rawData.trim());
      } catch {
        return [];
      }
    }
    if (!Array.isArray(parsed)) {
      parsed = parsed ? [parsed] : [];
    }

    list = parsed.map((p) => {
      const pid = p.Id || p.PID || p.pid || 0;
      const rawName = (p.ProcessName || p.name || '').replace(/\.exe$/i, '');
      const memoryMb = Math.round(((p.WorkingSet64 || p.ws || 0) / (1024 * 1024)) * 10) / 10 || Math.round((p.MemoryMB || 0) * 10) / 10;
      const title = (p.MainWindowTitle || p.title || '').trim();

      const lower = rawName.toLowerCase();
      let friendly = FRIENDLY_PROCESS_NAMES[lower] || title || rawName;
      if (friendly === rawName && rawName.length > 0) {
        friendly = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      }

      return {
        pid,
        processName: rawName,
        name: friendly,
        memoryMb,
        title,
      };
    });
  } else {
    // Linux / Unix ps line output: PID RSS COMM ARGS
    const lines = typeof rawData === 'string' ? rawData.trim().split('\n') : [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = parseInt(parts[0], 10);
        const rssKb = parseInt(parts[1], 10) || 0;
        const comm = parts[2] || '';
        const title = parts.slice(3).join(' ') || comm;
        if (!isNaN(pid)) {
          const lower = comm.toLowerCase();
          const memoryMb = Math.round((rssKb / 1024) * 10) / 10;
          let friendly = FRIENDLY_PROCESS_NAMES[lower] || comm;
          if (friendly === comm && comm.length > 0) {
            friendly = comm.charAt(0).toUpperCase() + comm.slice(1);
          }
          list.push({
            pid,
            processName: comm,
            name: friendly,
            memoryMb,
            title,
          });
        }
      }
    }
  }

  // Filter out system processes and sort by memory descending
  const filtered = list.filter((p) => {
    const key = (p.processName || '').toLowerCase();
    return key && !SYSTEM_PROCESSES.has(key);
  });

  filtered.sort((a, b) => b.memoryMb - a.memoryMb);
  return filtered.slice(0, 12);
}

/**
 * Queries top 12 user-facing running processes sorted by memory usage
 */
export function getRunningProcesses() {
  return new Promise((resolve) => {
    if (IS_WIN) {
      const cmd = 'powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne \'\' -or ($_.WorkingSet64 -gt 35MB -and $_.SessionId -ne 0) } | Select-Object Id, ProcessName, MainWindowTitle, WorkingSet64 | ConvertTo-Json -Compress"';
      exec(cmd, { timeout: 6000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) {
          logEvent('WARN', `Process query error: ${err?.message || 'Empty response'}`);
          return resolve([]);
        }
        const processes = parseProcesses(stdout, 'win32');
        resolve(processes);
      });
      return;
    }

    const cmd = 'ps -eo pid,rss,comm,args --sort=-rss 2>/dev/null';
    exec(cmd, { timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        logEvent('WARN', `Linux process query error: ${err?.message || 'Empty'}`);
        return resolve([]);
      }
      const processes = parseProcesses(stdout, 'linux');
      resolve(processes);
    });
  });
}

/**
 * High-level workstation action dispatcher
 */
export async function executeWorkstationCommand(action, target = '') {
  logEvent('COMMAND', `Action: ${action} | Target: ${target || 'local'}`);

  switch (action) {
    case 'lock':
      return lockSession();
    case 'sleep':
      return suspendSession();
    case 'screen_off':
      return turnOffScreen();
    case 'shutdown':
      return shutdownSession();
    case 'kill_process':
      return killProcess(target);
    default:
      throw new Error(`Unsupported workstation action: ${action}`);
  }
}
