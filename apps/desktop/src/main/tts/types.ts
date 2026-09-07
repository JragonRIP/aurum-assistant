/**
 * TTS provider abstraction — overlay/UI talks to the central synthesizer,
 * not a specific engine.
 */
export type TtsProviderId = "kokoro" | "gemini";

export type TtsVoiceInfo = {
  id: string;
  label: string;
  lang?: string;
  gender?: string;
};

export type TtsSynthesizeOptions = {
  text: string;
  voice?: string;
  speed?: number;
  signal?: AbortSignal;
};

export type TtsSynthesizeResult = {
  ok: true;
  provider: TtsProviderId;
  audioBase64: string;
  mimeType: string;
  speechText: string;
  voice: string;
  latencyMs: number;
  audioBytes: number;
};

export type TtsSynthesizeFailure = {
  ok: false;
  provider: TtsProviderId | null;
  error: string;
  code: string;
  latencyMs: number;
};

export type TtsProviderHealth = {
  id: TtsProviderId;
  available: boolean;
  ready: boolean;
  status: "ready" | "loading" | "starting" | "not_installed" | "error" | "unavailable";
  detail?: string | null;
  latencyMs?: number | null;
};

export interface TtsProvider {
  readonly id: TtsProviderId;
  availability(): Promise<TtsProviderHealth>;
  healthCheck(): Promise<TtsProviderHealth>;
  getVoices(): Promise<TtsVoiceInfo[]>;
  synthesize(
    opts: TtsSynthesizeOptions,
  ): Promise<TtsSynthesizeResult | TtsSynthesizeFailure>;
}

export type SpeechEngineMode = "local" | "gemini" | "auto";

export type PronunciationPreference =
  | "natural"
  | "british"
  | "americanized_british";

export type LocalTtsSettings = {
  speechEngine: SpeechEngineMode;
  /** Kokoro voice id */
  kokoroVoice: string;
  speed: number;
  allowGeminiFallback: boolean;
  /** Spoken pronunciation preference (does not change displayed text). */
  pronunciation: PronunciationPreference;
};

export const DEFAULT_LOCAL_TTS_SETTINGS: LocalTtsSettings = {
  speechEngine: "local",
  kokoroVoice: "bm_george",
  speed: 1.0,
  allowGeminiFallback: true,
  pronunciation: "americanized_british",
};

export const KOKORO_RECOMMENDED_VOICE = "bm_george";
