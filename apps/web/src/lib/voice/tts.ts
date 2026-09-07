/**
 * Text-to-speech via Gemini TTS (server-side only).
 */
import {
  buildSpeechResponse,
  getTtsModel,
  getTtsVoice,
  isGeminiConfigured,
} from "@aurum/ai";
import { getGeminiClient } from "@/lib/ai/gemini-client";

export type SpeechResult = {
  /** base64 PCM or wav payload */
  audioBase64: string;
  mimeType: string;
  speechText: string;
  latencyMs: number;
  provider: "gemini";
  model: string;
  voice: string;
};

export async function synthesizeSpeech(opts: {
  text: string;
  voice?: string;
}): Promise<SpeechResult> {
  if (!isGeminiConfigured()) {
    throw new Error("Voice synthesis is not configured.");
  }
  const speechText = buildSpeechResponse(opts.text);
  if (!speechText) {
    throw new Error("Nothing to speak.");
  }

  const model = getTtsModel(process.env);
  const voice = opts.voice?.trim() || getTtsVoice(process.env);
  const started = Date.now();
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model,
    contents: speechText,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
    } as Record<string, unknown>,
  });

  const inline = extractInlineAudio(response);
  if (!inline) {
    throw new Error("TTS returned no audio.");
  }

  return {
    audioBase64: inline.data,
    mimeType: inline.mimeType || "audio/L16;rate=24000",
    speechText,
    latencyMs: Date.now() - started,
    provider: "gemini",
    model,
    voice,
  };
}

function extractInlineAudio(response: unknown): {
  data: string;
  mimeType: string;
} | null {
  const r = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mimeType?: string };
        }>;
      };
    }>;
  };
  const part = r.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData ?? part?.inline_data;
  if (!inline?.data) return null;
  return {
    data: inline.data,
    mimeType: inline.mimeType ?? "audio/L16;rate=24000",
  };
}
