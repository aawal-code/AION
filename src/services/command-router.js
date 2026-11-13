/**
 * Zero-AI Multilingual Instant Command Router (<10ms)
 * High-performance deterministic regex dictionary router executing OS, power,
 * and media controls without invoking an LLM.
 *
 * Supported Languages & Dialects:
 * - English (EN)
 * - German (DE)
 * - Arabic (ar-EG / Modern Standard)
 * - Arabizi (Franco-Arab)
 */

import { performance } from 'perf_hooks';
import { controlMedia, getMediaStatus } from './media.js';
import { executeWorkstationCommand } from './os.js';
import { logEvent } from './sse.js';

/**
 * Normalizes input text across Arabic, Arabizi, and Latin scripts:
 * - Strips leading/trailing punctuation and command prefixes
 * - Normalizes Arabic diacritics, alefs, yehs, and tehs
 * - Collapses redundant whitespace and repeated characters (e.g. shhh -> shh)
 */
export function normalizePrompt(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== 'string') return '';

  let text = rawPrompt
    .trim()
    .toLowerCase()
    .replace(/^[!/#.]+\s*/, '')
    .replace(/[.!?,;:]+$/, '');

  // Strip Arabic diacritics / tashkeel ([\u064B-\u065F\u0670])
  text = text.replace(/[\u064B-\u065F\u0670]/g, '');

  // Normalize Arabic letters: [إأآا] -> ا, [يى] -> ي, [ة] -> ه, [ؤئ] -> ء
  text = text
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[ؤئ]/g, 'ء');

  // Collapse 3+ identical repeated characters to 2 (e.g., shhhhh -> shh, e2feeeel -> e2feel)
  text = text.replace(/(.)\1{2,}/g, '$1$1');

  // Collapse spaces
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fast Levenshtein distance for fuzzy typo tolerance
 */
export function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  const len1 = s1.length;
  const len2 = s2.length;
  const d = [];

  for (let i = 0; i <= len1; i++) d[i] = [i];
  for (let j = 0; j <= len2; j++) d[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return d[len1][len2];
}

/**
 * Dictionary of actions, matching patterns, and fuzzy keywords
 */
export const COMMAND_RULES = [
  // 1. Audio Mute
  {
    action: 'mute',
    category: 'media',
    regex: /^(?:mute(?: audio| sound)?|silence|quiet|shh+|stumm(?:schalten)?|ton aus|lautlos|ruhe|اكتم(?: الصوت)?|كتم(?: الصوت)?|اسكت|صمت|اخرس|a2fl el soot|a2fl el sot|ektem|ektm|ektim|soot off|eskoot|eskot)$/i,
    fuzzyKeywords: ['mute', 'stumm', 'اكتم', 'ektem', 'ektm', 'shh', 'a2fl el soot'],
    async execute() {
      await controlMedia('mute', true);
      return 'Audio output muted.';
    },
  },

  // 2. Audio Unmute
  {
    action: 'unmute',
    category: 'media',
    regex: /^(?:unmute(?: audio| sound)?|sound on|audio on|ton an|stumm aufheben|laut schalten|entstummen|شغل الصوت|فك الكتم|الغاء الكتم|افتح الصوت|رجع الصوت|efteh el soot|efta7 el soot|sheel el katm|ragga3 el soot|unmute)$/i,
    fuzzyKeywords: ['unmute', 'ton an', 'شغل الصوت', 'efteh el soot'],
    async execute() {
      await controlMedia('mute', false);
      return 'Audio output unmuted.';
    },
  },

  // 3. Deafen (Mute master output AND microphone simultaneously)
  {
    action: 'deafen',
    category: 'media',
    regex: /^(?:deafen(?: all)?|mute all|total silence|full mute|taub|alles stummschalten|vollstumm|كتم كلي|صمم|كتم المايك والسماعة|اكتم الكل|اخرس الكل|deafen|ektem kolo|a2fl kolo|ektm el koll)$/i,
    fuzzyKeywords: ['deafen', 'taub', 'كتم كلي', 'ektem kolo'],
    async execute() {
      await controlMedia('deafen', true);
      return 'Deafened: Audio output and microphone input are both muted.';
    },
  },

  // 4. Undeafen (Restore master output and microphone simultaneously)
  {
    action: 'undeafen',
    category: 'media',
    regex: /^(?:undeafen(?: all)?|un-deafen|restore all|enttauben|alles laut|الغاء الكتم الكلي|فك كتم الكل|رجع الكل|sheel el deafen|ragga3 kolo)$/i,
    fuzzyKeywords: ['undeafen', 'enttauben', 'فك كتم الكل', 'ragga3 kolo'],
    async execute() {
      await controlMedia('deafen', false);
      return 'Undeafened: Audio output and microphone input restored.';
    },
  },

  // 5. Volume Set (Numeric: e.g., "vol 50", "volume to 80%", "lautstärke 30", "الصوت 70", "soot 60")
  {
    action: 'volume_set',
    category: 'media',
    regex: /^(?:(?:set\s+)?vol(?:ume)?(?:\s+to)?|lautst[aä]rke(?:\s+auf)?|(?:خلي\s+)?الصوت(?:\s+علي)?|soot(?:\s+3ala)?)\s+(\d{1,3})%?$/i,
    fuzzyKeywords: [],
    async execute(match) {
      const vol = Math.max(0, Math.min(100, parseInt(match[1], 10)));
      await controlMedia('volume', vol);
      return `Volume set to ${vol}%.`;
    },
  },

  // 6. Volume Up
  {
    action: 'volume_up',
    category: 'media',
    regex: /^(?:volume up|vol up|turn it up|louder|lauter|علي الصوت|ارفع الصوت|3ally el soot|3ali el sot|3ali el soot)$/i,
    fuzzyKeywords: ['volume up', 'lauter', 'علي الصوت', '3ally el soot'],
    async execute() {
      let currentVol = 50;
      try {
        const status = await getMediaStatus();
        currentVol = typeof status.volume === 'number' ? status.volume : 50;
      } catch {}
      const target = Math.min(100, currentVol + 10);
      await controlMedia('volume', target);
      return `Volume increased to ${target}%.`;
    },
  },

  // 7. Volume Down
  {
    action: 'volume_down',
    category: 'media',
    regex: /^(?:volume down|vol down|turn it down|quieter|leiser|وطي الصوت|نزل الصوت|waty el soot|nzzel el sot|waty el sot)$/i,
    fuzzyKeywords: ['volume down', 'leiser', 'وطي الصوت', 'waty el soot'],
    async execute() {
      let currentVol = 50;
      try {
        const status = await getMediaStatus();
        currentVol = typeof status.volume === 'number' ? status.volume : 50;
      } catch {}
      const target = Math.max(0, currentVol - 10);
      await controlMedia('volume', target);
      return `Volume decreased to ${target}%.`;
    },
  },

  // 8. Media Play / Resume
  {
    action: 'play',
    category: 'media',
    regex: /^(?:play(?: music)?|resume(?: music| playback)?|start music|continue playback|abspielen|wiedergabe|musik abspielen|fortsetzen|شغل(?: الموسيقي| الاغنيه)?|تشغيل|كمل|تابع|shaghal(?: music)?|sha8al|sha3al|kamel)$/i,
    fuzzyKeywords: ['play', 'resume', 'abspielen', 'شغل', 'shaghal'],
    async execute() {
      await controlMedia('play_pause');
      return 'Playback resumed.';
    },
  },

  // 9. Media Pause / Stop
  {
    action: 'pause',
    category: 'media',
    regex: /^(?:pause(?: music)?|stop(?: music| playback)?|hold|pausieren|anhalten|stoppen|وقف(?: الموسيقي| الاغنيه)?|ايقاف(?: مؤقت)?|وقفه|استراحه|wa2ef(?: el music)?|wa22ef|stopp)$/i,
    fuzzyKeywords: ['pause', 'anhalten', 'وقف', 'wa2ef'],
    async execute() {
      await controlMedia('play_pause');
      return 'Playback paused.';
    },
  },

  // 10. Media Next Track / Skip
  {
    action: 'next',
    category: 'media',
    regex: /^(?:next(?: track| song)?|skip(?: track)?|forward|weiter|n[aä]chster(?: titel)?|[uü]berspringen|التالي|اللي بعده|تخطي|غير الاغنيه|بعده|هات اللي بعده|elly ba3do|elly ba3doh|ely ba3do|skip|8ayar|ghayar)$/i,
    fuzzyKeywords: ['next', 'skip', 'weiter', 'التالي', 'elly ba3do'],
    async execute() {
      await controlMedia('next');
      return 'Skipped to next track.';
    },
  },

  // 11. Media Previous Track
  {
    action: 'prev',
    category: 'media',
    regex: /^(?:prev(?:ious)?(?: track| song)?|back|last track|zur[uü]ck|vorheriger(?: titel)?|السابق|اللي فات|اللي قبله|رجع الاغنيه|ارجع|هات اللي قبله|elly fato|elly ablo|erga3|raga3)$/i,
    fuzzyKeywords: ['prev', 'previous', 'zurueck', 'السابق', 'erga3'],
    async execute() {
      await controlMedia('prev');
      return 'Returned to previous track.';
    },
  },

  // 12. Power: Lock Workstation
  {
    action: 'lock',
    category: 'power',
    regex: /^(?:lock(?: screen| pc| workstation| computer)?|screen lock|sperren|bildschirm sperren|pc sperren|rechner sperren|sperre|sperr|قفل(?: الشاشه)?|اقفل(?: الشاشه)?|سكر(?: الشاشه)?|اغلق الشاشه|اقفل الجهاز|e2fl|e2fel|e2fl el shasha|e2fel el shasha|e2fl el pc|eqfel|iqfil|skr|sakker)$/i,
    fuzzyKeywords: ['lock', 'sperren', 'اقفل', 'قفل', 'e2fl', 'e2fel'],
    async execute() {
      await executeWorkstationCommand('lock');
      return 'Workstation screen locked.';
    },
  },

  // 13. Power: Sleep / Suspend Workstation
  {
    action: 'sleep',
    category: 'power',
    regex: /^(?:sleep(?: pc)?|suspend|hibernate|standby|sleep mode|go to sleep|schlafen|ruhezustand|energie sparen|schlafmodus|نام|نوم(?: الجهاز)?|سكون|وضع السكون|اهدا|nam|nayem|naayem|skoon)$/i,
    fuzzyKeywords: ['sleep', 'schlafen', 'نام', 'سكون', 'nam'],
    async execute() {
      await executeWorkstationCommand('sleep');
      return 'Putting workstation into sleep mode.';
    },
  },

  // 14. Power: Shutdown Workstation
  {
    action: 'shutdown',
    category: 'power',
    regex: /^(?:shutdown|shut down|power off|turn off (?:pc|computer)|kill pc|herunterfahren|ausschalten|pc ausschalten|rechner ausschalten|اطفي(?: الجهاز| الكمبيوتر| البي سي)?|ايقاف التشغيل|اغلاق الجهاز|(?:etfe|etfy|etfi|taffy)(?: el computer| el gehaz| el pc)?)$/i,
    fuzzyKeywords: ['shutdown', 'herunterfahren', 'اطفي', 'etfe', 'etfy'],
    async execute() {
      await executeWorkstationCommand('shutdown');
      return 'Workstation shutdown initiated.';
    },
  },

  // 15. Power: Turn Off Screen / Display
  {
    action: 'screen_off',
    category: 'power',
    regex: /^(?:screen off|screenoff|turn off (?:display|screen)|bildschirm aus|display aus|اطفي الشاشه|طفي الشاشه|(?:etfe|etfy|etfi|taffy) el shasha)$/i,
    fuzzyKeywords: ['screen off', 'bildschirm aus', 'اطفي الشاشه', 'etfe el shasha'],
    async execute() {
      await executeWorkstationCommand('screen_off');
      return 'Display monitor powered off.';
    },
  },

  // 16. System Status
  {
    action: 'status',
    category: 'system',
    regex: /^(?:status|system status|node status|health|gesundheit|حاله النظام|الحاله|status el system)$/i,
    fuzzyKeywords: ['status', 'health'],
    async execute() {
      return 'AION Core is online and operational on port 5050. Node active.';
    },
  },
];

/**
 * Executes fuzzy lookup against canonical keywords if exact regex fails
 */
function findFuzzyMatch(normalized) {
  if (!normalized || normalized.length < 3) return null;

  let bestRule = null;
  let minDistance = Infinity;

  for (const rule of COMMAND_RULES) {
    for (const kw of rule.fuzzyKeywords) {
      const maxAllowed = kw.length <= 4 ? 1 : 2;
      const dist = levenshteinDistance(normalized, kw);

      if (dist <= maxAllowed && dist < minDistance) {
        minDistance = dist;
        bestRule = rule;
      }
    }
  }

  return bestRule;
}

/**
 * Matches a raw prompt against regex rules or fuzzy dictionary without executing.
 * Returns the matching rule, match object, category, and action, or null if no match.
 */
export function matchCommandRule(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    return null;
  }
  const normalized = normalizePrompt(rawPrompt);
  for (const rule of COMMAND_RULES) {
    const match = normalized.match(rule.regex);
    if (match) {
      return {
        rule,
        match,
        fuzzy: false,
        action: rule.action,
        category: rule.category,
      };
    }
  }
  const fuzzyRule = findFuzzyMatch(normalized);
  if (fuzzyRule) {
    return {
      rule: fuzzyRule,
      match: null,
      fuzzy: true,
      action: fuzzyRule.action,
      category: fuzzyRule.category,
    };
  }
  return null;
}

/**
 * Central deterministic router executing command in <10ms
 * Supports options.dryRun to inspect matching without executing hardware actions.
 */
export async function handleLocalCommand(rawPrompt, options = {}) {
  const startTime = performance.now();

  if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    return {
      handled: false,
      action: null,
      response: 'Empty command.',
      latencyMs: 0,
    };
  }

  const dryRun = Boolean(options.dryRun);
  const normalized = normalizePrompt(rawPrompt);

  // 1. Direct Regex Dictionary Matching (<1ms)
  for (const rule of COMMAND_RULES) {
    const match = normalized.match(rule.regex);
    if (match) {
      const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;
      if (dryRun) {
        return {
          handled: true,
          action: rule.action,
          category: rule.category,
          dryRun: true,
          response: `[Dry Run] Matched '${rule.action}' (${rule.category}).`,
          latencyMs,
        };
      }

      try {
        const response = await rule.execute(match);
        const execLatency = Math.round((performance.now() - startTime) * 100) / 100;
        logEvent('COMMAND', `[ROUTER <${execLatency}ms] Handled '${rule.action}' for prompt '${rawPrompt}'`);
        return {
          handled: true,
          action: rule.action,
          category: rule.category,
          response,
          latencyMs: execLatency,
        };
      } catch (err) {
        const execLatency = Math.round((performance.now() - startTime) * 100) / 100;
        return {
          handled: true,
          action: rule.action,
          category: rule.category,
          response: `Action failed: ${err.message}`,
          error: err.message,
          latencyMs: execLatency,
        };
      }
    }
  }

  // 2. Fast Fuzzy-Matching Fallback (<2ms)
  const fuzzyRule = findFuzzyMatch(normalized);
  if (fuzzyRule) {
    const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;
    if (dryRun) {
      return {
        handled: true,
        action: fuzzyRule.action,
        category: fuzzyRule.category,
        fuzzy: true,
        dryRun: true,
        response: `[Dry Run] Fuzzy-matched '${fuzzyRule.action}' (${fuzzyRule.category}).`,
        latencyMs,
      };
    }

    try {
      const response = await fuzzyRule.execute(null);
      const execLatency = Math.round((performance.now() - startTime) * 100) / 100;
      logEvent('COMMAND', `[ROUTER-FUZZY <${execLatency}ms] Handled '${fuzzyRule.action}' for prompt '${rawPrompt}'`);
      return {
        handled: true,
        action: fuzzyRule.action,
        category: fuzzyRule.category,
        response,
        fuzzy: true,
        latencyMs: execLatency,
      };
    } catch (err) {
      const execLatency = Math.round((performance.now() - startTime) * 100) / 100;
      return {
        handled: true,
        action: fuzzyRule.action,
        category: fuzzyRule.category,
        response: `Action failed: ${err.message}`,
        error: err.message,
        latencyMs: execLatency,
      };
    }
  }

  const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;
  return {
    handled: false,
    action: null,
    response: 'Unrecognized command.',
    latencyMs,
  };
}
