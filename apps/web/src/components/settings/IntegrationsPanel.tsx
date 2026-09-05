"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StatusBadge } from "@aurum/ui";

type IntegrationStatus = {
  provider: string;
  name: string;
  status: string;
  accountLabel: string | null;
  connectedAt: string | null;
  lastError: string | null;
  configured: boolean;
  scopes?: string[];
  requiredScopes?: string[];
  missingScopes?: string[];
  needsScopeUpgrade?: boolean;
};

export function IntegrationsPanel() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) throw new Error("Could not load integrations");
      const data = (await res.json()) as { integrations: IntegrationStatus[] };
      setItems(data.integrations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const spotify = searchParams.get("spotify");
    if (spotify === "connected") {
      setBanner("Spotify connected.");
      void load();
    } else if (spotify === "error") {
      setBanner("Spotify connection failed. Try again.");
    }
  }, [searchParams, load]);

  async function connectSpotify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/spotify/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.authorizeUrl) {
        throw new Error(data.error ?? "Could not start Spotify connect");
      }
      window.location.href = data.authorizeUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
      setBusy(false);
    }
  }

  async function disconnectSpotify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/spotify", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Disconnect failed");
      }
      setBanner("Spotify disconnected.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  const spotify = items.find((i) => i.provider === "spotify");
  const connected = spotify?.status === "connected";
  const reconnect = spotify?.status === "reconnect_required";
  const needsUpgrade = Boolean(spotify?.needsScopeUpgrade) || reconnect;

  return (
    <div className="space-y-3">
      {banner ? (
        <p className="text-[13px] text-[var(--aurum-text-muted)]">{banner}</p>
      ) : null}
      {error ? (
        <p className="text-[13px] text-[var(--aurum-danger,#c45)]">{error}</p>
      ) : null}

      <div className="flex items-center justify-between gap-4 border-b border-[var(--aurum-border)] py-3">
        <div className="min-w-0">
          <div className="text-[15px] text-[var(--aurum-text)]">Spotify</div>
          <p className="mt-0.5 truncate text-[13px] text-[var(--aurum-text-dim)]">
            {loading
              ? "Loading…"
              : connected && spotify?.accountLabel
                ? spotify.accountLabel
                : needsUpgrade
                  ? "Reconnect to grant playlist & library permissions"
                  : spotify?.configured === false
                    ? "Not configured on server"
                    : "Not connected"}
          </p>
          {spotify?.scopes && spotify.scopes.length > 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--aurum-text-dim)]">
              Scopes granted: {spotify.scopes.join(", ")}
            </p>
          ) : null}
          {spotify?.missingScopes && spotify.missingScopes.length > 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--aurum-text-muted)]">
              Missing: {spotify.missingScopes.join(", ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusBadge
            label={
              connected
                ? "Connected"
                : needsUpgrade
                  ? "Upgrade permissions"
                  : spotify?.configured === false
                    ? "Unavailable"
                    : "Not connected"
            }
            tone={
              connected ? "success" : needsUpgrade ? "warning" : "neutral"
            }
          />
          {connected || needsUpgrade ? (
            <>
              {needsUpgrade ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void connectSpotify()}
                  className="aurum-focus-ring text-[13px] text-[var(--aurum-gold,#c9a227)] disabled:opacity-50"
                >
                  Reconnect
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void disconnectSpotify()}
                className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)] hover:text-[var(--aurum-text)] disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy || spotify?.configured === false}
              onClick={() => void connectSpotify()}
              className="aurum-focus-ring text-[13px] text-[var(--aurum-gold,#c9a227)] hover:opacity-90 disabled:opacity-50"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      <p className="text-[13px] text-[var(--aurum-text-dim)]">
        Google Calendar and Gmail are not connected.
      </p>
    </div>
  );
}
