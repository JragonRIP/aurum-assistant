/**
 * Short-lived disambiguation candidate sets for replies like "Kirko".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreChoiceMatch } from "./music-query";
import type { MusicIntentType } from "./music-preferences";

const SESSION_TTL_MS = 30 * 60 * 1000;

export type DisambiguationCandidate = {
  providerId: string;
  providerUri: string;
  name: string;
  artists?: string[];
  album?: string;
  playlistName?: string;
  explicit?: boolean;
  referenceId?: string;
};

export type DisambiguationSession = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  intent_type: MusicIntentType;
  normalized_query: string;
  candidates: DisambiguationCandidate[];
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  selected_provider_id: string | null;
};

export async function createDisambiguationSession(opts: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string | null;
  intentType: MusicIntentType;
  normalizedQuery: string;
  candidates: DisambiguationCandidate[];
}): Promise<DisambiguationSession | null> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { data, error } = await opts.supabase
    .from("music_disambiguation_sessions")
    .insert({
      user_id: opts.userId,
      conversation_id: opts.conversationId ?? null,
      intent_type: opts.intentType,
      normalized_query: opts.normalizedQuery,
      candidates: opts.candidates,
      expires_at: expiresAt,
    })
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return mapSession(data);
}

export async function getActiveDisambiguationSession(opts: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string | null;
  intentType?: MusicIntentType;
}): Promise<DisambiguationSession | null> {
  let q = opts.supabase
    .from("music_disambiguation_sessions")
    .select("*")
    .eq("user_id", opts.userId)
    .is("resolved_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (opts.conversationId) {
    q = q.eq("conversation_id", opts.conversationId);
  }
  if (opts.intentType) {
    q = q.eq("intent_type", opts.intentType);
  }
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return mapSession(data);
}

export function resolveChoiceAgainstCandidates(
  choice: string,
  candidates: DisambiguationCandidate[],
): DisambiguationCandidate | null {
  let best: DisambiguationCandidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = scoreChoiceMatch(choice, {
      name: c.name,
      artists: c.artists,
      subtitle: c.artists?.join(", ") ?? c.playlistName,
    });
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (bestScore < 50) return null;
  // Require clear winner
  const scores = candidates.map((c) =>
    scoreChoiceMatch(choice, {
      name: c.name,
      artists: c.artists,
      subtitle: c.artists?.join(", ") ?? c.playlistName,
    }),
  );
  const sorted = [...scores].sort((a, b) => b - a);
  if (sorted.length > 1 && sorted[0]! - sorted[1]! < 10 && sorted[0]! < 80) {
    return null;
  }
  return best;
}

export async function markDisambiguationResolved(opts: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  selectedProviderId: string;
}): Promise<void> {
  await opts.supabase
    .from("music_disambiguation_sessions")
    .update({
      resolved_at: new Date().toISOString(),
      selected_provider_id: opts.selectedProviderId,
    })
    .eq("id", opts.sessionId)
    .eq("user_id", opts.userId);
}

export async function expireActiveDisambiguationSessions(opts: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string | null;
  /** When set, only expire this intent type (e.g. ignore stale track after playlist play). */
  intentType?: MusicIntentType;
}): Promise<void> {
  let q = opts.supabase
    .from("music_disambiguation_sessions")
    .update({
      resolved_at: new Date().toISOString(),
      selected_provider_id: null,
    })
    .eq("user_id", opts.userId)
    .is("resolved_at", null);
  if (opts.conversationId) {
    q = q.eq("conversation_id", opts.conversationId);
  }
  if (opts.intentType) {
    q = q.eq("intent_type", opts.intentType);
  }
  await q;
}

function mapSession(data: Record<string, unknown>): DisambiguationSession {
  return {
    id: String(data.id),
    user_id: String(data.user_id),
    conversation_id: (data.conversation_id as string | null) ?? null,
    intent_type: data.intent_type as MusicIntentType,
    normalized_query: String(data.normalized_query),
    candidates: Array.isArray(data.candidates)
      ? (data.candidates as DisambiguationCandidate[])
      : [],
    expires_at: String(data.expires_at),
    created_at: String(data.created_at),
    resolved_at: (data.resolved_at as string | null) ?? null,
    selected_provider_id: (data.selected_provider_id as string | null) ?? null,
  };
}
