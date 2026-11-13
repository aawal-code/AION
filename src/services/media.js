/**
 * Cross-Platform Media Session & Audio Service
 * Provides Now Playing telemetry and Master Volume / Mute / Deafen controls
 * Windows: WinRT GlobalSystemMediaTransportControlsSessionManager & CoreAudio
 * Linux: playerctl (MPRIS) & pactl / amixer
 */

import os from 'os';
import { spawn } from 'child_process';

const IS_WINDOWS = os.platform() === 'win32';
const IS_LINUX = os.platform() === 'linux';

// In-memory audio state tracking
let deafenedState = false;
let preDeafenSpeakerMute = false;
let preDeafenMicMute = false;

// Media status caching (TTL 1200ms) to avoid over-invoking PowerShell
let cachedStatus = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 1200;

// Thumbnail / Artwork in-memory cache keyed by 'title|artist'
const artworkCache = new Map();

// C# CoreAudio Definitions for Windows
const CS_AUDIO_CODE = `
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
    int VolumeStepUp(ref Guid pguidEventContext);
    int VolumeStepDown(ref Guid pguidEventContext);
    int QueryHardwareSupport(out uint pdwHardwareSupportMask);
    int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    [PreserveSig]
    int Activate([In, MarshalAs(UnmanagedType.LPStruct)] Guid iid, [In] int dwClsCtx, [In] IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    int GetState(out int pdwState);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    [PreserveSig]
    int GetDefaultAudioEndpoint([In] int dataFlow, [In] int role, out IMMDevice ppEndpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

public class AudioController {
    private static Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    private static IAudioEndpointVolume GetEndpointVolume(int dataFlow) {
        try {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice dev;
            int hr = enumerator.GetDefaultAudioEndpoint(dataFlow, 1, out dev);
            if (hr != 0 || dev == null) return null;
            object aev;
            hr = dev.Activate(IID_IAudioEndpointVolume, 23, IntPtr.Zero, out aev);
            if (hr != 0 || aev == null) return null;
            return (IAudioEndpointVolume)aev;
        } catch { return null; }
    }

    public static float GetMasterVolume() {
        var ep = GetEndpointVolume(0);
        if (ep == null) return 0f;
        float v;
        ep.GetMasterVolumeLevelScalar(out v);
        return (float)Math.Round(v * 100f);
    }

    public static void SetMasterVolume(float val) {
        var ep = GetEndpointVolume(0);
        if (ep == null) return;
        Guid g = Guid.Empty;
        ep.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, val / 100f)), ref g);
    }

    public static bool GetMasterMuted() {
        var ep = GetEndpointVolume(0);
        if (ep == null) return false;
        bool m;
        ep.GetMute(out m);
        return m;
    }

    public static void SetMasterMuted(bool mute) {
        var ep = GetEndpointVolume(0);
        if (ep == null) return;
        Guid g = Guid.Empty;
        ep.SetMute(mute, ref g);
    }

    public static bool GetMicMuted() {
        try {
            var ep = GetEndpointVolume(1);
            if (ep == null) return false;
            bool m;
            ep.GetMute(out m);
            return m;
        } catch { return false; }
    }

    public static void SetMicMuted(bool mute) {
        try {
            var ep = GetEndpointVolume(1);
            if (ep == null) return;
            Guid g = Guid.Empty;
            ep.SetMute(mute, ref g);
        } catch {}
    }
}
public class MediaFallbackKey {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    public static void SendMediaKey(byte vk) {
        keybd_event(vk, 0, 0, 0);
        keybd_event(vk, 0, 2, 0);
    }
}
`;

function runProcess(cmd, args, timeoutMs = 4500) {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve({ stdout, stderr, code: -1 });
      }, timeoutMs);

      child.stdout?.on('data', (d) => { stdout += d; });
      child.stderr?.on('data', (d) => { stderr += d; });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, code: -1 });
      });
    } catch (err) {
      resolve({ stdout: '', stderr: err.message, code: -1 });
    }
  });
}

/**
 * Normalizes raw media status output into strict standard object
 */
export function parseMediaStatusOutput(data) {
  if (!data || typeof data !== 'object') {
    return {
      playing: false,
      title: '',
      artist: '',
      sourceApp: '',
      artwork: '',
      volume: 50,
      muted: false,
      deafened: false,
    };
  }

  const vol = Math.max(0, Math.min(100, Math.round(Number(data.volume) || 0)));
  const title = String(data.title || '').trim();
  const artist = String(data.artist || '').trim();
  const cacheKey = `${title}|${artist}`;

  let artwork = String(data.artwork || '').trim();
  if (artwork) {
    artworkCache.set(cacheKey, artwork);
  } else if (title && artworkCache.has(cacheKey)) {
    artwork = artworkCache.get(cacheKey);
  }

  return {
    playing: Boolean(data.playing),
    title,
    artist,
    sourceApp: String(data.sourceApp || '').trim(),
    artwork,
    volume: Number.isNaN(vol) ? 50 : vol,
    muted: Boolean(data.muted),
    deafened: Boolean(deafenedState),
  };
}

/**
 * Windows Media & Audio Query implementation
 */
async function queryWindowsMediaStatus() {
  const psScript = `
$audioCode = @'
${CS_AUDIO_CODE}
'@

Add-Type -TypeDefinition $audioCode -Language CSharp
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1

function Await-WinRT($asyncOp, $type) {
  $asTask = $asTaskGeneric.MakeGenericMethod($type)
  $netTask = $asTask.Invoke($null, @($asyncOp))
  $netTask.Wait(2000) | Out-Null
  return $netTask.Result
}

$playing = $false
$title = ""
$artist = ""
$sourceApp = ""
$artwork = ""

try {
  $managerOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  $manager = Await-WinRT $managerOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $session = $manager.GetCurrentSession()
  if ($session) {
    $sourceApp = $session.SourceAppUserModelId
    $info = $session.GetPlaybackInfo()
    $playing = ($info.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing)
    $propsOp = $session.TryGetMediaPropertiesAsync()
    $props = Await-WinRT $propsOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if ($props) {
      $title = $props.Title
      $artist = $props.Artist
      if ($props.Thumbnail) {
        try {
          $thumbOp = $props.Thumbnail.OpenReadAsync()
          $stream = Await-WinRT $thumbOp ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
          if ($stream -and $stream.Size -gt 0 -and $stream.Size -lt 2097152) {
            $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
            $ms = New-Object System.IO.MemoryStream
            $netStream.CopyTo($ms)
            $bytes = $ms.ToArray()
            $ms.Dispose()
            $netStream.Dispose()
            if ($bytes.Length -gt 0) {
              $b64 = [Convert]::ToBase64String($bytes)
              $mime = "image/jpeg"
              try { if ($stream.ContentType) { $mime = $stream.ContentType } } catch {}
              $artwork = "data:$mime;base64,$b64"
            }
          }
        } catch {}
      }
    }
  }
} catch {}

$vol = [AudioController]::GetMasterVolume()
$muted = [AudioController]::GetMasterMuted()
$micMuted = [AudioController]::GetMicMuted()

$outObj = @{
  playing = $playing
  title = $title
  artist = $artist
  sourceApp = $sourceApp
  artwork = $artwork
  volume = $vol
  muted = $muted
  micMuted = $micMuted
}

Write-Output (ConvertTo-Json $outObj)
`;

  const { stdout } = await runProcess('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    psScript,
  ]);

  try {
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
      return parseMediaStatusOutput(parsed);
    }
  } catch {}

  return parseMediaStatusOutput(null);
}

/**
 * Linux Media & Audio Query implementation
 */
async function queryLinuxMediaStatus() {
  let playing = false;
  let title = '';
  let artist = '';
  let sourceApp = '';
  let volume = 50;
  let muted = false;

  // 1. Media metadata via playerctl
  try {
    const statusRes = await runProcess('playerctl', ['status']);
    playing = statusRes.stdout.trim().toLowerCase() === 'playing';

    const metaRes = await runProcess('playerctl', ['metadata', '--format', '{{title}}:::{{artist}}:::{{playerName}}']);
    const parts = metaRes.stdout.trim().split(':::');
    if (parts.length >= 1) title = parts[0] || '';
    if (parts.length >= 2) artist = parts[1] || '';
    if (parts.length >= 3) sourceApp = parts[2] || '';
  } catch {}

  // 2. Volume & Mute via pactl
  try {
    const pactlVol = await runProcess('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    const match = pactlVol.stdout.match(/(\d+)%/);
    if (match) volume = parseInt(match[1], 10);

    const pactlMute = await runProcess('pactl', ['get-sink-mute', '@DEFAULT_SINK@']);
    muted = pactlMute.stdout.toLowerCase().includes('yes');
  } catch {
    // Fallback amixer
    try {
      const amixer = await runProcess('amixer', ['sget', 'Master']);
      const match = amixer.stdout.match(/\[(\d+)%\]/);
      if (match) volume = parseInt(match[1], 10);
      muted = amixer.stdout.includes('[off]');
    } catch {}
  }

  return parseMediaStatusOutput({ playing, title, artist, sourceApp, volume, muted });
}

/**
 * Retrieves the current media playback metadata and master volume status
 */
export async function getMediaStatus(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cachedStatus && (now - lastFetchTime) < CACHE_TTL_MS) {
    return { ...cachedStatus, deafened: deafenedState };
  }

  let status;
  if (IS_WINDOWS) {
    status = await queryWindowsMediaStatus();
  } else if (IS_LINUX) {
    status = await queryLinuxMediaStatus();
  } else {
    // Clean mock for tests / unsupported platforms
    status = parseMediaStatusOutput({
      playing: false,
      title: 'Mock Track',
      artist: 'AION Audio',
      sourceApp: 'Player',
      volume: 65,
      muted: false,
    });
  }

  cachedStatus = status;
  lastFetchTime = now;
  return { ...status, deafened: deafenedState };
}

/**
 * Windows Media Control execution
 */
async function executeWindowsControl(action, value) {
  let psScript = `
$audioCode = @'
${CS_AUDIO_CODE}
'@

Add-Type -TypeDefinition $audioCode -Language CSharp
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1

function Await-WinRT($asyncOp, $type) {
  $asTask = $asTaskGeneric.MakeGenericMethod($type)
  $netTask = $asTask.Invoke($null, @($asyncOp))
  $netTask.Wait(2000) | Out-Null
  return $netTask.Result
}
`;

  if (action === 'play_pause') {
    psScript += `
$mgrOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$mgr = Await-WinRT $mgrOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $mgr.GetCurrentSession()
$success = $false
if ($session) {
  try {
    $op = $session.TryTogglePlayPauseAsync()
    $success = Await-WinRT $op ([System.Boolean])
  } catch {}
}
if (-not $success) {
  [MediaFallbackKey]::SendMediaKey(179)
}
`;
  } else if (action === 'next') {
    psScript += `
$mgrOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$mgr = Await-WinRT $mgrOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $mgr.GetCurrentSession()
$success = $false
if ($session) {
  try {
    $op = $session.TrySkipNextAsync()
    $success = Await-WinRT $op ([System.Boolean])
  } catch {}
}
if (-not $success) {
  [MediaFallbackKey]::SendMediaKey(176)
}
`;
  } else if (action === 'prev') {
    psScript += `
$mgrOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$mgr = Await-WinRT $mgrOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $mgr.GetCurrentSession()
$success = $false
if ($session) {
  try {
    $op = $session.TrySkipPreviousAsync()
    $success = Await-WinRT $op ([System.Boolean])
  } catch {}
}
if (-not $success) {
  [MediaFallbackKey]::SendMediaKey(177)
}
`;
  } else if (action === 'volume') {
    const val = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    psScript += `[AudioController]::SetMasterVolume(${val})\n`;
  } else if (action === 'mute') {
    const muteBool = (value !== undefined) ? (value ? '$true' : '$false') : '(-not [AudioController]::GetMasterMuted())';
    psScript += `[AudioController]::SetMasterMuted(${muteBool})\n`;
  } else if (action === 'deafen') {
    const deafBool = (value !== undefined) ? (value ? '$true' : '$false') : '$true';
    psScript += `
[AudioController]::SetMasterMuted(${deafBool})
[AudioController]::SetMicMuted(${deafBool})
`;
  }

  await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
}

/**
 * Linux Media Control execution
 */
async function executeLinuxControl(action, value) {
  if (action === 'play_pause') {
    await runProcess('playerctl', ['play-pause']);
  } else if (action === 'next') {
    await runProcess('playerctl', ['next']);
  } else if (action === 'prev') {
    await runProcess('playerctl', ['previous']);
  } else if (action === 'volume') {
    const val = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    await runProcess('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${val}%`]);
  } else if (action === 'mute') {
    const targetMute = value !== undefined ? (value ? '1' : '0') : 'toggle';
    await runProcess('pactl', ['set-sink-mute', '@DEFAULT_SINK@', targetMute]);
  } else if (action === 'deafen') {
    const targetDeaf = value !== undefined ? (value ? '1' : '0') : '1';
    await runProcess('pactl', ['set-sink-mute', '@DEFAULT_SINK@', targetDeaf]);
    await runProcess('pactl', ['set-source-mute', '@DEFAULT_SOURCE@', targetDeaf]);
  }
}

/**
 * Master Control Action Dispatcher
 */
export async function controlMedia(action, value) {
  // 1. Deafen state tracking
  if (action === 'deafen') {
    const targetDeaf = (value !== undefined) ? Boolean(value) : !deafenedState;
    if (targetDeaf) {
      preDeafenSpeakerMute = cachedStatus?.muted || false;
      deafenedState = true;
    } else {
      deafenedState = false;
    }

    if (IS_WINDOWS) {
      await executeWindowsControl('deafen', targetDeaf);
    } else if (IS_LINUX) {
      await executeLinuxControl('deafen', targetDeaf);
    }

    if (cachedStatus) {
      cachedStatus.muted = targetDeaf;
      cachedStatus.deafened = targetDeaf;
    }
    lastFetchTime = 0;
    return getMediaStatus(true);
  }

  // 2. If unmuting speaker while deafened, also clear deafened state
  if (action === 'mute') {
    let targetMute;
    if (value !== undefined) {
      targetMute = Boolean(value);
    } else {
      targetMute = !(cachedStatus?.muted || false);
    }

    if (!targetMute && deafenedState) {
      deafenedState = false;
      // also unmute mic on Windows/Linux
      if (IS_WINDOWS) {
        await runProcess('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -TypeDefinition @"\n${CS_AUDIO_CODE}\n"@\n[AudioController]::SetMicMuted($false)`,
        ]);
      } else if (IS_LINUX) {
        await runProcess('pactl', ['set-source-mute', '@DEFAULT_SOURCE@', '0']);
      }
    }

    if (IS_WINDOWS) {
      await executeWindowsControl('mute', targetMute);
    } else if (IS_LINUX) {
      await executeLinuxControl('mute', targetMute);
    }

    if (cachedStatus) {
      cachedStatus.muted = targetMute;
      cachedStatus.deafened = deafenedState;
    }
    lastFetchTime = 0;
    return getMediaStatus(true);
  }

  // 3. Volume
  if (action === 'volume') {
    const val = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    if (IS_WINDOWS) {
      await executeWindowsControl('volume', val);
    } else if (IS_LINUX) {
      await executeLinuxControl('volume', val);
    }
    if (cachedStatus) {
      cachedStatus.volume = val;
    }
    lastFetchTime = 0;
    return getMediaStatus(true);
  }

  // 4. Playback actions (play_pause, next, prev)
  if (IS_WINDOWS) {
    await executeWindowsControl(action, value);
  } else if (IS_LINUX) {
    await executeLinuxControl(action, value);
  }

  // Optimistically toggle playing state if play_pause
  if (action === 'play_pause' && cachedStatus) {
    cachedStatus.playing = !cachedStatus.playing;
  }

  // Invalidate cache so fresh poll happens
  lastFetchTime = 0;
  return getMediaStatus(true);
}

// Reset state helper for test suites
export function _resetMediaStateForTests() {
  deafenedState = false;
  preDeafenSpeakerMute = false;
  preDeafenMicMute = false;
  cachedStatus = null;
  lastFetchTime = 0;
}
