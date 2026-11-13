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
 * Inspects strictly physical Ethernet/Wi-Fi adapters (excluding virtual, tailscale, bluetooth)
 * Checks:
 * (a) Get-NetAdapterPowerManagement WakeOnMagicPacket == 'Enabled'
 * (b) Get-NetAdapterAdvancedProperty '*WakeOnMagicPacket' enabled
 * (c) Windows Fast Startup registry HiberbootEnabled == 0
 */
export function getWolStatus() {
  return new Promise((resolve) => {
    const fallback = getLocalAdapterFallback();

    if (!IS_WIN) {
      const iface = fallback.interface !== 'Unknown' ? fallback.interface : 'eth0';
      exec(`ethtool ${iface} 2>/dev/null`, (err, stdout) => {
        const out = stdout || '';
        const supportsMatch = out.match(/Supports Wake-on:\s*([^\r\n]+)/i);
        const wakeMatch = out.match(/Wake-on:\s*([^\r\n]+)/i);

        const supported = supportsMatch ? supportsMatch[1].includes('g') : true;
        const enabled = wakeMatch ? wakeMatch[1].includes('g') : false;
        const state = enabled ? 'os_ready' : 'disabled';

        resolve({
          supported,
          enabled,
          fastStartupBlocking: false,
          state,
          mac: fallback.mac,
          interface: iface,
        });
      });
      return;
    }

    const psCmd = `
      $ErrorActionPreference = 'SilentlyContinue'
      $adapters = Get-NetAdapter | Where-Object {
        $_.Virtual -eq $false -and
        $_.Status -eq 'Up' -and
        $_.InterfaceDescription -notmatch 'Tailscale|Loopback|Bluetooth|Virtual|Hyper-V|vEthernet|TAP|Npcap'
      }
      $adapter = $adapters | Select-Object -First 1
      if (-not $adapter) {
        $adapter = Get-NetAdapter | Where-Object {
          $_.Virtual -eq $false -and
          $_.InterfaceDescription -notmatch 'Tailscale|Loopback|Bluetooth|Virtual|Hyper-V|vEthernet|TAP|Npcap'
        } | Select-Object -First 1
      }

      $ifName = if ($adapter) { $adapter.Name } else { '' }
      $mac = if ($adapter) { $adapter.MacAddress } else { '' }

      $pmEnabled = $false
      if ($ifName) {
        $pm = Get-NetAdapterPowerManagement -Name $ifName -ErrorAction SilentlyContinue
        if ($pm -and $pm.WakeOnMagicPacket -match 'Enabled') {
          $pmEnabled = $true
        }
      }

      $advEnabled = $false
      $supported = $false
      if ($ifName) {
        $adv = Get-NetAdapterAdvancedProperty -Name $ifName -ErrorAction SilentlyContinue
        if ($adv) {
          $supported = ($adv | Where-Object { $_.DisplayName -match 'Wake on' -or $_.RegistryKeyword -match 'Wake' }).Count -gt 0
          $magic = $adv | Where-Object { $_.RegistryKeyword -match 'WakeOnMagicPacket' -or $_.DisplayName -match 'Magic' } | Select-Object -First 1
          if ($magic) {
            if ($magic.DisplayValue -match 'Enabled' -or $magic.RegistryValue -contains 1) {
              $advEnabled = $true
            }
          }
        }
      }

      $nicEnabled = ($pmEnabled -or $advEnabled)
      $hiber = (Get-ItemPropertyValue -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -ErrorAction SilentlyContinue)
      $fastStartupBlocking = ($hiber -eq 1)

      $state = 'disabled'
      if ($nicEnabled) {
        if ($fastStartupBlocking) {
          $state = 'fast_startup_blocked'
        } else {
          $state = 'os_ready'
        }
      }

      [PSCustomObject]@{
        interface = $ifName
        mac = $mac
        supported = [bool]($supported -or ($adapter -ne $null))
        enabled = [bool]$nicEnabled
        fastStartupBlocking = [bool]$fastStartupBlocking
        state = $state
      } | ConvertTo-Json -Compress
    `.replace(/\r?\n\s*/g, ' ');

    exec(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve({
          supported: true,
          enabled: true,
          fastStartupBlocking: false,
          state: 'os_ready',
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
          state: data.state || (data.enabled ? 'os_ready' : 'disabled'),
          mac: (data.mac || fallback.mac || '').replace(/-/g, ':').toUpperCase(),
          interface: data.interface || fallback.interface,
        });
      } catch {
        resolve({
          supported: true,
          enabled: true,
          fastStartupBlocking: false,
          state: 'os_ready',
          mac: fallback.mac,
          interface: fallback.interface,
        });
      }
    });
  });
}

/**
 * 1-Click Fix: Enables Wake-on-LAN on physical network adapter and disables Windows Fast Startup
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
      $ErrorActionPreference = 'SilentlyContinue'
      $adapters = Get-NetAdapter | Where-Object {
        $_.Virtual -eq $false -and
        $_.InterfaceDescription -notmatch 'Tailscale|Loopback|Bluetooth|Virtual|Hyper-V|vEthernet|TAP|Npcap'
      }
      $adapter = $adapters | Select-Object -First 1

      if ($adapter) {
        Set-NetAdapterPowerManagement -Name $adapter.Name -WakeOnMagicPacket Enabled -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -RegistryKeyword '*WakeOnMagicPacket' -RegistryValue '1' -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -DisplayName 'Wake on Magic Packet' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -DisplayName 'Shutdown Wake-On-Lan' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -RegistryKeyword 'S5WakeOnLan' -RegistryValue '1' -ErrorAction SilentlyContinue
        Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -Value 0 -Type DWord -ErrorAction SilentlyContinue
      }
    `.replace(/\r?\n\s*/g, ' ');

    exec(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 8000 }, (err) => {
      if (err) {
        logEvent('WARN', `Windows enable WoL error: ${err.message}`);
        return resolve({ success: false, message: `Failed configuring WoL: ${err.message}` });
      }
      logEvent('COMMAND', 'Enabled WakeOnMagicPacket and disabled Fast Startup on Windows');
      resolve({
        success: true,
        message: 'Wake-on-LAN enabled on adapter and Windows Fast Startup disabled',
      });
    });
  });
}
