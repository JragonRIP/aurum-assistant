/**
 * Canonical structured memory service — all writes go through here.
 * Gemini never writes to Supabase directly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryImportance, MemoryType } from "@aurum/shared";
import {
  categoryFromType,
  formatMemoriesForPrompt,
  gateMemoryCandidate,
  importanceToLegacyInt,
  normalizeCanonicalKey,
  parseResponseDetailValue,
  rankMemoryScore,
  RESPONSE_DETAIL_CANONICAL_KEY,
  type CreateMemoryInput,
  type MemoryCandidate,
  type MemoryItem,
} from "./types";
import { afterStructuredMemoryWrite } from "./vault-sync";

function mapRow(row: Record<string, unknown>): MemoryItem {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title ?? row.content ?? "Memory"),
    content: String(row.content),
    summary: (row.summary as string | null) ?? null,
    memory_type: row.memory_type as MemoryType,
    importance_level: row.importance_level as MemoryImportance,
    status: (row.status as MemoryItem["status"]) ?? "ACTIVE",
    canonical_key: (row.canonical_key as string | null) ?? null,
    subject_key: (row.subject_key as string | null) ?? null,
    source_type: (row.source_type as MemoryItem["source_type"]) ?? null,
    source_id: (row.source_id as string | null) ?? null,
    confidence: Number(row.confidence ?? 0.8),
    valid_from: (row.valid_from as string | null) ?? null,
    valid_until: (row.valid_until as string | null) ?? null,
    supersedes_memory_id: (row.supersedes_memory_id as string | null) ?? null,
    superseded_by_memory_id:
      (row.superseded_by_memory_id as string | null) ?? null,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
    vault_sync_status: (row.vault_sync_status as MemoryItem["vault_sync_status"]) ??
      "PENDING",
    last_accessed_at: (row.last_accessed_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

const SELECT_COLS =
  "id, user_id, title, content, summary, memory_type, importance_level, status, canonical_key, subject_key, source_type, source_id, confidence, valid_from, valid_until, supersedes_memory_id, superseded_by_memory_id, metadata, vault_sync_status, last_accessed_at, created_at, updated_at";

export async function expireTemporaryMemories(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<number> {
  const { data, error } = await supabase
    .from("memories")
    .update({ status: "ARCHIVED", is_active: false, updated_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .not("valid_until", "is", null)
    .lt("valid_until", now.toISOString())
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function getMemoryByKey(
  supabase: SupabaseClient,
  userId: string,
  canonicalKey: string,
): Promise<MemoryItem | null> {
  const key = normalizeCanonicalKey(canonicalKey);
  const { data, error } = await supabase
    .from("memories")
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .eq("canonical_key", key)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function getMemoryById(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<MemoryItem | null> {
  const { data, error } = await supabase
    .from("memories")
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function createMemory(
  supabase: SupabaseClient,
  userId: string,
  input: CreateMemoryInput,
): Promise<MemoryItem> {
  const canonicalKey = input.canonicalKey
    ? normalizeCanonicalKey(input.canonicalKey)
    : null;
  const importance = input.importance ?? "USEFUL";

  if (canonicalKey) {
    const existing = await getMemoryByKey(supabase, userId, canonicalKey);
    if (existing) {
      if (existing.importance_level === "PINNED" && importance !== "PINNED") {
        // Pinned requires explicit pin-level update
        if (input.sourceType !== "USER_EXPLICIT" && input.sourceType !== "MANUAL_EDIT" && input.sourceType !== "USER_CORRECTION") {
          throw new Error("Pinned memory requires an explicit update.");
        }
      }
      return updateMemory(supabase, userId, existing.id, {
        title: input.title,
        content: input.content,
        type: input.type,
        importance,
        confidence: input.confidence,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        validUntil: input.validUntil,
        metadata: input.metadata,
        summary: input.summary,
      });
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      title: input.title.trim().slice(0, 200),
      content: input.content.trim().slice(0, 4000),
      summary: input.summary ?? null,
      category: categoryFromType(input.type),
      importance: importanceToLegacyInt(importance),
      memory_type: input.type,
      importance_level: importance,
      status: "ACTIVE",
      is_active: true,
      canonical_key: canonicalKey,
      subject_key: input.subjectKey ?? null,
      source_type: input.sourceType ?? "USER_EXPLICIT",
      source_id: input.sourceId ?? null,
      confidence: input.confidence ?? 0.95,
      valid_until: input.validUntil ?? null,
      metadata: input.metadata ?? {},
      vault_sync_status: "SKIPPED",
      created_at: now,
      updated_at: now,
    })
    .select(SELECT_COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create memory");
  const created = mapRow(data as Record<string, unknown>);
  await afterStructuredMemoryWrite(supabase, userId, created.id);
  return (await getMemoryById(supabase, userId, created.id)) ?? created;
}

export async function updateMemory(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  patch: Partial<CreateMemoryInput> & { type?: MemoryType },
): Promise<MemoryItem> {
  const existing = await getMemoryById(supabase, userId, id);
  if (!existing || existing.status === "DELETED") {
    throw new Error("Memory not found.");
  }
  const type = patch.type ?? existing.memory_type;
  const importance = patch.importance ?? existing.importance_level;
  const { data, error } = await supabase
    .from("memories")
    .update({
      title: patch.title?.trim().slice(0, 200) ?? existing.title,
      content: patch.content?.trim().slice(0, 4000) ?? existing.content,
      summary: patch.summary === undefined ? existing.summary : patch.summary,
      memory_type: type,
      category: categoryFromType(type),
      importance_level: importance,
      importance: importanceToLegacyInt(importance),
      confidence: patch.confidence ?? existing.confidence,
      source_type: patch.sourceType ?? existing.source_type,
      source_id: patch.sourceId === undefined ? existing.source_id : patch.sourceId,
      valid_until:
        patch.validUntil === undefined ? existing.valid_until : patch.validUntil,
      metadata: patch.metadata ?? existing.metadata ?? {},
      vault_sync_status: existing.vault_sync_status,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", id)
    .select(SELECT_COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update memory");
  const updated = mapRow(data as Record<string, unknown>);
  await afterStructuredMemoryWrite(supabase, userId, updated.id);
  return (await getMemoryById(supabase, userId, updated.id)) ?? updated;
}

export async function supersedeMemory(
  supabase: SupabaseClient,
  userId: string,
  oldId: string,
  input: CreateMemoryInput,
): Promise<MemoryItem> {
  const old = await getMemoryById(supabase, userId, oldId);
  if (!old) throw new Error("Memory not found.");
  if (old.importance_level === "PINNED" && input.importance !== "PINNED") {
    if (input.sourceType !== "USER_EXPLICIT" && input.sourceType !== "USER_CORRECTION" && input.sourceType !== "MANUAL_EDIT") {
      throw new Error("Pinned memory cannot be silently superseded.");
    }
  }

  const created = await createMemory(supabase, userId, {
    ...input,
    canonicalKey: input.canonicalKey ?? old.canonical_key,
  });

  await supabase
    .from("memories")
    .update({
      status: "SUPERSEDED",
      is_active: false,
      superseded_by_memory_id: created.id,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", oldId);
  await afterStructuredMemoryWrite(supabase, userId, oldId);

  await supabase
    .from("memories")
    .update({
      supersedes_memory_id: oldId,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", created.id);

  return (await getMemoryById(supabase, userId, created.id))!;
}

export async function forgetMemory(
  supabase: SupabaseClient,
  userId: string,
  idOrKey: string,
): Promise<{ forgotten: boolean; id?: string }> {
  let item = await getMemoryById(supabase, userId, idOrKey).catch(() => null);
  if (!item && !idOrKey.includes("-")) {
    item = await getMemoryByKey(supabase, userId, idOrKey);
  } else if (!item) {
    // try as key anyway
    item = await getMemoryByKey(supabase, userId, idOrKey);
  }
  if (!item || item.status === "DELETED") return { forgotten: false };

  const { error } = await supabase
    .from("memories")
    .update({
      status: "DELETED",
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("id", item.id);
  if (error) throw new Error(error.message);
  await afterStructuredMemoryWrite(supabase, userId, item.id);
  return { forgotten: true, id: item.id };
}

export async function searchMemories(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    query?: string;
    type?: MemoryType;
    limit?: number;
    includeExpired?: boolean;
  } = {},
): Promise<MemoryItem[]> {
  await expireTemporaryMemories(supabase, userId);
  let q = supabase
    .from("memories")
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 25);

  if (opts.type) q = q.eq("memory_type", opts.type);
  if (opts.query?.trim()) {
    const raw = opts.query.trim().replace(/[%_,]/g, " ").slice(0, 80);
    if (raw) {
      q = q.or(`title.ilike.%${raw}%,content.ilike.%${raw}%`);
    }
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const items = (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
  if (!opts.includeExpired) {
    const now = Date.now();
    return items.filter(
      (m) => !m.valid_until || new Date(m.valid_until).getTime() >= now,
    );
  }
  return items;
}

export async function listRelevantMemories(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  limit = 6,
): Promise<MemoryItem[]> {
  await expireTemporaryMemories(supabase, userId);
  const { data, error } = await supabase
    .from("memories")
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  const items = (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
  const now = new Date();
  const ranked = items
    .map((item) => ({ item, score: rankMemoryScore({ item, query, now }) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, Math.min(8, limit)));

  // Always include response_detail preference when present
  const pref = items.find(
    (m) => m.canonical_key === RESPONSE_DETAIL_CANONICAL_KEY,
  );
  if (pref && !ranked.some((r) => r.item.id === pref.id)) {
    ranked.unshift({ item: pref, score: 100 });
  }

  const selected = ranked.slice(0, limit).map((r) => r.item);
  if (selected.length > 0) {
    const ids = selected.map((m) => m.id);
    void supabase
      .from("memories")
      .update({ last_accessed_at: now.toISOString() })
      .eq("user_id", userId)
      .in("id", ids);
  }
  return selected;
}

export async function applyMemoryCandidate(
  supabase: SupabaseClient,
  userId: string,
  candidate: MemoryCandidate,
  opts?: { explicit?: boolean; sourceId?: string | null },
): Promise<{ ok: boolean; reason?: string; memory?: MemoryItem }> {
  const reject = gateMemoryCandidate(candidate, { explicit: opts?.explicit });
  if (reject) return { ok: false, reason: reject };

  const sourceType = opts?.explicit
    ? candidate.action === "UPDATE" || candidate.action === "SUPERSEDE"
      ? "USER_CORRECTION"
      : "USER_EXPLICIT"
    : "INFERRED_FROM_CONVERSATION";

  if (candidate.action === "UPDATE" || candidate.action === "SUPERSEDE") {
    const key = candidate.canonicalKey
      ? normalizeCanonicalKey(candidate.canonicalKey)
      : null;
    const existing = key ? await getMemoryByKey(supabase, userId, key) : null;
    if (existing && candidate.action === "SUPERSEDE") {
      const memory = await supersedeMemory(supabase, userId, existing.id, {
        title: candidate.title,
        content: candidate.content,
        type: candidate.type,
        importance: candidate.importance,
        canonicalKey: key,
        confidence: candidate.confidence,
        sourceType,
        sourceId: opts?.sourceId ?? null,
        validUntil: candidate.validUntil ?? null,
      });
      return { ok: true, memory };
    }
    if (existing) {
      const memory = await updateMemory(supabase, userId, existing.id, {
        title: candidate.title,
        content: candidate.content,
        type: candidate.type,
        importance: candidate.importance,
        confidence: candidate.confidence,
        sourceType,
        sourceId: opts?.sourceId ?? null,
        validUntil: candidate.validUntil ?? null,
      });
      return { ok: true, memory };
    }
  }

  const memory = await createMemory(supabase, userId, {
    title: candidate.title,
    content: candidate.content,
    type: candidate.type,
    importance: candidate.importance,
    canonicalKey: candidate.canonicalKey ?? null,
    confidence: candidate.confidence,
    sourceType,
    sourceId: opts?.sourceId ?? null,
    validUntil: candidate.validUntil ?? null,
  });
  return { ok: true, memory };
}

export async function getResponseDetailPreference(
  supabase: SupabaseClient,
  userId: string,
): Promise<"concise" | "balanced" | "detailed"> {
  try {
    const { data: settings } = await supabase
      .from("memory_settings")
      .select("response_detail_preference")
      .eq("user_id", userId)
      .maybeSingle();
    if (
      settings?.response_detail_preference === "concise" ||
      settings?.response_detail_preference === "balanced" ||
      settings?.response_detail_preference === "detailed"
    ) {
      return settings.response_detail_preference;
    }
  } catch {
    // table may not exist yet locally
  }

  const mem = await getMemoryByKey(
    supabase,
    userId,
    RESPONSE_DETAIL_CANONICAL_KEY,
  ).catch(() => null);
  if (mem) {
    return parseResponseDetailValue(mem.content) ?? "concise";
  }
  return "concise";
}

export async function setResponseDetailPreference(
  supabase: SupabaseClient,
  userId: string,
  value: "concise" | "balanced" | "detailed",
  sourceId?: string | null,
): Promise<MemoryItem> {
  await supabase.from("memory_settings").upsert(
    {
      user_id: userId,
      response_detail_preference: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return createMemory(supabase, userId, {
    title: "Response detail preference",
    content: `User prefers ${value} answers by default.`,
    type: "PREFERENCE",
    importance: "IMPORTANT",
    canonicalKey: RESPONSE_DETAIL_CANONICAL_KEY,
    confidence: 1,
    sourceType: "USER_EXPLICIT",
    sourceId: sourceId ?? null,
  });
}

export { formatMemoriesForPrompt };
