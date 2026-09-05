import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerSecrets } from "@/lib/env";

/** Service-role client for device bridge (bypasses RLS after credential check). */
export function createServiceClient() {
  const { supabaseUrl } = getPublicEnv();
  const { supabaseServiceRoleKey } = getServerSecrets();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for device bridge");
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function hasServiceRole(): boolean {
  return Boolean(getServerSecrets().supabaseServiceRoleKey?.trim());
}
