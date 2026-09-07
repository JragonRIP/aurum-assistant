/**
 * In-memory TTS circuit breaker keyed by provider model.
 * Quota scope for Gemini TTS RPD is project+model, so one breaker per model
 * is correct for a single-project Aurum deployment.
 */
export type TtsCircuitSnapshot = {
  model: string;
  open: boolean;
  untilMs: number | null;
  remainingMs: number;
  quotaMetric: string | null;
  quotaId: string | null;
};

type CircuitEntry = {
  untilMs: number;
  quotaMetric: string | null;
  quotaId: string | null;
  openedAtMs: number;
};

const circuits = new Map<string, CircuitEntry>();

/** Cap stored open TTL so a process restart is not forever; daily quota still re-opens on next 429. */
export const TTS_CIRCUIT_MAX_TTL_MS = 6 * 60 * 60 * 1000;

/** Minimum open window once tripped. */
export const TTS_CIRCUIT_MIN_TTL_MS = 30_000;

export function normalizeTtsCircuitModel(model: string): string {
  return model.trim().toLowerCase();
}

export function getTtsCircuit(
  model: string,
  now = Date.now(),
): TtsCircuitSnapshot {
  const key = normalizeTtsCircuitModel(model);
  const entry = circuits.get(key);
  if (!entry) {
    return {
      model: key,
      open: false,
      untilMs: null,
      remainingMs: 0,
      quotaMetric: null,
      quotaId: null,
    };
  }
  if (now >= entry.untilMs) {
    circuits.delete(key);
    console.info("[aurum:voice:tts:circuit]", {
      stage: "circuit_closed",
      model: key,
      circuit_until: entry.untilMs,
    });
    return {
      model: key,
      open: false,
      untilMs: null,
      remainingMs: 0,
      quotaMetric: null,
      quotaId: null,
    };
  }
  return {
    model: key,
    open: true,
    untilMs: entry.untilMs,
    remainingMs: Math.max(0, entry.untilMs - now),
    quotaMetric: entry.quotaMetric,
    quotaId: entry.quotaId,
  };
}

export function openTtsCircuit(opts: {
  model: string;
  retryDelayMs: number | null;
  quotaMetric?: string | null;
  quotaId?: string | null;
  now?: number;
}): TtsCircuitSnapshot {
  const now = opts.now ?? Date.now();
  const key = normalizeTtsCircuitModel(opts.model);
  const hinted =
    typeof opts.retryDelayMs === "number" && opts.retryDelayMs > 0
      ? opts.retryDelayMs
      : 60_000;
  const ttl = Math.min(
    TTS_CIRCUIT_MAX_TTL_MS,
    Math.max(TTS_CIRCUIT_MIN_TTL_MS, hinted),
  );
  const untilMs = now + ttl;
  circuits.set(key, {
    untilMs,
    quotaMetric: opts.quotaMetric ?? null,
    quotaId: opts.quotaId ?? null,
    openedAtMs: now,
  });
  console.warn("[aurum:voice:tts:circuit]", {
    stage: "circuit_opened",
    model: key,
    circuit_until: untilMs,
    circuit_ttl_ms: ttl,
    quota_metric: opts.quotaMetric ?? null,
    quota_id: opts.quotaId ?? null,
    retry_delay_ms: opts.retryDelayMs,
  });
  return getTtsCircuit(key, now);
}

export function noteTtsCircuitHit(model: string, now = Date.now()): void {
  const snap = getTtsCircuit(model, now);
  if (!snap.open) return;
  console.info("[aurum:voice:tts:circuit]", {
    stage: "circuit_hit",
    model: snap.model,
    circuit_until: snap.untilMs,
    remaining_ms: snap.remainingMs,
    quota_metric: snap.quotaMetric,
    quota_id: snap.quotaId,
  });
}

/** Test helper */
export function resetTtsCircuits(): void {
  circuits.clear();
}
