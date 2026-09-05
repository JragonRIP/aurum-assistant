/**
 * Rank Spotify track candidates for normal play requests.
 * Default: prefer explicit when otherwise equivalent; demote remix/live/etc.
 */

export type RankableTrack = {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  explicit: boolean;
};

export type TrackRankOptions = {
  query: string;
  /** Prefer clean/radio when user asked for it. */
  preferClean?: boolean;
  /** Force explicit preference (default true unless preferClean). */
  preferExplicit?: boolean;
  /** Spotify id of a saved preference — strong boost. */
  preferredId?: string | null;
  /** Artist hint from user / preference. */
  preferredArtist?: string | null;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function hasVariant(name: string, album: string): number {
  const t = `${name} ${album}`.toLowerCase();
  let penalty = 0;
  if (/\b(remix|rmx)\b/.test(t)) penalty += 40;
  if (/\b(live|concert)\b/.test(t)) penalty += 35;
  if (/\b(acoustic)\b/.test(t)) penalty += 30;
  if (/\b(instrumental|karaoke)\b/.test(t)) penalty += 50;
  if (/\b(sped up|slowed|nightcore)\b/.test(t)) penalty += 45;
  if (/\b(cover|tribute)\b/.test(t)) penalty += 40;
  if (/\b(remaster(?:ed)?)\b/.test(t)) penalty += 5;
  if (/\b(deluxe|anniversary|expanded)\b/.test(t)) penalty += 3;
  return penalty;
}

function titleScore(query: string, name: string): number {
  const q = norm(query);
  const n = norm(name);
  if (!q || !n) return 0;
  if (q === n) return 100;
  if (n.startsWith(q) || q.startsWith(n)) return 85;
  if (n.includes(q) || q.includes(n)) return 70;
  const qt = q.split(" ").filter((t) => t.length > 2);
  const nt = new Set(n.split(" "));
  const hit = qt.filter((t) => nt.has(t)).length;
  return qt.length ? Math.round((hit / qt.length) * 60) : 0;
}

function artistScore(preferred: string | null | undefined, artists: string[]): number {
  if (!preferred) return 0;
  const p = norm(preferred);
  for (const a of artists) {
    const an = norm(a);
    if (an === p) return 50;
    if (an.includes(p) || p.includes(an)) return 35;
  }
  return 0;
}

export function scoreTrack(track: RankableTrack, opts: TrackRankOptions): number {
  let score = titleScore(opts.query, track.name);
  score += artistScore(opts.preferredArtist, track.artists);
  score -= hasVariant(track.name, track.album);

  const preferClean = Boolean(opts.preferClean);
  const preferExplicit = preferClean ? false : opts.preferExplicit !== false;

  if (preferExplicit && track.explicit) score += 15;
  if (preferExplicit && !track.explicit) score -= 8;
  if (preferClean && !track.explicit) score += 15;
  if (preferClean && track.explicit) score -= 20;

  if (opts.preferredId && track.id === opts.preferredId) score += 120;

  // Slight preference for shorter album names that look like singles/original
  if (/greatest hits|compilation|playlist/i.test(track.album)) score -= 6;

  return score;
}

export function rankTracks<T extends RankableTrack>(
  tracks: T[],
  opts: TrackRankOptions,
): T[] {
  return [...tracks].sort(
    (a, b) => scoreTrack(b, opts) - scoreTrack(a, opts),
  );
}

/**
 * After ranking, decide if we still need to ask the user.
 * Same dominant artist + clear top score → not ambiguous.
 */
export function isTrackAmbiguous<T extends RankableTrack>(
  ranked: T[],
  opts: TrackRankOptions,
): boolean {
  if (ranked.length <= 1) return false;
  if (opts.preferredId && ranked[0]!.id === opts.preferredId) return false;
  if (opts.preferredArtist) {
    const top = ranked[0]!;
    if (artistScore(opts.preferredArtist, top.artists) >= 35) return false;
  }

  const topScore = scoreTrack(ranked[0]!, opts);
  const secondScore = scoreTrack(ranked[1]!, opts);
  if (topScore - secondScore >= 25) return false;

  const artistSets = new Set(
    ranked.slice(0, 5).map((t) => t.artists.join("|").toLowerCase()),
  );
  return artistSets.size > 1;
}

/** Prefer explicit sibling with same name+primary artist when available. */
export function preferExplicitEquivalent<T extends RankableTrack>(
  ranked: T[],
  preferClean: boolean,
): T | null {
  if (ranked.length === 0) return null;
  const top = ranked[0]!;
  if (preferClean) {
    if (!top.explicit) return top;
    const clean = ranked.find(
      (t) =>
        !t.explicit &&
        norm(t.name) === norm(top.name) &&
        norm(t.artists[0] ?? "") === norm(top.artists[0] ?? ""),
    );
    return clean ?? top;
  }
  if (top.explicit) return top;
  const explicit = ranked.find(
    (t) =>
      t.explicit &&
      norm(t.name) === norm(top.name) &&
      norm(t.artists[0] ?? "") === norm(top.artists[0] ?? ""),
  );
  return explicit ?? top;
}
