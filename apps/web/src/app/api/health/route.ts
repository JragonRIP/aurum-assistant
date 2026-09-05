import { NextResponse } from "next/server";
import { PRODUCT } from "@aurum/shared";
import { getTextModel, isGeminiConfigured } from "@aurum/ai";
import { hasSupabaseConfig, hasGeminiConfig } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    product: PRODUCT.name,
    version: PRODUCT.version,
    phase: 2,
    status: "ok",
    provider: "gemini",
    supabaseConfigured: hasSupabaseConfig(),
    geminiConfigured: hasGeminiConfig() || isGeminiConfigured(),
    textModel: hasGeminiConfig() ? getTextModel(process.env) : null,
    timestamp: new Date().toISOString(),
  });
}
