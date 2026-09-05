import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { RenameConversationSchema } from "@/lib/conversations/schemas";
import {
  deleteConversation,
  getConversationForUser,
  renameConversation,
} from "@/lib/conversations/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;

  try {
    const conversation = await getConversationForUser(
      auth.supabase,
      id,
      auth.user.id,
    );
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ conversation });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RenameConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid title", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await getConversationForUser(
    auth.supabase,
    id,
    auth.user.id,
  );
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const conversation = await renameConversation(
      auth.supabase,
      id,
      auth.user.id,
      parsed.data.title,
    );
    return NextResponse.json({ conversation });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to rename conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;

  const existing = await getConversationForUser(
    auth.supabase,
    id,
    auth.user.id,
  );
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await deleteConversation(auth.supabase, id, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
