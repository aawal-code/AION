import { execFile } from 'child_process';
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
    let dnsName = data.Self?.DNSName ? data.Self.DNSName.replace(/\.+$/, '') : null;
    if (!hostname && dnsName) {
      hostname = dnsName;
    }
    if (!hostname && typeof os.hostname === 'function') {
      hostname = os.hostname();
    }

    const certDomains = Array.isArray(data.CertDomains) ? data.CertDomains : [];
    const isOnline = data.Self?.Online === true;
    const connected = isRunning && isOnline;

    return {
      connected: Boolean(connected),
      ipv4: ipv4 || null,
      ipv6: ipv6 || null,
      hostname: hostname || null,
      dnsName: dnsName || null,
      certDomains,
      httpsSupported: false,
      httpsUrl: null,
      httpUrl: null,
    };
  } catch (err) {
    logEvent('WARN', `Failed to parse Tailscale JSON: ${err.message}`);
    return {
      connected: false,
      ipv4: null,
      ipv6: null,
      hostname: null,
      dnsName: null,
      certDomains: [],
      httpsSupported: false,
      httpsUrl: null,
      httpUrl: null,
    };
  }
}

/**
 * Detects local non-loopback LAN IPv4 address (Wi-Fi or Ethernet: e.g. 192.168.x.x, 10.x.x.x)
 */
export function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!Array.isArray(addrs)) continue;
    const lower = name.toLowerCase();
    if (lower.includes('tailscale') || lower.includes('virtual') || lower.includes('loopback')) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && addr.address && !addr.address.startsWith('127.') && !addr.address.startsWith('169.254.')) {
        return addr.address;
      }
    }
  }
  return null;
}

let cachedMesh = null;
let lastMeshFetch = 0;
const MESH_CACHE_TTL_MS = 10000;

export function clearMeshCache() {
  cachedMesh = null;
  lastMeshFetch = 0;
}

/**
 * Checks live Tailscale mesh network state
 * Gracefully resolves to a clean disconnected state if Tailscale is not installed or offline.
 */
export function getMeshStatus(timeoutMs = 3000) {
  const now = Date.now();
  if (cachedMesh && (now - lastMeshFetch < MESH_CACHE_TTL_MS)) {
    return Promise.resolve({ ...cachedMesh });
  }

  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'tailscale.exe' : 'tailscale', ['status', '--json'], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      const lanIp = getLocalLanIp();
      let result;
      if (err || !stdout || !stdout.trim()) {
        result = {
          connected: false,
          ipv4: null,
          ipv6: null,
          hostname: typeof os.hostname === 'function' ? os.hostname() : null,
          lanIp,
          cliAvailable: err?.code === 'ENOENT' ? false : null,
          statusError: err?.code === 'ENOENT' ? 'cli_not_found' : 'status_unavailable',
        };
      } else {
        result = parseTailscaleStatus(stdout);
        result.cliAvailable = true;
        try {
          const raw = JSON.parse(stdout);
          result.statusError = typeof raw?.BackendState !== 'string' || (raw.BackendState.toLowerCase() === 'running' && typeof raw.Self?.Online !== 'boolean') ? 'invalid_status' : null;
        } catch { result.statusError = 'invalid_status'; }
        result.lanIp = lanIp;
      }
      cachedMesh = result;
      lastMeshFetch = Date.now();
      resolve(result);
    });
  });
}

/**
 * Returns Tailscale HTTPS cert/serve capability and target URLs
 */
export async function getTailscaleHttpsStatus() {
  const mesh = await getMeshStatus().catch(() => ({}));
  const dnsName = mesh.dnsName || null;
  const ipv4 = mesh.ipv4 || null;
  return {
    supported: false,
    dnsName,
    // No endpoint is published until a gateway and Serve mapping are verified.
    httpsUrl: null,
    httpUrl: null,
    tailscaleIp: ipv4 || null,
    connected: Boolean(mesh.connected),
  };
}
