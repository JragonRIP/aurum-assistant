"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_SPOKEN_MODE,
  type VoiceSettings,
  type VoiceSpokenMode,
} from "@aurum/shared";

/** Match desktop VoicePlayback L16 → WAV conversion for web Test Voice. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const dataSize = pcm.byteLength - (pcm.byteLength % 2);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm.subarray(0, dataSize));
  return buffer;
}

function toPlayableBlob(audioBase64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const mime = mimeType.toLowerCase();
  if (mime.includes("l16") || mime.includes("pcm")) {
    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const rate = rateMatch ? Number(rateMatch[1]) : 24000;
    return new Blob([pcmToWav(bytes, rate)], { type: "audio/wav" });
  }
  return new Blob([bytes], { type: mimeType.split(";")[0] || "audio/wav" });
}

export function VoiceSettingsPanel() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "synthesizing" | "speaking" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>(
    [],
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/settings");
      if (res.ok) {
        const json = (await res.json()) as { settings: VoiceSettings };
        setSettings(json.settings ?? DEFAULT_VOICE_SETTINGS);
      }
    } catch {
      // table may not exist yet
    }
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(
          list
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || "Microphone",
            })),
        );
      }
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(patch: Partial<VoiceSettings>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/voice/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as { settings?: VoiceSettings; error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save");
      if (json.settings) setSettings(json.settings);
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function testVoice() {
    setBusy(true);
    setMessage(null);
    setPhase("synthesizing");
    try {
      // Prefer desktop IPC when running inside Aurum Console (same synth + VoicePlayback path).
      const desktop = (
        window as unknown as {
          aurumDesktop?: {
            voiceTest?: (opts?: {
              text?: string;
              voice?: string;
            }) => Promise<{
              ok: boolean;
              audioBase64?: string;
              mimeType?: string;
              error?: string;
              httpStatus?: number;
              audioBytes?: number;
              debugWavPath?: string | null;
              voiceLogPath?: string;
              wavInfo?: { ok?: boolean; sampleRate?: number } | null;
              playbackAttempted?: boolean;
              playPromiseResolved?: boolean;
              playErrorName?: string | null;
              playErrorMessage?: string | null;
              speakingEntered?: boolean;
              objectUrlCreated?: boolean;
              events?: string | null;
              webContentsAudioMuted?: boolean | null;
              masterVolume?: number | null;
              masterMuted?: boolean | null;
            }>;
            voicePlayDebugWav?: () => Promise<{
              ok: boolean;
              error?: string;
              playPromiseResolved?: boolean;
              playErrorMessage?: string | null;
              events?: string | null;
              webContentsAudioMuted?: boolean | null;
              audioBytes?: number;
              debugWavPath?: string;
            }>;
            voiceDebugFlags?: (opts?: {
              bypassSpokenMode?: boolean;
            }) => Promise<{ ok: boolean; bypassSpokenMode?: boolean }>;
          };
        }
      ).aurumDesktop;

      if (desktop?.voiceTest) {
        const res = await desktop.voiceTest({
          text: "Aurum voice test.",
          voice: settings.ttsVoice || "Kore",
        });
        const detail = `HTTP ${res.httpStatus ?? "?"} · ${res.audioBytes ?? 0}B · play ${res.playPromiseResolved ? "ok" : "fail"} · URL ${res.objectUrlCreated ? "yes" : "no"} · events ${res.events ?? "none"} · mutedWC ${res.webContentsAudioMuted ?? "?"} · SPEAKING ${res.speakingEntered ? "yes" : "no"}`;
        if (!res.ok) {
          setPhase("error");
          setMessage(
            `${res.playErrorMessage || res.error || "Voice playback unavailable."} ${detail}`,
          );
          setBusy(false);
          return;
        }
        setPhase("speaking");
        setMessage(`Speaking via overlay VoicePlayback… ${detail}`);
        // Overlay owns playback; settle UI after a short SPEAKING flash.
        window.setTimeout(() => {
          setPhase("done");
          setMessage(`Done. ${detail}`);
          setBusy(false);
        }, 2500);
        return;
      }

      const res = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Aurum voice test.",
          voice: settings.ttsVoice,
        }),
      });
      const json = (await res.json()) as {
        audioBase64?: string;
        mimeType?: string;
        error?: string;
      };
      if (!res.ok || !json.audioBase64) {
        throw new Error(json.error || "Voice playback unavailable.");
      }

      setPhase("speaking");
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch {
          // ignore
        }
      }
      const blob = toPlayableBlob(json.audioBase64, json.mimeType || "audio/wav");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 1;
      audio.muted = false;
      audioRef.current = audio;
      await audio.play();
      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setPhase("done");
        setMessage(`Done. Web synth HTTP ${res.status}`);
        setBusy(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setPhase("error");
        setMessage(`Playback error. Web synth HTTP ${res.status}`);
        setBusy(false);
      };
      setMessage(`Speaking… Web synth HTTP ${res.status}`);
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Test failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 py-3">
      <p className="text-[13px] text-[var(--aurum-text-muted)]">
        Push-to-talk: hold Ctrl+Space (~300ms) in Aurum Console. Quick tap still
        opens the text overlay. Spoken replies use Gemini TTS; raw audio is not
        stored.
      </p>

      <label className="flex items-center justify-between gap-4 border-b border-[var(--aurum-border)] py-3 text-[14px]">
        <span className="text-[var(--aurum-text-muted)]">Voice enabled</span>
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(e) => void save({ enabled: e.target.checked })}
        />
      </label>

      <label className="grid gap-1 border-b border-[var(--aurum-border)] py-3 text-[12px] text-[var(--aurum-text-dim)]">
        Spoken responses
        <select
          className="aurum-focus-ring bg-transparent py-1 text-[14px] text-[var(--aurum-text)] outline-none"
          value={settings.spokenMode}
          disabled={busy}
          onChange={(e) =>
            void save({ spokenMode: e.target.value as VoiceSpokenMode })
          }
        >
          {VOICE_SPOKEN_MODE.map((m) => (
            <option key={m} value={m}>
              {m === "always_voice"
                ? "Always for voice requests"
                : m === "short_only"
                  ? "Short responses only"
                  : "Never"}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 border-b border-[var(--aurum-border)] py-3 text-[12px] text-[var(--aurum-text-dim)]">
        Voice
        <select
          className="aurum-focus-ring bg-transparent py-1 text-[14px] text-[var(--aurum-text)] outline-none"
          value={settings.ttsVoice}
          disabled={busy}
          onChange={(e) => void save({ ttsVoice: e.target.value })}
        >
          {["Kore", "Puck", "Charon", "Fenrir", "Aoede"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 border-b border-[var(--aurum-border)] py-3 text-[12px] text-[var(--aurum-text-dim)]">
        Microphone
        <select
          className="aurum-focus-ring bg-transparent py-1 text-[14px] text-[var(--aurum-text)] outline-none"
          value={settings.inputDeviceId ?? ""}
          disabled={busy}
          onChange={(e) =>
            void save({
              inputDeviceId: e.target.value ? e.target.value : null,
            })
          }
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <p className="text-[13px] text-[var(--aurum-text-dim)]">
        Custom speaker/output routing uses the system default in this build
        (setSinkId deferred when unsupported).
      </p>

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void testVoice()}
          className="aurum-focus-ring text-[13px] text-[var(--aurum-text)]"
        >
          {phase === "synthesizing"
            ? "Synthesizing…"
            : phase === "speaking"
              ? "SPEAKING…"
              : "Test voice"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const desktop = (
              window as unknown as {
                aurumDesktop?: {
                  voicePlayDebugWav?: () => Promise<{
                    ok: boolean;
                    error?: string;
                    playPromiseResolved?: boolean;
                    playErrorMessage?: string | null;
                    events?: string | null;
                    webContentsAudioMuted?: boolean | null;
                    audioBytes?: number;
                  }>;
                };
              }
            ).aurumDesktop;
            if (!desktop?.voicePlayDebugWav) {
              setMessage("Play debug WAV is available in Aurum Console only.");
              return;
            }
            setBusy(true);
            setPhase("speaking");
            void desktop.voicePlayDebugWav().then((r) => {
              setBusy(false);
              if (!r.ok) {
                setPhase("error");
                setMessage(
                  r.playErrorMessage ||
                    r.error ||
                    "Debug WAV playback failed.",
                );
                return;
              }
              setPhase("done");
              setMessage(
                `Debug WAV played via VoicePlayback · ${r.audioBytes ?? 0}B · play ${r.playPromiseResolved ? "ok" : "fail"} · events ${r.events ?? "none"} · mutedWC ${r.webContentsAudioMuted ?? "?"}`,
              );
            });
          }}
          className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)]"
        >
          Play debug WAV
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const desktop = (
              window as unknown as {
                aurumDesktop?: {
                  voiceDebugFlags?: (opts?: {
                    bypassSpokenMode?: boolean;
                  }) => Promise<{ ok: boolean; bypassSpokenMode?: boolean }>;
                };
              }
            ).aurumDesktop;
            if (!desktop?.voiceDebugFlags) {
              setMessage("Debug bypass is available in Aurum Console only.");
              return;
            }
            void desktop.voiceDebugFlags({ bypassSpokenMode: true }).then((r) => {
              setMessage(
                r.ok
                  ? "Temporary: PTT TTS will bypass spoken_mode until Console restart (settings unchanged)."
                  : "Could not set debug flag.",
              );
            });
          }}
          className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)]"
        >
          Debug: bypass spoken_mode
        </button>
        {message ? (
          <span className="text-[13px] text-[var(--aurum-text-muted)]">
            {message}
          </span>
        ) : null}
      </div>
      <p className="text-[12px] text-[var(--aurum-text-dim)]">
        Temporary diagnostics: Console writes{" "}
        <code className="text-[var(--aurum-text-muted)]">
          %APPDATA%\aurum\logs\voice.log
        </code>{" "}
        and may save{" "}
        <code className="text-[var(--aurum-text-muted)]">
          %TEMP%\aurum-tts-debug.wav
        </code>
        .
      </p>
    </div>
  );
}
