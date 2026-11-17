import { t } from './i18n.js';

// Read-only preparation surface. The mobile gateway remains disabled until
// its authenticated transport and phone pairing have been verified.
let generation = 0;
const element = id => document.getElementById(id);
function setStatus(key) { const status = element('mobileAccessStatus'); status.dataset.i18n = key; status.textContent = t(key); }

async function refreshMobileAccess() {
  const version = ++generation;
  const fields = [element('mobileAccessHostname'), element('mobileAccessIp'), element('mobileAccessDns')];
  setStatus('mobileStatusChecking');
  for (const field of fields) field.textContent = '—';
  try {
    const response = await fetch('/api/network/mesh', { signal: AbortSignal.timeout(6000) });
    if (response.status === 401 || response.status === 403) throw new Error('mobileStatusSignIn');
    if (!response.ok) throw new Error('mobileStatusError');
    const data = await response.json();
    if (version !== generation) return;
    if (data.status !== 'ok' || typeof data.connected !== 'boolean') throw new Error('mobileStatusInvalid');
    if (data.statusError === 'cli_not_found') setStatus('mobileStatusMissing');
    else if (data.statusError) setStatus('mobileStatusUnavailable');
    else setStatus(data.connected ? 'mobileStatusConnected' : 'mobileStatusDisconnected');
    fields[0].textContent = typeof data.hostname === 'string' ? data.hostname : '—';
    fields[1].textContent = typeof data.ipv4 === 'string' ? data.ipv4 : '—';
    fields[2].textContent = typeof data.dnsName === 'string' ? data.dnsName : '—';
  } catch (error) {
    if (version === generation) setStatus(error.name === 'TimeoutError' ? 'mobileStatusTimeout' : /^mobileStatus/.test(error.message) ? error.message : 'mobileStatusError');
  }
}

export function initMobileAccess() {
  const overview = element('devicesOverview'), panel = element('mobileAccessPanel');
  if (!overview || !panel) return;
  const close = () => { generation++; panel.hidden = true; overview.hidden = false; };
  element('openMobileAccess')?.addEventListener('click', () => { overview.hidden = true; panel.hidden = false; element('mobileAccessTitle').focus(); refreshMobileAccess(); });
  element('backToDevices')?.addEventListener('click', close);
  element('refreshMobileAccess')?.addEventListener('click', refreshMobileAccess);
  window.addEventListener('aion:navigation', close);
}
