import type { SupabaseClient } from "@supabase/supabase-js";

export const REFERENCE_TTL_MS = 30 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reject fabricated / non-UUID ids before any DB lookup */
export function assertTrustedReferenceId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!UUID_RE.test(trimmed)) return null;
  // Reject obviously fabricated Spotify-style uris passed as "references"
  if (trimmed.startsWith("spotify:") || trimmed.includes(":track:")) return null;
  return trimmed;
}

export type IntegrationReferenceKind = "track" | "device" | "album" | "playlist";

export type IntegrationReferenceRow = {
  id: string;
  user_id: string;
  provider: string;
  kind: IntegrationReferenceKind;
  provider_id: string;
  provider_uri: string;
  label: string;
  subtitle: string | null;
  payload: Record<string, unknown>;
  conversation_id: string | null;
  expires_at: string;
};

export async function createIntegrationReference(opts: {
  supabase: SupabaseClient;
  userId: string;
  provider: string;
  kind: IntegrationReferenceKind;
  providerId: string;
  providerUri: string;
  label: string;
  subtitle?: string | null;
  payload?: Record<string, unknown>;
  conversationId?: string | null;
  ttlMs?: number;
}): Promise<IntegrationReferenceRow> {
  const expiresAt = new Date(
    Date.now() + (opts.ttlMs ?? REFERENCE_TTL_MS),
  ).toISOString();
  const { data, error } = await opts.supabase
    .from("integration_references")
    .insert({
      user_id: opts.userId,
      provider: opts.provider,
      kind: opts.kind,
      provider_id: opts.providerId,
      provider_uri: opts.providerUri,
      label: opts.label,
      subtitle: opts.subtitle ?? null,
      payload: opts.payload ?? {},
      conversation_id: opts.conversationId ?? null,
      expires_at: expiresAt,
    })
    .select(
      "id, user_id, provider, kind, provider_id, provider_uri, label, subtitle, payload, conversation_id, expires_at",
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create integration reference");
  }
  return data as IntegrationReferenceRow;
}

export async function resolveIntegrationReference(opts: {
  supabase: SupabaseClient;
  userId: string;
  referenceId: unknown;
  provider: string;
  kind: IntegrationReferenceKind;
}): Promise<IntegrationReferenceRow | null> {
  const id = assertTrustedReferenceId(opts.referenceId);
  if (!id) return null;

  const { data, error } = await opts.supabase
    .from("integration_references")
    .select(
      "id, user_id, provider, kind, provider_id, provider_uri, label, subtitle, payload, conversation_id, expires_at",
    )
    .eq("id", id)
    .eq("user_id", opts.userId)
    .eq("provider", opts.provider)
    .eq("kind", opts.kind)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as IntegrationReferenceRow;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}
