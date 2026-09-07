/**
 * Renderer push-to-talk capture via MediaRecorder.
 * Stops tracks immediately on release/cancel. Does not persist audio.
 */
import { VOICE_MAX_RECORD_MS, VOICE_MIN_AUDIO_BYTES } from "@aurum/shared";

export type CaptureResult =
  | {
      ok: true;
      blob: Blob;
      mimeType: string;
      durationMs: number;
      chunkCount: number;
      requestedMimeType: string | null;
    }
  | {
      ok: false;
      code: "permission" | "empty" | "cancelled" | "error";
      message: string;
      diagnostics?: CaptureDiagnostics;
    };

export type CaptureDiagnostics = {
  durationMs: number;
  chunkCount: number;
  blobBytes: number;
  mimeType: string | null;
  requestedMimeType: string | null;
  recorderState: string | null;
};

export class VoiceCaptureSession {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private requestedMimeType: string | null = null;
  private chunkCount = 0;

  async start(opts?: {
    deviceId?: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    this.cleanupTracksOnly();
    this.cancelled = false;
    this.chunks = [];
    this.chunkCount = 0;
    try {
      const constraints: MediaStreamConstraints = {
        audio: opts?.deviceId
          ? { deviceId: { exact: opts.deviceId } }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
        video: false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      const mimeType = pickMimeType();
      this.requestedMimeType = mimeType ?? null;
      this.recorder = new MediaRecorder(
        this.stream,
        mimeType ? { mimeType } : undefined,
      );
      this.recorder.addEventListener("dataavailable", (ev) => {
        if (ev.data && ev.data.size > 0) {
          this.chunks.push(ev.data);
          this.chunkCount += 1;
        }
      });
      this.startedAt = Date.now();
      // Timeslice keeps chunks flowing; final stop still emits a last chunk.
      this.recorder.start(250);
      this.maxTimer = setTimeout(() => {
        void this.stop();
      }, VOICE_MAX_RECORD_MS);
      console.info("[aurum:voice:capture]", {
        event: "start",
        requestedMimeType: this.requestedMimeType,
        actualMimeType: this.recorder.mimeType || null,
        isTypeSupported: this.requestedMimeType
          ? MediaRecorder.isTypeSupported(this.requestedMimeType)
          : null,
      });
      return { ok: true };
    } catch (err) {
      this.cleanupTracksOnly();
      const message =
        err instanceof Error ? err.message : "Microphone unavailable";
      return { ok: false, error: message };
    }
  }

  async stop(): Promise<CaptureResult> {
    if (this.cancelled) {
      this.cleanupTracksOnly();
      return { ok: false, code: "cancelled", message: "Cancelled" };
    }
    const durationMs = Math.max(0, Date.now() - this.startedAt);
    const finalized = await this.finalizeRecorder();
    const blob = finalized.blob;
    const mimeType =
      blob?.type ||
      this.recorder?.mimeType ||
      this.requestedMimeType ||
      "audio/webm";
    const diagnostics: CaptureDiagnostics = {
      durationMs,
      chunkCount: this.chunkCount,
      blobBytes: blob?.size ?? 0,
      mimeType,
      requestedMimeType: this.requestedMimeType,
      recorderState: this.recorder?.state ?? null,
    };
    console.info("[aurum:voice:capture]", {
      event: "stop",
      ...diagnostics,
    });
    this.cleanupTracksOnly();

    if (!blob || blob.size <= 0) {
      return {
        ok: false,
        code: "empty",
        message: "I didn't catch that.",
        diagnostics,
      };
    }
    if (blob.size < VOICE_MIN_AUDIO_BYTES) {
      return {
        ok: false,
        code: "empty",
        message: "I didn't catch that.",
        diagnostics,
      };
    }
    return {
      ok: true,
      blob,
      mimeType,
      durationMs,
      chunkCount: this.chunkCount,
      requestedMimeType: this.requestedMimeType,
    };
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanupTracksOnly();
  }

  isActive(): boolean {
    return Boolean(this.recorder && this.recorder.state !== "inactive");
  }

  /**
   * Stop MediaRecorder and wait until the final dataavailable has been applied.
   * Calling stop() alone can race: onstop may run before the last chunk is queued.
   */
  private finalizeRecorder(): Promise<{ blob: Blob | null }> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec) {
        resolve({ blob: null });
        return;
      }
      if (rec.state === "inactive") {
        resolve({
          blob: this.chunks.length
            ? new Blob(this.chunks, {
                type: rec.mimeType || this.requestedMimeType || "audio/webm",
              })
            : null,
        });
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const type =
          rec.mimeType || this.requestedMimeType || "audio/webm";
        resolve({
          blob: this.chunks.length ? new Blob(this.chunks, { type }) : null,
        });
      };

      rec.addEventListener(
        "stop",
        () => {
          // Allow any trailing dataavailable from stop() to flush first.
          setTimeout(finish, 0);
        },
        { once: true },
      );

      try {
        if (rec.state === "recording") {
          try {
            rec.requestData();
          } catch {
            // Some Chromium builds throw if no data yet — stop still finalizes.
          }
          rec.stop();
        } else {
          finish();
        }
      } catch {
        finish();
      }

      // Safety: never hang the overlay if stop events are dropped.
      setTimeout(finish, 1500);
    });
  }

  private cleanupTracksOnly(): void {
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
    } catch {
      // ignore
    }
    this.recorder = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.stream = null;
    }
    // Chunks are only cleared here after stop() has already assembled the Blob
    // (or on cancel / failed start). Never clear before finalizeRecorder resolves.
    this.chunks = [];
    this.chunkCount = 0;
  }
}

export function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    ) {
      return c;
    }
  }
  return undefined;
}

export async function listAudioInputDevices(): Promise<
  Array<{ deviceId: string; label: string }>
> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || "Microphone",
      }));
  } catch {
    return [];
  }
}
