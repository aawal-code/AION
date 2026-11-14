import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { exec } from 'node:child_process';
import { logEvent } from './sse.js';

const DATA_DIR = path.resolve('data');
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc');

// Supported Providers Mapping to Environment Variables
const PROVIDER_ENV_MAP = {
  openai: ['OPENAI_API_KEY', 'AION_OPENAI_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'AION_ANTHROPIC_KEY'],
  groq: ['GROQ_API_KEY', 'AION_GROQ_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AION_GEMINI_KEY'],
  ollama: ['OLLAMA_HOST', 'OLLAMA_API_BASE'],
};

/**
 * Derives a deterministic machine-specific encryption key based on machine metadata.
 * Uses SHA-256 to produce a 32-byte AES-256 key.
 */
function getDerivedKey() {
  const machineSeed = [
    os.hostname(),
    os.platform(),
    os.arch(),
    'AION-API-VAULT-SEED-v1',
  ].join('::');

  return crypto.createHash('sha256').update(machineSeed).digest();
}

/**
 * Encrypts an object using AES-256-GCM
 */
function encryptData(obj) {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const jsonStr = JSON.stringify(obj);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted,
  });
}

/**
 * Decrypts an encrypted object using AES-256-GCM
 */
function decryptData(encryptedStr) {
  try {
    const parsed = JSON.parse(encryptedStr);
    const key = getDerivedKey();
    const iv = Buffer.from(parsed.iv, 'hex');
    const authTag = Buffer.from(parsed.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(parsed.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (err) {
    logEvent('WARN', `Vault decryption warning: ${err.message}`);
    return {};
  }
}

/**
 * Reads vault state from data/vault.enc
 */
export function readVault() {
  try {
    if (fs.existsSync(VAULT_FILE)) {
      const raw = fs.readFileSync(VAULT_FILE, 'utf8').trim();
      if (raw) return decryptData(raw);
    }
  } catch (err) {
    logEvent('WARN', `Failed reading vault file: ${err.message}`);
  }
  return {};
}

/**
 * Writes vault state to data/vault.enc
 */
export function writeVault(vaultData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const encrypted = encryptData(vaultData);
    fs.writeFileSync(VAULT_FILE, encrypted, 'utf8');
    return true;
  } catch (err) {
    logEvent('ERROR', `Failed writing vault file: ${err.message}`);
    return false;
  }
}

/**
 * Saves or updates an API key for target provider in the encrypted vault
 */
export function saveApiKey(provider, key) {
  const prov = (provider || '').toLowerCase().trim();
  if (!prov) return false;

  const vault = readVault();
  if (key && key.trim()) {
    vault[prov] = key.trim();
  } else {
    delete vault[prov];
  }
  return writeVault(vault);
}

/**
 * Retrieves the API key for a target provider:
 * 1. Checks encrypted local vault
 * 2. Checks environment variables
 * 3. Falls back to Windows Credential Manager if queryable
 */
export async function getApiKey(provider) {
  const prov = (provider || '').toLowerCase().trim();
  if (!prov) return null;

  // 1. Check encrypted local vault
  const vault = readVault();
  if (vault[prov]) {
    return vault[prov];
  }

  // 2. Check environment variables
  const envVars = PROVIDER_ENV_MAP[prov] || [];
  for (const varName of envVars) {
    if (process.env[varName] && process.env[varName].trim()) {
      return process.env[varName].trim();
    }
  }

  // 3. Optional Windows Credential Manager lookup on Win32
  if (process.platform === 'win32') {
    try {
      const winKey = await readWindowsCredential(`AION_${prov.toUpperCase()}_KEY`);
      if (winKey) return winKey;
    } catch {}
  }

  return null;
}

/**
 * Helper to query Windows Credential Manager via PowerShell
 */
function readWindowsCredential(targetName) {
  return new Promise((resolve) => {
    const psCmd = `
      try {
        $vault = New-Object Windows.Security.Credentials.PasswordVault
        $cred = $vault.FindAllByResource('${targetName}') | Select-Object -First 1
        if ($cred) { $cred.RetrievePassword(); Write-Output $cred.Password }
      } catch {}
    `.trim().replace(/\s+/g, ' ');

    exec(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 1500 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const val = stdout.trim();
      resolve(val || null);
    });
  });
}

/**
 * Deletes an API key from the vault
 */
export function deleteApiKey(provider) {
  return saveApiKey(provider, '');
}

/**
 * Returns safe status of configured keys without exposing plaintext secrets
 */
export async function getVaultStatus() {
  const providers = ['anthropic', 'openai', 'groq', 'gemini', 'ollama'];
  const status = {};

  for (const prov of providers) {
    const key = await getApiKey(prov);
    const hasKey = Boolean(key && key.length > 0);
    const masked = hasKey
      ? (key.length > 10 ? `${key.slice(0, 6)}••••••••${key.slice(-4)}` : '••••••••')
      : 'Not configured';

    status[prov] = {
      configured: hasKey,
      masked,
    };
  }

  return status;
}
