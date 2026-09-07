/**
 * Deterministic sentence / phrase boundaries for streaming TTS.
 * Never emits partial words; keeps unstable trailing fragments in the buffer.
 */

const ABBREV_RE =
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m)\.$/i;

export type PullSentencesResult = {
  sentences: string[];
  remainder: string;
};

export type PullSentencesOpts = {
  /** Flush remaining text even without terminal punctuation (stream end). */
  flush?: boolean;
  /**
   * Soft phrase flush when no punctuation appears.
   * Only splits on whitespace after this many chars (never mid-word).
   */
  softFlushMinChars?: number;
};

/**
 * Pull complete speakable units from a growing buffer.
 * Boundaries: . ? ! ; (and soft phrase flush when enabled).
 */
export function pullCompleteSentences(
  buffer: string,
  opts: PullSentencesOpts = {},
): PullSentencesResult {
  const softMin = opts.softFlushMinChars ?? 140;
  let rest = buffer;
  const sentences: string[] = [];

  while (rest.length > 0) {
    const match = rest.match(/^([\s\S]*?[.!?;])(\s+|$)/);
    if (match) {
      const raw = match[1] ?? "";
      const consumed = match[0] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) {
        rest = rest.slice(consumed.length);
        continue;
      }
      // Avoid splitting on common abbreviations / initials.
      if (ABBREV_RE.test(trimmed) && !/[!?]$/.test(trimmed)) {
        // Look ahead for a later real boundary; if none and not flushing, keep.
        const after = rest.slice(consumed.length);
        const later = after.match(/[.!?;](?:\s+|$)/);
        if (!later && !opts.flush) {
          break;
        }
        if (!later && opts.flush) {
          // Treat abbrev-ending as final fragment on flush.
          sentences.push(trimmed);
          rest = after;
          continue;
        }
        // Merge through the next boundary.
        const merged = rest.match(
          /^([\s\S]*?[.!?;][\s\S]*?[.!?])(\s+|$)/,
        );
        if (merged) {
          const unit = (merged[1] ?? "").trim();
          if (unit) sentences.push(unit);
          rest = rest.slice(merged[0].length);
          continue;
        }
        break;
      }
      sentences.push(trimmed);
      rest = rest.slice(consumed.length);
      continue;
    }

    // Soft flush: enough text, split at last whitespace before softMin+…
    if (!opts.flush && rest.trim().length >= softMin) {
      const slice = rest.slice(0, Math.min(rest.length, softMin + 40));
      const sp = slice.lastIndexOf(" ");
      if (sp >= Math.floor(softMin * 0.6)) {
        const unit = rest.slice(0, sp).trim();
        if (unit) {
          sentences.push(unit);
          rest = rest.slice(sp + 1);
          continue;
        }
      }
    }

    break;
  }

  if (opts.flush) {
    const tail = rest.trim();
    if (tail) sentences.push(tail);
    rest = "";
  }

  return { sentences, remainder: rest };
}

/** True when the unit should be spoken (non-empty after trim). */
export function isSpeakableChunk(text: string): boolean {
  return text.trim().length > 0;
}
