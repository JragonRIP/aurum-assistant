/**
 * Speech-to-text via Gemini Transcribe (server-side only).
 */
import {
  getSttModel,
  isGeminiConfigured,
} from "@aurum/ai";
import { getGeminiClient } from "@/lib/ai/gemini-client";

export type TranscriptResult = {
  transcript: string;
  latencyMs: number;
  provider: "gemini";
  model: string;
};

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
            {
              text: "Transcribe the spoken audio verbatim. Return only the transcript text with no commentary.",
            },
          ],
        },
      ],
      // Prefer SMART when supported; ignore if SDK strips unknown fields
      config: {
        audioTranscriptionConfig: { mode: "SMART" },
      } as Record<string, unknown>,
    });

    const transcript = extractText(response).trim();
    return {
      transcript,
      latencyMs: Date.now() - started,
      provider: "gemini",
      model,
    };
  } catch (err) {
    // Fallback: generic multimodal audio understanding if dedicated STT model unavailable
    if (isModelNotFound(err)) {
      const fallbackModel = process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-3.6-flash";
      const response = await client.models.generateContent({
        model: fallbackModel,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mime, data: b64 } },
              {
                text: "Transcribe the spoken audio verbatim. Return only the transcript text.",
              },
            ],
          },
        ],
      });
      return {
        transcript: extractText(response).trim(),
        latencyMs: Date.now() - started,
        provider: "gemini",
        model: fallbackModel,
      };
    }
    throw err;
  }
}

function normalizeAudioMime(raw: string): string {
  const m = raw.toLowerCase().split(";")[0]?.trim() || "audio/webm";
  if (m === "audio/webm" || m === "audio/wav" || m === "audio/mpeg" || m === "audio/mp4" || m === "audio/ogg") {
    return m;
  }
  if (m.includes("webm")) return "audio/webm";
  if (m.includes("wav")) return "audio/wav";
  return "audio/webm";
}

function extractText(response: unknown): string {
  const r = response as {
    text?: string;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (typeof r.text === "string" && r.text.trim()) return r.text;
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim();
}

function isModelNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|NOT_FOUND|404|unsupported/i.test(msg);
}
