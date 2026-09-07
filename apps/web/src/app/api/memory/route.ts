import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createMemory,
  searchMemories,
} from "@/lib/memory/service";
import type { MemoryImportance, MemoryType } from "@aurum/shared";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? undefined;
  const type = (url.searchParams.get("type") as MemoryType | null) ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "40");

  try {
    const items = await searchMemories(supabase, user.id, {
      query,
      type: type ?? undefined,
      limit: Number.isFinite(limit) ? limit : 40,
    });
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list memories" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const item = await createMemory(supabase, user.id, {
      title: String(body.title ?? ""),
      content: String(body.content ?? ""),
      type: (body.type as MemoryType) ?? "FACT",
      importance: (body.importance as MemoryImportance) ?? "USEFUL",
      canonicalKey:
        typeof body.canonicalKey === "string" ? body.canonicalKey : null,
      sourceType: "MANUAL_EDIT",
      confidence: 1,
    });
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create memory" },
      { status: 400 },
    );
  }
}
