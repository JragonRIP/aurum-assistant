/**
 * Local Kokoro TTS provider — talks only to the loopback voice engine.
 */
import { appendVoiceLog } from "../voice-log";
import type { VoiceEngineManager } from "./voice-engine-manager";
import type {
  TtsProvider,
  TtsProviderHealth,
  TtsSynthesizeFailure,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsVoiceInfo,
} from "./types";

export class KokoroLocalProvider implements TtsProvider {
  readonly id = "kokoro" as const;

  constructor(private engine: VoiceEngineManager) {}

  async availability(): Promise<TtsProviderHealth> {
    return this.healthCheck();
  }

  async healthCheck(): Promise<TtsProviderHealth> {
    let state = this.engine.getState();
    // Cold start only — do not auto-heal after a crash (Settings Restart does that).
    if (state.status === "stopped") {
      state = await this.engine.ensureStarted();
    } else if (
      state.status === "starting" ||
      state.status === "loading_model"
    ) {
      state = await this.engine.ensureStarted();
    }
    if (state.status === "not_installed") {
      return {
        id: "kokoro",
        available: false,
        ready: false,
        status: "not_installed",
        detail: state.detail,
      };
    }
    if (state.status === "error") {
      return {
        id: "kokoro",
        available: false,
        ready: false,
        status: "error",
        detail: state.detail,
      };
    }
    if (state.status === "starting" || state.status === "loading_model") {
      return {
        id: "kokoro",
        available: true,
        ready: false,
        status: state.status === "starting" ? "starting" : "loading",
        detail:
          state.status === "starting"
            ? "Starting local voice engine"
            : "Loading Kokoro model",
      };
    }
    const ok = await this.engine.ping();
    return {
      id: "kokoro",
      available: ok,
      ready: ok,
      status: ok ? "ready" : "error",
      detail: ok ? null : "Health check failed",
      latencyMs: state.modelLoadMs,
    };
  }

  async getVoices(): Promise<TtsVoiceInfo[]> {
    let state = this.engine.getState();
    if (state.status === "stopped") {
      state = await this.engine.ensureStarted();
    } else if (
      state.status === "starting" ||
      state.status === "loading_model"
    ) {
      state = await this.engine.ensureStarted();
    }
    const url = this.engine.baseUrl();
    // Voices list is available while model is still warming.
    if (
      !url ||
      !state.secret ||
      (state.status !== "ready" && state.status !== "loading_model")
    ) {
      return [];
    }
    const res = await fetch(`${url}/voices`, {
      headers: { Authorization: `Bearer ${state.secret}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      voices?: Array<{ id: string; label: string; lang?: string; gender?: string }>;
    };
    return (json.voices ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      lang: v.lang,
      gender: v.gender,
    }));
  }

  async synthesize(
    opts: TtsSynthesizeOptions,
  ): Promise<TtsSynthesizeResult | TtsSynthesizeFailure> {
    const started = Date.now();
    let state = this.engine.getState();
    if (state.status === "stopped") {
      state = await this.engine.ensureStarted();
    } else if (
      state.status === "starting" ||
      state.status === "loading_model"
    ) {
      state = await this.engine.ensureStarted();
    }
    const url = this.engine.baseUrl();
    if (!url || !state.secret || state.status !== "ready") {
      return {
        ok: false,
        provider: "kokoro",
        error: state.detail || "Local voice engine unavailable",
        code:
          state.status === "not_installed"
            ? "voice_engine_not_installed"
            : "voice_engine_unavailable",
        latencyMs: Date.now() - started,
      };
    }

    try {
      appendVoiceLog("synthesize_started", {
        channel: "VOICE_LOCAL",
        provider: "kokoro",
        text_length: opts.text.length,
        voice: opts.voice ?? null,
      });
      const res = await fetch(`${url}/synthesize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: opts.text,
          voice: opts.voice,
          speed: opts.speed ?? 1,
        }),
        signal: opts.signal,
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        appendVoiceLog("synthesize_error", {
          channel: "VOICE_LOCAL",
          provider: "kokoro",
          status: res.status,
          code: data.code ?? null,
          latency_ms: latencyMs,
        });
        return {
          ok: false,
          provider: "kokoro",
          error: data.error || "Local synthesis failed",
          code: data.code || "tts_failed",
          latencyMs,
        };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 44 || buf.toString("ascii", 0, 4) !== "RIFF") {
        return {
          ok: false,
          provider: "kokoro",
          error: "Invalid WAV from local engine",
          code: "invalid_wav",
          latencyMs,
        };
      }
      appendVoiceLog("synthesize_complete", {
        channel: "VOICE_LOCAL",
        provider: "kokoro",
        text_length: opts.text.length,
        audio_bytes: buf.byteLength,
        latency_ms: latencyMs,
        voice: opts.voice ?? null,
        cloud_tts_called: false,
      });
      return {
        ok: true,
        provider: "kokoro",
        audioBase64: buf.toString("base64"),
        mimeType: "audio/wav",
        speechText: opts.text,
        voice: opts.voice || "bm_george",
        latencyMs,
        audioBytes: buf.byteLength,
      };
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        return {
          ok: false,
          provider: "kokoro",
          error: "Cancelled",
          code: "cancelled",
          latencyMs: Date.now() - started,
        };
      }
      return {
        ok: false,
        provider: "kokoro",
        error: err instanceof Error ? err.message : "Local synthesis failed",
        code: "tts_failed",
        latencyMs: Date.now() - started,
      };
    }
  }
}
