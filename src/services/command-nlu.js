/**
 * Zero-AI Multilingual Natural Language Understanding (NLU) Command Parser
 * Instant deterministic routing (<5ms) across English, Arabic (العربية), German (Deutsch), and Arabizi (Franco-Arab).
 */

import { executeWorkstationCommand } from './os.js';
import { controlMedia, getMediaStatus } from './media.js';
import { killAppGroup } from './process-manager.js';
import { getScreenSnapshot } from './screen-control.js';
import { exec } from 'child_process';
import { logEvent } from './sse.js';

const IS_WIN = process.platform === 'win32';

export const MULTILINGUAL_APP_MAP = {
  'لوكال سيند': 'localsend',
  'لوكالسيند': 'localsend',
  'كروم': 'chrome',
  'جوجل كروم': 'chrome',
  'سبوتيفاي': 'spotify',
  'ديسكورد': 'discord',
  'فايرفوكس': 'firefox',
  'نوت باد': 'notepad',
  'المفكرة': 'notepad',
  'المفكره': 'notepad',
  'الرسام': 'mspaint',
  'تليجرام': 'telegram',
  'واتساب': 'whatsapp',
  'كود': 'code',
  'في اس كود': 'code',
  'فيس كود': 'code',
};

export function normalizeAppTarget(rawTarget) {
  if (!rawTarget) return '';
  const trimmed = rawTarget.trim().toLowerCase();
  return MULTILINGUAL_APP_MAP[trimmed] || trimmed;
}

/**
 * Normalizes input text across Arabic, Arabizi, German, and English scripts:
 * - Strips leading punctuation and symbols
 * - Normalizes Arabic diacritics, alefs, yehs, and tehs
 * - Collapses repeated characters (e.g. e2feeeel -> e2fel, shhh -> shh)
 * - Collapses spaces
 */
export function normalizeNluText(raw) {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw
    .trim()
    .toLowerCase()
    .replace(/^[!/#.]+\s*/, '')
    .replace(/[.!?,;:]+$/, '');

  // Strip Arabic diacritics / tashkeel
  text = text.replace(/[\u064B-\u065F\u0670]/g, '');

  // Normalize Arabic letters: [إأآا] -> ا, [يى] -> ي, [ة] -> ه, [ؤئ] -> ء
  text = text
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[ؤئ]/g, 'ء');

  // Collapse 3+ identical repeated characters to 2
  text = text.replace(/(.)\1{2,}/g, '$1$1');

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Matches raw prompt against multilingual NLU grammar patterns
 */
export function parseNluCommand(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    return { recognized: false, originalPrompt: rawPrompt };
  }

  const normalized = normalizeNluText(rawPrompt);

  // 1. Close / Terminate Application
  // English: close localsend, kill chrome
  // Arabic: اقفل لوكال سيند, قفل كروم, اغلق كروم
  // German: schließ localsend, beende chrome
  // Arabizi: 2efel localsend, e2fel chrome, eqfel slack
  const killRegex = /^(?:close|kill|terminate|stop|exit|quit|اقفل|قفل|اغلق|طفي|سكر|schlie[ßs]+(?:en)?|beenden?|stoppen?|2efel|2e2fel|e2fel|e2fl|eqfel|iqfil|sakker|skr)\s+(.+)$/iu;
  const killMatch = normalized.match(killRegex);
  if (killMatch) {
    const target = normalizeAppTarget(killMatch[1]);
    return {
      recognized: true,
      action: 'kill_process',
      target,
      originalPrompt: rawPrompt,
      category: 'apps',
    };
  }

  // 2. Open / Launch Application
  // English: open chrome, launch discord
  // Arabic: افتح كروم, شغل لوكال سيند, فتح كروم
  // German: öffne chrome, starte discord
  // Arabizi: afta7 chrome, efta7 discord, shaghal chrome
  const openRegex = /^(?:open|launch|start|run|افتح|شغل|ابدا|فتح|[öo]ffnen?|starte?n?|afta7|efta7|efteh|fta7|shaghal|sha8al|sha3al)\s+(.+)$/i;
  const openMatch = normalized.match(openRegex);
  if (openMatch) {
    const target = normalizeAppTarget(openMatch[1]);
    return {
      recognized: true,
      action: 'open',
      target,
      originalPrompt: rawPrompt,
      category: 'apps',
    };
  }

  // 3. Screenshot Capture
  // English: screenshot, take screenshot, screen capture
  // Arabic: خد سكرين شوت, خذ لقطة شاشة, سكرين شوت
  // German: bildschirmfoto, screenshot, screenshot machen
  // Arabizi: khod screenshot, 5od screenshot, hat screenshot
  const screenshotRegex = /^(?:(?:take\s+)?(?:a\s+)?(?:screenshot|screen\s*shot|screen\s*capture)|(?:خد|خذ|هات|التقط)?\s*(?:سكرين\s*شوت|لقطه\s*شاشه|صوره\s*شاشه)|bildschirmfoto|(?:screenshot(?:\s+machen)?)|(?:khod|5od|hat)?\s*(?:screenshot|screen\s*shot))$/i;
  if (screenshotRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'screenshot',
      originalPrompt: rawPrompt,
      category: 'screen',
    };
  }

  // 4. Audio Mute
  // EN: mute, silence, quiet
  // AR: اكتم, كتم الصوت, اسكت
  // DE: stumm, stummschalten, ton aus
  // Arabizi: ektem, ektm, a2fl el soot
  const muteRegex = /^(?:mute(?: audio| sound)?|silence|quiet|shh+|stumm(?:schalten)?|ton aus|lautlos|ruhe|اكتم(?: الصوت)?|كتم(?: الصوت)?|اسكت|صمت|اخرس|a2fl el soot|a2fl el sot|ektem|ektm|ektim|soot off)$/i;
  if (muteRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'mute',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 5. Audio Unmute
  const unmuteRegex = /^(?:unmute(?: audio| sound)?|sound on|audio on|ton an|stumm aufheben|laut schalten|entstummen|شغل الصوت|فك الكتم|الغاء الكتم|افتح الصوت|رجع الصوت|efteh el soot|efta7 el soot|sheel el katm|ragga3 el soot|unmute)$/i;
  if (unmuteRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'unmute',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 6. Deafen (Mute master output and mic simultaneously)
  const deafenRegex = /^(?:deafen(?: all)?|mute all|total silence|full mute|taub|alles stummschalten|vollstumm|كتم كلي|صمم|كتم المايك والسماعة|اكتم الكل|a2fl kolo|ektem kolo)$/i;
  if (deafenRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'deafen',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 7. Undeafen
  const undeafenRegex = /^(?:undeafen(?: all)?|un-deafen|restore all|enttauben|alles laut|الغاء الكتم الكلي|فك كتم الكل|رجع الكل|sheel el deafen|ragga3 kolo)$/i;
  if (undeafenRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'undeafen',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 8. Volume Set Numeric: e.g. vol 50, volume to 80%, الصوت 60, soot 70
  const volSetRegex = /^(?:(?:set\s+)?vol(?:ume)?(?:\s+to)?|lautst[aä]rke(?:\s+auf)?|(?:خلي\s+)?الصوت(?:\s+علي)?|soot(?:\s+3ala)?)\s+(\d{1,3})%?$/i;
  const volMatch = normalized.match(volSetRegex);
  if (volMatch) {
    const val = Math.max(0, Math.min(100, parseInt(volMatch[1], 10)));
    return {
      recognized: true,
      action: 'volume_set',
      value: val,
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 9. Volume Up
  // EN: volume up, vol up, turn it up, louder
  // AR: علي الصوت, ارفع الصوت
  // DE: lauter, ton lauter
  // Arabizi: 3ally el soot, 3ali el sot
  const volUpRegex = /^(?:volume up|vol up|turn it up|louder|lauter|علي الصوت|ارفع الصوت|3ally el soot|3ali el sot|3ali el soot)$/i;
  if (volUpRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'volume_up',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 10. Volume Down
  // EN: volume down, vol down, quieter, leiser
  // AR: وطي الصوت, نزل الصوت
  // Arabizi: waty el soot, nzzel el sot
  const volDownRegex = /^(?:volume down|vol down|turn it down|quieter|leiser|وطي الصوت|نزل الصوت|waty el soot|nzzel el sot|waty el sot)$/i;
  if (volDownRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'volume_down',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 11. Workstation Lock
  // EN: lock, lock screen, lock pc
  // AR: قفل الشاشه, اقفل الشاشه, اقفل الجهاز
  // DE: sperren, bildschirm sperren
  // Arabizi: e2fel el pc, e2fl el shasha, skr
  const lockRegex = /^(?:lock(?: screen| pc| workstation| computer)?|screen lock|sperren|bildschirm sperren|قفل(?: الشاشه)?|اقفل(?: الشاشه)?|سكر(?: الشاشه)?|اقفل الجهاز|e2fl|e2fel|e2fl el shasha|e2fel el pc|sakker)$/i;
  if (lockRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'lock',
      originalPrompt: rawPrompt,
      category: 'power',
    };
  }

  // 12. Workstation Sleep
  // EN: sleep, sleep pc, suspend, standby
  // AR: نام, نوم الجهاز, سكون, وضع السكون
  // DE: schlafen, ruhezustand
  // Arabizi: nam, nayem, skoon
  const sleepRegex = /^(?:sleep(?: pc)?|suspend|hibernate|standby|sleep mode|schlafen|ruhezustand|نام|نوم(?: الجهاز)?|سكون|وضع السكون|nam|nayem|skoon)$/i;
  if (sleepRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'sleep',
      originalPrompt: rawPrompt,
      category: 'power',
    };
  }

  // 13. Workstation Shutdown
  // EN: shutdown, shut down, power off
  // AR: اطفي الجهاز, ايقاف التشغيل
  // DE: herunterfahren, ausschalten
  // Arabizi: etfe el pc, etfy el computer
  const shutdownRegex = /^(?:shutdown|shut down|power off|herunterfahren|ausschalten|اطفي(?: الجهاز| الكمبيوتر| البي سي)?|ايقاف التشغيل|(?:etfe|etfy|etfi|taffy)(?: el computer| el gehaz| el pc)?)$/i;
  if (shutdownRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'shutdown',
      originalPrompt: rawPrompt,
      category: 'power',
    };
  }

  // 14. Media Play / Resume
  const playRegex = /^(?:play(?: music)?|resume(?: music)?|abspielen|wiedergabe|شغل(?: الموسيقي| الاغنيه)?|تشغيل|shaghal|sha8al)$/i;
  if (playRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'play',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 15. Media Pause
  const pauseRegex = /^(?:pause(?: music)?|stop(?: music)?|anhalten|stoppen|وقف(?: الموسيقي| الاغنيه)?|ايقاف|wa2ef|wa22ef)$/i;
  if (pauseRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'pause',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 16. Media Next / Skip
  const nextRegex = /^(?:next(?: track| song)?|skip|weiter|التالي|اللي بعده|تخطي|elly ba3do)$/i;
  if (nextRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'next',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 17. Media Prev
  const prevRegex = /^(?:prev(?:ious)?|back|zur[uü]ck|السابق|اللي قبله|ارجع|erga3|raga3)$/i;
  if (prevRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'prev',
      originalPrompt: rawPrompt,
      category: 'media',
    };
  }

  // 18. Status
  const statusRegex = /^(?:status|system status|node status|health|حاله النظام|الحاله)$/i;
  if (statusRegex.test(normalized)) {
    return {
      recognized: true,
      action: 'status',
      originalPrompt: rawPrompt,
      category: 'system',
    };
  }

  return {
    recognized: false,
    originalPrompt: rawPrompt,
  };
}

/**
 * Executes a parsed NLU command on the local workstation hardware
 */
export async function executeNluCommand(parsed) {
  if (!parsed || !parsed.recognized) {
    return { success: false, error: 'Command not recognized' };
  }

  const { action, target, value } = parsed;

  try {
    switch (action) {
      case 'kill_process': {
        const res = await killAppGroup(target);
        return {
          success: res.success,
          message: res.success ? `Closed ${target}.` : `Process ${target} not running.`,
          action,
          target,
        };
      }

      case 'open': {
        return new Promise((resolve) => {
          const cmd = IS_WIN ? `start "" "${target}"` : `xdg-open "${target}" 2>/dev/null || open "${target}"`;
          exec(cmd, (err) => {
            if (err) {
              resolve({ success: false, error: `Failed to open ${target}: ${err.message}` });
            } else {
              resolve({ success: true, message: `Opened ${target}.`, action, target });
            }
          });
        });
      }

      case 'screenshot': {
        const snap = await getScreenSnapshot();
        return {
          success: snap.status === 'ok',
          message: 'Screenshot captured.',
          action,
          image: snap.image,
        };
      }

      case 'mute': {
        await controlMedia('mute', true);
        return { success: true, message: 'Audio output muted.', action };
      }

      case 'unmute': {
        await controlMedia('mute', false);
        return { success: true, message: 'Audio output unmuted.', action };
      }

      case 'deafen': {
        await controlMedia('deafen', true);
        return { success: true, message: 'Deafened: Audio & microphone muted.', action };
      }

      case 'undeafen': {
        await controlMedia('deafen', false);
        return { success: true, message: 'Undeafened: Audio & microphone restored.', action };
      }

      case 'volume_set': {
        await controlMedia('volume', value);
        return { success: true, message: `Volume set to ${value}%.`, action, value };
      }

      case 'volume_up': {
        let cur = 50;
        try {
          const status = await getMediaStatus();
          cur = typeof status.volume === 'number' ? status.volume : 50;
        } catch {}
        const next = Math.min(100, cur + 10);
        await controlMedia('volume', next);
        return { success: true, message: `Volume increased to ${next}%.`, action, value: next };
      }

      case 'volume_down': {
        let cur = 50;
        try {
          const status = await getMediaStatus();
          cur = typeof status.volume === 'number' ? status.volume : 50;
        } catch {}
        const next = Math.max(0, cur - 10);
        await controlMedia('volume', next);
        return { success: true, message: `Volume decreased to ${next}%.`, action, value: next };
      }

      case 'lock': {
        await executeWorkstationCommand('lock');
        return { success: true, message: 'Workstation screen locked.', action };
      }

      case 'sleep': {
        await executeWorkstationCommand('sleep');
        return { success: true, message: 'Workstation entered sleep mode.', action };
      }

      case 'shutdown': {
        await executeWorkstationCommand('shutdown');
        return { success: true, message: 'Workstation shutdown initiated.', action };
      }

      case 'play': {
        await controlMedia('play_pause');
        return { success: true, message: 'Playback resumed.', action };
      }

      case 'pause': {
        await controlMedia('play_pause');
        return { success: true, message: 'Playback paused.', action };
      }

      case 'next': {
        await controlMedia('next');
        return { success: true, message: 'Skipped to next track.', action };
      }

      case 'prev': {
        await controlMedia('prev');
        return { success: true, message: 'Returned to previous track.', action };
      }

      case 'status': {
        return {
          success: true,
          message: 'AION Core is online and operational on port 5050. Node active.',
          action,
        };
      }

      default:
        return { success: false, error: `Unhandled action: ${action}` };
    }
  } catch (err) {
    logEvent('ERROR', `NLU execution error: ${err.message}`);
    return { success: false, error: err.message };
  }
}
