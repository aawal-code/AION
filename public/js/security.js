import { showToast } from './settings.js';

const encoder = new TextEncoder();
const dbName = 'aion-security-keys';
const storeName = 'keys';
let recoveryVisible = false;

const element = (id) => document.getElementById(id);
const cookie = (name) => document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const csrfHeaders = () => ({ 'content-type': 'application/json', 'x-aion-csrf': decodeURIComponent(cookie('aion_csrf')) });
const request = async (url, options = {}) => {
  const response = await fetch(url, options); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Security operation failed'); return data;
};
function database() { return new Promise((resolve, reject) => { const open = indexedDB.open(dbName, 1); open.onupgradeneeded = () => open.result.createObjectStore(storeName); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); }); }
async function keyPair() {
  const db = await database(); const existing = await new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readonly'); const get = tx.objectStore(storeName).get('owner'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  await new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(pair, 'owner'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); return pair;
}
async function ownerPublicKey() { const pair = await keyPair(); const raw = await crypto.subtle.exportKey('spki', pair.publicKey); const text = btoa(String.fromCharCode(...new Uint8Array(raw))); return `-----BEGIN PUBLIC KEY-----\n${text.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`; }
async function authenticateOwner(deviceId) { const pair = await keyPair(); const challenge = await request('/api/auth/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId }) }); const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, encoder.encode(challenge.signingPayload)); await request('/api/auth/authenticate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.challengeId, signature: btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') }) }); }
function setVisible(id, visible) { const node = element(id); if (node) node.hidden = !visible; }
function recoveryKey(value) { recoveryVisible = Boolean(value); element('securityRecoveryKeyValue').textContent = value || ''; setVisible('securityOneTimeKey', recoveryVisible); element('securityRecoveryConfirmed').checked = false; element('btnSecurityDismissRecovery').disabled = true; }
function row(title, meta, action) { const item = document.createElement('div'); item.className = 'security-list-item'; const copy = document.createElement('div'); copy.innerHTML = `<div class="security-list-title"></div><div class="security-list-meta"></div>`; copy.children[0].textContent = title; copy.children[1].textContent = meta; item.append(copy); if (action) item.append(action); return item; }
function renderList(id, entries, render) { const root = element(id); root.replaceChildren(...entries.map(render)); if (!entries.length) root.textContent = 'No records yet.'; }

export async function loadSecurityPanel() {
  try {
    const status = await request('/api/auth/status'); const initialized = status.initialized;
    element('securityStatus').textContent = initialized ? (status.authenticated ? `Signed in as ${status.owner?.name || 'Owner'} (${status.role}).` : 'Owner identity exists. Sign in with this desktop key or recover access.') : 'No Owner exists. Create the first Owner identity from this verified desktop session.';
    setVisible('securityEnrollment', !initialized); setVisible('securityRecovery', initialized && !status.authenticated); setVisible('securityOwnerActions', status.authenticated && status.role === 'owner'); setVisible('securityDeviceEnrollment', status.authenticated && status.role === 'owner'); setVisible('securityDevicesGroup', status.authenticated && status.role === 'owner'); setVisible('securitySessionsGroup', status.authenticated && status.role === 'owner'); setVisible('securityAuditGroup', status.authenticated && status.role === 'owner');
    if (initialized && !status.authenticated && status.owner) { try { await authenticateOwner(status.owner.id); return loadSecurityPanel(); } catch { /* Recovery remains available without exposing key details. */ } }
    if (status.authenticated && status.role === 'owner') {
      const [devices, sessions, audit] = await Promise.all([request('/api/auth/devices'), request('/api/auth/sessions'), request('/api/auth/audit')]);
      renderList('securityDevicesList', devices.devices, (device) => { const button = document.createElement('button'); button.className = 'btn-secondary'; button.type = 'button'; button.textContent = device.revokedAt ? 'Revoked' : 'Revoke'; button.disabled = Boolean(device.revokedAt) || device.role === 'owner'; button.onclick = async () => { await request(`/api/auth/devices/${encodeURIComponent(device.id)}`, { method: 'DELETE', headers: csrfHeaders() }); await loadSecurityPanel(); }; return row(`${device.name} · ${device.role}`, device.revokedAt ? `Revoked ${device.revokedAt}` : `Approved ${device.createdAt}`, button); });
      renderList('securitySessionsList', sessions.sessions.filter((session) => !session.revokedAt), (session) => { const button = document.createElement('button'); button.className = 'btn-secondary'; button.type = 'button'; button.textContent = 'Revoke'; button.onclick = async () => { await request('/api/auth/sessions/revoke', { method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ sessionId: session.id }) }); await loadSecurityPanel(); }; return row(`${session.deviceName} · ${session.role}`, `Expires ${session.expiresAt}`, button); });
      renderList('securityAuditList', audit.events, (event) => row(event.event, event.createdAt));
    }
  } catch (error) { element('securityStatus').textContent = `${error.message} Check that the desktop host is running and try again.`; }
}
export function initSecurity() {
  element('btnSecurityEnroll')?.addEventListener('click', async () => { try { const result = await request('/api/auth/enroll-owner', { method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ name: element('securityOwnerName').value, publicKey: await ownerPublicKey() }) }); recoveryKey(result.recoveryKey); await authenticateOwner(result.deviceId); showToast('Owner identity created. Save the recovery key before continuing.'); } catch (error) { showToast(error.message, 'alert'); } });
  element('btnSecurityRecover')?.addEventListener('click', async () => { try { const result = await request('/api/auth/recover-owner', { method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ recoveryKey: element('securityRecoveryKey').value, name: element('securityRecoveryName').value, publicKey: await ownerPublicKey() }) }); recoveryKey(result.recoveryKey); await authenticateOwner(result.deviceId); showToast('Owner access recovered. Save the replacement recovery key.'); } catch (error) { showToast(error.message, 'alert'); } });
  element('btnSecurityRotateRecovery')?.addEventListener('click', async () => { try { recoveryKey((await request('/api/auth/recovery/rotate', { method: 'POST', headers: csrfHeaders(), body: '{}' })).recoveryKey); } catch (error) { showToast(error.message, 'alert'); } });
  element('btnSecurityEnrollDevice')?.addEventListener('click', async () => { try { await request('/api/auth/enroll-device', { method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ name: element('securityDeviceName').value, role: element('securityDeviceRole').value, publicKey: element('securityDeviceKey').value }) }); element('securityDeviceKey').value = ''; showToast('Device approved.'); await loadSecurityPanel(); } catch (error) { showToast(error.message, 'alert'); } });
  element('btnSecurityCopyRecovery')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(element('securityRecoveryKeyValue').textContent); showToast('Recovery key copied.'); } catch { showToast('Copy is unavailable. Select the key and copy it manually.', 'alert'); } });
  element('securityRecoveryConfirmed')?.addEventListener('change', (event) => { element('btnSecurityDismissRecovery').disabled = !event.target.checked; });
  element('btnSecurityDismissRecovery')?.addEventListener('click', () => { recoveryKey(''); loadSecurityPanel(); });
}
