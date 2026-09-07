/**
 * Desktop TTS HTTP policy: server owns Gemini retries.
 * Desktop retries only genuine transport/network failures where the
 * server was likely not reached — never re-runs a completed 429/5xx tree.
 */
import { TTS_RETRY_DELAYS_MS, TTS_TOTAL_BUDGET_MS } from "@aurum/ai";

/** Transport-only retries (not HTTP status retries). */
export const DESKTOP_TTS_MAX_ATTEMPTS = 3;

/** @deprecated Server owns 502/503/504 retries; kept for tests/docs. */
export function isTransientTtsHttpStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export function isRateLimitedTtsStatus(status: number): boolean {
  return status === 429;
}

/** Completed HTTP responses must not trigger another provider retry tree. */
export function shouldRetryCompletedTtsHttpStatus(_status: number): boolean {
  return false;
}

export function isTransientTtsNetworkError(err: unknown): boolean {
  if (!err) return false;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  const lower = message.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("socket hang up") ||
    lower.includes("enotfound")
  ) {
    return true;
  }
  const code =
    err && typeof err === "object"
      ? (err as { code?: string }).code
      : undefined;
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED"
  );
}

export function ttsRetryDelayMs(attemptJustFailed: number): number {
  const index = Math.max(0, attemptJustFailed - 1);
  return (
    TTS_RETRY_DELAYS_MS[index] ??
    TTS_RETRY_DELAYS_MS[TTS_RETRY_DELAYS_MS.length - 1]!
  );
}

export function parseRetryAfterHeader(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.round(asNum * 1000);
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

export async function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One synth HTTP call by default. Retries only when fetch throws a
 * transient network error (server likely never handled the request).
 */
export async function withTtsHttpRetries<T>(opts: {
  signal?: AbortSignal;
  budgetMs?: number;
  attempt: (attempt: number) => Promise<{
    status: number;
    /** Ignored for HTTP retries — server owns provider trees. */
    transient?: boolean;
    rateLimited?: boolean;
    retryAfterMs?: number | null;
    value?: T;
    error?: unknown;
  }>;
  onAttempt?: (info: {
    attempt: number;
    status: number | null;
    retrying: boolean;
    latencyMs: number;
    providerErrorClass?: string | null;
    retryAfterMs?: number | null;
    budgetRemainingMs?: number;
  }) => void;
}): Promise<T> {
  const budgetMs = opts.budgetMs ?? TTS_TOTAL_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let lastError: unknown = new Error("TTS failed");
  let lastStatus = 0;

  for (let attempt = 1; attempt <= DESKTOP_TTS_MAX_ATTEMPTS; attempt++) {
    if (opts.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    if (Date.now() >= deadline) {
      const err = new Error("TTS latency budget exhausted");
      err.name = "AbortError";
      (err as { code?: string }).code = "budget_exhausted";
      throw err;
    }

    const started = Date.now();
    try {
      const result = await opts.attempt(attempt);
      lastStatus = result.status;
      const latencyMs = Date.now() - started;
      if (result.value !== undefined) {
        opts.onAttempt?.({
          attempt,
          status: result.status,
          retrying: false,
          latencyMs,
          budgetRemainingMs: Math.max(0, deadline - Date.now()),
        });
        return result.value;
      }

      lastError = result.error ?? new Error(`TTS HTTP ${result.status}`);
      const is429 = result.rateLimited === true || result.status === 429;
      opts.onAttempt?.({
        attempt,
        status: result.status,
        retrying: false,
        latencyMs,
        providerErrorClass: is429
          ? "rate_limited"
          : result.transient
            ? "transient"
            : null,
        retryAfterMs: is429 ? (result.retryAfterMs ?? null) : null,
        budgetRemainingMs: Math.max(0, deadline - Date.now()),
      });
      // Completed HTTP response — do not stack another server provider tree.
      throw lastError;
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") throw err;
      if (
        err === lastError ||
        (err instanceof Error && err.message.startsWith("TTS HTTP"))
      ) {
        throw err;
      }
      lastError = err;
      const latencyMs = Date.now() - started;
      const transient = isTransientTtsNetworkError(err);
      let willRetry =
        transient && attempt < DESKTOP_TTS_MAX_ATTEMPTS && !opts.signal?.aborted;
      const delayMs = ttsRetryDelayMs(attempt);
      if (willRetry && Date.now() + delayMs + 500 >= deadline) willRetry = false;
      opts.onAttempt?.({
        attempt,
        status: lastStatus || null,
        retrying: willRetry,
        latencyMs,
        providerErrorClass: transient ? "transient_network" : "unknown",
        budgetRemainingMs: Math.max(0, deadline - Date.now()),
      });
      if (!willRetry) throw err;
      await sleepWithAbort(delayMs, opts.signal);
    }
  }

  throw lastError;
}
