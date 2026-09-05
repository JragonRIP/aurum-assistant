import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { listNotes } from "@/lib/notes/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  try {
    const notes = await listNotes(auth.supabase, auth.user.id, { limit: 40 });
    return NextResponse.json({ notes });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load notes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
