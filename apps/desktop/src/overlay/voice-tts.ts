/**
 * Voice TTS eligibility helpers (renderer + tests).
 */
import {
  shouldSpeakResponse,
  type VoiceSpokenMode,
} from "@aurum/shared";

export type VoiceTtsDecision = {
  eligible: boolean;
  reason:
    | "ok"
    | "not_voice_origin"
    | "empty_speech"
    | "spoken_mode_never"
    | "short_only_too_long";
  speechTextLen: number;
};

/** Decide whether a final reply should attempt TTS (client-side gate). */
export function decideVoiceTts(opts: {
  origin: "voice" | "text";
  spokenMode: VoiceSpokenMode;
  /** Final user-facing reply (or buildSpeechResponse output). */
  speechText: string;
}): VoiceTtsDecision {
  const speechText = opts.speechText.trim();
  const speechTextLen = speechText.length;
  if (opts.origin !== "voice") {
    return { eligible: false, reason: "not_voice_origin", speechTextLen };
  }
  if (!speechText) {
    return { eligible: false, reason: "empty_speech", speechTextLen };
  }
  if (opts.spokenMode === "never") {
    return { eligible: false, reason: "spoken_mode_never", speechTextLen };
  }
  const ok = shouldSpeakResponse({
    inputMode: "voice",
    spokenMode: opts.spokenMode,
    speechText,
  });
  if (!ok && opts.spokenMode === "short_only") {
    return { eligible: false, reason: "short_only_too_long", speechTextLen };
  }
  return {
    eligible: ok,
    reason: ok ? "ok" : "not_voice_origin",
    speechTextLen,
  };
}

/**
 * short_only rule (shared):
 * - voice origin only
 * - trimmed speech text length <= 280
 * - at most 3 sentence-like segments (split on . ! ?)
 */
export const SHORT_ONLY_MAX_CHARS = 280;
export const SHORT_ONLY_MAX_SENTENCES = 3;
