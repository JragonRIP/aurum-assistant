import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AIProviderError,
  DEFAULT_TTS_FALLBACK_MODEL,
  DEFAULT_TTS_MODEL,
  getTtsFallbackModel,
  MAX_TTS_RETRIES,
  TTS_RATE_LIMIT_DEFAULT_BACKOFF_MS,
  TTS_RATE_LIMIT_MAX_BACKOFF_MS,
  TTS_RETRY_DELAYS_MS,
  TTS_TOTAL_BUDGET_MS,
} from "@aurum/ai";
import {
  httpStatusForTtsError,
  providerErrorClassFor,
} from "./tts";

const here = join(__dirname);

describe("tts retry + fallback contracts", () => {
  it("primary model is flash preview TTS", () => {
    assert.equal(DEFAULT_TTS_MODEL, "gemini-2.5-flash-preview-tts");
  });

  it("official fallback is pro preview TTS", () => {
    assert.equal(DEFAULT_TTS_FALLBACK_MODEL, "gemini-2.5-pro-preview-tts");
    assert.equal(
      getTtsFallbackModel({} as unknown as NodeJS.ProcessEnv),
      DEFAULT_TTS_FALLBACK_MODEL,
    );
    assert.equal(
      getTtsFallbackModel({
        VOICE_TTS_FALLBACK_MODEL: "off",
      } as unknown as NodeJS.ProcessEnv),
      null,
    );
  });

  it("uses 3-attempt delay schedule", () => {
    assert.equal(MAX_TTS_RETRIES, 2);
    assert.deepEqual([...TTS_RETRY_DELAYS_MS], [450, 1200, 2500]);
  });

  it("keeps end-to-end TTS budget under tens of seconds", () => {
    assert.equal(TTS_TOTAL_BUDGET_MS, 12_000);
    assert.ok(TTS_TOTAL_BUDGET_MS <= 15_000);
    assert.equal(TTS_RATE_LIMIT_DEFAULT_BACKOFF_MS, 2_000);
    assert.equal(TTS_RATE_LIMIT_MAX_BACKOFF_MS, 4_000);
  });

  it("maps provider errors to safe HTTP statuses", () => {
    assert.equal(
      httpStatusForTtsError(
        new AIProviderError({
          message: "x",
          kind: "transient",
          provider: "gemini",
          retryable: true,
          httpStatus: 503,
        }),
      ),
      503,
    );
    assert.equal(
      httpStatusForTtsError(
        new AIProviderError({
          message: "x",
          kind: "auth",
          provider: "gemini",
          retryable: false,
          httpStatus: 401,
        }),
      ),
      401,
    );
    assert.equal(
      httpStatusForTtsError(
        new AIProviderError({
          message: "x",
          kind: "invalid_request",
          provider: "gemini",
          retryable: false,
        }),
      ),
      400,
    );
    assert.equal(
      httpStatusForTtsError(
        new AIProviderError({
          message: "rate limited",
          kind: "transient",
          provider: "gemini",
          retryable: true,
          httpStatus: 429,
        }),
      ),
      429,
    );
    assert.equal(
      httpStatusForTtsError(
        new AIProviderError({
          message: "TTS latency budget exhausted",
          kind: "cancelled",
          provider: "gemini",
          retryable: false,
          code: "budget_exhausted",
        }),
      ),
      504,
    );
  });

  it("exposes provider error class including no_audio and budget", () => {
    assert.equal(
      providerErrorClassFor(
        new AIProviderError({
          message: "TTS returned no audio",
          kind: "transient",
          provider: "gemini",
          retryable: true,
          code: "no_audio",
        }),
      ),
      "no_audio",
    );
    assert.equal(
      providerErrorClassFor(
        new AIProviderError({
          message: "budget",
          kind: "cancelled",
          provider: "gemini",
          retryable: false,
          code: "budget_exhausted",
        }),
      ),
      "budget_exhausted",
    );
    assert.equal(
      providerErrorClassFor(
        new AIProviderError({
          message: "rl",
          kind: "transient",
          provider: "gemini",
          retryable: true,
          httpStatus: 429,
        }),
      ),
      "rate_limited",
    );
  });

  it("synthesizeSpeech uses budget-aware retries and fallback model", () => {
    const src = readFileSync(join(here, "tts.ts"), "utf8");
    assert.match(src, /TTS_TOTAL_BUDGET_MS/);
    assert.match(src, /getTtsFallbackModel/);
    assert.match(src, /fallback_start/);
    assert.match(src, /MAX_TTS_RETRIES/);
    assert.match(src, /rateLimitBackoffMs/);
    assert.match(src, /httpStatus !== 429/);
  });

  it("device synthesize route returns providerErrorClass", () => {
    const src = readFileSync(
      join(here, "../../app/api/devices/voice/synthesize/route.ts"),
      "utf8",
    );
    assert.match(src, /providerErrorClass/);
    assert.match(src, /httpStatusForTtsError/);
  });
});
