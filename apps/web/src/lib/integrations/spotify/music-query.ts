/**
 * Normalize music play intents into stable preference keys.
 * Strips filler command language; preserves version/artist qualifiers.
 */

const FILLER =
  /\b(play|please|put on|listen to|can you|could you|would you|start|queue|open|my|the song|the track|a song|a track|some)\b/gi;

const VERSION_KEEP =
  /\b(remix|live|clean|explicit|radio edit|censored|acoustic|cover|karaoke|instrumental|sped up|slowed|deluxe|remaster(?:ed)?|feat\.?|ft\.?)\b/i;

export type MusicVersionHint =
  | "clean"
  | "explicit"
  | "remix"
  | "live"
  | "acoustic"
  | "other"
  | null;

export type NormalizedMusicQuery = {
  /** Stable preference key (no filler). */
  key: string;
  /** Display-ish residual text after filler strip. */
  residual: string;
  versionHint: MusicVersionHint;
  /** True when the user asked for a one-off version (e.g. "this time"). */
  temporaryOverride: boolean;
  /** True when user asked to persist ("from now on", "always"). */
  persistPreference: boolean;
  preferOwnedPlaylist: boolean;
};

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function detectVersionHint(text: string): MusicVersionHint {
  const t = text.toLowerCase();
  if (/\b(clean|radio edit|censored|non[- ]?explicit|family[- ]?friendly|kid[- ]?friendly)\b/.test(t)) {
    return "clean";
  }
  if (/\bexplicit\b/.test(t)) return "explicit";
  if (/\bremix\b/.test(t)) return "remix";
  if (/\blive\b/.test(t)) return "live";
  if (/\bacoustic\b/.test(t)) return "acoustic";
  if (VERSION_KEEP.test(t)) return "other";
  return null;
}

export function normalizeMusicQuery(raw: string): NormalizedMusicQuery {
  const original = collapseWs(raw);
  const lower = original.toLowerCase();
  const temporaryOverride =
    /\b(this time|just this once|for now|once)\b/.test(lower);
  const persistPreference =
    /\b(from now on|always|every time|whenever i say|this is the one i mean|use this version)\b/.test(
      lower,
    );
  const preferOwnedPlaylist =
    /\bmy\b/.test(lower) || /\bplaylist\b/.test(lower);

  let residual = original.replace(FILLER, " ");
  residual = residual
    .replace(/\b(this time|just this once|for now|once|from now on|always|every time)\b/gi, " ")
    .replace(/[?!.,]+/g, " ");
  residual = collapseWs(residual).toLowerCase();

  const versionHint = detectVersionHint(original);
  const key = residual || collapseWs(original.replace(FILLER, " ")).toLowerCase();

  return {
    key,
    residual: residual || key,
    versionHint,
    temporaryOverride,
    persistPreference,
    preferOwnedPlaylist,
  };
}

/** Score how well a free-text choice matches a candidate label/artists. */
export function scoreChoiceMatch(
  choice: string,
  candidate: { name: string; artists?: string[]; subtitle?: string },
): number {
  const c = collapseWs(choice).toLowerCase();
  if (!c) return 0;
  const artists = (candidate.artists ?? []).map((a) => a.toLowerCase());
  const subtitle = (candidate.subtitle ?? "").toLowerCase();
  const name = candidate.name.toLowerCase();
  let score = 0;
  for (const a of artists) {
    if (a === c) score = Math.max(score, 100);
    else if (a.includes(c) || c.includes(a)) score = Math.max(score, 80);
    else {
      const tokens = c.split(" ").filter(Boolean);
      if (tokens.some((t) => t.length >= 3 && a.includes(t))) {
        score = Math.max(score, 60);
      }
    }
  }
  if (subtitle && (subtitle.includes(c) || c.includes(subtitle))) {
    score = Math.max(score, 70);
  }
  if (name === c) score = Math.max(score, 90);
  else if (name.includes(c) || c.includes(name)) score = Math.max(score, 50);
  return score;
}
