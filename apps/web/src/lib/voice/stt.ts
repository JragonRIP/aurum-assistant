/**
 * Speech-to-text via Gemini Transcribe (server-side only).
 */
import {
  getSttModel,
  isGeminiConfigured,
} from "@aurum/ai";
import { AudioTranscriptionConfigMode } from "@google/genai";
import { getGeminiClient } from "@/lib/ai/gemini-client";

export type TranscriptResult = {
  transcript: string;
  latencyMs: number;
  provider: "gemini";
  model: string;
  /** Where the text was read from in the SDK response */
  source: "text" | "audioTranscription" | "candidates" | "empty";
};

export type SttFailureCode =
  | "EMPTY_AUDIO"
  | "NO_SPEECH_DETECTED"
  | "STT_PROVIDER_ERROR"
  | "UNSUPPORTED_AUDIO_FORMAT"
  | "TRANSCRIPT_EMPTY";

export async function transcribeAudio(opts: {
  bytes: Buffer;
  mimeType: string;
}): Promise<TranscriptResult> {
  if (!isGeminiConfigured()) {
    throw new Error("Voice transcription is not configured.");
  }
  const model = getSttModel(process.env);
  const started = Date.now();
  const client = getGeminiClient();
  const b64 = opts.bytes.toString("base64");
  const mime = normalizeAudioMime(opts.mimeType);
  const fallbackModel =
    process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-3.6-flash";

  let lastError: unknown;

  try {
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mime,
                data: b64,
              },
            },
          ],
        },
      ],
      config: {
        // Dedicated STT returns Part.audioTranscription.text (not Part.text).
        audioTranscriptionConfig: {
          mode: AudioTranscriptionConfigMode.VERBATIM,
        },
      },
    });

    const extracted = extractTranscript(response);
    // Successful empty response = no speech. Do not multimodal-fallback
    // (avoids hallucinated transcripts on silence).
    return {
      transcript: extracted.transcript,
      latencyMs: Date.now() - started,
      provider: "gemini",
      model,
      source: extracted.source,
    };
  } catch (err) {
    lastError = err;
    console.warn("[aurum:voice:stt]", {
      stage: "primary",
      model,
      bytes: opts.bytes.byteLength,
      mime,
      error: err instanceof Error ? err.message.slice(0, 160) : "unknown",
    });
  }

  // Fallback only when the dedicated STT call throws (model/MIME/provider errors).
  try {
    const response = await client.models.generateContent({
      model: fallbackModel,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mime, data: b64 } },
            {
              text: "Transcribe the spoken audio verbatim. Return only the transcript text with no commentary.",
            },
          ],
        },
      ],
    });
    const extracted = extractTranscript(response);
    return {
      transcript: extracted.transcript,
      latencyMs: Date.now() - started,
      provider: "gemini",
      model: fallbackModel,
      source: extracted.source,
    };
  } catch (err) {
    const primary = lastError instanceof Error ? lastError.message : "";
    const secondary = err instanceof Error ? err.message : String(err);
    throw new Error(
      `STT failed (${model}${primary ? `: ${primary.slice(0, 80)}` : ""}; fallback ${fallbackModel}: ${secondary.slice(0, 80)})`,
    );
  }
}

export function normalizeAudioMime(raw: string): string {
  const m = raw.toLowerCase().split(";")[0]?.trim() || "audio/webm";
  if (
    m === "audio/webm" ||
    m === "audio/wav" ||
    m === "audio/mpeg" ||
    m === "audio/mp4" ||
    m === "audio/ogg" ||
    m === "audio/flac"
  ) {
    return m;
  }
  if (m.includes("webm")) return "audio/webm";
  if (m.includes("wav")) return "audio/wav";
  if (m.includes("ogg")) return "audio/ogg";
  if (m.includes("mp4") || m.includes("m4a")) return "audio/mp4";
  return "audio/webm";
}

/**
 * Read transcript from Gemini generateContent responses.
 * Dedicated STT models populate Part.audioTranscription.text (not Part.text).
 */
export function extractTranscript(response: unknown): {
  transcript: string;
  source: TranscriptResult["source"];
} {
  const r = response as {
    text?: string | (() => string);
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          audioTranscription?: { text?: string };
        }>;
      };
    }>;
  };

  const parts = r.candidates?.[0]?.content?.parts ?? [];

  const fromAudio = parts
    .map((p) => p.audioTranscription?.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fromAudio) {
    return { transcript: fromAudio, source: "audioTranscription" };
  }

  if (typeof r.text === "function") {
    try {
      const t = String(r.text()).trim();
      if (t) return { transcript: t, source: "text" };
    } catch {
      // ignore getter errors
    }
  } else if (typeof r.text === "string" && r.text.trim()) {
    return { transcript: r.text.trim(), source: "text" };
  }

  const fromParts = parts
    .map((p) => p.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fromParts) {
    return { transcript: fromParts, source: "candidates" };
  }

  return { transcript: "", source: "empty" };
}
