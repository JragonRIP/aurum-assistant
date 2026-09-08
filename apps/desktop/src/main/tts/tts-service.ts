/**
 * Central TTS service — routes to Kokoro (primary) or Gemini (optional fallback).
 * Single speech generation per request (never both).
 * prepareSpokenText is the only spoken-form transform before Kokoro.
 */
import {
  prepareSpokenText,
  type SpokenOrigin,
  type SpokenToolHint,
} from "@aurum/ai";
import { appendVoiceLog } from "../voice-log";
import type { DeviceCredential } from "../credentials";
import { GeminiTtsProvider } from "./gemini-provider";
import { KokoroLocalProvider } from "./kokoro-provider";
import { loadLocalTtsSettings } from "./local-settings";
import type { VoiceEngineManager } from "./voice-engine-manager";
import type {
  TtsProvider,
  TtsSynthesizeFailure,
  TtsSynthesizeResult,
} from "./types";

export type CentralSynthesizeOpts = {
  text: string;
  voice?: string;
  bypassSpokenMode?: boolean;
  signal?: AbortSignal;
  /** Generation / turn id — stale results discarded by caller via VoicePlayback. */
  turnId?: number;
  alreadyPrepared?: boolean;
  skipAddress?: boolean;
  addressAlreadyUsed?: boolean;
  skipSimplification?: boolean;
  origin?: SpokenOrigin;
  userMessage?: string;
  toolHints?: SpokenToolHint[];
};

export class TtsService {
  private kokoro: KokoroLocalProvider;
  private gemini: GeminiTtsProvider;

  constructor(
    engine: VoiceEngineManager,
    getCred: () => DeviceCredential | null,
  ) {
    this.kokoro = new KokoroLocalProvider(engine);
    this.gemini = new GeminiTtsProvider(getCred);
  }

  getKokoro(): TtsProvider {
    return this.kokoro;
  }

  getGemini(): TtsProvider {
    return this.gemini;
  }

  async synthesize(
    opts: CentralSynthesizeOpts,
  ): Promise<
    | (TtsSynthesizeResult & { fallbackUsed: boolean })
    | (TtsSynthesizeFailure & { fallbackUsed: boolean })
  > {
    const settings = loadLocalTtsSettings();
    const prepared = opts.alreadyPrepared
      ? {
          spoken: opts.text.trim(),
          displayLength: opts.text.trim().length,
          spokenLength: opts.text.trim().length,
          addressApplied: false,
          simplified: false,
          pronunciationApplied: false,
          prepareMs: 0,
        }
      : prepareSpokenText({
          text: opts.text,
          origin: opts.origin ?? "final",
          turnId: opts.turnId,
          toolHints: opts.toolHints,
          pronunciation: settings.pronunciation,
          skipAddress: opts.skipAddress,
          addressAlreadyUsed: opts.addressAlreadyUsed,
          skipSimplification: opts.skipSimplification,
          userMessage: opts.userMessage,
          logSpokenString: process.env.AURUM_LOG_SPOKEN === "1",
        });
    const speechText = prepared.spoken;
    appendVoiceLog("VOICE_SPEECH", {
      stage: "prepare",
      origin: opts.origin ?? "final",
      display_length: prepared.displayLength,
      spoken_length: prepared.spokenLength,
      address_applied: prepared.addressApplied,
      simplified: prepared.simplified,
      pronunciation_applied: prepared.pronunciationApplied,
      prepare_ms: prepared.prepareMs,
      has_sir: /\bsir\b/i.test(speechText),
    });
    if (!speechText) {
      return {
        ok: false,
        provider: null,
        error: "Nothing to speak.",
        code: "empty_speech",
        latencyMs: 0,
        fallbackUsed: false,
      };
    }

    const voice =
      opts.voice?.trim() ||
      (settings.speechEngine === "gemini"
        ? "Kore"
        : settings.kokoroVoice);

    const tryKokoro =
      settings.speechEngine === "local" || settings.speechEngine === "auto";
    const tryGemini =
      settings.speechEngine === "gemini" ||
      (settings.speechEngine === "auto" && settings.allowGeminiFallback) ||
      (settings.speechEngine === "local" && settings.allowGeminiFallback);

    if (tryKokoro) {
      appendVoiceLog("selected", {
        provider: "kokoro",
        engine: settings.speechEngine,
      });
      const health = await this.kokoro.healthCheck();
      if (health.ready) {
        const local = await this.kokoro.synthesize({
          text: speechText,
          voice: settings.speechEngine === "gemini" ? voice : settings.kokoroVoice,
          speed: settings.speed,
          signal: opts.signal,
        });
        if (local.ok) {
          appendVoiceLog("kokoro_success", {
            provider: "kokoro",
            fallback_used: false,
            cloud_tts_called: false,
            speech_text_length: speechText.length,
            has_sir: /\bsir\b/i.test(speechText),
            audio_bytes: local.audioBytes,
            latency_ms: local.latencyMs,
            voice: local.voice ?? settings.kokoroVoice,
          });
          return {
            ...local,
            speechText,
            fallbackUsed: false,
            addressApplied: prepared.addressApplied,
          };
        }
        if (!tryGemini || (settings.speechEngine === "local" && !settings.allowGeminiFallback)) {
          return { ...local, fallbackUsed: false };
        }
        appendVoiceLog("fallback_to_gemini", {
          provider: "kokoro",
          code: local.code,
        });
      } else if (settings.speechEngine === "local" && !settings.allowGeminiFallback) {
        return {
          ok: false,
          provider: "kokoro",
          error: health.detail || "Local voice unavailable",
          code:
            health.status === "not_installed"
              ? "voice_engine_not_installed"
              : "voice_engine_unavailable",
          latencyMs: 0,
          fallbackUsed: false,
        };
      }
    }

    if (tryGemini || settings.speechEngine === "gemini") {
      appendVoiceLog("selected", {
        provider: "gemini",
        engine: settings.speechEngine,
        fallback: tryKokoro,
      });
      const cloud = await this.gemini.synthesize({
        text: speechText,
        voice: opts.voice?.trim() || "Kore",
        signal: opts.signal,
      });
      appendVoiceLog("gemini_result", {
        provider: "gemini",
        fallback_used: tryKokoro,
        cloud_tts_called: true,
        ok: cloud.ok,
      });
      return cloud.ok
        ? { ...cloud, speechText, fallbackUsed: tryKokoro, addressApplied: prepared.addressApplied }
        : { ...cloud, fallbackUsed: tryKokoro };
    }

    return {
      ok: false,
      provider: null,
      error: "Voice playback unavailable.",
      code: "tts_unavailable",
      latencyMs: 0,
      fallbackUsed: false,
    };
  }
}
