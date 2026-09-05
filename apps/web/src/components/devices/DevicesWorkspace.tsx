"use client";

import { useCallback, useEffect, useState } from "react";
import { NativeError } from "@aurum/ui";

type DeviceRow = {
  id: string;
  name: string;
  device_type: string;
  platform: string | null;
  os_version: string | null;
  app_version: string | null;
  status: string;
  last_seen_at: string | null;
  is_default: boolean;
};

type RootRow = {
  id: string;
  label: string;
  canonical_path: string;
};

export function DevicesWorkspace() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpires, setPairingExpires] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roots, setRoots] = useState<RootRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/devices");
      if (!res.ok) throw new Error("Devices couldn't be loaded.");
      const data = (await res.json()) as { devices: DeviceRow[] };
      setDevices(data.devices);
      setError(null);
      if (!selectedId && data.devices[0]) setSelectedId(data.devices[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Devices couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadRoots = useCallback(async (deviceId: string) => {
    const res = await fetch(`/api/devices/${deviceId}/roots`);
    if (!res.ok) return;
    const data = (await res.json()) as { roots: RootRow[] };
    setRoots(data.roots);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId) void loadRoots(selectedId);
  }, [selectedId, loadRoots]);

  async function startPairing() {
    setBusy(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pair" }),
      });
      const data = (await res.json()) as {
        code?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!res.ok || !data.code) throw new Error(data.error ?? "Pairing failed");
      setPairingCode(data.code);
      setPairingExpires(data.expiresAt ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(deviceId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not disconnect device");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeRoot(rootId: string) {
    if (!selectedId) return;
    const res = await fetch(
      `/api/devices/${selectedId}/roots?rootId=${encodeURIComponent(rootId)}`,
      { method: "DELETE" },
    );
    if (res.ok) void loadRoots(selectedId);
  }

  const selected = devices.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      {error ? (
        <NativeError title={error} onRetry={() => void load()} />
      ) : null}

      <section>
        <p className="text-[13px] text-[var(--aurum-text-muted)]">
          Pair the Windows companion so Aurum can run approved desktop actions.
          The model never executes shell commands.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            className="aurum-focus-ring rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-gold)] px-4 py-2 text-[12px] tracking-[0.12em] uppercase text-[var(--aurum-gold)]"
            onClick={() => void startPairing()}
          >
            Connect Windows device
          </button>
          <button
            type="button"
            className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)]"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>

        {pairingCode ? (
          <div className="mt-5 rounded-[var(--aurum-radius-md)] border border-[var(--aurum-border)] p-4">
            <div className="text-[11px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
              Pairing code
            </div>
            <div
              className="mt-2 text-[28px] tracking-[0.2em] text-[var(--aurum-text)]"
              style={{ fontFamily: "var(--aurum-font-display)" }}
            >
              {pairingCode}
            </div>
            <p className="mt-2 text-[12px] text-[var(--aurum-text-muted)]">
              Enter this code in the Aurum desktop overlay (Ctrl+Space).
              {pairingExpires
                ? ` Expires ${new Date(pairingExpires).toLocaleTimeString()}.`
                : null}
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <div className="mb-3 text-[13px] text-[var(--aurum-text-dim)]">Devices</div>
        {loading && devices.length === 0 ? (
          <p className="text-[13px] text-[var(--aurum-text-dim)]">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-[13px] text-[var(--aurum-text-muted)]">
            No Windows devices paired yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="aurum-focus-ring flex w-full items-baseline justify-between gap-3 border-b border-[var(--aurum-border)] py-3 text-left"
                  onClick={() => setSelectedId(d.id)}
                >
                  <span>
                    <span className="text-[14px] text-[var(--aurum-text)]">
                      {d.name}
                    </span>
                    <span className="mt-1 block text-[12px] text-[var(--aurum-text-dim)]">
                      {d.platform ?? d.device_type}
                      {d.app_version ? ` · v${d.app_version}` : ""}
                    </span>
                  </span>
                  <span className="text-[11px] tracking-[0.12em] uppercase text-[var(--aurum-gold)]">
                    {d.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[13px] text-[var(--aurum-text-dim)]">
              Approved folders · {selected.name}
            </div>
            <button
              type="button"
              className="aurum-focus-ring text-[12px] text-[var(--aurum-danger)]"
              onClick={() => void revoke(selected.id)}
            >
              Disconnect
            </button>
          </div>
          <p className="mb-3 text-[12px] text-[var(--aurum-text-muted)]">
            Add folders from the Windows companion tray or overlay using the
            native folder picker. Aurum never receives arbitrary path strings
            from the model.
          </p>
          {roots.length === 0 ? (
            <p className="text-[13px] text-[var(--aurum-text-muted)]">
              No approved folders. On the paired PC, use the companion to add
              Documents or another safe folder.
            </p>
          ) : (
            <ul className="space-y-2">
              {roots.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-b border-[var(--aurum-border)] py-2"
                >
                  <span>
                    <span className="text-[13px] text-[var(--aurum-text)]">
                      {r.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--aurum-text-dim)]">
                      {r.canonical_path}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="aurum-focus-ring text-[12px] text-[var(--aurum-text-muted)]"
                    onClick={() => void removeRoot(r.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
