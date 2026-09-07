/**
 * Renderer push-to-talk capture via MediaRecorder.
 * Stops tracks immediately on release/cancel. Does not persist audio.
 */
import { VOICE_MAX_RECORD_MS, VOICE_MIN_AUDIO_BYTES } from "@aurum/shared";

export type CaptureResult =
  | { ok: true; blob: Blob; mimeType: string; durationMs: number }
  | { ok: false; code: "permission" | "empty" | "cancelled" | "error"; message: string };

export class VoiceCaptureSession {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;

  async start(opts?: { deviceId?: string | null }): Promise<{ ok: boolean; error?: string }> {
    this.cleanup();
    this.cancelled = false;
    this.chunks = [];
    try {
      const constraints: MediaStreamConstraints = {
        audio: opts?.deviceId
          ? { deviceId: { exact: opts.deviceId } }
          : true,
        video: false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      const mimeType = pickMimeType();
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
      this.recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
      };
      this.startedAt = Date.now();
      this.recorder.start(100);
      this.maxTimer = setTimeout(() => {
        void this.stop();
      }, VOICE_MAX_RECORD_MS);
      return { ok: true };
    } catch (err) {
      this.cleanup();
      const message = err instanceof Error ? err.message : "Microphone unavailable";
      const code = /Permission|NotAllowed|denied/i.test(message)
        ? "permission"
        : "error";
      return { ok: false, error: message };
    }
  }

  async stop(): Promise<CaptureResult> {
    if (this.cancelled) {
      this.cleanup();
      return { ok: false, code: "cancelled", message: "Cancelled" };
    }
    const durationMs = Date.now() - this.startedAt;
    const blob = await this.finalizeRecorder();
    this.cleanup();
    if (!blob || blob.size < VOICE_MIN_AUDIO_BYTES) {
      return { ok: false, code: "empty", message: "I didn't catch that." };
    }
    return {
      ok: true,
      blob,
      mimeType: blob.type || "audio/webm",
      durationMs,
    };
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanup();
  }

  isActive(): boolean {
    return Boolean(this.recorder && this.recorder.state !== "inactive");
  }

  private finalizeRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") {
        resolve(this.chunks.length ? new Blob(this.chunks, { type: "audio/webm" }) : null);
        return;
      }
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm";
        resolve(this.chunks.length ? new Blob(this.chunks, { type }) : null);
      };
      try {
        rec.requestData();
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  private cleanup(): void {
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
    this.chunks = [];
  }
}

function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
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
