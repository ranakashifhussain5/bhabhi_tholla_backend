export interface ProfanityFilter {
  containsProfanity(text: string): boolean;
}

/**
 * Starter word lists covering English, Roman Urdu, and Urdu script, per
 * GAME_RULES.md section 11. These are small, representative sets, not an
 * exhaustive catalogue - review and expand with a native speaker before
 * relying on this for anything beyond a basic first line of defense. The
 * ProfanityFilter interface is the real seam: swap createWordlistProfanityFilter
 * for a bigger curated list or a third-party moderation service later without
 * touching any call site.
 */
export const DEFAULT_ENGLISH_PROFANITY: readonly string[] = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'dick',
  'piss',
  'slut',
  'whore',
];

export const DEFAULT_ROMAN_URDU_PROFANITY: readonly string[] = [
  'chutiya',
  'madarchod',
  'behenchod',
  'bhenchod',
  'randi',
  'kutta',
  'harami',
  'gandu',
  'lund',
  'bc',
  'mc',
];

export const DEFAULT_URDU_SCRIPT_PROFANITY: readonly string[] = ['چوتیا', 'مادرچود', 'کتا', 'حرامی'];

export const DEFAULT_PROFANITY_WORDS: readonly string[] = [
  ...DEFAULT_ENGLISH_PROFANITY,
  ...DEFAULT_ROMAN_URDU_PROFANITY,
  ...DEFAULT_URDU_SCRIPT_PROFANITY,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9؀-ۿݐ-ݿ\s]/g, '');
}

/**
 * Word-boundary matching on the normalized text is the primary (low false
 * positive) check; a collapsed (spaces removed) substring check catches
 * spaced-out evasion like "f u c k" at the cost of occasional false
 * positives on short words - an accepted trade-off for a starter filter.
 */
export function createWordlistProfanityFilter(words: readonly string[]): ProfanityFilter {
  const normalizedWords = words.map((w) => normalize(w)).filter((w) => w.length > 0);

  return {
    containsProfanity(text: string): boolean {
      const normalized = normalize(text);
      const tokens = normalized.split(/\s+/).filter(Boolean);
      const collapsed = tokens.join('');
      return normalizedWords.some((word) => tokens.includes(word) || collapsed.includes(word));
    },
  };
}

export const defaultProfanityFilter: ProfanityFilter = createWordlistProfanityFilter(DEFAULT_PROFANITY_WORDS);
