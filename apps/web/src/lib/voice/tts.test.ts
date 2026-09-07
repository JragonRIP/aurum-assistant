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
  TTS_RETRY_DELAYS_MS,
  TTS_TOTAL_BUDGET_MS,
} from "@aurum/ai";
import {
  httpStatusForTtsError,
  providerErrorClassFor,
  shouldRetryRateLimit,
} from "./tts";
import {
  extractSafeTtsQuotaInfo,
  parseRetryDelayPhrase,
} from "./tts-quota";
import {
  getTtsCircuit,
  openTtsCircuit,
  resetTtsCircuits,
} from "./tts-circuit";

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
  });

  it("uses 3-attempt delay schedule and 12s budget", () => {
    assert.equal(MAX_TTS_RETRIES, 2);
    assert.deepEqual([...TTS_RETRY_DELAYS_MS], [450, 1200, 2500]);
    assert.equal(TTS_TOTAL_BUDGET_MS, 12_000);
  });

  it("maps provider errors to safe HTTP statuses", () => {
    assert.equal(
      httpStatusForTtsError(
        new AIProviderError({
          message: "rate limited",
          kind: "transient",
          provider: "gemini",
          retryable: false,
          httpStatus: 429,
        }),
      ),
      429,
    );
    assert.equal(
      providerErrorClassFor(
        new AIProviderError({
          message: "circuit",
          kind: "transient",
          provider: "gemini",
          retryable: false,
          httpStatus: 429,
          code: "circuit_open",
        }),
      ),
      "rate_limited",
    );
  });

  it("parses RetryInfo delay phrases", () => {
    assert.equal(parseRetryDelayPhrase("11.76s"), 11760);
    assert.equal(parseRetryDelayPhrase("34809s"), 34_809_000);
    assert.ok(
      Math.abs((parseRetryDelayPhrase("9h40m31.1s") ?? 0) - 34_831_100) < 1000,
    );
  });

  it("extracts safe QuotaFailure fields without secrets", () => {
    const err = new Error(
      JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message:
            "Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 100, model: gemini-2.5-flash-tts\nPlease retry in 9h40m0s.",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaMetric:
                    "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel",
                  quotaDimensions: {
                    model: "gemini-2.5-flash-tts",
                    location: "global",
                  },
                },
              ],
            },
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "34800s",
            },
          ],
        },
      }),
    );
    (err as { status?: number }).status = 429;
    const info = extractSafeTtsQuotaInfo(err);
    assert.equal(
      info.quotaMetric,
      "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
    );
    assert.equal(info.quotaId, "GenerateRequestsPerDayPerProjectPerModel");
    assert.equal(info.model, "gemini-2.5-flash-tts");
    assert.equal(info.limit, 100);
    assert.equal(info.isDailyQuota, true);
    assert.equal(info.isFreeTierMetric, false);
    assert.equal(info.retryDelayMs, 34_800_000);
  });

  it("does not retry daily RESOURCE_EXHAUSTED inside the turn", () => {
    const decision = shouldRetryRateLimit({
      alreadyRetried429: false,
      remainingBudgetMs: 12_000,
      quotaInfo: {
        httpStatus: 429,
        statusText: "RESOURCE_EXHAUSTED",
        quotaMetric:
          "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
        quotaId: "GenerateRequestsPerDayPerProjectPerModel",
        model: "gemini-2.5-flash-tts",
        location: "global",
        limit: 100,
        retryDelayMs: 34_800_000,
        isDailyQuota: true,
        isFreeTierMetric: false,
        violations: [],
      },
    });
    assert.equal(decision.retry, false);
    assert.equal(decision.reason, "daily_quota");
  });

  it("retries short RetryInfo only when it fits the budget", () => {
    const ok = shouldRetryRateLimit({
      alreadyRetried429: false,
      remainingBudgetMs: 12_000,
      quotaInfo: {
        httpStatus: 429,
        statusText: "RESOURCE_EXHAUSTED",
        quotaMetric: "generativelanguage.googleapis.com/generate_content_requests",
        quotaId: "GenerateRequestsPerMinutePerProjectPerModel",
        model: "gemini-2.5-flash-tts",
        location: "global",
        limit: 10,
        retryDelayMs: 2_000,
        isDailyQuota: false,
        isFreeTierMetric: false,
        violations: [],
      },
    });
    assert.equal(ok.retry, true);
    assert.equal(ok.delayMs, 2_000);

    const noInfo = shouldRetryRateLimit({
      alreadyRetried429: false,
      remainingBudgetMs: 12_000,
      quotaInfo: {
        httpStatus: 429,
        statusText: "RESOURCE_EXHAUSTED",
        quotaMetric: null,
        quotaId: null,
        model: null,
        location: null,
        limit: null,
        retryDelayMs: null,
        isDailyQuota: false,
        isFreeTierMetric: false,
        violations: [],
      },
    });
    assert.equal(noInfo.retry, false);
    assert.equal(noInfo.reason, "no_retry_info");
  });

  it("opens and hits a per-model circuit breaker", () => {
    resetTtsCircuits();
    openTtsCircuit({
      model: "gemini-2.5-flash-preview-tts",
      retryDelayMs: 60_000,
      quotaMetric:
        "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel",
    });
    const snap = getTtsCircuit("gemini-2.5-flash-preview-tts");
    assert.equal(snap.open, true);
    assert.ok((snap.remainingMs ?? 0) > 50_000);
    resetTtsCircuits();
  });

  it("synthesizeSpeech uses circuit + quota-aware 429 handling", () => {
    const src = readFileSync(join(here, "tts.ts"), "utf8");
    assert.match(src, /openTtsCircuit/);
    assert.match(src, /shouldRetryRateLimit/);
    assert.match(src, /primary_rate_limited/);
    assert.match(src, /TTS_TOTAL_BUDGET_MS/);
  });
});
