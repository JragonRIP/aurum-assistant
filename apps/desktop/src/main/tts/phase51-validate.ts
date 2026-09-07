/**
 * Phase 5.1 Console validation (dev only).
 * Trigger with AURUM_PHASE51_VALIDATE=1 — writes report JSON, does not package.
 */
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { appendVoiceLog, voiceLogFilePath } from "../voice-log";
import { getVoiceEngineManager } from "./voice-engine-manager";
import {
  loadLocalTtsSettings,
  saveLocalTtsSettings,
} from "./local-settings";
import type { VoiceBridge } from "../voice-bridge";

export type Phase51Report = {
  startedAt: string;
  finishedAt?: string;
  engine?: Record<string, unknown>;
  testVoice?: Record<string, unknown>;
  voiceTurn?: Record<string, unknown>;
  geminiFallbackOff?: Record<string, unknown>;
  killEngineFallback?: Record<string, unknown>;
  restartEngine?: Record<string, unknown>;
  bargeIn?: Record<string, unknown>;
  errors: string[];
  voiceLogPath?: string;
};

type Deps = {
  getOverlayWindow: () => BrowserWindow | null;
  showOverlay: () => void;
  ensureOverlayAudioReady: () => { audioMuted: boolean | null };
  createOverlayWindow: () => BrowserWindow;
  ensureVoiceBridge: () => VoiceBridge;
  startOverlayChat?: (
    text: string,
    opts?: { inputMode?: "voice" | "text" },
  ) => Promise<{ id: string }>;
  waitOverlayChatDone?: (
    id: string,
    timeoutMs?: number,
  ) => Promise<{
    ok: boolean;
    finalLen: number;
    finalText?: string;
    error?: string;
  }>;
  playViaOverlay: (audioBase64: string, mimeType: string) => Promise<{
    ok: boolean;
    playPromiseResolved?: boolean;
    events?: string | null;
    playErrorMessage?: string | null;
  }>;
};

function reportPath(): string {
  return path.join(app.getPath("userData"), "logs", "phase51-validate.json");
}

export async function runPhase51Validate(deps: Deps): Promise<Phase51Report> {
  const report: Phase51Report = {
    startedAt: new Date().toISOString(),
    errors: [],
  };

  try {
    appendVoiceLog("phase51_validate_start", { channel: "VOICE_TTS" });
    const engineStarted = Date.now();
    const engine = await getVoiceEngineManager().ensureStarted();
    report.engine = {
      ...engine,
      secret: engine.secret ? "[redacted]" : null,
      ensure_started_wait_ms: Date.now() - engineStarted,
    };

    if (engine.status !== "ready") {
      report.errors.push(`engine_not_ready:${engine.status}:${engine.detail}`);
      report.finishedAt = new Date().toISOString();
      fs.writeFileSync(reportPath(), JSON.stringify(report, null, 2));
      return report;
    }

    // Force local primary for validation.
    saveLocalTtsSettings({
      speechEngine: "local",
      kokoroVoice: "bm_george",
      speed: 1.0,
      allowGeminiFallback: false,
    });

    const phrase = "Aurum voice systems are online.";
    const synthStarted = Date.now();
    const synth = await deps.ensureVoiceBridge().synthesize({
      text: phrase,
      bypassSpokenMode: true,
      debugDumpWav: true,
      purpose: "test_voice",
    });
    const synthMs = Date.now() - synthStarted;

    let play: {
      ok: boolean;
      playPromiseResolved?: boolean;
      events?: string | null;
      playErrorMessage?: string | null;
    } = { ok: false };

    if (synth.ok && synth.audioBase64 && !synth.skipped) {
      let overlay = deps.getOverlayWindow();
      if (!overlay || overlay.isDestroyed()) {
        overlay = deps.createOverlayWindow();
      }
      deps.showOverlay();
      deps.ensureOverlayAudioReady();
      if (overlay.webContents.isLoading()) {
        await new Promise<void>((resolve) => {
          overlay?.webContents.once("did-finish-load", () => resolve());
          setTimeout(() => resolve(), 8000);
        });
      }
      await new Promise((r) => setTimeout(r, 250));
      play = await deps.playViaOverlay(
        synth.audioBase64,
        synth.mimeType || "audio/wav",
      );
    }

    report.testVoice = {
      phrase,
      synth_ok: synth.ok,
      provider: synth.provider ?? null,
      cloud_tts_called: synth.provider === "gemini",
      audio_bytes: synth.audioBytes ?? 0,
      latency_ms: synth.latencyMs ?? synthMs,
      play_ok: play.ok,
      play_promise_resolved: play.playPromiseResolved ?? false,
      events: play.events ?? null,
      play_error: play.playErrorMessage ?? null,
      settings: loadLocalTtsSettings(),
    };

    // Simulated voice-origin turn (agent text → Kokoro → VoicePlayback).
    const turnText = "What time is it? Answer in one short sentence.";
    const turnStarted = Date.now();
    let canned =
      "It is about noon. Local voice is online.";
    let agentOk = false;
    let agentError: string | null = null;

    if (deps.startOverlayChat && deps.waitOverlayChatDone) {
      appendVoiceLog("agent_start", {
        channel: "VOICE_PTT",
        prompt_length: turnText.length,
      });
      try {
        const handle = await deps.startOverlayChat(turnText, {
          inputMode: "voice",
        });
        const done = await deps.waitOverlayChatDone(handle.id, 90_000);
        agentOk = done.ok && done.finalLen > 0;
        agentError = done.error ?? null;
        if (done.finalText) canned = done.finalText;
        appendVoiceLog("agent_complete", {
          channel: "VOICE_PTT",
          ok: agentOk,
          final_response_length: canned.length,
        });
      } catch (err) {
        agentError = err instanceof Error ? err.message : String(err);
        appendVoiceLog("agent_complete", {
          channel: "VOICE_PTT",
          ok: false,
          error: agentError.slice(0, 120),
        });
      }
    }

    const finalTextAt = Date.now();
    const turnSynth = await deps.ensureVoiceBridge().synthesize({
      text: canned,
      bypassSpokenMode: true,
      purpose: "ptt_final",
    });
    let turnPlay = {
      ok: false,
      playPromiseResolved: false,
      events: null as string | null,
    };
    if (turnSynth.ok && turnSynth.audioBase64) {
      turnPlay = (await deps.playViaOverlay(
        turnSynth.audioBase64,
        turnSynth.mimeType || "audio/wav",
      )) as typeof turnPlay;
    }
    report.voiceTurn = {
      prompt: turnText,
      agent_ok: agentOk,
      agent_error: agentError,
      reply_length: canned.length,
      provider: turnSynth.provider ?? null,
      cloud_tts_called: turnSynth.provider === "gemini",
      synth_latency_ms: turnSynth.latencyMs ?? null,
      final_text_to_playback_ms: Date.now() - finalTextAt,
      play_ok: turnPlay.ok,
      events: turnPlay.events,
      total_ms: Date.now() - turnStarted,
    };

    // Barge-in: start play, then stop mid-stream.
    if (turnSynth.ok && turnSynth.audioBase64) {
      const overlay = deps.getOverlayWindow();
      overlay?.webContents.send("aurum:voice-test-play", {
        audioBase64: turnSynth.audioBase64,
        mimeType: turnSynth.mimeType || "audio/wav",
        purpose: "barge_in_setup",
      });
      await new Promise((r) => setTimeout(r, 400));
      overlay?.webContents.send("aurum:voice-ptt", { phase: "start" });
      await new Promise((r) => setTimeout(r, 200));
      overlay?.webContents.send("aurum:voice-ptt", { phase: "cancel" });
      report.bargeIn = {
        stop_sent: true,
        note: "PTT start should stop VoicePlayback immediately",
      };
    }

    // Kill engine → local-only should warn, not call Gemini (fallback off).
    const pid = getVoiceEngineManager().getState().pid;
    if (pid) {
      try {
        process.kill(pid);
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 800));
      // Manager marks error on child exit; do not call restart yet.
      const afterKill = await deps.ensureVoiceBridge().synthesize({
        text: "Should fail local only.",
        bypassSpokenMode: true,
        purpose: "failure_local_only",
      });
      report.killEngineFallback = {
        mode: "local_fallback_off",
        ok: afterKill.ok,
        provider: afterKill.provider ?? null,
        code: afterKill.code ?? null,
        cloud_tts_called: afterKill.provider === "gemini",
        expected: "fail_without_gemini",
      };

      // Auto + fallback: should attempt Gemini after local miss.
      saveLocalTtsSettings({
        speechEngine: "auto",
        allowGeminiFallback: true,
        kokoroVoice: "bm_george",
        speed: 1.0,
      });
      const afterKillAuto = await deps.ensureVoiceBridge().synthesize({
        text: "Fallback path check.",
        bypassSpokenMode: true,
        purpose: "failure_auto_fallback",
      });
      report.killEngineFallback = {
        ...report.killEngineFallback,
        auto_fallback_ok: afterKillAuto.ok,
        auto_fallback_provider: afterKillAuto.provider ?? null,
        auto_cloud_tts_called: afterKillAuto.provider === "gemini",
      };

      const restarted = await getVoiceEngineManager().restart();
      report.restartEngine = {
        status: restarted.status,
        port: restarted.port,
        warm_ms: restarted.warmMs,
        spawn_to_ready_ms: restarted.spawnToReadyMs,
      };

      saveLocalTtsSettings({
        speechEngine: "auto",
        allowGeminiFallback: true,
        kokoroVoice: "bm_george",
        speed: 1.0,
      });
    }

    // Restore recommended local settings.
    saveLocalTtsSettings({
      speechEngine: "local",
      kokoroVoice: "bm_george",
      speed: 1.0,
      allowGeminiFallback: true,
    });
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
  }

  report.voiceLogPath = voiceLogFilePath();
  report.finishedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(reportPath()), { recursive: true });
    fs.writeFileSync(reportPath(), JSON.stringify(report, null, 2));
  } catch {
    /* ignore */
  }
  appendVoiceLog("phase51_validate_done", {
    channel: "VOICE_TTS",
    errors: report.errors.length,
    report: reportPath(),
  });
  return report;
}

export function phase51ReportPath(): string {
  return reportPath();
}

/** Shared overlay play waiter used by voice-test and phase51. */
export function playAudioViaOverlay(
  getOverlay: () => BrowserWindow | null,
  audioBase64: string,
  mimeType: string,
): Promise<{
  ok: boolean;
  playPromiseResolved?: boolean;
  playErrorName?: string | null;
  playErrorMessage?: string | null;
  events?: string | null;
  objectUrlCreated?: boolean | null;
}> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener("aurum:voice-test-play-result", onResult);
      resolve({
        ok: false,
        playPromiseResolved: false,
        playErrorMessage: "overlay_play_timeout",
      });
    }, 25_000);

    function onResult(
      _e: Electron.IpcMainEvent,
      payload: {
        ok?: boolean;
        playPromiseResolved?: boolean;
        playErrorName?: string | null;
        playErrorMessage?: string | null;
        events?: string | null;
        objectUrlCreated?: boolean | null;
      },
    ) {
      clearTimeout(timeout);
      ipcMain.removeListener("aurum:voice-test-play-result", onResult);
      resolve({
        ok: Boolean(payload?.ok),
        playPromiseResolved: payload?.playPromiseResolved,
        playErrorName: payload?.playErrorName ?? null,
        playErrorMessage: payload?.playErrorMessage ?? null,
        events: payload?.events ?? null,
        objectUrlCreated: payload?.objectUrlCreated ?? null,
      });
    }

    ipcMain.on("aurum:voice-test-play-result", onResult);
    getOverlay()?.webContents.send("aurum:voice-test-play", {
      audioBase64,
      mimeType,
      purpose: "phase51_validate",
    });
  });
}
