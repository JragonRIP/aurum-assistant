import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CONVERSATION_TITLE } from "@aurum/ai";

export type MessageStatus = "complete" | "partial" | "error";

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  device_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  status: MessageStatus;
  metadata: Record<string, unknown>;
  tool_name: string | null;
  tool_call_id: string | null;
  created_at: string;
}

/** Cached detection of Phase 2 message columns */
let messageMetaSupported: boolean | null = null;

type DbMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRow["role"];
  content: string;
  tool_name: string | null;
  tool_call_id: string | null;
  created_at: string;
  status?: MessageStatus;
  metadata?: Record<string, unknown> | null;
};

function normalizeMessage(row: DbMessage): MessageRow {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    user_id: row.user_id,
    role: row.role,
    content: row.content,
    status: row.status ?? "complete",
    metadata: row.metadata ?? {},
    tool_name: row.tool_name,
    tool_call_id: row.tool_call_id,
    created_at: row.created_at,
  };
}

function isMissingColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("status") ||
    lower.includes("metadata") ||
    lower.includes("42703") ||
    lower.includes("does not exist")
  );
}

export async function listConversations(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, user_id, title, device_id, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list conversations: ${error.message}`);
  }
  return (data ?? []) as ConversationRow[];
}

export async function getConversationForUser(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, user_id, title, device_id, created_at, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load conversation: ${error.message}`);
  }
  return data as ConversationRow | null;
}

export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  title?: string,
): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      title: title?.trim() || DEFAULT_CONVERSATION_TITLE,
    })
    .select("id, user_id, title, device_id, created_at, updated_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create conversation: ${error?.message}`);
  }
  return data as ConversationRow;
}

export async function renameConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  title: string,
): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select("id, user_id, title, device_id, created_at, updated_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to rename conversation: ${error?.message}`);
  }
  return data as ConversationRow;
}

export async function deleteConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }
}

export async function listMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  options?: { limit?: number },
): Promise<MessageRow[]> {
  const limit = options?.limit;

  // Single query first. Fall back if Phase 2 columns are absent.
  if (messageMetaSupported !== false) {
    let query = supabase
      .from("messages")
      .select(
        "id, conversation_id, user_id, role, content, tool_name, tool_call_id, created_at, status, metadata",
      )
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (limit != null && limit > 0) {
      query = query.limit(limit);
    }

    const full = await query;

    if (!full.error && full.data) {
      messageMetaSupported = true;
      const rows = (full.data as DbMessage[]).map((row) =>
        normalizeMessage(row),
      );
      return rows.reverse();
    }

    if (full.error && isMissingColumnError(full.error.message)) {
      messageMetaSupported = false;
    } else if (full.error) {
      throw new Error(`Failed to list messages: ${full.error.message}`);
    }
  }

  let basicQuery = supabase
    .from("messages")
    .select(
      "id, conversation_id, user_id, role, content, tool_name, tool_call_id, created_at",
    )
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (limit != null && limit > 0) {
    basicQuery = basicQuery.limit(limit);
  }

  const basic = await basicQuery;

  if (basic.error) {
    throw new Error(`Failed to list messages: ${basic.error.message}`);
  }

  return ((basic.data ?? []) as DbMessage[])
    .map((row) => normalizeMessage(row))
    .reverse();
}

export async function insertMessage(
  supabase: SupabaseClient,
  input: {
    conversationId: string;
    userId: string;
    role: MessageRow["role"];
    content: string;
    status?: MessageStatus;
    metadata?: Record<string, unknown>;
  },
): Promise<MessageRow> {
  const basePayload = {
    conversation_id: input.conversationId,
    user_id: input.userId,
    role: input.role,
    content: input.content,
  };

  if (messageMetaSupported !== false) {
    const full = await supabase
      .from("messages")
      .insert({
        ...basePayload,
        status: input.status ?? "complete",
        metadata: input.metadata ?? {},
      })
      .select(
        "id, conversation_id, user_id, role, content, tool_name, tool_call_id, created_at, status, metadata",
      )
      .single();

    if (!full.error && full.data) {
      messageMetaSupported = true;
      return normalizeMessage(full.data as DbMessage);
    }

    if (full.error && isMissingColumnError(full.error.message)) {
      messageMetaSupported = false;
    } else if (full.error) {
      throw new Error(`Failed to insert message: ${full.error.message}`);
    }
  }

  const basic = await supabase
    .from("messages")
    .insert(basePayload)
    .select(
      "id, conversation_id, user_id, role, content, tool_name, tool_call_id, created_at",
    )
    .single();

  if (basic.error || !basic.data) {
    throw new Error(`Failed to insert message: ${basic.error?.message}`);
  }

  return normalizeMessage({
    ...(basic.data as DbMessage),
    status: input.status ?? "complete",
    metadata: input.metadata ?? {},
  });
}

export async function getMessageForUser(
  supabase: SupabaseClient,
  messageId: string,
  userId: string,
): Promise<MessageRow | null> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, user_id, role, content, tool_name, tool_call_id, created_at",
    )
    .eq("id", messageId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load message: ${error.message}`);
  }
  if (!data) return null;
  return normalizeMessage(data as DbMessage);
}

export async function touchConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update conversation: ${error.message}`);
  }
}

export async function recordGeneration(
  supabase: SupabaseClient,
  input: {
    userId: string;
    conversationId: string;
    messageId: string | null;
    model: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    status: "success" | "error" | "cancelled";
    error?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("ai_generations").insert({
    user_id: input.userId,
    conversation_id: input.conversationId,
    message_id: input.messageId,
    model: input.model,
    latency_ms: input.latencyMs,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    total_tokens: input.totalTokens,
    status: input.status,
    error: input.error ?? null,
  });

  if (error) {
    console.error("[aurum] ai_generations insert failed:", error.message);
  }
}
