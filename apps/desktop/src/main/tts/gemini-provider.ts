/**
 * Gemini cloud TTS provider — optional fallback via existing device synthesize API.
 */
import type { DeviceCredential } from "../credentials";
import { authenticatedDeviceFetch } from "../authenticated-device-fetch";
import {
  inspectWav,
  isPcmMime,
  parseSampleRateFromMime,
  pcmToWav,
} from "../../overlay/wav-audio";
import type {
  TtsProvider,
  TtsProviderHealth,
  TtsSynthesizeFailure,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsVoiceInfo,
} from "./types";

const GEMINI_VOICES: TtsVoiceInfo[] = [
  { id: "Kore", label: "Kore (Gemini)" },
  { id: "Puck", label: "Puck (Gemini)" },
  { id: "Charon", label: "Charon (Gemini)" },
  { id: "Fenrir", label: "Fenrir (Gemini)" },
  { id: "Aoede", label: "Aoede (Gemini)" },
];

function toWavBase64(audioBase64: string, mimeType: string): {
  base64: string;
  bytes: number;
  wavOk: boolean;
} {
  const raw = Buffer.from(audioBase64, "base64");
  if (isPcmMime(mimeType)) {
    const rate = parseSampleRateFromMime(mimeType);
    const wav = Buffer.from(pcmToWav(new Uint8Array(raw), rate));
    const info = inspectWav(new Uint8Array(wav));
    return { base64: wav.toString("base64"), bytes: wav.byteLength, wavOk: info.ok };
  }
  const info = inspectWav(new Uint8Array(raw));
  return { base64: audioBase64, bytes: raw.byteLength, wavOk: info.ok };
}

export class GeminiTtsProvider implements TtsProvider {
  readonly id = "gemini" as const;

  constructor(private getCred: () => DeviceCredential | null) {}

  async availability(): Promise<TtsProviderHealth> {
    return this.healthCheck();
  }

  async healthCheck(): Promise<TtsProviderHealth> {
    const cred = this.getCred();
    if (!cred) {
      return {
        id: "gemini",
        available: false,
        ready: false,
        status: "unavailable",
        detail: "Device not paired",
      };
    }
    return {
      id: "gemini",
      available: true,
      ready: true,
      status: "ready",
      detail: "Cloud Gemini TTS (optional fallback)",
    };
  }

  async getVoices(): Promise<TtsVoiceInfo[]> {
    return GEMINI_VOICES;
  }

  async synthesize(
    opts: TtsSynthesizeOptions,
  ): Promise<TtsSynthesizeResult | TtsSynthesizeFailure> {
    const started = Date.now();
    const cred = this.getCred();
    if (!cred) {
      return {
        ok: false,
        provider: "gemini",
        error: "Device not paired",
        code: "DEVICE_OFFLINE",
        latencyMs: Date.now() - started,
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
            voice: opts.voice,
            bypassSpokenMode: true,
          }),
          signal: opts.signal,
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        audioBase64?: string;
        mimeType?: string;
        speechText?: string;
        error?: string;
        code?: string;
        skipped?: boolean;
      };
      const latencyMs = Date.now() - started;
      if (!res.ok || !data.audioBase64) {
        return {
          ok: false,
          provider: "gemini",
          error: data.error || "Cloud voice unavailable",
          code: data.code || "tts_failed",
          latencyMs,
        };
      }
      const wav = toWavBase64(
        data.audioBase64,
        data.mimeType || "audio/L16;rate=24000",
      );
      if (!wav.wavOk) {
        return {
          ok: false,
          provider: "gemini",
          error: "Invalid cloud WAV",
          code: "invalid_wav",
          latencyMs,
        };
      }
      return {
        ok: true,
        provider: "gemini",
        audioBase64: wav.base64,
        mimeType: "audio/wav",
        speechText: data.speechText || opts.text,
        voice: opts.voice || "Kore",
        latencyMs,
        audioBytes: wav.bytes,
      };
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        return {
          ok: false,
          provider: "gemini",
          error: "Cancelled",
          code: "cancelled",
          latencyMs: Date.now() - started,
        };
      }
      return {
        ok: false,
        provider: "gemini",
        error: err instanceof Error ? err.message : "Cloud TTS failed",
        code: "tts_failed",
        latencyMs: Date.now() - started,
      };
    }
  }
}
