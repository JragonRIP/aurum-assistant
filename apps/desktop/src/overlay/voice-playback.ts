/**
 * Single-slot TTS playback for the overlay.
 * New play() stops previous. Esc / new PTT should call stop().
 */
export class VoicePlayback {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private playing = false;

  isPlaying(): boolean {
    return this.playing;
  }

  stop(): void {
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.src = "";
      } catch {
        // ignore
      }
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.playing = false;
  }

  async playBase64(
    audioBase64: string,
    mimeType: string,
    opts?: { sinkId?: string | null; onEnded?: () => void },
  ): Promise<{ ok: boolean; error?: string }> {
    this.stop();
    try {
      const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const blob = pcmOrBlob(bytes, mimeType);
      this.objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(this.objectUrl);
      this.audio = audio;
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
        this.playing = false;
        this.stop();
        opts?.onEnded?.();
      };
      audio.onerror = () => {
        this.playing = false;
        this.stop();
        opts?.onEnded?.();
      };
      await audio.play();
      return { ok: true };
    } catch (err) {
      this.stop();
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Playback failed",
      };
    }
  }
}

function pcmOrBlob(bytes: Uint8Array, mimeType: string): Blob {
  const mime = mimeType.toLowerCase();
  if (mime.includes("l16") || mime.includes("pcm")) {
    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const rate = rateMatch ? Number(rateMatch[1]) : 24000;
    return new Blob([pcmToWav(bytes, rate)], { type: "audio/wav" });
  }
  return new Blob([bytes], { type: mimeType.split(";")[0] || "audio/wav" });
}

function pcmToWav(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
