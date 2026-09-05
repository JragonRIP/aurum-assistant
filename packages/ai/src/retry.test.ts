import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AIProviderError,
  AI_PROVIDER_UNAVAILABLE_MESSAGE,
  classifyProviderError,
} from "./provider-errors";
import { CHAT_RETRY_DELAYS_MS, withProviderRetry } from "./retry";

describe("classifyProviderError", () => {
  it("marks 503 UNAVAILABLE as transient/retryable", () => {
    const err = Object.assign(new Error('{"error":{"code":503,"message":"The service is currently unavailable.","status":"UNAVAILABLE"}}'), {
      status: 503,
    });
    const classified = classifyProviderError(err, "gemini");
    assert.equal(classified.kind, "transient");
    assert.equal(classified.retryable, true);
    assert.equal(classified.httpStatus, 503);
    assert.equal(classified.toUserMessage(), AI_PROVIDER_UNAVAILABLE_MESSAGE);
  });

  it("does not retry 401", () => {
    const err = Object.assign(new Error("Invalid API key"), { status: 401 });
    const classified = classifyProviderError(err, "gemini");
    assert.equal(classified.kind, "auth");
    assert.equal(classified.retryable, false);
  });

  it("does not retry 400 bad request", () => {
    const err = Object.assign(new Error("Bad request"), { status: 400 });
    const classified = classifyProviderError(err, "gemini");
    assert.equal(classified.kind, "invalid_request");
    assert.equal(classified.retryable, false);
  });
});

describe("withProviderRetry", () => {
  it("succeeds on first attempt", async () => {
    const delays: number[] = [];
    const result = await withProviderRetry({
      provider: "gemini",
      model: "gemini-3.6-flash",
      delaysMs: CHAT_RETRY_DELAYS_MS,
      sleep: async (ms) => {
        delays.push(ms);
      },
      operation: async () => "ok",
    });
    assert.equal(result, "ok");
    assert.deepEqual(delays, []);
  });

  it("retries after 503 then succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withProviderRetry({
      provider: "gemini",
      model: "gemini-3.6-flash",
      delaysMs: CHAT_RETRY_DELAYS_MS,
      sleep: async (ms) => {
        delays.push(ms);
      },
      operation: async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
        }
        return "recovered";
      },
    });
    assert.equal(result, "recovered");
    assert.equal(calls, 2);
    assert.deepEqual(delays, [1000]);
  });

  it("fails gracefully after repeated 503s", async () => {
    let calls = 0;
    const delays: number[] = [];
    await assert.rejects(
      async () =>
        withProviderRetry({
          provider: "gemini",
          model: "gemini-3.6-flash",
          maxRetries: 3,
          delaysMs: CHAT_RETRY_DELAYS_MS,
          sleep: async (ms) => {
            delays.push(ms);
          },
          operation: async () => {
            calls += 1;
            throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AIProviderError);
        assert.equal(err.kind, "transient");
        assert.equal(err.toUserMessage(), AI_PROVIDER_UNAVAILABLE_MESSAGE);
        return true;
      },
    );
    assert.equal(calls, 4); // 1 initial + 3 retries
    assert.deepEqual(delays, [1000, 3000, 7000]);
  });

  it("does not retry 401", async () => {
    let calls = 0;
    await assert.rejects(
      async () =>
        withProviderRetry({
          provider: "gemini",
          model: "gemini-3.6-flash",
          sleep: async () => {
            throw new Error("should not sleep");
          },
          operation: async () => {
            calls += 1;
            throw Object.assign(new Error("Invalid API key"), { status: 401 });
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AIProviderError);
        assert.equal(err.kind, "auth");
        assert.equal(err.retryable, false);
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it("stops retries when request is cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(
      async () =>
        withProviderRetry({
          provider: "gemini",
          model: "gemini-3.6-flash",
          signal: controller.signal,
          delaysMs: CHAT_RETRY_DELAYS_MS,
          sleep: async (_ms, signal) => {
            controller.abort();
            if (signal?.aborted) {
              throw new AIProviderError({
                message: "Request cancelled",
                kind: "cancelled",
                provider: "gemini",
                retryable: false,
                code: "cancelled",
              });
            }
          },
          operation: async () => {
            calls += 1;
            throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AIProviderError);
        assert.equal(err.kind, "cancelled");
        return true;
      },
    );
    assert.equal(calls, 1);
  });
});
