import path from 'path';
import { exec, spawn } from 'child_process';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';

/**
 * Workstation session locking bypassing Session 0 isolation
 * Uses unreferenced detached spawn of rundll32.exe user32.dll,LockWorkStation
 */
export function lockSession() {
  return new Promise((resolve, reject) => {
    if (!IS_WIN) {
      const cmd = 'loginctl lock-session';
      exec(cmd, (err) => {
        if (err) {
          logEvent('ERROR', `Linux lock error: ${err.message}`);
          return reject(err);
        }
        resolve({ cmd });
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
 * System suspend / sleep hook
 */
export function suspendSession() {
  return new Promise((resolve, reject) => {
    const cmd = IS_WIN
      ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
      : 'systemctl suspend';

    exec(cmd, (err) => {
      if (err) {
        logEvent('ERROR', `Suspend command failed: ${err.message}`);
        return reject(err);
      }
      resolve({ cmd });
    });
  });
}

/**
 * Process termination by executable name
 */
export function killProcess(target) {
  return new Promise((resolve, reject) => {
    const cmd = IS_WIN
      ? `taskkill /F /IM ${target}.exe /T`
      : `pkill -f ${target}`;

    exec(cmd, (err) => {
      if (err) {
        logEvent('ERROR', `Kill process '${target}' failed: ${err.message}`);
        return reject(err);
      }
      resolve({ cmd });
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
    case 'kill_process':
      return killProcess(target);
    default:
      throw new Error(`Unsupported workstation action: ${action}`);
  }
}
