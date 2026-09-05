/**
 * Rank the authenticated user's Spotify playlists for "play my X playlist".
 */

export type RankablePlaylist = {
  id: string;
  uri: string;
  name: string;
  public: boolean | null;
  ownerId?: string | null;
};

export type PlaylistRankOptions = {
  query: string;
  preferredId?: string | null;
  /** Current Spotify user id — boost owned playlists. */
  currentUserId?: string | null;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bplaylist\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scorePlaylist(
  playlist: RankablePlaylist,
  opts: PlaylistRankOptions,
): number {
  const q = norm(opts.query);
  const n = norm(playlist.name);
  let score = 0;
  if (!q || !n) return score;
  if (q === n) score += 100;
  else if (n.startsWith(q) || q.startsWith(n)) score += 85;
  else if (n.includes(q) || q.includes(n)) score += 70;
  else {
    const qt = q.split(" ").filter((t) => t.length > 1);
    const nt = new Set(n.split(" "));
    const hit = qt.filter((t) => nt.has(t)).length;
    score += qt.length ? Math.round((hit / qt.length) * 55) : 0;
  }

  if (
    opts.currentUserId &&
    playlist.ownerId &&
    playlist.ownerId === opts.currentUserId
  ) {
    score += 20;
  }

  if (opts.preferredId && playlist.id === opts.preferredId) score += 120;
  return score;
}

export function rankPlaylists<T extends RankablePlaylist>(
  playlists: T[],
  opts: PlaylistRankOptions,
): T[] {
  return [...playlists]
    .map((p) => ({ p, s: scorePlaylist(p, opts) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

export function isPlaylistAmbiguous<T extends RankablePlaylist>(
  ranked: T[],
  opts: PlaylistRankOptions,
): boolean {
  if (ranked.length <= 1) return false;
  if (opts.preferredId && ranked[0]!.id === opts.preferredId) return false;
  const top = scorePlaylist(ranked[0]!, opts);
  const second = scorePlaylist(ranked[1]!, opts);
  if (top >= 95 && top - second >= 15) return false;
  if (top - second >= 30) return false;
  return true;
}
