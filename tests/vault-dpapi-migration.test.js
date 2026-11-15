import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const vaultUrl = new URL('../src/services/vault.js', import.meta.url).href;
const run = (code, cwd) => new Promise((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', code], { cwd, timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stdout}\n${stderr}`)) : resolve(stdout)));

test('Windows DPAPI migrates synthetic legacy credentials atomically and preserves backup', { skip: process.platform !== 'win32' }, async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'aion-vault-migration-'));
  const code = `
    import assert from 'node:assert/strict'; import crypto from 'node:crypto'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
    const legacyKey = crypto.createHash('sha256').update([os.hostname(), os.platform(), os.arch(), 'AION-API-VAULT-SEED-v1'].join('::')).digest();
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', legacyKey, iv); const body = Buffer.concat([cipher.update(JSON.stringify({ openai: 'synthetic-test-credential' }), 'utf8'), cipher.final()]);
    fs.mkdirSync('data', { recursive: true }); fs.writeFileSync('data/vault.enc', JSON.stringify({ iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex'), data: body.toString('hex') }));
    const vault = await import(${JSON.stringify(vaultUrl)}); assert.equal(vault.readVault().openai, 'synthetic-test-credential');
    assert.ok(fs.existsSync('data/vault.legacy.enc')); const migrated = JSON.parse(fs.readFileSync('data/vault.enc', 'utf8')); assert.equal(migrated.version, 2); assert.equal(migrated.protection, 'dpapi-current-user');
    assert.equal(vault.readVault().openai, 'synthetic-test-credential');
  `;
  try { await run(code, sandbox); } finally { await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('corrupted vault fails closed without overwriting the original bytes', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'aion-vault-corrupt-'));
  const code = `
    import assert from 'node:assert/strict'; import fs from 'node:fs'; fs.mkdirSync('data', { recursive: true }); fs.writeFileSync('data/vault.enc', '{not-json');
    const vault = await import(${JSON.stringify(vaultUrl)}); assert.throws(() => vault.readVault(), /unavailable or corrupted/i); assert.equal(fs.readFileSync('data/vault.enc','utf8'), '{not-json');
  `;
  try { await run(code, sandbox); } finally { await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
