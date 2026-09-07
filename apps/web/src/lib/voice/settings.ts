import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_SPOKEN_MODE,
  type VoiceSettings,
  type VoiceSpokenMode,
} from "@aurum/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getVoiceSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<VoiceSettings> {
  try {
    const { data } = await supabase
      .from("voice_settings")
      .select(
        "enabled, spoken_mode, tts_voice, input_device_id, output_device_id",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return { ...DEFAULT_VOICE_SETTINGS };
    return {
      enabled: data.enabled ?? true,
      spokenMode: normalizeSpokenMode(data.spoken_mode),
      ttsVoice: String(data.tts_voice || DEFAULT_VOICE_SETTINGS.ttsVoice),
      inputDeviceId:
        typeof data.input_device_id === "string" ? data.input_device_id : null,
      outputDeviceId:
        typeof data.output_device_id === "string"
          ? data.output_device_id
          : null,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export async function upsertVoiceSettings(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<VoiceSettings>,
): Promise<VoiceSettings> {
  const current = await getVoiceSettings(supabase, userId);
  const next: VoiceSettings = {
    enabled: patch.enabled ?? current.enabled,
    spokenMode: patch.spokenMode ?? current.spokenMode,
    ttsVoice: patch.ttsVoice ?? current.ttsVoice,
    inputDeviceId:
      patch.inputDeviceId === undefined
        ? current.inputDeviceId
        : patch.inputDeviceId,
    outputDeviceId:
      patch.outputDeviceId === undefined
        ? current.outputDeviceId
        : patch.outputDeviceId,
  };
  await supabase.from("voice_settings").upsert(
    {
      user_id: userId,
      enabled: next.enabled,
      spoken_mode: next.spokenMode,
      tts_voice: next.ttsVoice,
      input_device_id: next.inputDeviceId,
      output_device_id: next.outputDeviceId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return next;
}

function normalizeSpokenMode(raw: unknown): VoiceSpokenMode {
  if (
    typeof raw === "string" &&
    (VOICE_SPOKEN_MODE as readonly string[]).includes(raw)
  ) {
    return raw as VoiceSpokenMode;
  }
  return DEFAULT_VOICE_SETTINGS.spokenMode;
}
