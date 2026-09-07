/**
 * Desktop-local TTS preferences (speech engine, Kokoro voice, speed).
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_LOCAL_TTS_SETTINGS,
  type LocalTtsSettings,
  type PronunciationPreference,
  type SpeechEngineMode,
} from "./types";

function settingsPath(): string {
  return path.join(app.getPath("userData"), "local-tts-settings.json");
}

function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LOCAL_TTS_SETTINGS.speed;
  return Math.min(1.3, Math.max(0.7, n));
}

function normalizeEngine(raw: unknown): SpeechEngineMode {
  if (raw === "local" || raw === "gemini" || raw === "auto") return raw;
  return DEFAULT_LOCAL_TTS_SETTINGS.speechEngine;
}

function normalizePronunciation(raw: unknown): PronunciationPreference {
  if (
    raw === "natural" ||
    raw === "british" ||
    raw === "americanized_british"
  ) {
    return raw;
  }
  return DEFAULT_LOCAL_TTS_SETTINGS.pronunciation;
}

export function loadLocalTtsSettings(): LocalTtsSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const json = JSON.parse(raw) as Partial<LocalTtsSettings>;
    return {
      speechEngine: normalizeEngine(json.speechEngine),
      kokoroVoice:
        typeof json.kokoroVoice === "string" && json.kokoroVoice.trim()
          ? json.kokoroVoice.trim()
          : DEFAULT_LOCAL_TTS_SETTINGS.kokoroVoice,
      speed: clampSpeed(
        typeof json.speed === "number" ? json.speed : DEFAULT_LOCAL_TTS_SETTINGS.speed,
      ),
      allowGeminiFallback:
        typeof json.allowGeminiFallback === "boolean"
          ? json.allowGeminiFallback
          : DEFAULT_LOCAL_TTS_SETTINGS.allowGeminiFallback,
      pronunciation: normalizePronunciation(json.pronunciation),
    };
  } catch {
    return { ...DEFAULT_LOCAL_TTS_SETTINGS };
  }
}

export function saveLocalTtsSettings(
  patch: Partial<LocalTtsSettings>,
): LocalTtsSettings {
  const current = loadLocalTtsSettings();
  const next: LocalTtsSettings = {
    speechEngine: patch.speechEngine
      ? normalizeEngine(patch.speechEngine)
      : current.speechEngine,
    kokoroVoice:
      typeof patch.kokoroVoice === "string" && patch.kokoroVoice.trim()
        ? patch.kokoroVoice.trim()
        : current.kokoroVoice,
    speed:
      typeof patch.speed === "number" ? clampSpeed(patch.speed) : current.speed,
    allowGeminiFallback:
      typeof patch.allowGeminiFallback === "boolean"
        ? patch.allowGeminiFallback
        : current.allowGeminiFallback,
    pronunciation: patch.pronunciation
      ? normalizePronunciation(patch.pronunciation)
      : current.pronunciation,
  };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}
