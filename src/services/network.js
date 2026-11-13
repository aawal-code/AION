import { exec } from 'child_process';
import os from 'os';
import { logEvent } from './sse.js';

/**
 * Parses raw JSON output from 'tailscale status --json'
 */
export function parseTailscaleStatus(jsonStr) {
  try {
    if (!jsonStr || typeof jsonStr !== 'string' || !jsonStr.trim()) {
      return {
        connected: false,
        ipv4: null,
        ipv6: null,
        hostname: null,
      };
    }

    const data = JSON.parse(jsonStr);
    const backendState = (data.BackendState || '').toLowerCase();
    const isRunning = backendState === 'running';

    // TailscaleIPs can be array at root data.TailscaleIPs or data.Self.TailscaleIPs
    const ips = Array.isArray(data.TailscaleIPs) && data.TailscaleIPs.length > 0
      ? data.TailscaleIPs
      : Array.isArray(data.Self?.TailscaleIPs)
      ? data.Self.TailscaleIPs
      : [];

    let ipv4 = null;
    let ipv6 = null;

    for (const ip of ips) {
      if (typeof ip === 'string') {
        const cleanIp = ip.trim();
        if (cleanIp.includes('.') && !ipv4) {
          ipv4 = cleanIp;
        } else if (cleanIp.includes(':') && !ipv6) {
          ipv6 = cleanIp;
        }
      }
    }

    let hostname = data.Self?.HostName || null;
    if (!hostname && data.Self?.DNSName) {
      hostname = data.Self.DNSName.replace(/\.+$/, '');
    }
    if (!hostname && typeof os.hostname === 'function') {
      hostname = os.hostname();
    }

    const isOnline = data.Self?.Online !== undefined ? Boolean(data.Self.Online) : isRunning;
    const connected = isRunning && (isOnline || Boolean(ipv4 || ipv6));

    return {
      connected: Boolean(connected),
      ipv4: ipv4 || null,
      ipv6: ipv6 || null,
      hostname: hostname || null,
    };
  } catch (err) {
    logEvent('WARN', `Failed to parse Tailscale JSON: ${err.message}`);
    return {
      connected: false,
      ipv4: null,
      ipv6: null,
      hostname: null,
    };
  }
}

/**
 * Checks live Tailscale mesh network state
 * Gracefully resolves to a clean disconnected state if Tailscale is not installed or offline.
 */
export function getMeshStatus(timeoutMs = 4000) {
  return new Promise((resolve) => {
    exec('tailscale status --json', { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        return resolve({
          connected: false,
          ipv4: null,
          ipv6: null,
          hostname: null,
        });
      }

      const result = parseTailscaleStatus(stdout);
      resolve(result);
    });
  });
}
