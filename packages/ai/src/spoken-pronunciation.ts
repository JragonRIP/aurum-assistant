/**
 * Spoken-only pronunciation normalization for TTS.
 * Never mutates displayed / stored assistant text — only the string sent to speech engines.
 *
 * Preference modes:
 * - natural: light fixes only (ambiguity / Aurum brand terms)
 * - british: keep British-leaning readings where they differ
 * - americanized_british: bm_george character, American-friendly heteronyms (default)
 *
 * Kokoro 0.9.4 / Misaki: no reliable official phoneme API in our Python path;
 * use conservative orthographic respelling that espeak/Misaki read correctly.
 */

export type PronunciationPreference =
  | "natural"
  | "british"
  | "americanized_british";

export type PronunciationEntry = {
  /** Case-insensitive match term (word). */
  term: string;
  /** Spoken replacement (orthographic). */
  spoken: string;
  /**
   * Optional regex tested against a window around the match (lowercase).
   * Use `<<TERM>>` as the matched word placeholder.
   */
  when?: RegExp;
  /** Apply only for these preferences (default: all). */
  modes?: PronunciationPreference[];
};

export type PronunciationOptions = {
  preference?: PronunciationPreference;
  /** User / future Settings dictionary (applied after built-ins). */
  custom?: PronunciationEntry[];
};

/** Built-in Aurum dictionary — extensible; Settings UI later. */
export const BUILTIN_PRONUNCIATIONS: PronunciationEntry[] = [
  // Brand / product
  {
    term: "Aurum",
    spoken: "OR-um",
    modes: ["natural", "british", "americanized_british"],
  },
  // American-friendly British voice defaults
  {
    term: "privacy",
    spoken: "PRY-vuh-see",
    modes: ["americanized_british", "natural"],
  },
  {
    term: "privacy",
    spoken: "PRIV-uh-see",
    modes: ["british"],
  },
  // Heteronym: live = /lɪv/ (verb “reside / exist”)
  {
    term: "live",
    spoken: "liv",
    when:
      /(?:\b(?:i|we|you|they|he|she|to|will|can|can't|cannot|don't|doesn't|didn't|won't|wanna|gotta|used\s+to)\s+)<<TERM>>\b|<<TERM>>\s+(?:in|at|with|here|there|nearby|alone|together|on)\b/,
    modes: ["natural", "british", "americanized_british"],
  },
  // Heteronym: live = /laɪv/ (adjective “happening now / not recorded”)
  {
    term: "live",
    spoken: "lyve",
    when:
      /(?:\b(?:a|the|this|that|our|your|go|going|went|going\s+to)\s+)<<TERM>>\b|<<TERM>>\s+(?:voice|system|stream|music|show|feed|broadcast|event|demo|update|session|mode|audio|video|chat|call)\b/,
    modes: ["natural", "british", "americanized_british"],
  },
  // Schedule / calendar (British “shedule” vs American “skedule”)
  {
    term: "schedule",
    spoken: "SKED-jool",
    modes: ["americanized_british", "natural"],
  },
  {
    term: "scheduled",
    spoken: "SKED-joold",
    modes: ["americanized_british", "natural"],
  },
  {
    term: "scheduling",
    spoken: "SKED-jool-ing",
    modes: ["americanized_british", "natural"],
  },
];

const WORD_RE = /\b[\p{L}']+\b/gu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesContext(
  text: string,
  index: number,
  length: number,
  when: RegExp | undefined,
): boolean {
  if (!when) return true;
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + length + 48);
  const window = text.slice(start, end).toLowerCase();
  const localIdx = index - start;
  const before = window.slice(0, localIdx);
  const after = window.slice(localIdx + length);
  const probe = `${before}<<TERM>>${after}`;
  return when.test(probe);
}

function pickEntry(
  term: string,
  text: string,
  index: number,
  preference: PronunciationPreference,
  custom: PronunciationEntry[],
): PronunciationEntry | null {
  const lower = term.toLowerCase();
  const pool = [...custom, ...BUILTIN_PRONUNCIATIONS].filter((e) => {
    if (e.term.toLowerCase() !== lower) return false;
    if (e.modes && !e.modes.includes(preference)) return false;
    return true;
  });
  // Prefer contextual entries first, then unconditional.
  const contextual = pool.filter((e) => e.when);
  for (const e of contextual) {
    if (matchesContext(text, index, term.length, e.when)) return e;
  }
  const plain = pool.find((e) => !e.when);
  return plain ?? null;
}

/**
 * Apply pronunciation overrides to speech text only.
 * Preserves non-matching words and punctuation exactly.
 */
export function applySpokenPronunciation(
  text: string,
  opts: PronunciationOptions = {},
): string {
  const preference = opts.preference ?? "americanized_british";
  const custom = opts.custom ?? [];
  if (!text.trim()) return text;

  return text.replace(WORD_RE, (word, offset) => {
    const entry = pickEntry(word, text, offset, preference, custom);
    if (!entry) return word;
    // Preserve simple capitalization of the first letter when original was Title Case.
    if (/^[A-Z][a-z']+$/.test(word) && /^[A-Za-z]/.test(entry.spoken)) {
      return (
        entry.spoken.charAt(0).toUpperCase() + entry.spoken.slice(1)
      );
    }
    if (/^[A-Z']+$/.test(word) && !entry.spoken.includes("-")) {
      return entry.spoken.toUpperCase();
    }
    return entry.spoken;
  });
}

/** Merge helper for future Settings dictionary. */
export function mergePronunciationDictionaries(
  ...dicts: PronunciationEntry[][]
): PronunciationEntry[] {
  return dicts.flat();
}

export function pronunciationPreferenceLabel(
  preference: PronunciationPreference,
): string {
  switch (preference) {
    case "british":
      return "British";
    case "americanized_british":
      return "Americanized British";
    default:
      return "Natural";
  }
}

// Silence unused helper warning in some bundlers
void escapeRegExp;
