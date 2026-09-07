/**
 * Main-process voice STT/TTS proxy — device Bearer stays off the renderer.
 */
import { getAurumWebUrl } from "./config";
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

export class VoiceBridge {
  constructor(private getCred: () => DeviceCredential | null) {}

  async transcribe(opts: {
    bytes: ArrayBuffer | Buffer;
    mimeType: string;
  }): Promise<TranscribeResult> {
    const cred = this.getCred();
    if (!cred) return { ok: false, error: "Device not paired", code: "DEVICE_OFFLINE" };

    const form = new FormData();
    const blob = new Blob([opts.bytes], { type: opts.mimeType || "audio/webm" });
    form.append("audio", blob, "ptt.webm");

    const started = Date.now();
    try {
      const res = await fetch(
        `${getAurumWebUrl()}/api/devices/voice/transcribe`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cred.deviceId}.${cred.deviceSecret}`,
          },
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
        return {
          ok: false,
          error: data.error || "Transcription unavailable.",
          code: data.code,
          latencyMs: Date.now() - started,
        };
      }
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
      const res = await fetch(
        `${getAurumWebUrl()}/api/devices/voice/synthesize`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cred.deviceId}.${cred.deviceSecret}`,
            "Content-Type": "application/json",
          },
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
      };
      if (!res.ok) {
        return {
          ok: false,
          error: data.error || "Voice playback unavailable.",
          code: data.code,
          latencyMs: Date.now() - started,
          skipped: Boolean((data as { skipped?: boolean }).skipped),
        };
      }
      if ((data as { skipped?: boolean }).skipped) {
        return { ok: true, skipped: true, speechText: data.speechText };
      }
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
