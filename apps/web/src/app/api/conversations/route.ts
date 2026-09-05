import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { CreateConversationSchema } from "@/lib/conversations/schemas";
import {
  createConversation,
  listConversations,
} from "@/lib/conversations/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const auth = await requireAuth();
  if (isAuthError(auth)) {
    console.error("[aurum:conversations]", {
      requestId,
      authenticated: false,
      httpStatus: auth.status,
      durationMs: Date.now() - started,
    });
    return auth;
  }

  try {
    // Dev-only resilience probe: ?forceError=1 or AURUM_FORCE_CONVERSATIONS_ERROR=1
    const forceError =
      process.env.NODE_ENV === "development" &&
      (process.env.AURUM_FORCE_CONVERSATIONS_ERROR === "1" ||
        new URL(request.url).searchParams.get("forceError") === "1");
    if (forceError) {
      console.error("[aurum:conversations]", {
        requestId,
        authenticated: true,
        userIdPrefix: auth.user.id.slice(0, 8),
        httpStatus: 503,
        supabaseError: "forced_dev_failure",
        durationMs: Date.now() - started,
      });
      return NextResponse.json(
        { error: "Forced conversation list failure (dev)", requestId },
        { status: 503 },
      );
    }

    const conversations = await listConversations(auth.supabase, auth.user.id);
    console.info("[aurum:conversations]", {
      requestId,
      authenticated: true,
      userIdPrefix: auth.user.id.slice(0, 8),
      count: conversations.length,
      httpStatus: 200,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ conversations, requestId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to list conversations";
    console.error("[aurum:conversations]", {
      requestId,
      authenticated: true,
      userIdPrefix: auth.user.id.slice(0, 8),
      httpStatus: 500,
      supabaseError: message.slice(0, 300),
      durationMs: Date.now() - started,
    });
    return NextResponse.json(
      { error: message, requestId },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = CreateConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const conversation = await createConversation(
      auth.supabase,
      auth.user.id,
      parsed.data.title,
    );
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
