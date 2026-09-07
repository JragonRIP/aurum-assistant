/**
 * Vault sync is derived from canonical Supabase memory.
 * Structured writes never fail because the desktop vault is offline.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type VaultSyncStatus =
  | "SYNCED"
  | "PENDING"
  | "OFFLINE"
  | "ERROR"
  | "SKIPPED";

export async function resolveVaultSyncStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<VaultSyncStatus> {
  try {
    const { data } = await supabase
      .from("memory_settings")
      .select("vault_enabled, vault_root_path, vault_device_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data?.vault_enabled || !data.vault_root_path) {
      return "SKIPPED";
    }
    return "PENDING";
  } catch {
    return "SKIPPED";
  }
}

export async function markMemoryVaultStatus(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
  status: VaultSyncStatus,
): Promise<void> {
  await supabase
    .from("memories")
    .update({ vault_sync_status: status, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", memoryId);
}

/** After a successful structured write, queue vault sync when enabled. */
export async function afterStructuredMemoryWrite(
  supabase: SupabaseClient,
  userId: string,
  memoryId: string,
): Promise<VaultSyncStatus> {
  const status = await resolveVaultSyncStatus(supabase, userId);
  await markMemoryVaultStatus(supabase, userId, memoryId, status);
  return status;
}
