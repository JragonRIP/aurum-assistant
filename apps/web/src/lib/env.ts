/**
 * Environment helpers.
 * Public vars are safe for the browser. Server secrets must never be imported
 * into client components.
 */

export function hasSupabaseConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getPublicEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  };
}

/** Server-only — do not import from client components */
export function getServerSecrets() {
  return {
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  };
}

export function hasGeminiConfig(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/** True when any text AI provider is configured (Gemini preferred) */
export function hasAIConfig(): boolean {
  return hasGeminiConfig() || Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** @deprecated Prefer hasAIConfig / hasGeminiConfig */
export function hasOpenAIConfig(): boolean {
  return hasAIConfig();
}
