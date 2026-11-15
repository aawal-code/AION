import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleRequest } from '../src/routes/router.js';
import { loadConfig, saveConfig, updateExecutionTarget, DEFAULT_CONFIG } from '../src/services/config.js';
import { saveApiKey, deleteApiKey, getVaultStatus } from '../src/services/vault.js';
import { resolveActiveProvider, PROVIDER_ENDPOINTS, DEFAULT_MODELS } from '../src/services/llm-provider.js';
import { getDb } from '../src/services/assistant-db.js';

describe('Unified Config & Execution Target Suite', () => {
  let server;
  let baseUrl;
  const configPath = path.resolve('data', 'config.json');
  let originalConfigRaw = null;

  before(async () => {
    // Preserve existing config if present
    if (fs.existsSync(configPath)) {
      originalConfigRaw = fs.readFileSync(configPath, 'utf8');
    }

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
    // Restore original config
    if (originalConfigRaw) {
      fs.writeFileSync(configPath, originalConfigRaw, 'utf8');
    }
    // Clean up test keys
    deleteApiKey('cerebras');
  });

  describe('Config Service (data/config.json)', () => {
    test('loadConfig returns valid configuration with default execution target', () => {
      const cfg = loadConfig();
      assert.ok(cfg.deviceName, 'deviceName should exist');
      assert.ok(cfg.executionTarget, 'executionTarget should exist');
      assert.ok(['cli', 'api'].includes(cfg.executionTarget.runtimeMode));
      assert.equal(typeof cfg.executionTarget.cliProfile, 'string');
      assert.equal(typeof cfg.executionTarget.apiProvider, 'string');
    });

    test('saveConfig updates and persists fields atomically', () => {
      const updated = saveConfig({
        deviceName: 'Test-Workstation-Alpha',
        executionTarget: {
          runtimeMode: 'api',
          apiProvider: 'cerebras',
          apiModel: 'llama3.3-70b',
        },
      });

      assert.equal(updated.deviceName, 'Test-Workstation-Alpha');
      assert.equal(updated.executionTarget.runtimeMode, 'api');
      assert.equal(updated.executionTarget.apiProvider, 'cerebras');

      // Verify file on disk
      const diskCfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(diskCfg.deviceName, 'Test-Workstation-Alpha');
      assert.equal(diskCfg.executionTarget.runtimeMode, 'api');
    });

    test('updateExecutionTarget updates only target slice', () => {
      const updated = updateExecutionTarget({
        runtimeMode: 'cli',
        cliProfile: 'opencode',
      });

      assert.equal(updated.executionTarget.runtimeMode, 'cli');
      assert.equal(updated.executionTarget.cliProfile, 'opencode');
      assert.equal(updated.deviceName, 'Test-Workstation-Alpha'); // Preserved
    });
  });

  describe('Cerebras & Extended Provider Resolution', () => {
    test('defines Cerebras endpoint and default model', () => {
      assert.equal(PROVIDER_ENDPOINTS.cerebras, 'https://api.cerebras.ai/v1/chat/completions');
      assert.equal(DEFAULT_MODELS.cerebras, 'llama3.3-70b');
    });

    test('stores Cerebras key in encrypted vault and resolves active provider', async () => {
      saveApiKey('cerebras', 'test-cerebras-credential-fixture');

      const vaultStatus = await getVaultStatus();
      assert.ok(vaultStatus.cerebras, 'Cerebras should be in vault status');
      assert.equal(vaultStatus.cerebras.configured, true);

      const resolved = await resolveActiveProvider('cerebras');
      assert.equal(resolved.provider, 'cerebras');
      assert.equal(resolved.apiKey, 'test-cerebras-credential-fixture');
    });
  });

  describe('HTTP REST Endpoints (/api/config)', () => {
    test('GET /api/config returns 200 with config payload', async () => {
      const res = await fetch(`${baseUrl}/api/config`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(data.config);
      assert.ok(data.config.executionTarget);
    });

    test('POST /api/config updates configuration cleanly', async () => {
      const res = await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionTarget: {
            runtimeMode: 'cli',
            cliProfile: 'claude',
          },
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.config.executionTarget.runtimeMode, 'cli');
      assert.equal(data.config.executionTarget.cliProfile, 'claude');
    });

    test('POST /api/assistant/chat processes prompt with execution target context', async () => {
      // Clear mock key so it uses intelligent zero-network local response generator
      deleteApiKey('cerebras');

      const res = await fetch(`${baseUrl}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'System status report',
          mode: 'ask',
          runtimeMode: 'cli',
          cliProfile: 'agy',
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      assert.ok(data.assistantMessage);
      assert.ok(data.response);
    });
  });
});
