import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  getConversationForUser,
  listMessages,
} from "@/lib/conversations/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const auth = await requireAuth();
  if (isAuthError(auth)) {
    console.error("[aurum:messages]", {
      requestId,
      authenticated: false,
      httpStatus: auth.status,
      durationMs: Date.now() - started,
    });
    return auth;
  }
  const { id } = await params;

  try {
    const conversation = await getConversationForUser(
      auth.supabase,
      id,
      auth.user.id,
    );
    if (!conversation) {
      return NextResponse.json(
        { error: "Not found", requestId },
        { status: 404 },
      );
    }

    const messages = await listMessages(auth.supabase, id, auth.user.id);
    console.info("[aurum:messages]", {
      requestId,
      authenticated: true,
      conversationId: id,
      count: messages.length,
      httpStatus: 200,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ messages, requestId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to list messages";
    console.error("[aurum:messages]", {
      requestId,
      authenticated: true,
      conversationId: id,
      httpStatus: 500,
      supabaseError: message.slice(0, 300),
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ error: message, requestId }, { status: 500 });
  }
}
