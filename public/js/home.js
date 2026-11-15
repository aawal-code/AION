import { t } from './i18n.js';
import { sendAssistantPrompt, setAssistantMode } from './assistant.js';

let devices = [];
export async function refreshHomeDevices() {
  const select = document.getElementById('homeDeviceSelect'), status = document.getElementById('homeDeviceStatus');
  if (!select || !status) return;
  try {
    const response = await fetch('/api/devices'); if (!response.ok) throw new Error('unavailable');
    const data = await response.json(); if (!Array.isArray(data.devices)) throw new Error('unavailable');
    devices = data.devices.filter((device) => typeof device.id === 'string' && typeof device.name === 'string');
    const previous = select.value; select.replaceChildren(new Option(t('homeChooseDevice'), ''));
    for (const device of devices) select.add(new Option(device.name, device.id));
    if (devices.some((device) => device.id === previous)) select.value = previous;
    status.textContent = t(devices.length ? 'homeDeviceReady' : 'homeDeviceNone');
  } catch { devices = []; select.replaceChildren(new Option(t('homeChooseDevice'), '')); status.textContent = t('homeDeviceUnavailable'); }
}
export function initHome() {
  const ask = document.getElementById('homeAskForm'), device = document.getElementById('homeDeviceForm');
  ask?.addEventListener('submit', async (event) => { event.preventDefault(); const input = document.getElementById('homeAskInput'), prompt = input.value.trim(); if (!prompt) return; window.aionSelectDevice?.('assistant'); setAssistantMode('ask', false); input.value = ''; await sendAssistantPrompt(prompt); });
  device?.addEventListener('submit', (event) => { event.preventDefault(); const selected = document.getElementById('homeDeviceSelect').value; if (devices.some((item) => item.id === selected)) window.aionSelectDevice?.(selected); });
  window.addEventListener('aion:authenticated', refreshHomeDevices);
  window.addEventListener('aion:languagechange', refreshHomeDevices);
  window.addEventListener('aion:navigation', (event) => { if (event.detail.id === 'home') refreshHomeDevices(); });
  refreshHomeDevices();
}
