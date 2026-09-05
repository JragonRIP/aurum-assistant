import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  deleteMusicPreference,
  upsertMusicPreference,
} from "@/lib/integrations/spotify/music-preferences";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const ok = await deleteMusicPreference({
    supabase: auth.supabase,
    userId: auth.user.id,
    preferenceId: id,
  });
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

const PatchSchema = z.object({
  source: z
    .enum(["INFERRED", "USER_SELECTED", "USER_EXPLICITLY_PREFERRED"])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  stale: z.boolean().optional(),
});

/** Limited update — never accepts Spotify tokens. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 422 });
  }

  // Load existing via delete-safe update path
  const { data: existing } = await auth.supabase
    .from("music_resolution_preferences")
    .select("*")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.stale === true) {
    await auth.supabase
      .from("music_resolution_preferences")
      .update({
        stale: true,
        confidence: 0.1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", auth.user.id);
    return NextResponse.json({ ok: true });
  }

  // Re-upsert with stronger source if requested
  if (parsed.data.source || parsed.data.confidence !== undefined) {
    await upsertMusicPreference({
      supabase: auth.supabase,
      userId: auth.user.id,
      input: {
        intentType: existing.intent_type,
        normalizedQuery: existing.normalized_query,
        spotifyResourceType: existing.spotify_resource_type,
        spotifyResourceId: existing.spotify_resource_id,
        spotifyResourceUri: existing.spotify_resource_uri,
        trackName: existing.track_name,
        artistName: existing.artist_name,
        albumName: existing.album_name,
        playlistName: existing.playlist_name,
        explicit: existing.explicit,
        source: parsed.data.source ?? existing.source,
        confidence: parsed.data.confidence ?? existing.confidence,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
