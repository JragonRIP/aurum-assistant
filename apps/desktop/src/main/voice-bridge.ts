/**
 * Main-process voice STT/TTS proxy — device Bearer stays off the renderer.
 */
import fs from "node:fs";
import {
  appendVoiceLog,
  debugWavPath,
  isTtsDebugDumpEnabled,
  voiceLogFilePath,
} from "./voice-log";
import { authenticatedDeviceFetch } from "./authenticated-device-fetch";
import type { DeviceCredential } from "./credentials";
import {
  inspectWav,
  isPcmMime,
  parseSampleRateFromMime,
  pcmToWav,
} from "../overlay/wav-audio";
import {
  isRateLimitedTtsStatus,
  isTransientTtsHttpStatus,
  parseRetryAfterHeader,
  withTtsHttpRetries,
} from "./tts-http-retry";

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
  debugWavPath?: string | null;
  wavInfo?: ReturnType<typeof inspectWav> | null;
  audioBytes?: number;
  httpStatus?: number;
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

function toPlayableWavBytes(
  audioBase64: string,
  mimeType: string,
): { wav: Buffer; sourceBytes: number } {
  const raw = Buffer.from(audioBase64, "base64");
  if (isPcmMime(mimeType)) {
    const rate = parseSampleRateFromMime(mimeType);
    const wav = Buffer.from(pcmToWav(new Uint8Array(raw), rate));
    return { wav, sourceBytes: raw.byteLength };
  }
  return { wav: raw, sourceBytes: raw.byteLength };
}

export class VoiceBridge {
  constructor(private getCred: () => DeviceCredential | null) {}

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
        latencyMs?: number;
      };
      if (!res.ok) {
        const authFail = mapAuthFailure(res.status, data);
        if (authFail) {
          return {
            ok: false,
            ...authFail,
            latencyMs: Date.now() - started,
          };
        }
        return {
          ok: false,
          error: data.error || "Transcription unavailable.",
          code: data.code ?? "stt_failed",
          latencyMs: Date.now() - started,
        };
      }
      console.info("[aurum:voice:bridge:stt]", {
        httpStatus: res.status,
        latencyMs: Date.now() - started,
        transcriptLen: (data.transcript ?? "").length,
        model: (data as { model?: string }).model ?? null,
        source: (data as { source?: string }).source ?? null,
        code: data.code ?? null,
      });
      return {
        ok: true,
        transcript: data.transcript ?? "",
        latencyMs: data.latencyMs ?? Date.now() - started,
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

  async synthesize(opts: {
    text: string;
    voice?: string;
    bypassSpokenMode?: boolean;
    debugDumpWav?: boolean;
    purpose?: string;
    signal?: AbortSignal;
  }): Promise<SynthesizeResult> {
    const cred = this.getCred();
    if (!cred) return { ok: false, error: "Device not paired", code: "DEVICE_OFFLINE" };

    const started = Date.now();
    const purpose = opts.purpose ?? "speak";
    appendVoiceLog("synth_request_started", {
      purpose,
      bypassSpokenMode: Boolean(opts.bypassSpokenMode),
      speechTextLen: opts.text.trim().length,
    });

    type ParsedOk = {
      res: Response;
      data: {
        audioBase64?: string;
        mimeType?: string;
        speechText?: string;
        error?: string;
        code?: string;
        latencyMs?: number;
        skipped?: boolean;
        spokenMode?: string;
        voiceEnabled?: boolean;
        bypassSpokenMode?: boolean;
        providerErrorClass?: string;
        primaryModel?: string;
        fallbackModel?: string | null;
        fallbackUsed?: boolean;
        attemptsTotal?: number;
        model?: string;
      };
    };

    try {
      const parsed = await withTtsHttpRetries<ParsedOk>({
        signal: opts.signal,
        onAttempt: ({
          attempt,
          status,
          retrying,
          latencyMs,
          providerErrorClass,
          retryAfterMs,
          budgetRemainingMs,
        }) => {
          appendVoiceLog("synth_attempt", {
            purpose,
            attempt,
            model: null,
            status: status ?? 0,
            latency_ms: latencyMs,
            provider_error_class: providerErrorClass ?? null,
            retry_after_ms: retryAfterMs ?? null,
            budget_remaining_ms: budgetRemainingMs ?? null,
            retrying,
          });
        },
        attempt: async (attempt) => {
          const attemptStarted = Date.now();
          const res = await authenticatedDeviceFetch(
            cred,
            "/api/devices/voice/synthesize",
            {
              method: "POST",
              body: JSON.stringify({
                text: opts.text,
                voice: opts.voice,
                bypassSpokenMode: opts.bypassSpokenMode === true,
              }),
              signal: opts.signal,
            },
          );
          const data = (await res.json().catch(() => ({}))) as ParsedOk["data"];
          const latencyMs = Date.now() - attemptStarted;
          const rateLimited = isRateLimitedTtsStatus(res.status);
          const transient = isTransientTtsHttpStatus(res.status);
          const retryAfterMs = rateLimited
            ? parseRetryAfterHeader(res)
            : null;
          appendVoiceLog("synth_attempt", {
            purpose,
            attempt,
            model: data.model ?? data.primaryModel ?? null,
            status: res.status,
            latency_ms: latencyMs,
            provider_error_class:
              data.providerErrorClass ??
              (rateLimited ? "rate_limited" : null),
            retry_after_ms: retryAfterMs,
            retrying: !res.ok && (transient || rateLimited),
          });

          if (res.ok) {
            return { status: res.status, transient: false, value: { res, data } };
          }

          const authFail = mapAuthFailure(res.status, data);
          if (authFail) {
            return {
              status: res.status,
              transient: false,
              error: Object.assign(new Error(authFail.error), {
                code: authFail.code,
                httpStatus: res.status,
              }),
            };
          }

          return {
            status: res.status,
            transient,
            rateLimited,
            retryAfterMs,
            error: Object.assign(
              new Error(data.error || "Voice playback unavailable."),
              {
                code: data.code ?? "tts_failed",
                httpStatus: res.status,
                providerErrorClass: data.providerErrorClass,
              },
            ),
          };
        },
      });

      const { res, data } = parsed;
      if (data.skipped) {
        appendVoiceLog("synth_status", {
          purpose,
          synth_status: res.status,
          skipped: true,
          code: data.code ?? null,
          spoken_mode: data.spokenMode ?? null,
          voice_enabled: data.voiceEnabled ?? null,
          speech_text_length: (data.speechText ?? "").length,
          attempts_total: data.attemptsTotal ?? 1,
          fallback_attempted: Boolean(data.fallbackUsed),
        });
        return {
          ok: true,
          skipped: true,
          speechText: data.speechText,
          spokenMode: data.spokenMode ?? null,
          voiceEnabled: data.voiceEnabled ?? null,
          httpStatus: res.status,
          latencyMs: Date.now() - started,
        };
      }

      const sourceMime = data.mimeType || "audio/L16;rate=24000";
      const sourceBytes = data.audioBase64
        ? Buffer.from(data.audioBase64, "base64").byteLength
        : 0;
      let wavInfo: ReturnType<typeof inspectWav> | null = null;
      let dumpPath: string | null = null;
      let playableBase64 = data.audioBase64;
      let playableMime = sourceMime;
      if (data.audioBase64) {
        const { wav } = toPlayableWavBytes(data.audioBase64, sourceMime);
        wavInfo = inspectWav(new Uint8Array(wav));
        playableBase64 = wav.toString("base64");
        playableMime = "audio/wav";
        const shouldDump =
          opts.debugDumpWav === true || isTtsDebugDumpEnabled();
        if (shouldDump) {
          try {
            dumpPath = debugWavPath();
            fs.writeFileSync(dumpPath, wav);
          } catch {
            dumpPath = null;
          }
        }
      }

      appendVoiceLog("synth_status", {
        purpose,
        synth_status: res.status,
        skipped: false,
        audio_bytes: sourceBytes,
        playable_bytes: playableBase64
          ? Buffer.from(playableBase64, "base64").byteLength
          : 0,
        audio_mime: sourceMime.split(";")[0] || sourceMime,
        playable_mime: playableMime,
        speech_text_length: (data.speechText ?? "").length,
        spoken_mode: data.spokenMode ?? null,
        voice_enabled: data.voiceEnabled ?? null,
        wav_ok: wavInfo?.ok ?? null,
        wav_rate: wavInfo?.sampleRate ?? null,
        wav_channels: wavInfo?.numChannels ?? null,
        wav_bits: wavInfo?.bitsPerSample ?? null,
        wav_nonzero: wavInfo?.nonzeroSamples ?? null,
        debug_wav: dumpPath ? "1" : "0",
        model: data.model ?? null,
        primary_model: data.primaryModel ?? null,
        fallback_model: data.fallbackModel ?? null,
        fallback_attempted: Boolean(data.fallbackUsed),
        attempts_total: data.attemptsTotal ?? null,
        voice_log: voiceLogFilePath(),
      });

      console.info("[aurum:voice:bridge:tts]", {
        httpStatus: res.status,
        latencyMs: data.latencyMs ?? Date.now() - started,
        mimeType: sourceMime.split(";")[0] || null,
        audioBytes: sourceBytes,
        speechTextLen: (data.speechText ?? "").length,
        skipped: false,
        wavOk: wavInfo?.ok ?? null,
        debugWav: Boolean(dumpPath),
        fallbackUsed: Boolean(data.fallbackUsed),
      });

      return {
        ok: true,
        audioBase64: playableBase64,
        mimeType: playableMime,
        speechText: data.speechText,
        latencyMs: data.latencyMs ?? Date.now() - started,
        spokenMode: data.spokenMode ?? null,
        voiceEnabled: data.voiceEnabled ?? null,
        bypassSpokenMode: Boolean(opts.bypassSpokenMode),
        debugWavPath: dumpPath,
        wavInfo,
        audioBytes: sourceBytes,
        httpStatus: res.status,
      };
    } catch (err) {
      const errCode =
        typeof (err as { code?: string })?.code === "string"
          ? (err as { code: string }).code
          : null;
      if (
        (err as { name?: string })?.name === "AbortError" &&
        errCode !== "budget_exhausted"
      ) {
        appendVoiceLog("synth_status", {
          purpose,
          synth_status: 0,
          ok: false,
          code: "cancelled",
          fallback_attempted: false,
        });
        return {
          ok: false,
          error: "Voice playback cancelled.",
          code: "cancelled",
          latencyMs: Date.now() - started,
        };
      }
      if (errCode === "budget_exhausted") {
        appendVoiceLog("synth_status", {
          purpose,
          synth_status: 504,
          ok: false,
          code: "budget_exhausted",
          provider_error_class: "budget_exhausted",
          fallback_attempted: false,
          final_status: 504,
        });
        return {
          ok: false,
          error: "Voice playback unavailable.",
          code: "budget_exhausted",
          latencyMs: Date.now() - started,
          httpStatus: 504,
        };
      }
      const httpStatus =
        typeof (err as { httpStatus?: number })?.httpStatus === "number"
          ? (err as { httpStatus: number }).httpStatus
          : 0;
      const code =
        typeof (err as { code?: string })?.code === "string"
          ? (err as { code: string }).code
          : "tts_failed";
      const providerErrorClass =
        typeof (err as { providerErrorClass?: string })?.providerErrorClass ===
        "string"
          ? (err as { providerErrorClass: string }).providerErrorClass
          : null;
      appendVoiceLog("synth_status", {
        purpose,
        synth_status: httpStatus || 0,
        ok: false,
        code,
        provider_error_class: providerErrorClass,
        fallback_attempted: false,
        final_status: httpStatus || 0,
      });
      if (httpStatus === 401 || httpStatus === 403) {
        const authFail = mapAuthFailure(httpStatus, {
          error: err instanceof Error ? err.message : undefined,
          code,
        });
        return {
          ok: false,
          ...(authFail ?? {
            error: "Device authentication failed.",
            code,
          }),
          latencyMs: Date.now() - started,
          httpStatus,
        };
      }
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Voice playback unavailable.",
        code,
        latencyMs: Date.now() - started,
        httpStatus: httpStatus || undefined,
      };
    }
  }
}
