import OpenAI from "openai";
import { getTextModel, isOpenAIConfigured } from "@aurum/ai";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!isOpenAIConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

export function getConfiguredTextModel(): string {
  return getTextModel(process.env);
}

/** Reset cached client (tests) */
export function resetOpenAIClient(): void {
  client = null;
}
