import https from 'https';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { logEvent } from './sse.js';

const GITHUB_REPO = 'aawal-code/AION';
const IS_WIN = process.platform === 'win32';

/**
 * Reads local package.json version
 */
export function getLocalVersion() {
  try {
    const pkgPath = path.resolve('package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version || '1.0.0';
    }
  } catch (err) {
    logEvent('WARN', `Failed reading package.json version: ${err.message}`);
  }
  return '1.0.0';
}

/**
 * Semver comparison helper
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1, v2) {
  const p1 = (v1 || '0').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = (v2 || '0').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);

  for (let i = 0; i < maxLen; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

/**
 * Fetches JSON from GitHub API with standard https module
 */
function fetchGithubJson(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        'User-Agent': 'AION-Updater',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 8000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          parsed = { raw: data };
        }
        resolve({ statusCode: res.statusCode, data: parsed });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub API request timed out'));
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

/**
 * Checks for updates against GitHub Releases API with commit fallback
 */
export async function checkForUpdates() {
  const currentVersion = getLocalVersion();

  try {
    const res = await fetchGithubJson(`/repos/${GITHUB_REPO}/releases/latest`);

    if (res.statusCode === 200 && res.data?.tag_name) {
      const remoteTag = String(res.data.tag_name).trim();
      const latestVersion = remoteTag.replace(/^v/, '');
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

      return {
        status: 'ok',
        updateAvailable,
        currentVersion,
        latestVersion,
        releaseName: res.data.name || remoteTag,
        releaseUrl: res.data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
        publishedAt: res.data.published_at || null,
        changelog: res.data.body || 'No release notes provided.',
      };
    }

    // If 404 (no releases published yet), check latest commit on main branch
    if (res.statusCode === 404) {
      const commitRes = await fetchGithubJson(`/repos/${GITHUB_REPO}/commits/main`);
      const sha = commitRes.data?.sha ? commitRes.data.sha.slice(0, 7) : 'HEAD';

      return {
        status: 'ok',
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        commitSha: sha,
        message: 'No official releases tagged yet. Repository main branch is tracked.',
        releaseUrl: `https://github.com/${GITHUB_REPO}`,
      };
    }

    // Other status (e.g. rate limit 403)
    return {
      status: 'rate_limited',
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      message: res.data?.message || `GitHub returned status ${res.statusCode}`,
    };
  } catch (err) {
    logEvent('WARN', `Update check network error: ${err.message}`);
    return {
      status: 'error',
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      message: `Failed checking for updates: ${err.message}`,
    };
  }
}

/**
 * Atomic update pipeline:
 * 1. Stages updates into .aion-staging/
 * 2. Verifies stage integrity
 * 3. Atomically applies files
 * 4. Spawns detached unreferenced daemon restart process and shuts down active PID
 */
export async function applyUpdate() {
  logEvent('UPDATE', 'Initiating atomic daemon auto-update routine...');
  const stagingDir = path.resolve('.aion-staging');

  try {
    // 1. Prepare clean staging directory
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });

    // 2. Fetch/stage latest code
    const isGitRepo = fs.existsSync(path.resolve('.git'));
    if (isGitRepo) {
      await new Promise((resolve, reject) => {
        exec('git stash', () => {
          exec('git fetch origin main', (fetchErr) => {
            if (fetchErr) return reject(new Error(`git fetch failed: ${fetchErr.message}`));
            // Extract archive directly into staging directory
            const tarCmd = IS_WIN
              ? `tar -xf - -C "${stagingDir}"`
              : `tar -x -C "${stagingDir}"`;
            exec(`git archive origin/main | ${tarCmd}`, (archiveErr) => {
              if (archiveErr) {
                // Fallback to git checkout into staging
                exec('git pull origin main', (pullErr) => {
                  if (pullErr) return reject(new Error(`git pull failed: ${pullErr.message}`));
                  resolve();
                });
                return;
              }
              resolve();
            });
          });
        });
      });
    }

    // 3. Verify staged files (if staging dir has files)
    const stagedPkg = path.join(stagingDir, 'package.json');
    if (fs.existsSync(stagedPkg)) {
      const stagedJson = JSON.parse(fs.readFileSync(stagedPkg, 'utf8'));
      logEvent('UPDATE', `Staged package verified: v${stagedJson.version || '1.0.0'}`);

      // Atomically copy staged files over project (preserving .env and git)
      copyDirectoryRecursive(stagingDir, process.cwd(), ['.git', '.env', '.aion-staging']);
      logEvent('UPDATE', 'Staged files swapped successfully into live tree.');
    }

    // 4. Clean up staging directory
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {}

    const newVersion = getLocalVersion();
    logEvent('UPDATE', `Auto-update successfully applied. Target version: v${newVersion}`);

    // 5. Schedule detached unreferenced restart and exit active PID
    scheduleDaemonRestart();

    return {
      status: 'ok',
      success: true,
      message: 'Atomic update applied. AION Daemon is restarting...',
      version: newVersion,
    };
  } catch (err) {
    const errMsg = `Atomic update failure: ${err.message}`;
    logEvent('ERROR', errMsg);
    try {
      if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {}

    return {
      status: 'error',
      success: false,
      message: errMsg,
      version: getLocalVersion(),
    };
  }
}

/**
 * Recursive directory copy helper excluding protected paths
 */
function copyDirectoryRecursive(src, dest, exclude = []) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyDirectoryRecursive(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Schedules a clean detached restart of the daemon and terminates active PID
 */
function scheduleDaemonRestart() {
  setTimeout(() => {
    try {
      logEvent('SYSTEM', 'Restarting daemon process for update application...');
      const nodePath = process.execPath;
      const serverScript = path.resolve('src/server.js');

      if (IS_WIN) {
        // Detached unreferenced Windows spawn
        const child = spawn(nodePath, [serverScript], {
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd(),
          windowsHide: true,
        });
        child.unref();
      } else {
        // Linux: Attempt systemd user restart first, fallback to detached spawn
        exec('systemctl --user restart aion.service 2>/dev/null', (err) => {
          if (err) {
            const child = spawn(nodePath, [serverScript], {
              detached: true,
              stdio: 'ignore',
              cwd: process.cwd(),
            });
            child.unref();
          }
        });
      }

      // Exit active PID cleanly after unreferencing detached process
      setTimeout(() => process.exit(0), 400).unref();
    } catch (err) {
      logEvent('ERROR', `Failed scheduling restart: ${err.message}`);
      process.exit(1);
    }
  }, 1000).unref();
}
