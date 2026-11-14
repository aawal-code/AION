import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleRequest } from '../src/routes/router.js';
import {
  getDb,
  getProjects,
  getProject,
  createProject,
  getSessions,
  createSession,
  getMessages,
  addMessage,
  closeDb,
} from '../src/services/assistant-db.js';
import {
  saveApiKey,
  getApiKey,
  deleteApiKey,
  getVaultStatus,
} from '../src/services/vault.js';
import {
  routePrompt,
  resolveActiveProvider,
  PROVIDER_ENDPOINTS,
} from '../src/services/llm-provider.js';
import {
  resolveCliCommand,
  spawnCliProcess,
  CLI_PROFILE_TEMPLATES,
} from '../src/services/execution-engine.js';

describe('Milestone 6: The Assistant Workspace & CLI Integration', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Ensure DB is initialized
    await getDb();

    server = http.createServer(handleRequest);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    closeDb();
  });

  // ========================================================================
  // 1. SQLite Database & Schema (src/services/assistant-db.js)
  // ========================================================================
  describe('SQLite Database & Schema (data/assistant.sqlite)', () => {
    test('database file or memory store exists and seeds default projects', async () => {
      const projects = await getProjects();
      assert.ok(Array.isArray(projects));
      assert.ok(projects.length >= 2, 'Must contain seeded projects');

      const aion = projects.find((p) => p.id === 'aion');
      const hexis = projects.find((p) => p.id === 'hexis');
      assert.ok(aion, 'AION project must exist');
      assert.equal(aion.name, 'AION');
      assert.ok(hexis, 'HEXIS project must exist');
      assert.equal(hexis.name, 'HEXIS');
    });

    test('creates and retrieves custom projects', async () => {
      const created = await createProject({
        id: 'test-nebula',
        name: 'Nebula Test Engine',
        path: 'C:\\nebula',
        pinned_context: 'Cloud orchestration node',
      });

      assert.equal(created.id, 'test-nebula');
      assert.equal(created.name, 'Nebula Test Engine');
      assert.equal(created.pinned_context, 'Cloud orchestration node');

      const fetched = await getProject('test-nebula');
      assert.ok(fetched);
      assert.equal(fetched.name, 'Nebula Test Engine');
    });

    test('creates sessions and records messages under projects', async () => {
      const session = await createSession({
        projectId: 'test-nebula',
        mode: 'execute',
      });

      assert.ok(session.id);
      assert.equal(session.project_id, 'test-nebula');
      assert.equal(session.mode, 'execute');
      assert.ok(session.created_at);

      const msg = await addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Compile native binary',
        metadata: { cli: 'agy' },
      });

      assert.ok(msg.id);
      assert.equal(msg.session_id, session.id);
      assert.equal(msg.role, 'user');
      assert.equal(msg.content, 'Compile native binary');

      const messages = await getMessages(session.id);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].content, 'Compile native binary');
    });
  });

  // ========================================================================
  // 2. Encrypted API Vault & Credential Storage (src/services/vault.js)
  // ========================================================================
  describe('Encrypted API Vault & Credential Storage', () => {
    test('encrypts, persists, and retrieves API keys without plaintext leak', async () => {
      const testKey = 'sk-proj-test1234567890abcdefghijklmnopqrstuvwxyz';
      const saved = saveApiKey('openai', testKey);
      assert.equal(saved, true);

      const retrieved = await getApiKey('openai');
      assert.equal(retrieved, testKey);

      const status = await getVaultStatus();
      assert.equal(status.openai.configured, true);
      assert.ok(status.openai.masked.includes('••••••••'));
      assert.ok(!status.openai.masked.includes('abcdefghijklmnopqrstuvwxyz'));

      deleteApiKey('openai');
      const cleared = await getApiKey('openai');
      assert.equal(cleared, null);
    });

    test('supports Anthropic, OpenAI, and Groq providers in vault status', async () => {
      saveApiKey('groq', 'gsk_test987654321');
      const status = await getVaultStatus();

      assert.ok('anthropic' in status);
      assert.ok('openai' in status);
      assert.ok('groq' in status);
      assert.equal(status.groq.configured, true);

      deleteApiKey('groq');
    });
  });

  // ========================================================================
  // 3. LLM Provider Router (src/services/llm-provider.js)
  // ========================================================================
  describe('LLM Provider Router (OpenAI, Anthropic, Groq)', () => {
    test('defines official endpoints for OpenAI, Anthropic, and Groq', () => {
      assert.equal(PROVIDER_ENDPOINTS.openai, 'https://api.openai.com/v1/chat/completions');
      assert.equal(PROVIDER_ENDPOINTS.anthropic, 'https://api.anthropic.com/v1/messages');
      assert.equal(PROVIDER_ENDPOINTS.groq, 'https://api.groq.com/openai/v1/chat/completions');
    });

    test('routes prompt in Ask mode and returns clean response', async () => {
      const result = await routePrompt({
        prompt: 'What is the system uptime?',
        mode: 'ask',
        pinnedContext: 'AION Core Node',
      });

      assert.ok(result);
      assert.ok(result.content);
      assert.ok(result.provider);
      assert.ok(result.model);
    });

    test('routes prompt in Plan mode and produces structured milestones', async () => {
      const result = await routePrompt({
        prompt: 'Migrate database to distributed cluster',
        mode: 'plan',
        pinnedContext: 'HEXIS Workspace',
      });

      assert.ok(result);
      assert.ok(result.content);
      assert.ok(result.content.includes('Plan') || result.content.includes('Milestone') || result.content.includes('Requirements'));
    });
  });

  // ========================================================================
  // 4. Bring-Your-Own-CLI (BYOCLI) Bridge (src/services/execution-engine.js)
  // ========================================================================
  describe('BYOCLI Execution Engine & Process Spawning', () => {
    test('resolves command templates for agy, claude, codex, gemini, cursor, and shell', () => {
      assert.ok(CLI_PROFILE_TEMPLATES.agy);
      assert.ok(CLI_PROFILE_TEMPLATES.claude);
      assert.ok(CLI_PROFILE_TEMPLATES.codex);
      assert.ok(CLI_PROFILE_TEMPLATES.gemini);

      const agyCmd = resolveCliCommand('build project', 'agy');
      assert.ok(agyCmd.includes('agy -p'));
      assert.ok(agyCmd.includes('build project'));

      const claudeCmd = resolveCliCommand('inspect code', 'claude');
      assert.ok(claudeCmd.includes('claude -p'));

      const customCmd = resolveCliCommand('test prompt', 'custom', 'echo "{prompt}"');
      assert.equal(customCmd, 'echo "test prompt"');
    });

    test('spawns child process and captures stdout and exit code', async () => {
      let stdoutReceived = '';
      let exitResult = null;

      await new Promise((resolve) => {
        spawnCliProcess({
          command: 'node -e "process.stdout.write(\'AION_SSE_TEST_OUTPUT\')"',
          onStdout: (text) => {
            stdoutReceived += text;
          },
          onExit: (res) => {
            exitResult = res;
            resolve();
          },
        });
      });

      assert.equal(stdoutReceived, 'AION_SSE_TEST_OUTPUT');
      assert.ok(exitResult);
      assert.equal(exitResult.code, 0);
      assert.equal(typeof exitResult.durationMs, 'number');
    });
  });

  // ========================================================================
  // 5. HTTP Endpoints & SSE Streaming (src/routes/assistant.js)
  // ========================================================================
  describe('HTTP Endpoints & Server-Sent Events (SSE) Streaming', () => {
    test('GET /api/assistant/projects returns project list', async () => {
      const res = await fetch(`${baseUrl}/api/assistant/projects`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(Array.isArray(data.projects));
    });

    test('POST /api/assistant/projects creates new project', async () => {
      const res = await fetch(`${baseUrl}/api/assistant/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Core Orbit',
          path: 'C:\\orbit',
          pinned_context: 'Autonomous satellite relay',
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.project.name, 'Core Orbit');
    });

    test('POST /api/assistant/chat processes Ask mode and returns assistant message', async () => {
      const res = await fetch(`${baseUrl}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Explain the current system state',
          mode: 'ask',
          projectId: 'aion',
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.mode, 'ask');
      assert.ok(data.sessionId);
      assert.ok(data.userMessage);
      assert.ok(data.assistantMessage);
      assert.ok(data.response.content);
    });

    test('POST /api/assistant/chat processes Plan mode and stores structured plan', async () => {
      const res = await fetch(`${baseUrl}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Refactor network topology',
          mode: 'plan',
          projectId: 'hexis',
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.mode, 'plan');
      assert.ok(data.assistantMessage.content.includes('Plan') || data.assistantMessage.content.includes('Milestone') || data.assistantMessage.content.includes('Requirements'));
    });

    test('POST /api/assistant/chat in Execute mode streams SSE events (start, stdout, exit)', async () => {
      const res = await fetch(`${baseUrl}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Testing SSE Stream',
          mode: 'execute',
          projectId: 'aion',
          customCommand: 'node -e "console.log(\'SSE_LINE_1\'); console.log(\'SSE_LINE_2\');"',
        }),
      });

      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/event-stream/);

      const text = await res.text();
      assert.ok(text.includes('event: start'), 'Must emit start event');
      assert.ok(text.includes('event: stdout'), 'Must emit stdout event');
      assert.ok(text.includes('SSE_LINE_1'), 'Must stream stdout content');
      assert.ok(text.includes('event: exit'), 'Must emit exit event');
    });

    test('GET and POST /api/assistant/vault manage keys securely', async () => {
      const postRes = await fetch(`${baseUrl}/api/assistant/vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', key: 'sk-ant-test-key-999' }),
      });
      assert.equal(postRes.status, 200);

      const getRes = await fetch(`${baseUrl}/api/assistant/vault`);
      assert.equal(getRes.status, 200);
      const data = await getRes.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.vault.anthropic.configured, true);

      // Clean up
      await fetch(`${baseUrl}/api/assistant/vault/anthropic`, { method: 'DELETE' });
    });
  });

  // ========================================================================
  // 6. Frontend Workspace UI & CSS Architecture
  // ========================================================================
  describe('Frontend Workspace UI Structure & CSS', () => {
    test('public/index.html includes project list rail, 3-way toggle, and chat container', () => {
      const html = fs.readFileSync('public/index.html', 'utf8');
      assert.ok(html.includes('assistant-workspace-layout'), 'Must have assistant-workspace-layout');
      assert.ok(html.includes('id="assistantProjectsList"'), 'Must have assistantProjectsList');
      assert.ok(html.includes('id="btnNewProject"'), 'Must have btnNewProject');
      assert.ok(html.includes('id="assistantCurrentProjectName"'), 'Must have assistantCurrentProjectName');
      assert.ok(html.includes('id="assistantPinnedContext"'), 'Must have assistantPinnedContext');
      assert.ok(html.includes('id="assistantModeToggle"'), 'Must have assistantModeToggle');
      assert.ok(html.includes('id="modeBtnAsk"'), 'Must have modeBtnAsk');
      assert.ok(html.includes('id="modeBtnPlan"'), 'Must have modeBtnPlan');
      assert.ok(html.includes('id="modeBtnExecute"'), 'Must have modeBtnExecute');
      assert.ok(html.includes('id="commandMicBtn"'), 'Must have commandMicBtn for voice dictation');
    });

    test('public/css/app.css implements assistant layout, 3-way toggle, and dark terminal blocks', () => {
      const css = fs.readFileSync('public/css/app.css', 'utf8');
      assert.ok(css.includes('.assistant-workspace-layout'), 'Must style .assistant-workspace-layout');
      assert.ok(css.includes('.assistant-projects-sidebar'), 'Must style .assistant-projects-sidebar');
      assert.ok(css.includes('.assistant-mode-segmented'), 'Must style .assistant-mode-segmented');
      assert.ok(css.includes('.terminal-block'), 'Must style .terminal-block');
      assert.ok(css.includes('.terminal-header'), 'Must style .terminal-header');
      assert.ok(css.includes('.terminal-body'), 'Must style .terminal-body');
      assert.ok(css.includes('.terminal-badge'), 'Must style .terminal-badge');
      assert.ok(css.includes('.command-btn-mic.listening'), 'Must style pulsating listening mic');
    });

    test('public/js/assistant.js exports workspace controller and manages mode state', async () => {
      const assistantModule = await import('../public/js/assistant.js');
      assert.equal(typeof assistantModule.initAssistantWorkspace, 'function');
      assert.equal(typeof assistantModule.loadProjects, 'function');
      assert.equal(typeof assistantModule.selectProject, 'function');
      assert.equal(typeof assistantModule.setAssistantMode, 'function');
      assert.equal(typeof assistantModule.getAssistantMode, 'function');
      assert.equal(typeof assistantModule.sendAssistantPrompt, 'function');
      assert.equal(typeof assistantModule.renderProjectList, 'function');
      assert.equal(typeof assistantModule.renderChatMessages, 'function');

      assistantModule.setAssistantMode('plan', false);
      assert.equal(assistantModule.getAssistantMode(), 'plan');

      assistantModule.setAssistantMode('execute', false);
      assert.equal(assistantModule.getAssistantMode(), 'execute');

      assistantModule.setAssistantMode('ask', false);
      assert.equal(assistantModule.getAssistantMode(), 'ask');
    });
  });
});
