/**
 * Main-process voice STT/TTS proxy — device Bearer stays off the renderer.
 * TTS routes through TtsService (Kokoro local primary, Gemini optional fallback).
 */
import fs from "node:fs";
import type { SpokenOrigin, SpokenToolHint } from "@aurum/ai";
import { shouldSpeakResponse } from "@aurum/shared";
import {
  appendVoiceLog,
  debugWavPath,
  isTtsDebugDumpEnabled,
  voiceLogFilePath,
} from "./voice-log";
import { authenticatedDeviceFetch } from "./authenticated-device-fetch";
import type { DeviceCredential } from "./credentials";
import { inspectWav } from "../overlay/wav-audio";
import { getVoiceEngineManager } from "./tts/voice-engine-manager";
import { TtsService } from "./tts/tts-service";
import { loadLocalTtsSettings } from "./tts/local-settings";

export type TranscribeResult = {
  ok: boolean;
  transcript?: string;
  error?: string;
  code?: string;
  latencyMs?: number;
};

export type SynthesizeResult = {
  ok: boolean;
  audioBase64?: string;
  mimeType?: string;
  speechText?: string;
  error?: string;
  code?: string;
  latencyMs?: number;
  skipped?: boolean;
  spokenMode?: string | null;
  voiceEnabled?: boolean | null;
  bypassSpokenMode?: boolean;
  debugDumpWav?: boolean;
  debugWavPath?: string | null;
  wavInfo?: ReturnType<typeof inspectWav> | null;
  audioBytes?: number;
  httpStatus?: number;
  provider?: string | null;
  fallbackUsed?: boolean;
  addressApplied?: boolean;
};

function mapAuthFailure(status: number, data: { error?: string; code?: string }) {
  if (status === 401 || status === 403) {
    return {
      error:
        data.error === "Device revoked"
          ? "This device was revoked. Re-pair Aurum Console."
          : "Device authentication failed. Re-pair Aurum Console if this continues.",
      code: data.code ?? (status === 403 ? "DEVICE_REVOKED" : "DEVICE_UNAUTHORIZED"),
    };
  }
  return null;
}

export class VoiceBridge {
  private tts: TtsService;

  constructor(private getCred: () => DeviceCredential | null) {
    this.tts = new TtsService(getVoiceEngineManager(), getCred);
  }

  getTtsService(): TtsService {
    return this.tts;
  }

  async transcribe(opts: {
    bytes: ArrayBuffer | Buffer;
    mimeType: string;
  }): Promise<TranscribeResult> {
    const cred = this.getCred();
    if (!cred) return { ok: false, error: "Device not paired", code: "DEVICE_OFFLINE" };

    const form = new FormData();
    const bytes =
      opts.bytes instanceof Buffer
        ? new Uint8Array(opts.bytes)
        : new Uint8Array(opts.bytes);
    const blob = new Blob([bytes], {
      type: opts.mimeType || "audio/webm",
    });
    form.append("audio", blob, "ptt.webm");

    const started = Date.now();
    try {
      const res = await authenticatedDeviceFetch(
        cred,
        "/api/devices/voice/transcribe",
        {
          method: "POST",
          body: form,
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        transcript?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        const authFail = mapAuthFailure(res.status, data);
        if (authFail) {
          return { ok: false, ...authFail, latencyMs: Date.now() - started };
        }
        return {
          ok: false,
          error: data.error || "Transcription unavailable.",
          code: data.code ?? "stt_failed",
          latencyMs: Date.now() - started,
        };
      }
      console.info("[aurum:voice:bridge:stt]", {
        latencyMs: Date.now() - started,
        transcriptLen: (data.transcript ?? "").length,
      });
      return {
        ok: true,
        transcript: data.transcript ?? "",
        latencyMs: Date.now() - started,
      };
    } catch {
      return {
        ok: false,
        error: "Transcription unavailable.",
        code: "stt_failed",
        latencyMs: Date.now() - started,
      };
    }
  }

  /**
   * Optional server-side spoken_mode / enabled gate without cloud TTS.
   * Falls open (allow speak) if the preview call fails so local TTS still works offline.
   */
  private async checkSpokenEligibility(opts: {
    text: string;
    bypassSpokenMode?: boolean;
  }): Promise<{
    skip: boolean;
    speechText: string;
    spokenMode: string | null;
    voiceEnabled: boolean | null;
    code?: string;
  }> {
    const speechText = opts.text.trim();
    if (opts.bypassSpokenMode) {
      return {
        skip: false,
        speechText,
        spokenMode: null,
        voiceEnabled: true,
      };
    }
    const cred = this.getCred();
    if (!cred) {
      return {
        skip: false,
        speechText,
        spokenMode: null,
        voiceEnabled: null,
      };
    }
    try {
      const res = await authenticatedDeviceFetch(
        cred,
        "/api/devices/voice/synthesize",
        {
          method: "POST",
          body: JSON.stringify({
            text: opts.text,
            previewOnly: true,
            bypassSpokenMode: false,
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        skipped?: boolean;
        speechText?: string;
        spokenMode?: string;
        voiceEnabled?: boolean;
        code?: string;
      };
      if (res.ok && data.skipped) {
        return {
          skip: true,
          speechText: data.speechText ?? speechText,
          spokenMode: data.spokenMode ?? null,
          voiceEnabled: data.voiceEnabled ?? null,
          code: data.code,
        };
      }
      if (res.ok) {
        return {
          skip: false,
          speechText: data.speechText ?? speechText,
          spokenMode: data.spokenMode ?? null,
          voiceEnabled: data.voiceEnabled ?? true,
        };
      }
    } catch {
      // Offline / unreachable — use shared short_only heuristic with always_voice default.
    }
    const allow = shouldSpeakResponse({
      inputMode: "voice",
      spokenMode: "always_voice",
      speechText,
    });
    return {
      skip: !allow,
      speechText,
      spokenMode: "always_voice",
      voiceEnabled: true,
      code: allow ? undefined : "tts_skipped",
    };
  }

  async synthesize(opts: {
    text: string;
    voice?: string;
    bypassSpokenMode?: boolean;
    debugDumpWav?: boolean;
    purpose?: string;
    signal?: AbortSignal;
    alreadyPrepared?: boolean;
    skipAddress?: boolean;
    addressAlreadyUsed?: boolean;
    skipSimplification?: boolean;
    origin?: SpokenOrigin;
    userMessage?: string;
    toolHints?: SpokenToolHint[];
  }): Promise<SynthesizeResult> {
    const started = Date.now();
    const purpose = opts.purpose ?? "speak";
    appendVoiceLog("synth_request_started", {
      purpose,
      bypassSpokenMode: Boolean(opts.bypassSpokenMode),
      speechTextLen: opts.text.trim().length,
      engine: loadLocalTtsSettings().speechEngine,
    });

    const eligibility = await this.checkSpokenEligibility({
      text: opts.text,
      bypassSpokenMode: opts.bypassSpokenMode,
    });
    if (eligibility.skip) {
      appendVoiceLog("synth_status", {
        purpose,
        synth_status: 200,
        skipped: true,
        code: eligibility.code ?? "tts_skipped",
        spoken_mode: eligibility.spokenMode,
        voice_enabled: eligibility.voiceEnabled,
        speech_text_length: eligibility.speechText.length,
      });
      return {
        ok: true,
        skipped: true,
        speechText: eligibility.speechText,
        spokenMode: eligibility.spokenMode,
        voiceEnabled: eligibility.voiceEnabled,
        httpStatus: 200,
        latencyMs: Date.now() - started,
        provider: null,
      };
    }

    const result = await this.tts.synthesize({
      text: opts.text,
      voice: opts.voice,
      bypassSpokenMode: opts.bypassSpokenMode,
      signal: opts.signal,
      alreadyPrepared: opts.alreadyPrepared,
      skipAddress: opts.skipAddress,
      addressAlreadyUsed: opts.addressAlreadyUsed,
      skipSimplification: opts.skipSimplification,
      origin: opts.origin,
      userMessage: opts.userMessage,
      toolHints: opts.toolHints,
    });

    if (!result.ok) {
      appendVoiceLog("synth_status", {
        purpose,
        synth_status: 0,
        ok: false,
        code: result.code,
        provider: result.provider,
        fallback_attempted: result.fallbackUsed,
      });
      return {
        ok: false,
        error: result.error,
        code: result.code,
        latencyMs: result.latencyMs || Date.now() - started,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
      };
    }

    const wavBuf = Buffer.from(result.audioBase64, "base64");
    const wavInfo = inspectWav(new Uint8Array(wavBuf));
    let dumpPath: string | null = null;
    if (opts.debugDumpWav === true || isTtsDebugDumpEnabled()) {
      try {
        dumpPath = debugWavPath();
        fs.writeFileSync(dumpPath, wavBuf);
      } catch {
        dumpPath = null;
      }
    }

    appendVoiceLog("synth_status", {
      purpose,
      synth_status: 200,
      skipped: false,
      audio_bytes: result.audioBytes,
      playable_bytes: result.audioBytes,
      audio_mime: "audio/wav",
      playable_mime: "audio/wav",
      speech_text_length: result.speechText.length,
      has_sir: /\bsir\b/i.test(result.speechText),
      address_applied:
        "addressApplied" in result ? Boolean(result.addressApplied) : null,
      spoken_mode: eligibility.spokenMode,
      voice_enabled: eligibility.voiceEnabled,
      wav_ok: wavInfo.ok,
      wav_rate: wavInfo.sampleRate ?? null,
      wav_channels: wavInfo.numChannels ?? null,
      wav_bits: wavInfo.bitsPerSample ?? null,
      wav_nonzero: wavInfo.nonzeroSamples ?? null,
      debug_wav: dumpPath ? "1" : "0",
      provider: result.provider,
      fallback_attempted: result.fallbackUsed,
      voice_log: voiceLogFilePath(),
    });

    console.info("[aurum:voice:bridge:tts]", {
      httpStatus: 200,
      latencyMs: result.latencyMs,
      mimeType: "audio/wav",
      audioBytes: result.audioBytes,
      speechTextLen: result.speechText.length,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
      wavOk: wavInfo.ok,
      debugWav: Boolean(dumpPath),
    });

    return {
      ok: true,
      audioBase64: result.audioBase64,
      mimeType: "audio/wav",
      speechText: result.speechText,
      latencyMs: result.latencyMs,
      spokenMode: eligibility.spokenMode,
      voiceEnabled: eligibility.voiceEnabled,
      bypassSpokenMode: Boolean(opts.bypassSpokenMode),
      debugWavPath: dumpPath,
      wavInfo,
      audioBytes: result.audioBytes,
      httpStatus: 200,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
      addressApplied:
        "addressApplied" in result ? Boolean(result.addressApplied) : false,
    };
  }
}
