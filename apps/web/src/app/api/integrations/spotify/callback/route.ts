import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicEnv } from "@/lib/env";
import { completeSpotifyOAuth } from "@/lib/integrations/spotify/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { appUrl } = getPublicEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=missing_code`,
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(`${appUrl}/login?next=/settings`);
    }

    const { redirectTo } = await completeSpotifyOAuth({
      supabase,
      userId: user.id,
      code,
      state,
    });

    const target = redirectTo.startsWith("http")
      ? redirectTo
      : `${appUrl}${redirectTo.startsWith("/") ? "" : "/"}${redirectTo}`;
    return NextResponse.redirect(target);
  } catch {
    return NextResponse.redirect(
      `${appUrl}/settings?spotify=error&reason=callback_failed`,
    );
  }
}
