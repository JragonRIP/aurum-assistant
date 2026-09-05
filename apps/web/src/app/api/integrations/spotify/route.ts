import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { disconnectSpotify } from "@/lib/integrations/spotify/service";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  try {
    await disconnectSpotify({
      supabase: auth.supabase,
      userId: auth.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not disconnect Spotify",
      },
      { status: 500 },
    );
  }
}
