import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  clearMusicPreferences,
  listMusicPreferences,
} from "@/lib/integrations/spotify/music-preferences";

export const dynamic = "force-dynamic";

/** List the authenticated user's music resolution preferences. */
export async function GET(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const url = new URL(request.url);
  const intentType = url.searchParams.get("intentType");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const parsedIntent =
    intentType === "track" ||
    intentType === "playlist" ||
    intentType === "album"
      ? intentType
      : undefined;

  const rows = await listMusicPreferences({
    supabase: auth.supabase,
    userId: auth.user.id,
    intentType: parsedIntent,
    limit: Number.isFinite(limit) ? limit : 50,
  });

  return NextResponse.json({
    preferences: rows.map((r) => ({
      id: r.id,
      intentType: r.intent_type,
      query: r.normalized_query,
      resourceType: r.spotify_resource_type,
      name: r.track_name ?? r.playlist_name ?? r.album_name,
      artists: r.artist_name,
      explicit: r.explicit,
      source: r.source,
      confidence: r.confidence,
      useCount: r.use_count,
      lastUsedAt: r.last_used_at,
      stale: r.stale,
      // Never expose Spotify tokens; resource id is ok for the owner
      spotifyResourceId: r.spotify_resource_id,
    })),
  });
}

const ClearSchema = z.object({
  intentType: z.enum(["track", "playlist", "album"]).optional(),
});

/** Clear music preferences (optional intentType filter). */
export async function DELETE(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const parsed = ClearSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 422 });
  }

  const n = await clearMusicPreferences({
    supabase: auth.supabase,
    userId: auth.user.id,
    intentType: parsed.data.intentType,
  });
  return NextResponse.json({ ok: true, cleared: n });
}
