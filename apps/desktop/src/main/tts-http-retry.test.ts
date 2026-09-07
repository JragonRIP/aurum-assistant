import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESKTOP_TTS_MAX_ATTEMPTS,
  isRateLimitedTtsStatus,
  isTransientTtsHttpStatus,
  isTransientTtsNetworkError,
  rateLimitDelayMs,
  sleepWithAbort,
  ttsRetryDelayMs,
  withTtsHttpRetries,
} from "./tts-http-retry";

describe("tts http retry policy", () => {
  it("retries 502/503/504 only as generic transient", () => {
    assert.equal(isTransientTtsHttpStatus(502), true);
    assert.equal(isTransientTtsHttpStatus(503), true);
    assert.equal(isTransientTtsHttpStatus(504), true);
    assert.equal(isTransientTtsHttpStatus(400), false);
    assert.equal(isTransientTtsHttpStatus(401), false);
    assert.equal(isTransientTtsHttpStatus(403), false);
    assert.equal(isTransientTtsHttpStatus(429), false);
    assert.equal(isRateLimitedTtsStatus(429), true);
    assert.equal(isRateLimitedTtsStatus(502), false);
  });

  it("caps rate-limit backoff", () => {
    assert.equal(rateLimitDelayMs(null), 2000);
    assert.equal(rateLimitDelayMs(500), 500);
    assert.equal(rateLimitDelayMs(60_000), 4000);
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

  it("succeeds on attempt 2 after 502", async () => {
    let calls = 0;
    const value = await withTtsHttpRetries({
      attempt: async () => {
        calls += 1;
        if (calls === 1) return { status: 502, transient: true };
        return { status: 200, transient: false, value: "ok" };
      },
    });
    assert.equal(value, "ok");
    assert.equal(calls, 2);
  });

  it("succeeds on attempt 3 after repeated 503", async () => {
    let calls = 0;
    const value = await withTtsHttpRetries({
      attempt: async () => {
        calls += 1;
        if (calls < 3) return { status: 503, transient: true };
        return { status: 200, transient: false, value: "ok3" };
      },
    });
    assert.equal(value, "ok3");
    assert.equal(calls, 3);
  });

  it("does not retry 400", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            return {
              status: 400,
              transient: false,
              error: new Error("bad"),
            };
          },
        }),
      /bad/,
    );
    assert.equal(calls, 1);
  });

  it("does not retry 401/403", async () => {
    for (const status of [401, 403]) {
      let calls = 0;
      await assert.rejects(() =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            return {
              status,
              transient: false,
              error: new Error(`auth ${status}`),
            };
          },
        }),
      );
      assert.equal(calls, 1);
    }
  });

  it("fails after max attempts", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            return { status: 504, transient: true, error: new Error("down") };
          },
        }),
      /down/,
    );
    assert.equal(calls, DESKTOP_TTS_MAX_ATTEMPTS);
  });

  it("retries 429 at most once with conservative backoff", async () => {
    let calls = 0;
    const started = Date.now();
    await assert.rejects(
      () =>
        withTtsHttpRetries({
          attempt: async () => {
            calls += 1;
            return {
              status: 429,
              transient: false,
              rateLimited: true,
              retryAfterMs: 50,
              error: new Error("rate limited"),
            };
          },
        }),
      /rate limited/,
    );
    assert.equal(calls, 2);
    assert.ok(Date.now() - started >= 40);
  });

  it("stops when latency budget is exhausted", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withTtsHttpRetries({
          budgetMs: 30,
          attempt: async () => {
            calls += 1;
            await new Promise((r) => setTimeout(r, 40));
            return { status: 502, transient: true, error: new Error("slow") };
          },
        }),
      (err: Error & { code?: string }) =>
        err.name === "AbortError" ||
        err.code === "budget_exhausted" ||
        /budget|slow/.test(err.message),
    );
    assert.ok(calls >= 1);
    assert.ok(calls < DESKTOP_TTS_MAX_ATTEMPTS);
  });

  it("aborts during backoff", async () => {
    const controller = new AbortController();
    let calls = 0;
    const p = withTtsHttpRetries({
      signal: controller.signal,
      onAttempt: ({ retrying }) => {
        if (retrying) controller.abort();
      },
      attempt: async () => {
        calls += 1;
        return { status: 502, transient: true, error: new Error("TTS HTTP 502") };
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
