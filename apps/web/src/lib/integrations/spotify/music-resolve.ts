/**
 * Orchestrates preference lookup, ranking, and trusted-ref creation for music.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolResult } from "@aurum/tools";
import type { SpotifyAdapter, SpotifyTrackHit } from "./adapter";
import { createIntegrationReference } from "./references";
import { normalizeMusicQuery } from "./music-query";
import {
  isTrackAmbiguous,
  preferExplicitEquivalent,
  rankTracks,
} from "./track-ranking";
import {
  isPlaylistAmbiguous,
  rankPlaylists,
} from "./playlist-resolution";
import {
  getMusicPreference,
  markMusicPreferenceStale,
  touchMusicPreference,
  upsertMusicPreference,
  type MusicPreferenceSource,
} from "./music-preferences";
import {
  createDisambiguationSession,
  type DisambiguationCandidate,
} from "./disambiguation";

export async function resolveTrackSearch(opts: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string;
  adapter: SpotifyAdapter;
  query: string;
  artist?: string;
  limit?: number;
}): Promise<ToolResult> {
  const rawQuery = opts.query.trim();
  if (!rawQuery) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Search query is required." },
      activityLabel: "Search failed",
    };
  }

  const normalized = normalizeMusicQuery(rawQuery);
  const preferClean = normalized.versionHint === "clean";
  const searchQuery = normalized.residual || rawQuery;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 30);

  // 1) Preference memory (unless temporary override / version qualifier changes key meaningfully)
  let preferredId: string | null = null;
  let preferredArtist: string | null = opts.artist?.trim() || null;
  let preferenceId: string | null = null;

  if (!normalized.temporaryOverride || normalized.persistPreference) {
    const pref = await getMusicPreference({
      supabase: opts.supabase,
      userId: opts.userId,
      intentType: "track",
      normalizedQuery: normalized.key,
    });
    if (pref) {
      const still = await opts.adapter.getTrack(pref.spotify_resource_id);
      if (!still) {
        await markMusicPreferenceStale({
          supabase: opts.supabase,
          userId: opts.userId,
          preferenceId: pref.id,
        });
      } else {
        // Version qualifier conflicts with stored preference → ignore for this request
        const versionConflict =
          (preferClean && still.explicit) ||
          (normalized.versionHint === "remix" &&
            !/remix/i.test(`${still.name} ${still.album}`)) ||
          (normalized.versionHint === "live" &&
            !/live/i.test(`${still.name} ${still.album}`)) ||
          (normalized.versionHint === "acoustic" &&
            !/acoustic/i.test(`${still.name} ${still.album}`));

        if (!versionConflict && !opts.artist) {
          preferredId = still.id;
          preferredArtist = still.artists[0] ?? pref.artist_name;
          preferenceId = pref.id;
          await touchMusicPreference({
            supabase: opts.supabase,
            userId: opts.userId,
            preferenceId: pref.id,
          });

          const ref = await createIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            provider: "spotify",
            kind: "track",
            providerId: still.id,
            providerUri: still.uri,
            label: still.name,
            subtitle: still.artists.join(", "),
            payload: {
              album: still.album,
              durationMs: still.durationMs,
              artists: still.artists,
              explicit: still.explicit,
              fromPreference: true,
            },
            conversationId: opts.conversationId,
          });

          return {
            success: true,
            data: {
              tracks: [
                {
                  referenceId: ref.id,
                  name: still.name,
                  artists: still.artists,
                  album: still.album,
                  durationMs: still.durationMs,
                  explicit: still.explicit,
                  fromPreference: true,
                },
              ],
              ambiguous: false,
              fromPreference: true,
              preferenceId: pref.id,
            },
            message: `Remembered: ${still.name} — ${still.artists.join(", ")}.`,
            activityLabel: `Remembered · ${still.name}`,
          };
        }
      }
    }
  }

  // 2) Search + rank
  const hits = await opts.adapter.searchTracks({
    query: searchQuery,
    artist: opts.artist,
    limit,
  });
  if (hits.length === 0) {
    return {
      success: false,
      error: {
        code: "TRACK_NOT_FOUND",
        message: "No matching Spotify tracks found.",
      },
      activityLabel: "Track not found",
    };
  }

  const ranked = rankTracks(hits, {
    query: searchQuery,
    preferClean,
    preferExplicit: !preferClean,
    preferredId,
    preferredArtist,
  });
  const best = preferExplicitEquivalent(ranked, preferClean) ?? ranked[0]!;
  // Move best to front
  const ordered = [best, ...ranked.filter((t) => t.id !== best.id)];

  const ambiguous =
    !opts.artist &&
    isTrackAmbiguous(ordered, {
      query: searchQuery,
      preferClean,
      preferredId,
      preferredArtist,
    });

  const tracks: Array<{
    referenceId: string;
    name: string;
    artists: string[];
    album: string;
    durationMs: number;
    explicit: boolean;
  }> = [];
  for (const t of ordered.slice(0, Math.min(limit, 10))) {
    const ref = await createIntegrationReference({
      supabase: opts.supabase,
      userId: opts.userId,
      provider: "spotify",
      kind: "track",
      providerId: t.id,
      providerUri: t.uri,
      label: t.name,
      subtitle: t.artists.join(", "),
      payload: {
        album: t.album,
        durationMs: t.durationMs,
        artists: t.artists,
        explicit: t.explicit,
      },
      conversationId: opts.conversationId,
    });
    tracks.push({
      referenceId: ref.id,
      name: t.name,
      artists: t.artists,
      album: t.album,
      durationMs: t.durationMs,
      explicit: t.explicit,
    });
  }

  if (ambiguous) {
    const candidates: DisambiguationCandidate[] = ordered
      .slice(0, 5)
      .map((t, i) => ({
        providerId: t.id,
        providerUri: t.uri,
        name: t.name,
        artists: t.artists,
        album: t.album,
        explicit: t.explicit,
        referenceId: tracks[i]?.referenceId,
      }));
    await createDisambiguationSession({
      supabase: opts.supabase,
      userId: opts.userId,
      conversationId: opts.conversationId,
      intentType: "track",
      normalizedQuery: normalized.key,
      candidates,
    });
    return {
      success: false,
      error: {
        code: "AMBIGUOUS_TRACK",
        message: "Multiple plausible tracks — ask which artist.",
      },
      data: {
        tracks,
        ambiguous: true,
        normalizedQuery: normalized.key,
      },
      message: `Found ${tracks.length} tracks. Ask which one.`,
      activityLabel: `Found ${searchQuery}`,
    };
  }

  return {
    success: true,
    data: {
      tracks,
      ambiguous: false,
      normalizedQuery: normalized.key,
      preferenceId,
    },
    message: `Found ${tracks.length} track(s).`,
    activityLabel: `Found ${searchQuery}`,
  };
}

export async function resolveUserPlaylist(opts: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string;
  adapter: SpotifyAdapter;
  query: string;
  mineOnly?: boolean;
}): Promise<ToolResult> {
  const rawQuery = opts.query.trim();
  if (!rawQuery) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Playlist query is required." },
      activityLabel: "Search failed",
    };
  }

  const normalized = normalizeMusicQuery(rawQuery);
  const mineOnly = opts.mineOnly !== false;
  const searchKey = normalized.key.replace(/\bplaylist\b/g, "").trim() || normalized.key;

  let preferredId: string | null = null;
  const pref = await getMusicPreference({
    supabase: opts.supabase,
    userId: opts.userId,
    intentType: "playlist",
    normalizedQuery: normalized.key,
  });
  if (pref && !normalized.temporaryOverride) {
    preferredId = pref.spotify_resource_id;
  }

  let currentUserId: string | null = null;
  try {
    currentUserId = await opts.adapter.getCurrentUserId();
  } catch {
    currentUserId = null;
  }

  const owned = await opts.adapter.getUserPlaylists(200);
  let ranked = rankPlaylists(owned, {
    query: searchKey,
    preferredId,
    currentUserId,
  });

  // Validate preferred still exists among owned
  if (preferredId && pref) {
    const still = owned.find((p) => p.id === preferredId);
    if (!still) {
      await markMusicPreferenceStale({
        supabase: opts.supabase,
        userId: opts.userId,
        preferenceId: pref.id,
      });
      preferredId = null;
      ranked = rankPlaylists(owned, {
        query: searchKey,
        preferredId: null,
        currentUserId,
      });
    } else if (!normalized.versionHint) {
      await touchMusicPreference({
        supabase: opts.supabase,
        userId: opts.userId,
        preferenceId: pref.id,
      });
      const ref = await createIntegrationReference({
        supabase: opts.supabase,
        userId: opts.userId,
        provider: "spotify",
        kind: "playlist",
        providerId: still.id,
        providerUri: still.uri,
        label: still.name,
        subtitle: still.public ? "Public" : "Private",
        payload: { fromPreference: true, ownerId: still.ownerId },
        conversationId: opts.conversationId,
      });
      return {
        success: true,
        data: {
          playlists: [
            {
              referenceId: ref.id,
              name: still.name,
              public: still.public,
              fromPreference: true,
            },
          ],
          ambiguous: false,
          fromPreference: true,
          source: "owned",
        },
        message: `Using remembered playlist ${still.name}.`,
        activityLabel: `Remembered · ${still.name}`,
      };
    }
  }

  // Global catalog only when not insisting on "my"
  if (ranked.length === 0 && !mineOnly) {
    const global = await opts.adapter.searchPlaylists({
      query: searchKey,
      limit: 8,
    });
    ranked = rankPlaylists(
      global.map((p) => ({
        id: p.id,
        uri: p.uri,
        name: p.name,
        public: true as boolean | null,
        ownerId: p.ownerId,
      })),
      { query: searchKey, preferredId: null, currentUserId },
    );
  }

  if (ranked.length === 0) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: mineOnly
          ? "No matching playlist in your Spotify library."
          : "No matching Spotify playlist found.",
      },
      activityLabel: "Playlist not found",
    };
  }

  const ambiguous = isPlaylistAmbiguous(ranked, {
    query: searchKey,
    preferredId,
    currentUserId,
  });

  const playlists: Array<{
    referenceId: string;
    name: string;
    public: boolean | null;
    ownerId: string | null;
  }> = [];
  for (const p of ranked.slice(0, 8)) {
    const ref = await createIntegrationReference({
      supabase: opts.supabase,
      userId: opts.userId,
      provider: "spotify",
      kind: "playlist",
      providerId: p.id,
      providerUri: p.uri,
      label: p.name,
      subtitle: p.public ? "Public" : "Private",
      payload: { ownerId: p.ownerId ?? null },
      conversationId: opts.conversationId,
    });
    playlists.push({
      referenceId: ref.id,
      name: p.name,
      public: p.public,
      ownerId: p.ownerId ?? null,
    });
  }

  if (ambiguous) {
    await createDisambiguationSession({
      supabase: opts.supabase,
      userId: opts.userId,
      conversationId: opts.conversationId,
      intentType: "playlist",
      normalizedQuery: normalized.key,
      candidates: ranked.slice(0, 5).map((p, i) => ({
        providerId: p.id,
        providerUri: p.uri,
        name: p.name,
        playlistName: p.name,
        referenceId: playlists[i]?.referenceId,
      })),
    });
    return {
      success: false,
      error: {
        code: "AMBIGUOUS_PLAYLIST",
        message: "Multiple matching playlists — ask which one.",
      },
      data: {
        playlists,
        ambiguous: true,
        normalizedQuery: normalized.key,
        source: "owned",
      },
      message: `Found ${playlists.length} playlists. Ask which one.`,
      activityLabel: "Found playlists",
    };
  }

  return {
    success: true,
    data: {
      playlists,
      ambiguous: false,
      normalizedQuery: normalized.key,
      source: "owned",
    },
    message: `Found playlist ${playlists[0]?.name}.`,
    activityLabel: `Found · ${playlists[0]?.name ?? "playlist"}`,
  };
}

export async function learnFromSuccessfulPlay(opts: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string;
  kind: "track" | "playlist";
  providerId: string;
  providerUri: string;
  name: string;
  artists?: string;
  album?: string;
  explicit?: boolean;
  normalizedQuery?: string;
  source?: MusicPreferenceSource;
  temporary?: boolean;
  persist?: boolean;
}): Promise<void> {
  if (opts.temporary && !opts.persist) return;
  const source: MusicPreferenceSource =
    opts.source ??
    (opts.persist ? "USER_EXPLICITLY_PREFERRED" : "USER_SELECTED");
  // Only learn when we have a normalized query from a prior disambiguation/search
  if (!opts.normalizedQuery) return;
  // INFERRED path is not used here — require USER_SELECTED+ from disambiguation or explicit persist
  if (source === "INFERRED") return;

  await upsertMusicPreference({
    supabase: opts.supabase,
    userId: opts.userId,
    input: {
      intentType: opts.kind,
      normalizedQuery: opts.normalizedQuery,
      spotifyResourceType: opts.kind,
      spotifyResourceId: opts.providerId,
      spotifyResourceUri: opts.providerUri,
      trackName: opts.kind === "track" ? opts.name : null,
      artistName: opts.artists ?? null,
      albumName: opts.album ?? null,
      playlistName: opts.kind === "playlist" ? opts.name : null,
      explicit: opts.explicit ?? null,
      source,
    },
  });
}

export function trackHitToRankable(t: SpotifyTrackHit) {
  return t;
}
