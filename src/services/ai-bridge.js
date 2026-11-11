import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';
const USER_DIR = os.homedir();

/**
 * Builds sandboxed environment variables dynamically without hardcoded user directories
 */
export function buildAiEnvironment() {
  const parsedRoot = path.parse(USER_DIR).root;
  const homeDrive = IS_WIN ? parsedRoot.replace(/[\\/]$/, '') || 'C:' : '';
  const homePath = IS_WIN ? USER_DIR.slice(parsedRoot.length - 1) : USER_DIR;

  const localAppData =
    process.env.LOCALAPPDATA ||
    (IS_WIN
      ? path.join(USER_DIR, 'AppData', 'Local')
      : path.join(USER_DIR, '.local', 'share'));

  const appData =
    process.env.APPDATA ||
    (IS_WIN
      ? path.join(USER_DIR, 'AppData', 'Roaming')
      : path.join(USER_DIR, '.config'));

  const extraPaths = [];
  const nodeDir = path.dirname(process.execPath);
  if (nodeDir) extraPaths.push(nodeDir);

  if (IS_WIN) {
    extraPaths.push(path.join(localAppData, 'agy', 'bin'));
  } else {
    extraPaths.push(path.join(USER_DIR, '.local', 'bin'));
    extraPaths.push('/usr/local/bin');
  }

  const fullPath = [...extraPaths, process.env.PATH || ''].filter(Boolean).join(path.delimiter);

  return {
    ...process.env,
    USERPROFILE: process.env.USERPROFILE || USER_DIR,
    HOME: process.env.HOME || USER_DIR,
    HOMEPATH: process.env.HOMEPATH || homePath,
    HOMEDRIVE: process.env.HOMEDRIVE || homeDrive,
    LOCALAPPDATA: localAppData,
    APPDATA: appData,
    ANTIGRAVITY_CONFIG_DIR:
      process.env.ANTIGRAVITY_CONFIG_DIR || path.join(USER_DIR, '.antigravity'),
    GEMINI_CLI_CONFIG_DIR:
      process.env.GEMINI_CLI_CONFIG_DIR || path.join(USER_DIR, '.gemini'),
    PATH: fullPath,
  };
}

/**
 * Executes a prompt against headless agy CLI with timeout management and stderr capture
 */
export function executeAiPrompt(prompt, timeoutMs = 60000) {
  return new Promise((resolve) => {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return resolve({
        response: 'Error: Prompt is required and must be a non-empty string',
        error: 'Invalid prompt',
        stderr: null,
      });
    }

    const cleanPrompt = prompt.trim();
    logEvent('AI_IN', cleanPrompt);

    const customEnv = buildAiEnvironment();
    const sanitizedPrompt = cleanPrompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const aiCmd = `agy --dangerously-skip-permissions -p "${sanitizedPrompt}"`;

    try {
      exec(
        aiCmd,
        {
          env: customEnv,
          cwd: USER_DIR,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          const cleanStdout = (stdout || '').trim();
          const cleanStderr = (stderr || '').trim();

          if (err) {
            const isTimeout = err.killed || err.signal === 'SIGTERM';
            const reason = isTimeout
              ? `Execution timed out after ${timeoutMs}ms`
              : err.message || 'Execution error';
            logEvent(
              'ERROR',
              `AI exec failed: ${reason}${cleanStderr ? ` | Stderr: ${cleanStderr}` : ''}`
            );
          } else if (cleanStderr) {
            logEvent('WARN', `AI exec stderr: ${cleanStderr}`);
          }

          const reply =
            cleanStdout ||
            cleanStderr ||
            (err
              ? err.killed
                ? `Error: AI execution timed out after ${timeoutMs / 1000}s`
                : `Error: ${err.message}`
              : 'No output');

          logEvent('AI_OUT', reply.slice(0, 120));

          resolve({
            response: reply,
            error: err
              ? err.killed
                ? `Timeout (${timeoutMs}ms) exceeded`
                : err.message
              : null,
            stderr: cleanStderr || null,
          });
        }
      );
    } catch (spawnErr) {
      logEvent('ERROR', `AI exec invocation crashed: ${spawnErr.message}`);
      resolve({
        response: `Error launching AI process: ${spawnErr.message}`,
        error: spawnErr.message,
        stderr: null,
      });
    }
  });
}
