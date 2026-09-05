/**
 * Client-side display queue: smooth word-ish reveal of text already
 * received from the real Gemini stream. Never invents text.
 */

export type StreamingTextControllerOptions = {
  /** Called with the currently revealed prefix */
  onReveal: (visibleText: string) => void;
  /** Words per tick (approx). Default 1–3 dynamically */
  minWordsPerTick?: number;
  maxWordsPerTick?: number;
};

function splitPreservingWhitespace(text: string): string[] {
  // Keep whitespace attached to following word when possible: " hello" / "\n\nHi"
  const parts = text.split(/(\s+)/);
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      const next = parts[i + 1];
      if (next && !/^\s+$/.test(next)) {
        tokens.push(part + next);
        i++;
      } else {
        tokens.push(part);
      }
    } else {
      tokens.push(part);
    }
  }
  return tokens;
}

function endsWithSoftPunctuation(token: string): boolean {
  return /[,;:]$/.test(token.trimEnd());
}

function endsWithHardPunctuation(token: string): boolean {
  return /[.!?]$/.test(token.trimEnd());
}

export class StreamingTextController {
  private received = "";
  private revealedLength = 0;
  private queue: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private finishing = false;
  private readonly onReveal: (visibleText: string) => void;
  private readonly minWords: number;
  private readonly maxWords: number;

  constructor(options: StreamingTextControllerOptions) {
    this.onReveal = options.onReveal;
    this.minWords = options.minWordsPerTick ?? 1;
    this.maxWords = options.maxWordsPerTick ?? 3;
  }

  /** Enqueue text that just arrived from the network (real Gemini delta). */
  enqueue(delta: string): void {
    if (this.cancelled || !delta) return;
    this.received += delta;
    this.queue.push(...splitPreservingWhitespace(delta));
    this.schedule();
  }

  /** Snap visible text to everything received so far (e.g. mid-flight sync). */
  getReceived(): string {
    return this.received;
  }

  getVisible(): string {
    return this.received.slice(0, this.revealedLength);
  }

  /** Generation finished — drain remaining queue quickly, then snap. */
  finish(onDone?: () => void): void {
    if (this.cancelled) {
      onDone?.();
      return;
    }
    this.finishing = true;
    this.clearTimer();

    const flush = () => {
      if (this.cancelled) {
        onDone?.();
        return;
      }
      // Reveal up to ~8 tokens per frame while finishing
      let n = 0;
      while (this.queue.length > 0 && n < 8) {
        const token = this.queue.shift()!;
        this.revealedLength += token.length;
        n += 1;
      }
      this.onReveal(this.received.slice(0, this.revealedLength));
      if (this.queue.length > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          flush();
        }, 4);
        return;
      }
      this.snapToReceived();
      onDone?.();
    };
    flush();
  }

  /** Stop network-correlated reveal; drop unread queue. Keeps already-visible text. */
  cancel(): void {
    this.cancelled = true;
    this.clearTimer();
    this.queue = [];
    // Do not invent; keep revealed prefix only
    this.received = this.received.slice(0, this.revealedLength);
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  private clearTimer(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.cancelled || this.timer != null || this.finishing) return;
    if (this.queue.length === 0) return;

    const delay = this.nextDelay();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }

  private nextDelay(): number {
    const q = this.queue.length;
    if (this.finishing) return q > 20 ? 0 : 4;
    if (q > 40) return 8;
    if (q > 20) return 12;
    if (q > 10) return 18;
    return 28;
  }

  private wordsThisTick(): number {
    const q = this.queue.length;
    if (q > 40) return this.maxWords;
    if (q > 15) return Math.min(this.maxWords, 2);
    return this.minWords;
  }

  private tick(): void {
    if (this.cancelled || this.finishing) return;
    if (this.queue.length === 0) return;

    let words = this.wordsThisTick();
    let chunk = "";
    while (words > 0 && this.queue.length > 0) {
      const token = this.queue.shift()!;
      chunk += token;
      words -= 1;
      if (endsWithHardPunctuation(token)) break;
      if (endsWithSoftPunctuation(token) && words > 0) break;
    }

    this.revealedLength += chunk.length;
    this.onReveal(this.received.slice(0, this.revealedLength));
    this.schedule();
  }

  private snapToReceived(): void {
    this.revealedLength = this.received.length;
    this.queue = [];
    this.onReveal(this.received);
  }
}

/** Pure helper for tests: split text the same way the controller does. */
export function tokenizeForReveal(text: string): string[] {
  return splitPreservingWhitespace(text);
}
