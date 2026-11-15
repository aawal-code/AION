import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function runNode(code, cwd) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', code], { cwd, timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
      resolve({ stdout, stderr });
    });
  });
}

test('Phase 1 containment rejects unauthenticated and arbitrary execution routes', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'aion-phase1-'));
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const port = 51838;
  const serverUrl = new URL('../src/server.js', import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict';
    process.env.PORT = '${port}';
    process.env.AION_LOCAL_AUTH_SECRET = '${secret}';
    const { server } = await import('${serverUrl}');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:${port}';
    try {
      let response = await fetch(base + '/api/runner', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({command:'whoami'}) });
      assert.equal(response.status, 401);
      response = await fetch(base + '/api/auth/local-session', { headers: {'x-aion-local-secret':'${secret}'} });
      assert.equal(response.status, 200);
      const headers = {cookie:'aion_token=${secret}', 'content-type':'application/json'};
      response = await fetch(base + '/api/runner', {method:'POST', headers, body:JSON.stringify({command:'whoami'})}); assert.equal(response.status, 410);
      response = await fetch(base + '/api/assistant/execute', {method:'POST', headers, body:JSON.stringify({prompt:'test'})}); assert.equal(response.status, 503);
      response = await fetch(base + '/api/screen/snapshot', {headers}); assert.equal(response.status, 503);
      response = await fetch(base + '/api/system/update/apply', {method:'POST', headers}); assert.equal(response.status, 503);
      response = await fetch(base + '/api/devices?token=${secret}'); assert.equal(response.status, 401);
    } finally { await new Promise(resolve => server.close(resolve)); }
  `;

  try {
    const result = await runNode(code, sandbox);
    assert.match(result.stdout, /AION CORE ONLINE/);
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
