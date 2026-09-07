/**
 * Main-process voice STT/TTS proxy — device Bearer stays off the renderer.
 */
import { authenticatedDeviceFetch } from "./authenticated-device-fetch";
import type { DeviceCredential } from "./credentials";

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
  }): Promise<SynthesizeResult> {
    const cred = this.getCred();
    if (!cred) return { ok: false, error: "Device not paired", code: "DEVICE_OFFLINE" };

    const started = Date.now();
    try {
      const res = await authenticatedDeviceFetch(
        cred,
        "/api/devices/voice/synthesize",
        {
          method: "POST",
          body: JSON.stringify({
            text: opts.text,
            voice: opts.voice,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        audioBase64?: string;
        mimeType?: string;
        speechText?: string;
        error?: string;
        code?: string;
        latencyMs?: number;
        skipped?: boolean;
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
          error: data.error || "Voice playback unavailable.",
          code: data.code ?? "tts_failed",
          latencyMs: Date.now() - started,
          skipped: Boolean(data.skipped),
        };
      }
      if (data.skipped) {
        console.info("[aurum:voice:bridge:tts]", {
          skipped: true,
          code: data.code ?? null,
          speechTextLen: (data.speechText ?? "").length,
          latencyMs: Date.now() - started,
        });
        return { ok: true, skipped: true, speechText: data.speechText };
      }
      const audioBytesApprox = Math.floor(
        (data.audioBase64?.length ?? 0) * 0.75,
      );
      console.info("[aurum:voice:bridge:tts]", {
        httpStatus: res.status,
        latencyMs: data.latencyMs ?? Date.now() - started,
        mimeType: (data.mimeType ?? "").split(";")[0] || null,
        audioBytesApprox,
        speechTextLen: (data.speechText ?? "").length,
        skipped: false,
      });
      return {
        ok: true,
        audioBase64: data.audioBase64,
        mimeType: data.mimeType,
        speechText: data.speechText,
        latencyMs: data.latencyMs ?? Date.now() - started,
      };
    } catch {
      return {
        ok: false,
        error: "Voice playback unavailable.",
        code: "tts_failed",
        latencyMs: Date.now() - started,
      };
    }
  }
}
