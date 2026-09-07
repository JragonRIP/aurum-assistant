/**
 * Phase 5 Voice — shared constants and preference types.
 * Push-to-talk only; no wake-word / always-listening.
 */

export const VOICE_PTT_HOLD_MS = 300;
export const VOICE_MAX_RECORD_MS = 60_000;
/** Reject near-empty clips before STT. */
export const VOICE_MIN_AUDIO_BYTES = 800;
/** Max multipart upload size (~4 MB). */
export const VOICE_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const VOICE_SPOKEN_MODE = [
  "always_voice",
  "short_only",
  "never",
] as const;
export type VoiceSpokenMode = (typeof VOICE_SPOKEN_MODE)[number];

export type VoiceSettings = {
  enabled: boolean;
  spokenMode: VoiceSpokenMode;
  /** Prebuilt Gemini TTS voice name */
  ttsVoice: string;
  /** Optional preferred input deviceId (browser/Electron) */
  inputDeviceId: string | null;
  /** Optional output sinkId when supported */
  outputDeviceId: string | null;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  spokenMode: "always_voice",
  ttsVoice: "Kore",
  inputDeviceId: null,
  outputDeviceId: null,
};

export type VoicePttPhase =
  | "idle"
  | "press_pending"
  | "listening"
  | "released"
  | "cancelled";

export type VoicePttEvent =
  | { type: "press"; at: number }
  | { type: "tick"; at: number; spaceDown: boolean; ctrlDown: boolean }
  | { type: "release"; at: number }
  | { type: "cancel"; at: number }
  | { type: "reset" };

export type VoicePttState = {
  phase: VoicePttPhase;
  pressAt: number | null;
  listeningStartedAt: number | null;
};

export function initialVoicePttState(): VoicePttState {
  return { phase: "idle", pressAt: null, listeningStartedAt: null };
}

/**
 * Pure push-to-talk state machine.
 * Tap (< holdMs) → release without listening (caller runs text overlay toggle).
 * Hold (>= holdMs) → listening until Space release or cancel.
 */
export function reduceVoicePtt(
  state: VoicePttState,
  event: VoicePttEvent,
  holdMs = VOICE_PTT_HOLD_MS,
  maxMs = VOICE_MAX_RECORD_MS,
): { state: VoicePttState; effects: VoicePttEffect[] } {
  const effects: VoicePttEffect[] = [];

  if (event.type === "reset") {
    return { state: initialVoicePttState(), effects: [{ type: "noop" }] };
  }

  if (event.type === "cancel") {
    if (state.phase === "listening") {
      effects.push({ type: "cancel_capture" });
    }
    return { state: initialVoicePttState(), effects };
  }

  if (event.type === "press") {
    if (state.phase !== "idle") {
      return { state, effects: [{ type: "debounce_ignore" }] };
    }
    return {
      state: { phase: "press_pending", pressAt: event.at, listeningStartedAt: null },
      effects: [{ type: "ensure_overlay_visible" }],
    };
  }

  if (event.type === "tick") {
    if (state.phase === "press_pending" && state.pressAt != null) {
      if (!event.spaceDown) {
        // Released before hold — treat as tap
        return {
          state: initialVoicePttState(),
          effects: [{ type: "tap_toggle" }],
        };
      }
      if (event.at - state.pressAt >= holdMs) {
        return {
          state: {
            phase: "listening",
            pressAt: state.pressAt,
            listeningStartedAt: event.at,
          },
          effects: [{ type: "start_listening" }],
        };
      }
      return { state, effects: [] };
    }
    if (state.phase === "listening") {
      if (!event.spaceDown) {
        return {
          state: initialVoicePttState(),
          effects: [{ type: "stop_and_submit" }],
        };
      }
      if (
        state.listeningStartedAt != null &&
        event.at - state.listeningStartedAt >= maxMs
      ) {
        return {
          state: initialVoicePttState(),
          effects: [{ type: "stop_and_submit" }, { type: "max_duration" }],
        };
      }
      return { state, effects: [] };
    }
    return { state, effects: [] };
  }

  if (event.type === "release") {
    if (state.phase === "press_pending") {
      return {
        state: initialVoicePttState(),
        effects: [{ type: "tap_toggle" }],
      };
    }
    if (state.phase === "listening") {
      return {
        state: initialVoicePttState(),
        effects: [{ type: "stop_and_submit" }],
      };
    }
    return { state: initialVoicePttState(), effects: [] };
  }

  return { state, effects: [] };
}

export type VoicePttEffect =
  | { type: "noop" }
  | { type: "debounce_ignore" }
  | { type: "ensure_overlay_visible" }
  | { type: "tap_toggle" }
  | { type: "start_listening" }
  | { type: "stop_and_submit" }
  | { type: "cancel_capture" }
  | { type: "max_duration" };

/** Whether a spoken reply should play for a voice-originated turn. */
export function shouldSpeakResponse(opts: {
  inputMode: "voice" | "text";
  spokenMode: VoiceSpokenMode;
  speechText: string;
}): boolean {
  if (opts.inputMode !== "voice") return false;
  if (opts.spokenMode === "never") return false;
  if (opts.spokenMode === "always_voice") return opts.speechText.trim().length > 0;
  // short_only: speak if under ~280 chars and <= 3 sentence-like segments
  const t = opts.speechText.trim();
  if (!t) return false;
  return t.length <= 280 && t.split(/[.!?]+/).filter(Boolean).length <= 3;
}
