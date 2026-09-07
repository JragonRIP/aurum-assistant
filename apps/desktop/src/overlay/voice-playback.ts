/**
 * Single-element TTS playback with an ordered queue.
 * One Audio element at a time; pre-buffered clips play sequentially.
 * stop() / barge-in clears current + queued; stale turnIds are ignored.
 */
import { pcmOrBlob } from "./wav-audio";

export type PlaybackDiag = {
  playbackAttempted: boolean;
  playPromiseResolved: boolean;
  playErrorName?: string;
  playErrorMessage?: string;
  audioVolume?: number;
  audioMuted?: boolean;
  audioBytes?: number;
  blobBytes?: number;
  blobMime?: string;
  objectUrlCreated?: boolean;
  readyState?: number;
  networkState?: number;
  events?: string;
};

export type PlaybackEventName =
  | "loadstart"
  | "loadedmetadata"
  | "loadeddata"
  | "canplay"
  | "playing"
  | "ended"
  | "error"
  | "stalled"
  | "abort"
  | "play_called"
  | "play_resolved"
  | "play_rejected";

export type PlaybackEventSink = (
  event: PlaybackEventName,
  fields?: Record<string, string | number | boolean | null>,
) => void;

type QueuedClip = {
  turnId: number;
  chunkIndex: number;
  bytes: Uint8Array;
  mimeType: string;
  onEvent?: PlaybackEventSink;
  onEnded?: () => void;
  onError?: (message: string) => void;
  onQueueIdle?: () => void;
};

/** Module singleton — survives OverlayApp remounts. */
let sharedPlayback: VoicePlayback | null = null;

export function getVoicePlayback(): VoicePlayback {
  if (!sharedPlayback) sharedPlayback = new VoicePlayback();
  return sharedPlayback;
}

export class VoicePlayback {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private playing = false;
  private generation = 0;
  private turnId = 0;
  private queue: QueuedClip[] = [];
  private draining = false;
  private mountedEl: HTMLAudioElement | null = null;
  private activeClip: QueuedClip | null = null;

  isPlaying(): boolean {
    return this.playing;
  }

  queueLength(): number {
    return this.queue.length + (this.playing ? 1 : 0);
  }

  getTurnId(): number {
    return this.turnId;
  }

  /** Strong reference retained until stop/ended/error. */
  getActiveAudio(): HTMLAudioElement | null {
    return this.audio;
  }

  /** Start a logical speak turn; invalidates prior queue. */
  beginTurn(turnId: number): void {
    this.stop();
    this.turnId = turnId;
  }

  /**
   * Hard stop: bump generation, clear queue, stop current audio.
   * Used for barge-in / Esc / new turn.
   */
  stop(): void {
    this.generation += 1;
    this.turnId = -1;
    this.queue = [];
    this.draining = false;
    this.activeClip = null;
    this.clearCurrentMedia();
    this.playing = false;
  }

  /**
   * Enqueue a clip for ordered playback. Stale turnIds are discarded.
   * Does not overlap — pumps one clip at a time.
   */
  enqueueBase64(
    audioBase64: string,
    mimeType: string,
    opts: {
      turnId: number;
      chunkIndex: number;
      onEvent?: PlaybackEventSink;
      onEnded?: () => void;
      onError?: (message: string) => void;
      onQueueIdle?: () => void;
    },
  ): void {
    if (opts.turnId !== this.turnId) return;
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    this.queue.push({
      turnId: opts.turnId,
      chunkIndex: opts.chunkIndex,
      bytes,
      mimeType,
      onEvent: opts.onEvent,
      onEnded: opts.onEnded,
      onError: opts.onError,
      onQueueIdle: opts.onQueueIdle,
    });
    void this.pump();
  }

  /** Immediate replace play (Test Voice / approval). Clears queue. */
  async playBase64(
    audioBase64: string,
    mimeType: string,
    opts?: {
      sinkId?: string | null;
      onEnded?: () => void;
      onError?: (message: string) => void;
      onEvent?: PlaybackEventSink;
    },
  ): Promise<{ ok: boolean; error?: string; audioBytes?: number; diag: PlaybackDiag }> {
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    return this.playBytes(bytes, mimeType, opts);
  }

  async playBytes(
    bytes: Uint8Array,
    mimeType: string,
    opts?: {
      sinkId?: string | null;
      onEnded?: () => void;
      onError?: (message: string) => void;
      onEvent?: PlaybackEventSink;
    },
  ): Promise<{ ok: boolean; error?: string; audioBytes?: number; diag: PlaybackDiag }> {
    this.queue = [];
    this.draining = false;
    this.activeClip = null;
    return this.playBytesInternal(bytes, mimeType, {
      onEnded: opts?.onEnded,
      onError: opts?.onError,
      onEvent: opts?.onEvent,
      sinkId: opts?.sinkId,
      advanceQueue: false,
    });
  }

  private async pump(): Promise<void> {
    if (this.playing || this.draining) return;
    const next = this.queue.shift();
    if (!next) return;
    if (next.turnId !== this.turnId) {
      void this.pump();
      return;
    }
    this.draining = true;
    this.activeClip = next;
    // playBytesInternal returns after audio.play() resolves, while audio may
    // still be playing. Next clip is started only from onended → pump().
    await this.playBytesInternal(next.bytes, next.mimeType, {
      onEvent: next.onEvent,
      onError: (message) => {
        next.onError?.(message);
        this.draining = false;
        this.activeClip = null;
        void this.pump();
      },
      onEnded: () => {
        next.onEnded?.();
        this.draining = false;
        this.activeClip = null;
        if (this.queue.length === 0 && !this.playing) {
          next.onQueueIdle?.();
        } else {
          void this.pump();
        }
      },
      advanceQueue: false,
      expectedTurnId: next.turnId,
    });
    // If play failed before starting, drain flag may still be true.
    if (!this.playing) {
      this.draining = false;
      this.activeClip = null;
      if (this.queue.length === 0) {
        next.onQueueIdle?.();
      } else {
        void this.pump();
      }
    }
  }

  private clearCurrentMedia(): void {
    if (this.audio) {
      try {
        this.audio.onended = null;
        this.audio.onerror = null;
        this.detachMediaListeners(this.audio);
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
      } catch {
        // ignore
      }
      this.unmountAudioElement(this.audio);
      this.audio = null;
    }
    if (this.objectUrl) {
      try {
        URL.revokeObjectURL(this.objectUrl);
      } catch {
        // ignore
      }
      this.objectUrl = null;
    }
  }

  private mediaErrorDetail(audio: HTMLAudioElement): {
    code: number | null;
    message: string;
  } {
    const err = audio.error;
    if (!err) return { code: null, message: "Audio element error" };
    const labels: Record<number, string> = {
      1: "MEDIA_ERR_ABORTED",
      2: "MEDIA_ERR_NETWORK",
      3: "MEDIA_ERR_DECODE",
      4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
    };
    return {
      code: err.code,
      message: labels[err.code] || err.message || "Audio element error",
    };
  }

  private async playBytesInternal(
    bytes: Uint8Array,
    mimeType: string,
    opts: {
      sinkId?: string | null;
      onEnded?: () => void;
      onError?: (message: string) => void;
      onEvent?: PlaybackEventSink;
      advanceQueue: boolean;
      expectedTurnId?: number;
    },
  ): Promise<{ ok: boolean; error?: string; audioBytes?: number; diag: PlaybackDiag }> {
    // Replace current element without invalidating the queue / turn.
    this.clearCurrentMedia();
    this.generation += 1;
    const gen = this.generation;
    const emit: PlaybackEventSink = (event, fields) => {
      opts?.onEvent?.(event, fields);
    };
    const events: PlaybackEventName[] = [];
    const track = (
      event: PlaybackEventName,
      fields?: Record<string, string | number | boolean | null>,
    ) => {
      events.push(event);
      emit(event, fields);
    };
    const diag: PlaybackDiag = {
      playbackAttempted: true,
      playPromiseResolved: false,
      audioBytes: bytes.byteLength,
      objectUrlCreated: false,
    };
    try {
      const blob = pcmOrBlob(bytes, mimeType);
      diag.blobBytes = blob.size;
      diag.blobMime = blob.type || "audio/wav";
      this.objectUrl = URL.createObjectURL(blob);
      diag.objectUrlCreated = true;

      const audio = new Audio();
      audio.preload = "auto";
      audio.volume = 1;
      audio.muted = false;
      audio.playbackRate = 1;
      this.mountAudioElement(audio);
      audio.src = this.objectUrl;
      this.audio = audio;
      diag.audioVolume = audio.volume;
      diag.audioMuted = audio.muted;
      diag.readyState = audio.readyState;
      diag.networkState = audio.networkState;

      this.attachMediaListeners(audio, gen, track);

      if (opts?.sinkId && "setSinkId" in audio) {
        try {
          // @ts-expect-error setSinkId is Chromium-specific
          await audio.setSinkId(opts.sinkId);
        } catch {
          // fall back to default output
        }
      }

      this.playing = true;

      audio.onended = () => {
        if (gen !== this.generation) return;
        if (
          opts.expectedTurnId != null &&
          opts.expectedTurnId !== this.turnId
        ) {
          return;
        }
        this.playing = false;
        track("ended");
        diag.events = events.join(",");
        this.clearCurrentMedia();
        opts?.onEnded?.();
        if (opts.advanceQueue) {
          void this.pump();
        }
      };
      audio.onerror = () => {
        if (gen !== this.generation) return;
        this.playing = false;
        const detail = this.mediaErrorDetail(audio);
        track("error", {
          play_error_message: detail.message,
          media_error_code: detail.code,
        });
        this.clearCurrentMedia();
        opts?.onError?.(detail.message);
        if (opts.advanceQueue) {
          void this.pump();
        }
      };

      track("play_called", {
        volume: audio.volume,
        muted: audio.muted,
        readyState: audio.readyState,
        networkState: audio.networkState,
        blobBytes: diag.blobBytes ?? null,
        blobMime: diag.blobMime ?? null,
      });
      try {
        await audio.play();
        if (gen !== this.generation) {
          diag.events = events.join(",");
          return { ok: false, error: "Playback superseded", diag };
        }
        diag.playPromiseResolved = true;
        track("play_resolved", {
          volume: audio.volume,
          muted: audio.muted,
          readyState: audio.readyState,
        });
      } catch (err) {
        if (gen !== this.generation) {
          diag.events = events.join(",");
          return { ok: false, error: "Playback superseded", diag };
        }
        this.playing = false;
        const name = err instanceof Error ? err.name : "Error";
        const message =
          err instanceof Error
            ? err.name === "NotAllowedError"
              ? "Autoplay blocked"
              : err.message.slice(0, 160)
            : "Playback failed";
        diag.playErrorName = name;
        diag.playErrorMessage = message;
        track("play_rejected", {
          play_error_name: name,
          play_error_message: message,
        });
        this.clearCurrentMedia();
        opts?.onError?.(message);
        diag.events = events.join(",");
        if (opts.advanceQueue) {
          void this.pump();
        }
        return { ok: false, error: message, audioBytes: bytes.byteLength, diag };
      }

      diag.audioVolume = audio.volume;
      diag.audioMuted = audio.muted;
      diag.readyState = audio.readyState;
      diag.networkState = audio.networkState;
      diag.events = events.join(",");

      return { ok: true, audioBytes: bytes.byteLength, diag };
    } catch (err) {
      this.playing = false;
      this.clearCurrentMedia();
      const message =
        err instanceof Error ? err.message.slice(0, 160) : "Playback failed";
      diag.playErrorMessage = message;
      diag.playErrorName = err instanceof Error ? err.name : "Error";
      diag.events = events.join(",");
      if (opts.advanceQueue) {
        void this.pump();
      }
      return { ok: false, error: message, diag };
    }
  }

  private mountAudioElement(audio: HTMLAudioElement): void {
    try {
      audio.setAttribute("data-aurum-voice-playback", "1");
      audio.style.display = "none";
      if (typeof document !== "undefined" && document.body) {
        document.body.appendChild(audio);
        this.mountedEl = audio;
      }
    } catch {
      // ignore
    }
  }

  private unmountAudioElement(audio: HTMLAudioElement): void {
    try {
      if (this.mountedEl === audio) this.mountedEl = null;
      audio.remove();
    } catch {
      // ignore
    }
  }

  private mediaCleanups = new WeakMap<HTMLAudioElement, () => void>();

  private attachMediaListeners(
    audio: HTMLAudioElement,
    gen: number,
    track: (
      event: PlaybackEventName,
      fields?: Record<string, string | number | boolean | null>,
    ) => void,
  ): void {
    const names: PlaybackEventName[] = [
      "loadstart",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "playing",
      "stalled",
      "abort",
    ];
    const handlers: Array<[string, EventListener]> = names.map((name) => {
      const handler: EventListener = () => {
        if (gen !== this.generation) return;
        track(name, {
          readyState: audio.readyState,
          networkState: audio.networkState,
          volume: audio.volume,
          muted: audio.muted,
        });
      };
      audio.addEventListener(name, handler);
      return [name, handler];
    });
    this.mediaCleanups.set(audio, () => {
      for (const [name, handler] of handlers) {
        audio.removeEventListener(name, handler);
      }
    });
  }

  private detachMediaListeners(audio: HTMLAudioElement): void {
    const cleanup = this.mediaCleanups.get(audio);
    if (cleanup) {
      cleanup();
      this.mediaCleanups.delete(audio);
    }
  }
}

export { pcmOrBlob } from "./wav-audio";
