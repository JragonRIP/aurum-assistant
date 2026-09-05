import {
  AIProviderError,
  classifyProviderError,
  logProviderAttempt,
  type AIProviderName,
} from "./provider-errors";

/** Delays before retry attempts 1..3 (after failures) */
export const CHAT_RETRY_DELAYS_MS = [1_000, 3_000, 7_000] as const;

/** Maximum number of retries after the initial attempt (total attempts = maxRetries + 1) */
export const MAX_CHAT_RETRIES = 3;

export interface WithProviderRetryOptions<T> {
  provider: AIProviderName;
  model: string;
  operation: (attempt: number) => Promise<T>;
  /** Retries after first failure (default 3 → 4 total attempts) */
  maxRetries?: number;
  delaysMs?: readonly number[];
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onAttemptFailure?: (info: {
    attempt: number;
    error: AIProviderError;
    willRetry: boolean;
    delayMs: number | null;
  }) => void;
}

export async function sleepWithSignal(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new AIProviderError({
      message: "Request cancelled",
      kind: "cancelled",
      provider: "unknown",
      retryable: false,
      code: "cancelled",
    });
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(
        new AIProviderError({
          message: "Request cancelled",
          kind: "cancelled",
          provider: "unknown",
          retryable: false,
          code: "cancelled",
        }),
      );
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run an AI provider operation with exponential-style backoff for transient failures.
 * Does not retry auth / invalid request / cancellation.
 */
export async function withProviderRetry<T>(
  options: WithProviderRetryOptions<T>,
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_CHAT_RETRIES;
  const delays = options.delaysMs ?? CHAT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepWithSignal;
  const maxAttempts = maxRetries + 1;

  let lastError: AIProviderError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new AIProviderError({
        message: "Request cancelled",
        kind: "cancelled",
        provider: options.provider,
        retryable: false,
        code: "cancelled",
      });
    }

    const started = Date.now();
    try {
      return await options.operation(attempt);
    } catch (err) {
      const classified = classifyProviderError(err, options.provider);
      lastError = classified;
      const latencyMs = Date.now() - started;
      const retryIndex = attempt - 1; // 0-based index into delays for next wait
      const willRetry =
        classified.retryable &&
        attempt < maxAttempts &&
        !options.signal?.aborted &&
        classified.kind !== "cancelled";

      logProviderAttempt({
        provider: options.provider,
        model: options.model,
        attempt,
        maxAttempts,
        httpStatus: classified.httpStatus,
        latencyMs,
        requestId: classified.requestId,
        retryable: classified.retryable,
        kind: classified.kind,
        errorSummary: classified.message,
      });

      const delayMs = willRetry ? (delays[retryIndex] ?? delays[delays.length - 1] ?? 1000) : null;

      options.onAttemptFailure?.({
        attempt,
        error: classified,
        willRetry,
        delayMs,
      });

      if (!willRetry || delayMs == null) {
        throw classified;
      }

      await sleep(delayMs, options.signal);
    }
  }

  throw (
    lastError ??
    new AIProviderError({
      message: "AI provider failed",
      kind: "unknown",
      provider: options.provider,
      retryable: false,
    })
  );
}
