/**
 * PCM/WAV helpers for Gemini TTS (L16) → playable WAV.
 * Exported for tests and shared conversion with web Test Voice.
 */

export type WavInfo = {
  ok: boolean;
  error?: string;
  riff?: string;
  wave?: string;
  audioFormat?: number;
  numChannels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  byteRate?: number;
  blockAlign?: number;
  dataSize?: number;
  pcmBytes?: number;
  nonzeroSamples?: number;
  durationMsApprox?: number;
};

export function pcmToWav(
  pcm: Uint8Array,
  sampleRate: number,
  opts?: { numChannels?: number; bitsPerSample?: number },
): ArrayBuffer {
  const numChannels = opts?.numChannels ?? 1;
  const bitsPerSample = opts?.bitsPerSample ?? 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  // 16-bit PCM requires even byte length
  const dataSize = pcm.byteLength - (pcm.byteLength % 2);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm.subarray(0, dataSize));
  return buffer;
}

export function parseSampleRateFromMime(mimeType: string): number {
  const rateMatch = /rate=(\d+)/i.exec(mimeType);
  return rateMatch ? Number(rateMatch[1]) : 24000;
}

export function isPcmMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  return mime.includes("l16") || mime.includes("pcm");
}

/** Convert Gemini inline audio (often L16 PCM) into a playable audio/wav Blob. */
export function pcmOrBlob(bytes: Uint8Array, mimeType: string): Blob {
  if (isPcmMime(mimeType)) {
    const rate = parseSampleRateFromMime(mimeType);
    return new Blob([pcmToWav(bytes, rate)], { type: "audio/wav" });
  }
  return new Blob([bytes], { type: mimeType.split(";")[0] || "audio/wav" });
}

/** Inspect a WAV buffer for RIFF validity and basic PCM stats (safe diagnostics). */
export function inspectWav(bytes: Uint8Array): WavInfo {
  if (bytes.byteLength < 44) {
    return { ok: false, error: "too_short", pcmBytes: bytes.byteLength };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = readString(view, 0, 4);
  const wave = readString(view, 8, 4);
  if (riff !== "RIFF" || wave !== "WAVE") {
    return { ok: false, error: "not_riff_wave", riff, wave, pcmBytes: bytes.byteLength };
  }
  const audioFormat = view.getUint16(20, true);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const blockAlign = view.getUint16(32, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataTag = readString(view, 36, 4);
  const dataSize = view.getUint32(40, true);
  if (dataTag !== "data") {
    return {
      ok: false,
      error: "missing_data_chunk",
      riff,
      wave,
      audioFormat,
      numChannels,
      sampleRate,
      bitsPerSample,
      byteRate,
      blockAlign,
    };
  }
  const pcmStart = 44;
  const pcmEnd = Math.min(bytes.byteLength, pcmStart + dataSize);
  const pcm = bytes.subarray(pcmStart, pcmEnd);
  let nonzero = 0;
  const step = Math.max(2, Math.floor(pcm.byteLength / 2000) * 2 || 2);
  for (let i = 0; i + 1 < pcm.byteLength; i += step) {
    if (pcm[i] !== 0 || pcm[i + 1] !== 0) nonzero += 1;
  }
  const durationMsApprox =
    sampleRate > 0 && bitsPerSample > 0 && numChannels > 0
      ? Math.round(
          (pcm.byteLength / (sampleRate * numChannels * (bitsPerSample / 8))) *
            1000,
        )
      : undefined;
  const ok =
    audioFormat === 1 &&
    numChannels === 1 &&
    bitsPerSample === 16 &&
    sampleRate > 0 &&
    dataSize > 0 &&
    nonzero > 0;
  return {
    ok,
    error: ok ? undefined : "invalid_or_silent_pcm",
    riff,
    wave,
    audioFormat,
    numChannels,
    sampleRate,
    bitsPerSample,
    byteRate,
    blockAlign,
    dataSize,
    pcmBytes: pcm.byteLength,
    nonzeroSamples: nonzero,
    durationMsApprox,
  };
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function readString(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}
