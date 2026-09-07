/**
 * Rotating-safe voice diagnostics log (main process).
 * Path: %APPDATA%/aurum/logs/voice.log
 * Never log secrets, auth headers, raw audio, or full transcripts.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const MAX_BYTES = 512 * 1024;

export type VoiceLogChannel =
  | "VOICE_TTS"
  | "VOICE_PTT"
  | "VOICE_LOCAL"
  | "VOICE_PLAYBACK";

export type VoiceDiagFields = Record<
  string,
  string | number | boolean | null | undefined
> & {
  /** Overrides default VOICE_TTS channel prefix. */
  channel?: VoiceLogChannel;
};

function logPath(): string {
  return path.join(app.getPath("userData"), "logs", "voice.log");
}

function ensureDir(): void {
  const dir = path.dirname(logPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function rotateIfNeeded(): void {
  const p = logPath();
  try {
    if (fs.existsSync(p) && fs.statSync(p).size > MAX_BYTES) {
      const bak = `${p}.1`;
      try {
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
      } catch {
        // ignore
      }
      fs.renameSync(p, bak);
    }
  } catch {
    // ignore
  }
}

/** Append one diagnostic line with an explicit channel prefix. */
export function appendVoiceLog(
  stage: string,
  fields: VoiceDiagFields = {},
): void {
  try {
    ensureDir();
    rotateIfNeeded();
    const ts = new Date().toISOString();
    const { channel, ...rest } = fields;
    const prefix = channel ?? "VOICE_TTS";
    const parts = Object.entries(rest)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
      .join(" ");
    const line = `${ts} ${prefix} stage=${stage}${parts ? ` ${parts}` : ""}\n`;
    fs.appendFileSync(logPath(), line, { encoding: "utf8" });
  } catch {
    // never throw into voice path
  }
}

export function voiceLogFilePath(): string {
  try {
    ensureDir();
    return logPath();
  } catch {
    return "";
  }
}

/** Whether temporary debug WAV dumps are enabled for all synthesize calls. */
export function isTtsDebugDumpEnabled(): boolean {
  const env = process.env.AURUM_TTS_DEBUG?.trim().toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}

export function debugWavPath(): string {
  return path.join(app.getPath("temp"), "aurum-tts-debug.wav");
}
