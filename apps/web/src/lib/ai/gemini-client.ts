import { GoogleGenAI } from "@google/genai";
import { getTextModel, isGeminiConfigured } from "@aurum/ai";

let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  if (!client) {
    client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }
  return client;
}

export function getConfiguredTextModel(): string {
  return getTextModel(process.env);
}

export function resetGeminiClient(): void {
  client = null;
}
