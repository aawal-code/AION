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
  const muteBtn = document.getElementById('btnMediaMute');
  const muteLabel = document.getElementById('mediaMuteLabel');
  const deafenBtn = document.getElementById('btnMediaDeafen');
  const deafenLabel = document.getElementById('mediaDeafenLabel');

  const hasMedia = Boolean(currentMedia.title || currentMedia.artist);

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
  const artworkImg = document.getElementById('mediaArtworkImg');
  const artworkFallback = document.getElementById('mediaArtworkFallback');

  if (artworkBox) {
    artworkBox.classList.toggle('playing', currentMedia.playing);
  }

  if (currentMedia.artwork && artworkImg) {
    if (artworkImg.src !== currentMedia.artwork) {
      artworkImg.src = currentMedia.artwork;
    }
    artworkImg.style.display = 'block';
    if (artworkFallback) artworkFallback.style.display = 'none';
  } else {
    if (artworkImg) artworkImg.style.display = 'none';
    if (artworkFallback) artworkFallback.style.display = 'block';
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
  const muteBtn = document.getElementById('btnMediaMute');
  const deafenBtn = document.getElementById('btnMediaDeafen');

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
