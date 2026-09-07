/**
 * Single-slot TTS playback for the overlay.
 * Owns HTMLAudioElement independently of React render lifecycle.
 * New play() stops previous. Esc / new PTT should call stop().
 * Object URL revoked only on ended / stop / barge-in / error — never right after play().
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
  private mountedEl: HTMLAudioElement | null = null;

  isPlaying(): boolean {
    return this.playing;
  }

  /** Strong reference retained until stop/ended/error. */
  getActiveAudio(): HTMLAudioElement | null {
    return this.audio;
  }

  stop(): void {
    this.generation += 1;
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
    this.playing = false;
  }

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
    this.stop();
    const gen = this.generation;
    const emit: PlaybackEventSink = (event, fields) => {
      opts?.onEvent?.(event, fields);
    };
    const events: PlaybackEventName[] = [];
    const track = (event: PlaybackEventName, fields?: Record<string, string | number | boolean | null>) => {
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
      // Keep element in the document — some Electron builds silent-play detached Audio.
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
        this.playing = false;
        track("ended");
        diag.events = events.join(",");
        // Revoke only after playback completes.
        this.stop();
        opts?.onEnded?.();
      };
      audio.onerror = () => {
        if (gen !== this.generation) return;
        this.playing = false;
        const msg = "Audio element error";
        track("error", { play_error_message: msg });
        this.stop();
        opts?.onError?.(msg);
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
        this.stop();
        opts?.onError?.(message);
        diag.events = events.join(",");
        return { ok: false, error: message, audioBytes: bytes.byteLength, diag };
      }

      diag.audioVolume = audio.volume;
      diag.audioMuted = audio.muted;
      diag.readyState = audio.readyState;
      diag.networkState = audio.networkState;
      diag.events = events.join(",");

      return { ok: true, audioBytes: bytes.byteLength, diag };
    } catch (err) {
      this.stop();
      const message = err instanceof Error ? err.message.slice(0, 160) : "Playback failed";
      diag.playErrorMessage = message;
      diag.playErrorName = err instanceof Error ? err.name : "Error";
      diag.events = events.join(",");
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
    track: (event: PlaybackEventName, fields?: Record<string, string | number | boolean | null>) => void,
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
