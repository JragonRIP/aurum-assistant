import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { startSpotifyConnect } from "@/lib/integrations/spotify/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      redirectTo?: string;
    };
    const { authorizeUrl } = await startSpotifyConnect({
      supabase: auth.supabase,
      userId: auth.user.id,
      redirectTo: body.redirectTo,
    });
    return NextResponse.json({ authorizeUrl });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not start Spotify connect",
      },
      { status: 500 },
    );
  }
}
