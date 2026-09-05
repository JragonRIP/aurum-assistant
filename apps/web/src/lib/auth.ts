import { NextResponse } from "next/server";
import type { User, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";

export type AuthSuccess = {
  supabase: SupabaseClient;
  user: User;
};

export async function requireAuth(): Promise<AuthSuccess | NextResponse> {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { supabase, user };
}

export function isAuthError(
  value: AuthSuccess | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}
