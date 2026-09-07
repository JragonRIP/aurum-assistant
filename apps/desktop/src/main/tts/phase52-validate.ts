/**
 * Phase 5.2 streaming TTS validation (dev only).
 * AURUM_PHASE52_VALIDATE=1
 */
import fs from "node:fs";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import { appendVoiceLog, voiceLogFilePath } from "../voice-log";
import { getVoiceEngineManager } from "./voice-engine-manager";
import { saveLocalTtsSettings } from "./local-settings";
import type { VoiceBridge } from "../voice-bridge";
import { StreamingTtsController } from "../../overlay/streaming-tts";
import { playAudioViaOverlay } from "./phase51-validate";

export type Phase52Report = {
  startedAt: string;
  finishedAt?: string;
  shortReply?: Record<string, unknown>;
  multiSentence?: Record<string, unknown>;
  bargeIn?: Record<string, unknown>;
  errors: string[];
  voiceLogPath?: string;
};

function reportPath(): string {
  return path.join(app.getPath("userData"), "logs", "phase52-validate.json");
}

export function phase52ReportPath(): string {
  return reportPath();
}

export async function runPhase52Validate(deps: {
  ensureVoiceBridge: () => VoiceBridge;
  getOverlayWindow: () => BrowserWindow | null;
  showOverlay: () => void;
  ensureOverlayAudioReady: () => { audioMuted: boolean | null };
  createOverlayWindow: () => BrowserWindow;
}): Promise<Phase52Report> {
  const report: Phase52Report = {
    startedAt: new Date().toISOString(),
    errors: [],
  };

  try {
    saveLocalTtsSettings({
      speechEngine: "local",
      kokoroVoice: "bm_george",
      speed: 1.0,
      allowGeminiFallback: false,
    });

    const engine = await getVoiceEngineManager().ensureStarted();
    if (engine.status !== "ready") {
      report.errors.push(`engine_not_ready:${engine.status}`);
      report.finishedAt = new Date().toISOString();
      fs.writeFileSync(reportPath(), JSON.stringify(report, null, 2));
      return report;
    }

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
    await new Promise((r) => setTimeout(r, 300));

    const makeCtl = () => {
      // Main process has no HTMLAudioElement — measure synth+queue timing with a stub.
      const stubPlayback = {
        beginTurn(_id: number) {},
        stop() {},
        enqueueBase64(
          _b64: string,
          _mime: string,
          opts: {
            turnId: number;
            chunkIndex: number;
            onEvent?: (
              event: string,
              fields?: Record<string, string | number | boolean | null>,
            ) => void;
            onQueueIdle?: () => void;
          },
        ) {
          opts.onEvent?.("play_resolved", {});
          opts.onEvent?.("playing", {});
          setTimeout(() => {
            opts.onEvent?.("ended", {});
            opts.onQueueIdle?.();
          }, 120);
        },
        isPlaying: () => false,
        queueLength: () => 0,
      };
      return new StreamingTtsController({
        playback: stubPlayback as ConstructorParameters<
          typeof StreamingTtsController
        >[0]["playback"],
        synthesize: async (opts) => {
          const res = await deps.ensureVoiceBridge().synthesize({
            text: opts.text,
            bypassSpokenMode: opts.bypassSpokenMode,
            purpose: opts.purpose,
          });
          return {
            ok: Boolean(res.ok),
            audioBase64: res.audioBase64,
            mimeType: res.mimeType,
            skipped: Boolean(res.skipped),
            error: res.error,
            code: res.code,
            provider: res.provider ?? null,
            audioBytes: res.audioBytes,
            latencyMs: res.latencyMs,
          };
        },
        log: (stage, fields) => {
          appendVoiceLog(stage, {
            channel:
              typeof fields?.channel === "string"
                ? (fields.channel as
                    | "VOICE_PTT"
                    | "VOICE_TTS"
                    | "VOICE_LOCAL"
                    | "VOICE_PLAYBACK")
                : "VOICE_PTT",
            ...fields,
          });
        },
      });
    };

    // --- Short one-sentence reply ---
    {
      const ctl = makeCtl();
      ctl.beginTurn();
      // Simulate streamed tokens for a short answer.
      for (const part of ["It's ", "10:17 ", "AM."]) {
        ctl.onDelta(part);
        await new Promise((r) => setTimeout(r, 40));
      }
      const firstReady = ctl.getMarks().agent_first_sentence_ready;
      // Wait for first audio enqueue / playing mark
      const deadline = Date.now() + 8000;
      while (
        ctl.getMarks().playback_playing == null &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const playingAt = ctl.getMarks().playback_playing;
      ctl.onAgentComplete();
      // Let audio finish a bit
      await new Promise((r) => setTimeout(r, 800));
      const marks = ctl.getMarks();
      report.shortReply = {
        A_first_sentence_to_playing_ms:
          firstReady != null && playingAt != null
            ? playingAt - firstReady
            : null,
        B_agent_complete_to_playing_ms:
          marks.agent_complete != null && playingAt != null
            ? playingAt - marks.agent_complete
            : null,
        C_speech_to_kokoro_ms:
          marks.speech_text_ready != null && marks.kokoro_audio_ready != null
            ? marks.kokoro_audio_ready - marks.speech_text_ready
            : null,
        D_kokoro_to_playing_ms:
          marks.kokoro_audio_ready != null && playingAt != null
            ? playingAt - marks.kokoro_audio_ready
            : null,
        streamed_before_complete:
          playingAt != null &&
          marks.agent_complete != null &&
          playingAt < marks.agent_complete,
        marks,
      };
      ctl.cancel();
    }

    // --- Multi-sentence: speech should start before full text ---
    {
      const ctl = makeCtl();
      ctl.beginTurn();
      ctl.onDelta("You have three things today. ");
      await new Promise((r) => setTimeout(r, 100));
      const midMarks = { ...ctl.getMarks() };
      // Continue streaming more while first may already be synthesizing
      await new Promise((r) => setTimeout(r, 200));
      ctl.onDelta("First, a morning standup. ");
      ctl.onDelta("Then lunch with Alex. ");
      ctl.onDelta("Finally, ship the voice update.");
      ctl.onAgentComplete();
      const deadline = Date.now() + 15000;
      while (
        ctl.getMarks().playback_playing == null &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 1500));
      const marks = ctl.getMarks();
      report.multiSentence = {
        first_sentence_ready_before_complete:
          midMarks.agent_first_sentence_ready != null &&
          (marks.agent_complete == null ||
            midMarks.agent_first_sentence_ready < (marks.agent_complete ?? 0)),
        A_first_sentence_to_playing_ms:
          marks.agent_first_sentence_ready != null &&
          marks.playback_playing != null
            ? marks.playback_playing - marks.agent_first_sentence_ready
            : null,
        streamed_before_complete:
          marks.playback_playing != null &&
          marks.agent_complete != null &&
          marks.playback_playing < marks.agent_complete,
        marks,
      };
      // Barge-in mid speech
      ctl.cancel();
      report.bargeIn = {
        cancel_called: true,
        note: "controller cancel aborts pending synth + invalidates turn",
      };
    }

    // Sanity: overlay can still play a direct clip
    const probe = await deps.ensureVoiceBridge().synthesize({
      text: "Streaming voice systems are online.",
      bypassSpokenMode: true,
      purpose: "phase52_probe",
    });
    if (probe.ok && probe.audioBase64) {
      await playAudioViaOverlay(
        deps.getOverlayWindow,
        probe.audioBase64,
        probe.mimeType || "audio/wav",
      );
    }
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
  appendVoiceLog("phase52_validate_done", {
    channel: "VOICE_TTS",
    errors: report.errors.length,
    report: reportPath(),
  });
  return report;
}
