/**
 * AION Live Media & Audio Deck Controller
 * Apple Control Center style Now Playing & Master Volume / Mute / Deafen
 */

import { t } from './i18n.js';
import { getSvgIcon } from './icons.js';
import { showToast } from './app.js';
import { addActivity } from './state.js';

let currentMedia = {
  playing: false,
  title: '',
  artist: '',
  sourceApp: '',
  volume: 50,
  muted: false,
  deafened: false,
};

let isDraggingVolume = false;

// ==========================================================================
// Silent Data Fetching (Never spam toasts on periodic background polls)
// ==========================================================================

export async function fetchMediaStatus() {
  try {
    const res = await fetch('/api/media/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok') {
      currentMedia = {
        playing: Boolean(data.playing),
        title: data.title || '',
        artist: data.artist || '',
        sourceApp: data.sourceApp || '',
        artwork: data.artwork || '',
        volume: Number.isFinite(data.volume) ? data.volume : 50,
        muted: Boolean(data.muted),
        deafened: Boolean(data.deafened),
      };
      renderMediaDeck();
    }
  } catch (err) {
    console.debug('[AION Media] Silent background refresh error:', err.message);
  }
}

// ==========================================================================
// Control Action Execution
// ==========================================================================

export async function executeMediaControl(action, value) {
  // Optimistic UI updates
  if (action === 'play_pause') {
    currentMedia.playing = !currentMedia.playing;
    renderMediaDeck();
  } else if (action === 'volume' && value !== undefined) {
    currentMedia.volume = Math.round(Number(value));
    renderMediaDeck();
  } else if (action === 'mute') {
    currentMedia.muted = !currentMedia.muted;
    if (!currentMedia.muted) currentMedia.deafened = false;
    renderMediaDeck();
  } else if (action === 'deafen') {
    currentMedia.deafened = !currentMedia.deafened;
    currentMedia.muted = currentMedia.deafened;
    renderMediaDeck();
  }

  try {
    const res = await fetch('/api/media/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, value }),
    });

    const data = await res.json();
    if (res.ok && data.status === 'ok') {
      currentMedia = {
        playing: Boolean(data.playing),
        title: data.title || '',
        artist: data.artist || '',
        sourceApp: data.sourceApp || '',
        artwork: data.artwork || currentMedia.artwork || '',
        volume: Number.isFinite(data.volume) ? data.volume : currentMedia.volume,
        muted: Boolean(data.muted),
        deafened: Boolean(data.deafened),
      };
      renderMediaDeck();

      // Explicit activity feed logging for major audio actions
      if (action === 'deafen') {
        const title = currentMedia.deafened ? t('mediaDeafened') : t('mediaDeafen');
        const desc = currentMedia.deafened ? 'Audio output and microphone muted' : 'Audio and microphone restored';
        showToast(title, 'deafen');
        addActivity(title, desc, 'deafen');
      } else if (action === 'mute') {
        const title = currentMedia.muted ? t('mediaMuted') : t('mediaMute');
        showToast(title, currentMedia.muted ? 'volumeMute' : 'volume');
      }
    } else {
      showToast(data.error || 'Media control failed', 'close');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'close');
  }
}

// ==========================================================================
// Ambient Artwork Glow & Color Extraction (True Spotify-Style)
// ==========================================================================

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Samples 3-4 saturated dominant colors from artwork using an offscreen 16x16 canvas.
 * Boosts saturation on dark/muted covers (e.g. Travis Scott's Utopia) to produce rich
 * warm amber, bronze, and crimson tones instead of muddy gray.
 */
export function sampleDominantColors(imgEl) {
  if (!imgEl) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(imgEl, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;

    let totalR = 0, totalG = 0, totalB = 0, count = 0;
    let maxSaturation = 0;
    const pixels = [];

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 128) continue;

      const hsl = rgbToHsl(r, g, b);
      pixels.push({ r, g, b, h: hsl.h, s: hsl.s, l: hsl.l });
      totalR += r;
      totalG += g;
      totalB += b;
      count++;
      if (hsl.s > maxSaturation) maxSaturation = hsl.s;
    }

    if (count === 0) return null;

    const avgR = totalR / count;
    const avgG = totalG / count;
    const avgB = totalB / count;
    const isDarkOrMuted = maxSaturation < 0.28 || (avgR + avgG + avgB) / 3 < 55;

    // Travis Scott's Utopia / dark muted album detection:
    // If the cover is dark or muted, boost saturation and produce rich warm amber/bronze/crimson tones
    if (isDarkOrMuted) {
      const warmBias = avgR >= avgB;
      if (warmBias) {
        return [
          'rgb(245, 158, 11)',  // Rich Warm Amber
          'rgb(194, 65, 12)',   // Warm Deep Bronze
          'rgb(220, 38, 38)',   // Rich Crimson
        ];
      } else {
        return [
          'rgb(14, 165, 233)',  // Electric Cyan
          'rgb(99, 102, 241)',  // Indigo / Violet
          'rgb(236, 72, 153)',  // Neon Magenta
        ];
      }
    }

    // For colorful covers, boost saturation and normalize lightness
    const boostedCandidates = [];
    for (const p of pixels) {
      if (p.l < 0.08 || p.l > 0.94) continue;

      // Boost saturation significantly so orbs are rich and punchy
      const boostedS = Math.min(1.0, Math.max(0.70, p.s * 1.5 + 0.25));
      const boostedL = Math.max(0.38, Math.min(0.60, p.l < 0.35 ? p.l + 0.18 : p.l));
      const rgb = hslToRgb(p.h, boostedS, boostedL);

      const score = p.s * 2.0 + (1 - Math.abs(p.l - 0.5));
      boostedCandidates.push({ ...rgb, h: p.h, s: boostedS, l: boostedL, score });
    }

    boostedCandidates.sort((a, b) => b.score - a.score);

    const picked = [];
    for (const c of boostedCandidates) {
      const isDistinct = picked.every((p) => {
        const hueDiff = Math.min(Math.abs(c.h - p.h), 360 - Math.abs(c.h - p.h));
        const colorDist = Math.hypot(c.r - p.r, c.g - p.g, c.b - p.b);
        return hueDiff > 35 || colorDist > 55;
      });
      if (isDistinct) {
        picked.push(c);
        if (picked.length === 3) break;
      }
    }

    if (picked.length >= 3) {
      return picked.map((c) => `rgb(${c.r}, ${c.g}, ${c.b})`);
    } else if (picked.length === 2) {
      const c1 = picked[0];
      const c2 = picked[1];
      const h3 = (c1.h + 60) % 360;
      const rgb3 = hslToRgb(h3, 0.85, 0.48);
      return [
        `rgb(${c1.r}, ${c1.g}, ${c1.b})`,
        `rgb(${c2.r}, ${c2.g}, ${c2.b})`,
        `rgb(${rgb3.r}, ${rgb3.g}, ${rgb3.b})`,
      ];
    } else if (picked.length === 1) {
      const c = picked[0];
      const c2 = hslToRgb((c.h + 40) % 360, 0.85, 0.48);
      const c3 = hslToRgb((c.h + 80) % 360, 0.85, 0.48);
      return [
        `rgb(${c.r}, ${c.g}, ${c.b})`,
        `rgb(${c2.r}, ${c2.g}, ${c2.b})`,
        `rgb(${c3.r}, ${c3.g}, ${c3.b})`,
      ];
    } else {
      return [
        'rgb(245, 158, 11)',
        'rgb(194, 65, 12)',
        'rgb(220, 38, 38)',
      ];
    }
  } catch (err) {
    console.debug('[Media] Dominant color extraction error:', err.message);
  }
  return null;
}

/**
 * Applies fluid multi-orb ambient glow colors directly inside .media-deck-card.
 * Cleans any legacy styling off #mediaDeckSection so it remains a pure clean header.
 */
export function updateMediaAmbientGlow(artworkImg, artworkSrc) {
  const card = document.querySelector('.media-deck-card');
  const mediaSection = document.getElementById('mediaDeckSection');

  // Ensure #mediaDeckSection is purely a clean section header with zero outer box
  if (mediaSection) {
    mediaSection.classList.remove('has-ambient-art');
    mediaSection.style.removeProperty('--media-glow-1');
    mediaSection.style.removeProperty('--media-glow-2');
    mediaSection.style.removeProperty('--media-glow-3');
  }

  if (!card) return;

  if (!artworkSrc) {
    card.classList.remove('has-ambient-art');
    card.style.removeProperty('--media-glow-1');
    card.style.removeProperty('--media-glow-2');
    card.style.removeProperty('--media-glow-3');
    return;
  }

  const applyColors = () => {
    const colors = sampleDominantColors(artworkImg);
    if (colors && colors.length >= 2) {
      card.style.setProperty('--media-glow-1', colors[0]);
      card.style.setProperty('--media-glow-2', colors[1]);
      card.style.setProperty('--media-glow-3', colors[2] || colors[0]);
      card.classList.add('has-ambient-art');
    } else {
      card.classList.remove('has-ambient-art');
    }
  };

  if (artworkImg && artworkImg.complete && artworkImg.naturalWidth > 0) {
    applyColors();
  } else if (artworkImg) {
    artworkImg.crossOrigin = 'anonymous';
    artworkImg.onload = () => applyColors();
  }
}

// ==========================================================================
// UI Rendering
// ==========================================================================

export function renderMediaDeck() {
  const titleEl = document.getElementById('mediaTrackTitle');
  const artistEl = document.getElementById('mediaTrackArtist');
  const appBadgeEl = document.getElementById('mediaSourceApp');
  const artworkBox = document.getElementById('mediaArtworkBox');
  const playPauseBtn = document.getElementById('btnMediaPlayPause');
  const volumeSlider = document.getElementById('mediaVolumeSlider');
  const volumeLabel = document.getElementById('mediaVolumeLabel');
  const volumeIconBox = document.getElementById('mediaVolumeIconBox');
  const muteBtn = document.getElementById('mediaBtnMute') || document.getElementById('btnMediaMute');
  const muteLabel = document.getElementById('mediaMuteLabel');
  const deafenBtn = document.getElementById('mediaBtnDeafen') || document.getElementById('btnMediaDeafen');
  const deafenLabel = document.getElementById('mediaDeafenLabel');

  const hasMedia = Boolean(currentMedia.title || currentMedia.artist);
  const mediaSection = document.getElementById('mediaDeckSection');

  // Automatically hide #mediaDeckSection when nothing is playing so it doesn't clutter dashboard
  if (mediaSection) {
    mediaSection.style.display = hasMedia ? 'block' : 'none';
  }

  // Track & Artist Metadata
  if (titleEl) {
    titleEl.textContent = hasMedia ? currentMedia.title : t('mediaIdleTitle');
  }

  if (artistEl) {
    artistEl.textContent = hasMedia ? (currentMedia.artist || 'Unknown Artist') : t('mediaIdleDesc');
  }

  if (appBadgeEl) {
    if (hasMedia && currentMedia.sourceApp) {
      // Clean clean app name (e.g. Spotify.exe -> Spotify)
      const cleanApp = currentMedia.sourceApp.replace(/\.exe$/i, '');
      appBadgeEl.textContent = cleanApp;
      appBadgeEl.style.display = 'inline-block';
    } else {
      appBadgeEl.style.display = 'none';
    }
  }

  // Artwork box active glow and cover image rendering
  const artworkImg = document.getElementById('nowPlayingArt') || document.getElementById('mediaArtworkImg');
  const artworkFallback = document.getElementById('mediaArtworkFallback');

  if (artworkBox) {
    artworkBox.classList.toggle('playing', currentMedia.playing);
  }

  if (currentMedia.artwork && artworkImg) {
    artworkImg.crossOrigin = 'anonymous';
    if (artworkImg.src !== currentMedia.artwork) {
      artworkImg.src = currentMedia.artwork;
    }
    artworkImg.style.display = 'block';
    if (artworkFallback) artworkFallback.style.display = 'none';
    updateMediaAmbientGlow(artworkImg, currentMedia.artwork);
  } else {
    if (artworkImg) artworkImg.style.display = 'none';
    if (artworkFallback) artworkFallback.style.display = 'block';
    updateMediaAmbientGlow(null, null);
  }

  // Play / Pause Icon
  if (playPauseBtn) {
    playPauseBtn.innerHTML = currentMedia.playing
      ? getSvgIcon('pause', 'icon-sm')
      : getSvgIcon('play', 'icon-sm');
    playPauseBtn.setAttribute('title', currentMedia.playing ? t('mediaPause') : t('mediaPlay'));
  }

  // Volume Slider & Label
  if (volumeSlider && !isDraggingVolume) {
    volumeSlider.value = currentMedia.volume;
  }

  if (volumeLabel) {
    volumeLabel.textContent = `${currentMedia.volume}%`;
  }

  if (volumeIconBox) {
    volumeIconBox.innerHTML = currentMedia.muted
      ? getSvgIcon('volumeMute', 'icon-sm')
      : getSvgIcon('volume', 'icon-sm');
  }

  // Mute Pill
  if (muteBtn) {
    muteBtn.classList.toggle('active', currentMedia.muted && !currentMedia.deafened);
  }
  if (muteLabel) {
    muteLabel.textContent = currentMedia.muted ? t('mediaMuted') : t('mediaMute');
  }

  // Deafen Pill
  if (deafenBtn) {
    deafenBtn.classList.toggle('active', currentMedia.deafened);
  }
  if (deafenLabel) {
    deafenLabel.textContent = currentMedia.deafened ? t('mediaDeafened') : t('mediaDeafen');
  }
}

// ==========================================================================
// Initialization & Event Wiring
// ==========================================================================

export function initMediaModule() {
  const prevBtn = document.getElementById('btnMediaPrev');
  const playPauseBtn = document.getElementById('btnMediaPlayPause');
  const nextBtn = document.getElementById('btnMediaNext');
  const volumeSlider = document.getElementById('mediaVolumeSlider');
  const muteBtn = document.getElementById('mediaBtnMute') || document.getElementById('btnMediaMute');
  const deafenBtn = document.getElementById('mediaBtnDeafen') || document.getElementById('btnMediaDeafen');

  prevBtn?.addEventListener('click', () => executeMediaControl('prev'));
  playPauseBtn?.addEventListener('click', () => executeMediaControl('play_pause'));
  nextBtn?.addEventListener('click', () => executeMediaControl('next'));

  if (volumeSlider) {
    volumeSlider.addEventListener('mousedown', () => { isDraggingVolume = true; });
    volumeSlider.addEventListener('touchstart', () => { isDraggingVolume = true; }, { passive: true });

    volumeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      const label = document.getElementById('mediaVolumeLabel');
      if (label) label.textContent = `${val}%`;
    });

    const finishVolume = (e) => {
      if (isDraggingVolume) {
        isDraggingVolume = false;
        executeMediaControl('volume', Number(e.target.value));
      }
    };

    volumeSlider.addEventListener('change', finishVolume);
    volumeSlider.addEventListener('mouseup', finishVolume);
    volumeSlider.addEventListener('touchend', finishVolume);
  }

  muteBtn?.addEventListener('click', () => executeMediaControl('mute'));
  deafenBtn?.addEventListener('click', () => executeMediaControl('deafen'));

  // Initial fetch
  fetchMediaStatus();

  // Periodic silent polling
  setInterval(() => {
    fetchMediaStatus();
  }, 4000);

  // Re-render when language changes
  window.addEventListener('aion:languagechange', () => {
    renderMediaDeck();
  });
}
