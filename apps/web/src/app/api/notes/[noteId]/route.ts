import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { getNoteById } from "@/lib/notes/queries";
import { isUuid } from "@aurum/shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ noteId: string }> };

export async function GET(_request: Request, context: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { noteId } = await context.params;
  if (!isUuid(noteId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const note = await getNoteById(auth.supabase, auth.user.id, noteId);
    if (!note) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
