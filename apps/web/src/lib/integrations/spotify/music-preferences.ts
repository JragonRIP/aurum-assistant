/**
 * Persistent user-scoped Spotify/music resolution preferences.
 * Stores stable Spotify resource ids — never temporary trusted-ref UUIDs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MusicIntentType = "track" | "playlist" | "album";
export type MusicPreferenceSource =
  | "INFERRED"
  | "USER_SELECTED"
  | "USER_EXPLICITLY_PREFERRED";

export type MusicPreferenceRow = {
  id: string;
  user_id: string;
  intent_type: MusicIntentType;
  normalized_query: string;
  spotify_resource_type: MusicIntentType;
  spotify_resource_id: string;
  spotify_resource_uri: string;
  track_name: string | null;
  artist_name: string | null;
  album_name: string | null;
  playlist_name: string | null;
  explicit: boolean | null;
  source: MusicPreferenceSource;
  confidence: number;
  stale: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export type UpsertMusicPreferenceInput = {
  intentType: MusicIntentType;
  normalizedQuery: string;
  spotifyResourceType: MusicIntentType;
  spotifyResourceId: string;
  spotifyResourceUri: string;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  playlistName?: string | null;
  explicit?: boolean | null;
  source: MusicPreferenceSource;
  confidence?: number;
};

function sourceRank(source: MusicPreferenceSource): number {
  if (source === "USER_EXPLICITLY_PREFERRED") return 3;
  if (source === "USER_SELECTED") return 2;
  return 1;
}

function defaultConfidence(source: MusicPreferenceSource): number {
  if (source === "USER_EXPLICITLY_PREFERRED") return 0.95;
  if (source === "USER_SELECTED") return 0.85;
  return 0.55;
}

export async function getMusicPreference(opts: {
  supabase: SupabaseClient;
  userId: string;
  intentType: MusicIntentType;
  normalizedQuery: string;
}): Promise<MusicPreferenceRow | null> {
  const { data, error } = await opts.supabase
    .from("music_resolution_preferences")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("intent_type", opts.intentType)
    .eq("normalized_query", opts.normalizedQuery)
    .eq("stale", false)
    .maybeSingle();
  if (error || !data) return null;
  return data as MusicPreferenceRow;
}

export async function listMusicPreferences(opts: {
  supabase: SupabaseClient;
  userId: string;
  intentType?: MusicIntentType;
  limit?: number;
}): Promise<MusicPreferenceRow[]> {
  let q = opts.supabase
    .from("music_resolution_preferences")
    .select("*")
    .eq("user_id", opts.userId)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 100));
  if (opts.intentType) q = q.eq("intent_type", opts.intentType);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as MusicPreferenceRow[];
}

export async function upsertMusicPreference(opts: {
  supabase: SupabaseClient;
  userId: string;
  input: UpsertMusicPreferenceInput;
}): Promise<MusicPreferenceRow | null> {
  const { input } = opts;
  const existing = await getMusicPreference({
    supabase: opts.supabase,
    userId: opts.userId,
    intentType: input.intentType,
    normalizedQuery: input.normalizedQuery,
  });

  // Do not let INFERRED overwrite a stronger user choice
  if (
    existing &&
    sourceRank(input.source) < sourceRank(existing.source) &&
    existing.spotify_resource_id !== input.spotifyResourceId
  ) {
    return existing;
  }

  const confidence = input.confidence ?? defaultConfidence(input.source);
  const now = new Date().toISOString();
  const row = {
    user_id: opts.userId,
    intent_type: input.intentType,
    normalized_query: input.normalizedQuery,
    spotify_resource_type: input.spotifyResourceType,
    spotify_resource_id: input.spotifyResourceId,
    spotify_resource_uri: input.spotifyResourceUri,
    track_name: input.trackName ?? null,
    artist_name: input.artistName ?? null,
    album_name: input.albumName ?? null,
    playlist_name: input.playlistName ?? null,
    explicit: input.explicit ?? null,
    source: input.source,
    confidence,
    stale: false,
    updated_at: now,
    last_used_at: now,
    use_count: existing ? existing.use_count + 1 : 1,
  };

  const { data, error } = await opts.supabase
    .from("music_resolution_preferences")
    .upsert(row, { onConflict: "user_id,intent_type,normalized_query" })
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return data as MusicPreferenceRow;
}

export async function touchMusicPreference(opts: {
  supabase: SupabaseClient;
  userId: string;
  preferenceId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data } = await opts.supabase
    .from("music_resolution_preferences")
    .select("use_count")
    .eq("id", opts.preferenceId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  const useCount = Number(data?.use_count ?? 0) + 1;
  await opts.supabase
    .from("music_resolution_preferences")
    .update({
      last_used_at: now,
      use_count: useCount,
      updated_at: now,
    })
    .eq("id", opts.preferenceId)
    .eq("user_id", opts.userId);
}

export async function markMusicPreferenceStale(opts: {
  supabase: SupabaseClient;
  userId: string;
  preferenceId: string;
}): Promise<void> {
  await opts.supabase
    .from("music_resolution_preferences")
    .update({
      stale: true,
      confidence: 0.1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.preferenceId)
    .eq("user_id", opts.userId);
}

export async function deleteMusicPreference(opts: {
  supabase: SupabaseClient;
  userId: string;
  preferenceId: string;
}): Promise<boolean> {
  const { error } = await opts.supabase
    .from("music_resolution_preferences")
    .delete()
    .eq("id", opts.preferenceId)
    .eq("user_id", opts.userId);
  return !error;
}

export async function clearMusicPreferences(opts: {
  supabase: SupabaseClient;
  userId: string;
  intentType?: MusicIntentType;
}): Promise<number> {
  let q = opts.supabase
    .from("music_resolution_preferences")
    .delete()
    .eq("user_id", opts.userId);
  if (opts.intentType) q = q.eq("intent_type", opts.intentType);
  const { data, error } = await q.select("id");
  if (error || !data) return 0;
  return data.length;
}

export async function forgetMusicPreferenceByQuery(opts: {
  supabase: SupabaseClient;
  userId: string;
  intentType: MusicIntentType;
  normalizedQuery: string;
}): Promise<boolean> {
  const { error } = await opts.supabase
    .from("music_resolution_preferences")
    .delete()
    .eq("user_id", opts.userId)
    .eq("intent_type", opts.intentType)
    .eq("normalized_query", opts.normalizedQuery);
  return !error;
}
