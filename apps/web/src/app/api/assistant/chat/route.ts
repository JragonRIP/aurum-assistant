import { isAuthError, requireAuth } from "@/lib/auth";
import { hasGeminiConfig } from "@/lib/env";
import { ChatRequestSchema } from "@/lib/conversations/schemas";
import {
  ChatServiceError,
  createChatStream,
} from "@/lib/conversations/chat-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const routeStartedAt = Date.now();
  const auth = await requireAuth();
  const authCompletedAt = Date.now();
  if (isAuthError(auth)) return auth;

  if (!hasGeminiConfig()) {
    return Response.json(
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
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const stream = createChatStream({
      supabase: auth.supabase,
      userId: auth.user.id,
      conversationId: parsed.data.conversationId,
      content: parsed.data.content,
      retryOfUserMessageId: parsed.data.retryOfUserMessageId,
      generationId: parsed.data.generationId,
      clientSentAt: parsed.data.clientSentAt,
      deviceType: "WEB",
      signal: request.signal,
      routeStartedAt,
      authCompletedAt,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    if (err instanceof ChatServiceError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to start chat stream";
    console.error("[aurum] /api/assistant/chat:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
