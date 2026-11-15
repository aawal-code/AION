import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc');
const LEGACY_BACKUP = path.join(DATA_DIR, 'vault.legacy.enc');
const PROVIDER_ENV_MAP = { cerebras: ['CEREBRAS_API_KEY', 'AION_CEREBRAS_KEY'], openai: ['OPENAI_API_KEY', 'AION_OPENAI_KEY'], anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'AION_ANTHROPIC_KEY'], groq: ['GROQ_API_KEY', 'AION_GROQ_KEY'], gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AION_GEMINI_KEY'], ollama: ['OLLAMA_HOST', 'OLLAMA_API_BASE'] };

export function protectedData(input, unprotect = false) {
  const encoded = Buffer.from(input).toString('base64');
  if (process.platform === 'win32') {
    const operation = unprotect ? 'Unprotect' : 'Protect';
    const script = `Add-Type -AssemblyName System.Security;$encodedInput=[Console]::In.ReadToEnd();$bytes=[Convert]::FromBase64String($encodedInput);$scope=[Security.Cryptography.DataProtectionScope]::CurrentUser;[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($bytes,$null,$scope)))`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { input: encoded, encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (result.status !== 0 || !result.stdout) throw new Error('Windows protected storage is unavailable');
    return Buffer.from(result.stdout.trim(), 'base64');
  }
  // A test-only key permits isolated fixtures on non-Windows CI. Production
  // hosts fail closed rather than substituting predictable machine metadata.
  if (process.env.AION_TEST_VAULT_KEY) {
    const key = crypto.createHash('sha256').update(process.env.AION_TEST_VAULT_KEY).digest();
    if (unprotect) { const raw = Buffer.from(input); const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), body = raw.subarray(28); const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); return Buffer.concat([d.update(body), d.final()]); }
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv), body = Buffer.concat([c.update(input), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]);
  }
  throw new Error('Protected credential storage is only available on Windows');
}
function legacyKey() { return crypto.createHash('sha256').update([os.hostname(), os.platform(), os.arch(), 'AION-API-VAULT-SEED-v1'].join('::')).digest(); }
function decryptLegacy(raw) { const value = JSON.parse(raw), d = crypto.createDecipheriv('aes-256-gcm', legacyKey(), Buffer.from(value.iv, 'hex')); d.setAuthTag(Buffer.from(value.authTag, 'hex')); return JSON.parse(`${d.update(value.data, 'hex', 'utf8')}${d.final('utf8')}`); }
function encode(value) { return JSON.stringify({ version: 2, protection: 'dpapi-current-user', payload: protectedData(Buffer.from(JSON.stringify(value))).toString('base64') }); }
function decode(raw) { const value = JSON.parse(raw); if (value.version !== 2 || value.protection !== 'dpapi-current-user' || typeof value.payload !== 'string') throw new Error('Unsupported protected vault format'); return JSON.parse(protectedData(Buffer.from(value.payload, 'base64'), true).toString('utf8')); }
function atomicWrite(file, contents) { fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, contents, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(tmp, file); }

export function readVault() {
  if (!fs.existsSync(VAULT_FILE)) return {};
  const raw = fs.readFileSync(VAULT_FILE, 'utf8').trim(); if (!raw) return {};
  try { return decode(raw); }
  catch (protectedError) {
    try {
      const legacy = decryptLegacy(raw);
      // Preserve the original encrypted bytes before atomically replacing them.
      if (!fs.existsSync(LEGACY_BACKUP)) atomicWrite(LEGACY_BACKUP, raw);
      atomicWrite(VAULT_FILE, encode(legacy));
      logEvent('SECURITY', 'Legacy credential vault migrated to Windows protected storage');
      return legacy;
    } catch { throw new Error('Credential vault is unavailable or corrupted; no credentials were changed.'); }
  }
}
export function writeVault(vault) { atomicWrite(VAULT_FILE, encode(vault)); return true; }
export function saveApiKey(provider, key) { const id = String(provider || '').trim().toLowerCase(); if (!id) return false; const vault = readVault(); if (key && String(key).trim()) vault[id] = String(key).trim(); else delete vault[id]; return writeVault(vault); }
export function deleteApiKey(provider) { return saveApiKey(provider, ''); }
export async function getApiKey(provider) { const id = String(provider || '').trim().toLowerCase(); if (!id) return null; const vault = readVault(); if (vault[id]) return vault[id]; for (const variable of PROVIDER_ENV_MAP[id] || []) if (process.env[variable]?.trim()) return process.env[variable].trim(); return null; }
export async function getVaultStatus() { const status = {}; for (const provider of Object.keys(PROVIDER_ENV_MAP)) { const value = await getApiKey(provider); status[provider] = { configured: Boolean(value), masked: value ? 'Configured (protected)' : 'Not configured' }; } return status; }
