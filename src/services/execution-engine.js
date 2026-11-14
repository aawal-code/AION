import { spawn } from 'node:child_process';
import path from 'node:path';
import { logEvent } from './sse.js';
import { addMessage } from './assistant-db.js';

// Pre-configured BYOCLI command templates
export const CLI_PROFILE_TEMPLATES = {
  agy: {
    name: 'Antigravity CLI',
    buildCommand: (prompt) => `agy -p "${escapeForShell(prompt)}"`,
  },
  claude: {
    name: 'Claude Code CLI',
    buildCommand: (prompt) => `claude -p "${escapeForShell(prompt)}"`,
  },
  codex: {
    name: 'Codex CLI',
    buildCommand: (prompt) => `codex exec "${escapeForShell(prompt)}"`,
  },
  gemini: {
    name: 'Gemini CLI',
    buildCommand: (prompt) => `gemini -p "${escapeForShell(prompt)}"`,
  },
  cursor: {
    name: 'Cursor Agent CLI',
    buildCommand: (prompt) => `cursor --agent "${escapeForShell(prompt)}"`,
  },
  powershell: {
    name: 'PowerShell',
    buildCommand: (prompt) => `powershell -NoProfile -Command "${escapeForShell(prompt)}"`,
  },
  cmd: {
    name: 'Command Prompt',
    buildCommand: (prompt) => `cmd /c "${escapeForShell(prompt)}"`,
  },
};

/**
 * Escapes quotes and special characters for command line interpolation
 */
function escapeForShell(str) {
  if (!str) return '';
  return str.replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

/**
 * Resolves the full executable command based on the active BYOCLI profile
 */
export function resolveCliCommand(prompt, profileId = 'agy', customCommand = '') {
  if (customCommand && customCommand.trim()) {
    return customCommand.replace(/\{prompt\}/g, escapeForShell(prompt));
  }

  const pid = (profileId || 'agy').toLowerCase().trim();
  const template = CLI_PROFILE_TEMPLATES[pid] || CLI_PROFILE_TEMPLATES.agy;
  return template.buildCommand(prompt);
}

/**
 * Spawns a BYOCLI child process and calls stream callbacks
 */
export function spawnCliProcess({
  command,
  cwd = process.cwd(),
  env = process.env,
  onStart = () => {},
  onStdout = () => {},
  onStderr = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  const isWin = process.platform === 'win32';
  const startTime = Date.now();

  let child;
  try {
    child = spawn(command, {
      shell: true,
      cwd: path.resolve(cwd),
      env: { ...process.env, ...env },
      windowsHide: true,
    });
  } catch (err) {
    onError(err);
    onExit({ code: 1, durationMs: Date.now() - startTime, error: err.message });
    return null;
  }

  if (child.pid) {
    onStart({ pid: child.pid, command, timestamp: new Date().toISOString() });
  }

  child.stdout?.on('data', (chunk) => {
    onStdout(chunk.toString());
  });

  child.stderr?.on('data', (chunk) => {
    onStderr(chunk.toString());
  });

  child.on('error', (err) => {
    onError(err);
  });

  child.on('close', (code, signal) => {
    const durationMs = Date.now() - startTime;
    onExit({ code: code ?? (signal ? 1 : 0), signal, durationMs });
  });

  return child;
}

/**
 * Pipes child process output directly to HTTP Server-Sent Events (SSE) response
 */
export function streamExecutionToSse(res, {
  prompt,
  profileId = 'agy',
  customCommand = '',
  cwd = process.cwd(),
  sessionId = null,
  projectId = null,
}) {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const command = resolveCliCommand(prompt, profileId, customCommand);
  let accumulatedOutput = '';

  sendEvent('start', {
    command,
    profileId,
    cwd,
    timestamp: new Date().toISOString(),
  });

  spawnCliProcess({
    command,
    cwd,
    onStart: (info) => {
      sendEvent('spawn', info);
    },
    onStdout: (text) => {
      accumulatedOutput += text;
      sendEvent('stdout', { text });
    },
    onStderr: (text) => {
      accumulatedOutput += text;
      sendEvent('stderr', { text });
    },
    onError: (err) => {
      sendEvent('error', { message: err.message });
    },
    onExit: async (result) => {
      sendEvent('exit', result);

      // Persist the executed output into SQLite messages if sessionId is provided
      if (sessionId) {
        try {
          await addMessage({
            sessionId,
            role: 'assistant',
            content: accumulatedOutput.trim() || `Command completed with exit code ${result.code}`,
            metadata: {
              mode: 'execute',
              command,
              profileId,
              exitCode: result.code,
              durationMs: result.durationMs,
            },
          });
        } catch (dbErr) {
          logEvent('WARN', `Failed saving execution message: ${dbErr.message}`);
        }
      }

      res.end();
    },
  });
}
