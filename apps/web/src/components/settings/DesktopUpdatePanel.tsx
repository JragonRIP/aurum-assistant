"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@aurum/ui";

type UpdaterState = {
  status: string;
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  enabled: boolean;
};

function statusTone(
  status: string,
): "success" | "warning" | "neutral" | "danger" {
  if (status === "up_to_date") return "success";
  if (status === "downloaded" || status === "update_available") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

function statusLabel(state: UpdaterState): string {
  switch (state.status) {
    case "checking":
      return "Checking";
    case "update_available":
      return "Update available";
    case "up_to_date":
      return "Up to date";
    case "downloading":
      return state.progressPercent != null
        ? `Downloading ${Math.round(state.progressPercent)}%`
        : "Downloading";
    case "downloaded":
      return "Ready to install";
    case "installing":
      return "Installing";
    case "error":
      return "Error";
    case "disabled":
      return "Desktop only";
    default:
      return "Idle";
  }
}

/**
 * Compact desktop update controls — visible only inside the Electron shell.
 * Browser sessions hide this section.
 */
export function DesktopUpdatePanel() {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<UpdaterState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.aurumDesktop;
    if (!api?.getUpdaterState) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    try {
      const next = await api.getUpdaterState();
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read updater");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const api = window.aurumDesktop;
    if (!api?.onUpdaterState) return;
    return api.onUpdaterState((next) => {
      setState(next);
      setAvailable(true);
    });
  }, [refresh]);

  if (!available || !state) {
    return null;
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const next = await window.aurumDesktop?.checkForUpdates?.();
      if (next) setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.aurumDesktop?.installUpdate?.();
      if (result && !result.ok) {
        setError(result.error ?? "Install failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--aurum-border)] py-3">
        <div className="min-w-0">
          <div className="text-[15px] text-[var(--aurum-text)]">
            Desktop update
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--aurum-text-dim)]">
            Installed {state.currentVersion}
            {state.latestVersion ? ` · Latest ${state.latestVersion}` : ""}
          </p>
          {state.errorMessage ? (
            <p className="mt-1 text-[12px] text-[var(--aurum-text-muted)]">
              {state.errorMessage}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusBadge
            label={statusLabel(state)}
            tone={statusTone(state.status)}
          />
          {state.status === "downloaded" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void install()}
              className="aurum-focus-ring text-[13px] text-[var(--aurum-gold,#c9a227)] disabled:opacity-50"
            >
              Restart & Update
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !state.enabled}
              onClick={() => void check()}
              className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)] hover:text-[var(--aurum-text)] disabled:opacity-50"
            >
              Check for Updates
            </button>
          )}
        </div>
      </div>
      {error ? (
        <p className="text-[13px] text-[var(--aurum-danger,#c45)]">{error}</p>
      ) : null}
    </div>
  );
}
