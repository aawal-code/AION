import { exec } from 'child_process';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';

/**
 * Filter set of background system/kernel processes that should never be shown in user app lists.
 */
const SYSTEM_NOISE = new Set([
  'system',
  'system idle process',
  'idle',
  'registry',
  'smss',
  'csrss',
  'wininit',
  'services',
  'lsass',
  'svchost',
  'fontdrvhost',
  'dwm',
  'conhost',
  'sihost',
  'taskhostw',
  'ctfmon',
  'searchhost',
  'startmenuexperiencehost',
  'shellexperiencehost',
  'lockapp',
  'securityhealthsystray',
  'securityhealthservice',
  'runtimebroker',
  'applicationframehost',
  'systemd',
  'init',
  'kthreadd',
  'kworker',
  'spoolsv',
  'wmiapsrv',
  'wmiprvse',
  'searchindexer',
  'audiodg',
  'dllhost',
  'sedsvc',
  'aggregatorhost',
  'trustedinstaller',
  'tiworker',
  'msmpeng',
  'nissrv',
  'smartscreen',
  'dashost',
  'vds',
  'lsiso',
  'werfault',
  'defrag',
  'cleanmgr',
  'compattelrunner',
  'mousocoreworker',
  'usocoreworker',
]);

/**
 * Canonical friendly names for popular desktop applications
 */
const CANONICAL_APP_NAMES = {
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  brave: 'Brave Browser',
  opera: 'Opera',
  code: 'Visual Studio Code',
  cursor: 'Cursor',
  spotify: 'Spotify',
  discord: 'Discord',
  discordcanary: 'Discord Canary',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  steam: 'Steam',
  steamwebhelper: 'Steam',
  notepad: 'Notepad',
  notepadplusplus: 'Notepad++',
  calc: 'Calculator',
  calculatorapp: 'Calculator',
  antigravity: 'Antigravity IDE',
  node: 'Node.js',
  windowsterminal: 'Windows Terminal',
  powershell: 'PowerShell',
  pwsh: 'PowerShell Core',
  cmd: 'Command Prompt',
  explorer: 'File Explorer',
  obs64: 'OBS Studio',
  obs32: 'OBS Studio',
  obs: 'OBS Studio',
  vlc: 'VLC Media Player',
  photoshop: 'Adobe Photoshop',
  illustrator: 'Adobe Illustrator',
  premiere: 'Adobe Premiere Pro',
  afterfx: 'Adobe After Effects',
  acrobat: 'Adobe Acrobat',
  blender: 'Blender',
  figma: 'Figma',
  zoom: 'Zoom',
  epicgameslauncher: 'Epic Games Launcher',
  'battle.net': 'Battle.net',
  riotclientservices: 'Riot Client',
  rustdesk: 'RustDesk Remote Desktop',
};

/**
 * Converts a raw executable base name to a clean human-friendly name
 */
export function getFriendlyAppName(rawName, windowTitle = '') {
  if (!rawName) return 'Unknown Application';
  const lower = rawName.toLowerCase();

  if (CANONICAL_APP_NAMES[lower]) {
    return CANONICAL_APP_NAMES[lower];
  }

  // If there's a clean window title, prefer it if short, or clean rawName
  if (windowTitle && windowTitle.length > 0 && windowTitle.length < 40) {
    // Check if title ends with " - App Name" e.g. "Doc1 - Word"
    const titleParts = windowTitle.split(' - ');
    if (titleParts.length > 1) {
      const lastPart = titleParts[titleParts.length - 1].trim();
      if (lastPart.length > 2 && lastPart.length < 30) {
        return lastPart;
      }
    }
  }

  // Format camelCase or lowercase into capitalized word
  return rawName.charAt(0).toUpperCase() + rawName.slice(1);
}

/**
 * Parses raw process list output into grouped user-facing applications
 */
export function groupProcesses(rawProcesses) {
  if (!Array.isArray(rawProcesses) || rawProcesses.length === 0) {
    return [];
  }

  const groupMap = new Map();

  for (const proc of rawProcesses) {
    if (!proc) continue;
    const rawExec = (proc.ProcessName || proc.processName || proc.comm || proc.name || '')
      .replace(/\.exe$/i, '')
      .trim();
    if (!rawExec) continue;

    const lowerExec = rawExec.toLowerCase();

    // Filter system noise
    if (SYSTEM_NOISE.has(lowerExec)) {
      continue;
    }

    const pid = Number(proc.Id || proc.id || proc.pid || proc.PID || 0);
    const title = (proc.MainWindowTitle || proc.title || '').trim();
    const memBytes = Number(proc.WorkingSet64 || proc.ws || proc.rss || 0);
    const memMb = memBytes > 0 ? memBytes / (1024 * 1024) : Number(proc.memoryMb || proc.MemoryMB || 0);
    const cpu = Number(proc.CPU || proc.cpu || proc.cpuPercent || 0);

    if (!groupMap.has(lowerExec)) {
      groupMap.set(lowerExec, {
        executable: rawExec,
        name: getFriendlyAppName(rawExec, title),
        pids: [],
        count: 0,
        totalMemoryMb: 0,
        totalCpu: 0,
        mainWindows: [],
      });
    }

    const group = groupMap.get(lowerExec);
    if (pid && !group.pids.includes(pid)) {
      group.pids.push(pid);
    }
    group.count += 1;
    group.totalMemoryMb += memMb;
    group.totalCpu += cpu;
    if (title && !group.mainWindows.includes(title)) {
      group.mainWindows.push(title);
    }
  }

  const result = Array.from(groupMap.values()).map((g) => ({
    name: g.name,
    executable: g.executable,
    count: g.count,
    pids: g.pids,
    totalMemoryMb: Math.round(g.totalMemoryMb * 10) / 10,
    totalCpu: Math.round(g.totalCpu * 10) / 10,
    mainWindows: g.mainWindows.slice(0, 5),
  }));

  // Sort descending by total memory
  result.sort((a, b) => b.totalMemoryMb - a.totalMemoryMb);
  return result;
}

/**
 * Fetches all running user applications grouped by executable name
 */
export function getGroupedApps() {
  return new Promise((resolve) => {
    if (IS_WIN) {
      // Query processes with UI window or active session
      const script = `
        Get-Process | Where-Object {
          $_.SessionId -ne 0 -and ($_.MainWindowTitle -ne '' -or $_.WorkingSet64 -gt 15MB)
        } | Select-Object Id, ProcessName, MainWindowTitle, WorkingSet64, CPU | ConvertTo-Json -Compress
      `.trim().replace(/\s+/g, ' ');

      const cmd = `powershell -NoProfile -Command "${script}"`;
      exec(cmd, { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          logEvent('WARN', `Windows apps query error: ${err?.message || 'Empty stdout'}`);
          return resolve([]);
        }

        try {
          let parsed = JSON.parse(stdout.trim());
          if (!Array.isArray(parsed)) parsed = [parsed];
          const grouped = groupProcesses(parsed);
          resolve(grouped);
        } catch (e) {
          logEvent('WARN', `Failed to parse Windows process JSON: ${e.message}`);
          resolve([]);
        }
      });
      return;
    }

    // Linux fallback using ps
    const cmd = 'ps -eo pid,rss,%cpu,comm,args 2>/dev/null';
    exec(cmd, { timeout: 6000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        logEvent('WARN', `Linux apps query error: ${err?.message || 'Empty stdout'}`);
        return resolve([]);
      }

      const lines = stdout.trim().split('\n').slice(1);
      const raw = lines.map((l) => {
        const parts = l.trim().split(/\s+/);
        return {
          Id: parseInt(parts[0], 10),
          WorkingSet64: (parseInt(parts[1], 10) || 0) * 1024,
          CPU: parseFloat(parts[2]) || 0,
          ProcessName: parts[3] || '',
          MainWindowTitle: parts.slice(4).join(' '),
        };
      });

      const grouped = groupProcesses(raw);
      resolve(grouped);
    });
  });
}

/**
 * Forcefully terminates an entire application process tree instantly
 * Accepts either friendly name (e.g. "Google Chrome") or executable name (e.g. "chrome" / "chrome.exe")
 */
export function killAppGroup(appIdentifier) {
  return new Promise((resolve) => {
    if (!appIdentifier || typeof appIdentifier !== 'string' || !appIdentifier.trim()) {
      return resolve({
        success: false,
        message: 'Application identifier is required',
      });
    }

    const cleanInput = appIdentifier.trim().toLowerCase().replace(/\.exe$/i, '');

    // Reverse look up executable from CANONICAL_APP_NAMES or use direct input
    let targetExe = cleanInput;
    for (const [exe, friendly] of Object.entries(CANONICAL_APP_NAMES)) {
      if (friendly.toLowerCase() === cleanInput || exe.toLowerCase() === cleanInput) {
        targetExe = exe;
        break;
      }
    }

    logEvent('COMMAND', `Terminating application group: ${targetExe}`);

    if (IS_WIN) {
      // Force kill entire tree (/F /T) by image name
      const cmd = `taskkill /F /T /IM "${targetExe}.exe"`;
      exec(cmd, (err, stdout, stderr) => {
        const outStr = (stdout || '') + (stderr || '');
        if (err && !outStr.toLowerCase().includes('success')) {
          // If taskkill reports process not found, return clean status without crashing
          return resolve({
            success: false,
            target: targetExe,
            message: `No active process found for '${targetExe}'`,
          });
        }

        resolve({
          success: true,
          target: targetExe,
          message: `Application group '${targetExe}' terminated successfully`,
        });
      });
      return;
    }

    // Linux process group termination
    const cmd = `pkill -9 -f "${targetExe}" 2>/dev/null || killall -9 "${targetExe}" 2>/dev/null`;
    exec(cmd, (err) => {
      resolve({
        success: !err,
        target: targetExe,
        message: !err
          ? `Application group '${targetExe}' terminated successfully`
          : `No active process found for '${targetExe}'`,
      });
    });
  });
}
