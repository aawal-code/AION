import dgram from 'dgram';
import os from 'os';
import { exec } from 'child_process';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';

/**
 * Builds standard 102-byte AMD Magic Packet Buffer
 * 6 bytes of 0xFF followed by 16 repetitions of the target 6-byte MAC address
 */
export function buildMagicPacket(mac) {
  if (!mac || typeof mac !== 'string') {
    throw new Error('MAC address must be a non-empty string');
  }

  const cleanHex = mac.replace(/[^0-9A-Fa-f]/g, '');
  if (cleanHex.length !== 12) {
    throw new Error(`Invalid MAC address '${mac}': must contain exactly 12 hex digits`);
  }

  const macBytes = Buffer.from(cleanHex, 'hex');
  const packet = Buffer.alloc(102);

  // 6 bytes of 0xFF prefix
  packet.fill(0xff, 0, 6);

  // 16 repetitions of 6-byte target MAC
  for (let i = 0; i < 16; i++) {
    macBytes.copy(packet, 6 + i * 6);
  }

  return packet;
}

/**
 * Calculates IPv4 subnet broadcast address from IP and netmask
 */
export function calculateBroadcastAddress(ip, netmask) {
  try {
    const ipParts = ip.split('.').map((p) => parseInt(p, 10));
    const maskParts = netmask.split('.').map((p) => parseInt(p, 10));
    if (ipParts.length !== 4 || maskParts.length !== 4) return null;

    const bcastParts = ipParts.map((b, i) => (b | (~maskParts[i] & 255)) >>> 0);
    return bcastParts.join('.');
  } catch {
    return null;
  }
}

/**
 * Broadcasts native Node.js dgram UDP Magic Packet across all subnet broadcast addresses
 */
export function sendMagicPacket(mac, options = {}) {
  return new Promise((resolve, reject) => {
    let packet;
    try {
      packet = buildMagicPacket(mac);
    } catch (err) {
      logEvent('ERROR', `WoL build error: ${err.message}`);
      return reject(err);
    }

    const port = options.port || 9;
    const socket = dgram.createSocket('udp4');

    socket.on('error', (err) => {
      logEvent('ERROR', `WoL socket failure: ${err.message}`);
      try { socket.close(); } catch {}
      reject(err);
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);

        const broadcastTargets = new Set(['255.255.255.255']);
        const ifaces = os.networkInterfaces();

        for (const name of Object.keys(ifaces)) {
          for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && iface.netmask) {
              const bcast = calculateBroadcastAddress(iface.address, iface.netmask);
              if (bcast) broadcastTargets.add(bcast);
            }
          }
        }

        const targets = Array.from(broadcastTargets);
        let sent = 0;
        let errors = [];

        targets.forEach((target) => {
          socket.send(packet, 0, packet.length, port, target, (err) => {
            if (err) {
              errors.push(`${target}: ${err.message}`);
            }
            sent++;
            if (sent === targets.length) {
              try { socket.close(); } catch {}
              logEvent('COMMAND', `WoL magic packet broadcasted for MAC: ${mac} to ${targets.length} targets`);
              resolve({
                success: true,
                message: `Magic packet broadcasted to ${mac}`,
                mac,
                broadcasts: targets,
                warnings: errors.length > 0 ? errors : undefined,
              });
            }
          });
        });
      } catch (err) {
        try { socket.close(); } catch {}
        logEvent('ERROR', `WoL broadcast error: ${err.message}`);
        reject(err);
      }
    });
  });
}

/**
 * Gets local active MAC address and interface via Node networkInterfaces
 */
export function getLocalAdapterFallback() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return {
          interface: name,
          mac: iface.mac.toUpperCase(),
        };
      }
    }
  }
  return { interface: 'Unknown', mac: '' };
}

/**
 * Queries active network adapter MAC and OS WoL configuration state
 */
export function getWolStatus() {
  return new Promise((resolve) => {
    const fallback = getLocalAdapterFallback();

    if (!IS_WIN) {
      // Linux: query ethtool and /sys/class/net
      const iface = fallback.interface !== 'Unknown' ? fallback.interface : 'eth0';
      exec(`ethtool ${iface} 2>/dev/null`, (err, stdout) => {
        const out = stdout || '';
        const supportsMatch = out.match(/Supports Wake-on:\s*([^\r\n]+)/i);
        const wakeMatch = out.match(/Wake-on:\s*([^\r\n]+)/i);

        const supported = supportsMatch ? supportsMatch[1].includes('g') : true;
        const enabled = wakeMatch ? wakeMatch[1].includes('g') : false;

        resolve({
          supported,
          enabled,
          fastStartupBlocking: false,
          mac: fallback.mac,
          interface: iface,
        });
      });
      return;
    }

    // Windows: Check Get-NetAdapter, Get-NetAdapterAdvancedProperty and HiberbootEnabled
    const psCmd = `
      $ErrorActionPreference = 'SilentlyContinue'
      $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Virtual -eq $false } | Select-Object -First 1 Name, InterfaceDescription, MacAddress
      $ifName = if ($adapter) { $adapter.Name } else { '' }
      $mac = if ($adapter) { $adapter.MacAddress } else { '' }
      
      $adv = if ($ifName) { Get-NetAdapterAdvancedProperty -Name $ifName | Where-Object { $_.DisplayName -match 'Wake on' -or $_.DisplayName -match 'WOL' } } else { @() }
      $magicProp = $adv | Where-Object { $_.DisplayName -match 'Magic' } | Select-Object -First 1
      $enabled = if ($magicProp) { $magicProp.DisplayValue -match 'Enabled' } else { $true }
      
      $hiber = (Get-ItemPropertyValue -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -ErrorAction SilentlyContinue)
      $fastStartup = ($hiber -eq 1)

      [PSCustomObject]@{
        interface = $ifName
        mac = $mac
        supported = ($adv.Count -gt 0 -or $adapter -ne $null)
        enabled = [bool]$enabled
        fastStartupBlocking = [bool]$fastStartup
      } | ConvertTo-Json -Compress
    `.replace(/\r?\n\s*/g, ' ');

    exec(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve({
          supported: true,
          enabled: true,
          fastStartupBlocking: false,
          mac: fallback.mac,
          interface: fallback.interface,
        });
      }

      try {
        const data = JSON.parse(stdout.trim());
        resolve({
          supported: Boolean(data.supported),
          enabled: Boolean(data.enabled),
          fastStartupBlocking: Boolean(data.fastStartupBlocking),
          mac: (data.mac || fallback.mac || '').replace(/-/g, ':').toUpperCase(),
          interface: data.interface || fallback.interface,
        });
      } catch {
        resolve({
          supported: true,
          enabled: true,
          fastStartupBlocking: false,
          mac: fallback.mac,
          interface: fallback.interface,
        });
      }
    });
  });
}

/**
 * Enables Wake-on-LAN on active network adapter
 */
export function enableWol() {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      const fallback = getLocalAdapterFallback();
      const iface = fallback.interface !== 'Unknown' ? fallback.interface : 'eth0';
      exec(`ethtool -s ${iface} wol g 2>/dev/null`, (err) => {
        if (err) {
          logEvent('WARN', `Linux ethtool enable WoL error: ${err.message}`);
          return resolve({ success: false, message: `Failed enabling WoL: ${err.message}` });
        }
        logEvent('COMMAND', `Enabled WoL on ${iface}`);
        resolve({ success: true, message: `Wake-on-LAN enabled on ${iface}` });
      });
      return;
    }

    const psCmd = `
      $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Virtual -eq $false } | Select-Object -First 1 Name
      if ($adapter) {
        Set-NetAdapterPowerManagement -Name $adapter.Name -WakeOnMagicPacket Enabled -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -DisplayName 'Wake on Magic Packet' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -DisplayName 'Shutdown Wake-On-Lan' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
      }
    `.replace(/\r?\n\s*/g, ' ');

    exec(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 6000 }, (err) => {
      if (err) {
        logEvent('WARN', `Windows enable WoL error: ${err.message}`);
        return resolve({ success: false, message: `Failed configuring WoL: ${err.message}` });
      }
      logEvent('COMMAND', 'Enabled WakeOnMagicPacket on active Windows adapter');
      resolve({ success: true, message: 'Wake-on-LAN (Wake on Magic Packet) enabled on network adapter' });
    });
  });
}
