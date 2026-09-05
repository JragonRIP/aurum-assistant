import { NextResponse } from "next/server";
import { hasGeminiConfig } from "@/lib/env";
import { ChatRequestSchema } from "@/lib/conversations/schemas";
import {
  ChatServiceError,
  createChatStream,
} from "@/lib/conversations/chat-service";
import {
  isDeviceAuthError,
  requireDeviceAuth,
} from "@/lib/devices/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Overlay / companion chat — authenticated via device credential.
 * Same agent brain as web; deviceType WINDOWS_DESKTOP.
 */
export async function POST(request: Request) {
  const routeStartedAt = Date.now();
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) return auth;

  if (!hasGeminiConfig()) {
    return NextResponse.json(
      {
        error:
          "AI not configured. Add GEMINI_API_KEY to apps/web/.env.local and restart the server.",
        code: "ai_not_configured",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const stream = createChatStream({
      supabase: auth.supabase,
      userId: auth.device.user_id,
      conversationId: parsed.data.conversationId,
      content: parsed.data.content,
      retryOfUserMessageId: parsed.data.retryOfUserMessageId,
      generationId: parsed.data.generationId,
      clientSentAt: parsed.data.clientSentAt,
      deviceType: "WINDOWS_DESKTOP",
      signal: request.signal,
      routeStartedAt,
      authCompletedAt: Date.now(),
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof ChatServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error("[aurum:device-chat]", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
