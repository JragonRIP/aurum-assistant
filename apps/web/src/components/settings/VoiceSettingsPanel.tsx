"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_SPOKEN_MODE,
  type VoiceSettings,
  type VoiceSpokenMode,
} from "@aurum/shared";

export function VoiceSettingsPanel() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>(
    [],
  );

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
    try {
      const res = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Aurum is ready.",
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
      const bytes = Uint8Array.from(atob(json.audioBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: (json.mimeType || "audio/wav").split(";")[0],
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      setMessage("Playing test voice.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Test failed");
    } finally {
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
          Test voice
        </button>
        {message ? (
          <span className="text-[13px] text-[var(--aurum-text-muted)]">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
