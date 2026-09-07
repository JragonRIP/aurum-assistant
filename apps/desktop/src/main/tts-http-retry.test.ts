import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESKTOP_TTS_MAX_ATTEMPTS,
  isRateLimitedTtsStatus,
  isTransientTtsHttpStatus,
  isTransientTtsNetworkError,
  shouldRetryCompletedTtsHttpStatus,
  sleepWithAbort,
  ttsRetryDelayMs,
  withTtsHttpRetries,
} from "./tts-http-retry";

describe("tts http retry policy", () => {
  it("classifies statuses but does not retry completed HTTP", () => {
    assert.equal(isTransientTtsHttpStatus(502), true);
    assert.equal(isTransientTtsHttpStatus(429), false);
    assert.equal(isRateLimitedTtsStatus(429), true);
    assert.equal(shouldRetryCompletedTtsHttpStatus(502), false);
    assert.equal(shouldRetryCompletedTtsHttpStatus(429), false);
    assert.equal(shouldRetryCompletedTtsHttpStatus(503), false);
  });

  it("treats network failures as transient", () => {
    assert.equal(isTransientTtsNetworkError(new Error("fetch failed")), true);
    assert.equal(isTransientTtsNetworkError(new Error("validation")), false);
  });

  it("uses escalating backoff delays", () => {
    assert.equal(ttsRetryDelayMs(1), 450);
    assert.equal(ttsRetryDelayMs(2), 1200);
    assert.equal(ttsRetryDelayMs(3), 2500);
  });

  it("does not retry completed 502 from server", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            return { status: 502, transient: true, error: new Error("down") };
          },
        }),
      /down/,
    );
    assert.equal(calls, 1);
  });

  it("does not retry completed 429", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            return {
              status: 429,
              rateLimited: true,
              error: new Error("rate limited"),
            };
          },
        }),
      /rate limited/,
    );
    assert.equal(calls, 1);
  });

  it("does not retry 400/401/403", async () => {
    for (const status of [400, 401, 403]) {
      let calls = 0;
      await assert.rejects(() =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            return {
              status,
              error: new Error(`http ${status}`),
            };
          },
        }),
      );
      assert.equal(calls, 1);
    }
  });

  it("retries only transient network throws", async () => {
    let calls = 0;
    const value = await withTtsHttpRetries({
      attempt: async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        return { status: 200, value: "ok" };
      },
    });
    assert.equal(value, "ok");
    assert.equal(calls, 2);
  });

  it("fails after max network attempts", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            throw new Error("fetch failed");
          },
        }),
      /fetch failed/,
    );
    assert.equal(calls, DESKTOP_TTS_MAX_ATTEMPTS);
  });

  it("aborts during network backoff", async () => {
    const controller = new AbortController();
    let calls = 0;
    const p = withTtsHttpRetries({
      signal: controller.signal,
      onAttempt: ({ retrying }) => {
        if (retrying) controller.abort();
      },
      attempt: async () => {
        calls += 1;
        throw new Error("fetch failed");
      },
    });
    await assert.rejects(p, (err: Error) => err.name === "AbortError");
    assert.equal(calls, 1);
  });

  it("sleepWithAbort rejects when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => sleepWithAbort(10, controller.signal),
      (err: Error) => err.name === "AbortError",
    );
  });
});
