"use client";

import { useCallback, useEffect, useState } from "react";
import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  memory_type: string;
  importance_level: string;
  canonical_key?: string | null;
  updated_at: string;
};

type Settings = {
  enabled: boolean;
  vaultEnabled: boolean;
  vaultStatus: string;
  vaultRootLabel: string | null;
  responseDetailPreference: "concise" | "balanced" | "detailed";
  memoryCount: number;
};

export default function MemoryPage() {
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [memRes, setRes] = await Promise.all([
        fetch(`/api/memory?q=${encodeURIComponent(query)}`),
        fetch("/api/memory/settings"),
      ]);
      if (!memRes.ok || !setRes.ok) {
        throw new Error("Could not load memory.");
      }
      const memJson = (await memRes.json()) as { items: MemoryRow[] };
      const setJson = (await setRes.json()) as Settings;
      setItems(memJson.items ?? []);
      setSettings(setJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function setDetail(value: "concise" | "balanced" | "detailed") {
    setBusy(true);
    try {
      await fetch("/api/memory/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responseDetailPreference: value }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function forget(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/memory/${id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: MemoryRow) {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditContent(item.content);
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/memory/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      if (!res.ok) {
        throw new Error("Could not update memory.");
      }
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceScreen kicker="System" title="Memory">
      <p className="mb-8 max-w-xl text-[15px] text-[var(--aurum-text-muted)]">
        Structured long-term memory for preferences, projects, and durable
        facts. Secrets are never stored. Markdown vault sync is optional and
        uses an approved desktop folder.
      </p>

      {error ? (
        <p className="mb-4 text-[14px] text-[var(--aurum-danger)]">{error}</p>
      ) : null}

      <section className="mb-10 grid gap-4">
        <h2 className="text-[12px] uppercase tracking-[0.14em] text-[var(--aurum-text-dim)]">
          Preferences
        </h2>
        <div className="flex flex-wrap gap-2">
          {(["concise", "balanced", "detailed"] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={busy}
              onClick={() => void setDetail(v)}
              className={`aurum-focus-ring rounded-sm border px-3 py-1.5 text-[13px] ${
                settings?.responseDetailPreference === v
                  ? "border-[var(--aurum-gold)] text-[var(--aurum-text)]"
                  : "border-[var(--aurum-border)] text-[var(--aurum-text-muted)]"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-[var(--aurum-text-dim)]">
          Active memories: {settings?.memoryCount ?? "—"} · Vault:{" "}
          {settings?.vaultStatus ?? "—"}
          {settings?.vaultRootLabel ? ` (${settings.vaultRootLabel})` : ""}
        </p>
        <p className="text-[13px] text-[var(--aurum-text-muted)]">
          Enable the Obsidian-compatible vault by approving a folder on Devices
          and setting it as the Aurum Vault root in settings. Structured memory
          works without the PC online; vault sync queues until the device is
          available.
        </p>
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[12px] text-[var(--aurum-text-dim)]">
            Search
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="aurum-focus-ring min-w-[220px] border-b border-[var(--aurum-border)] bg-transparent py-1 text-[15px] text-[var(--aurum-text)] outline-none"
              placeholder="preferences, projects…"
            />
          </label>
          <button
            type="button"
            className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)]"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-[15px] text-[var(--aurum-text-muted)]">
            No active memories yet. Say “Remember that…” or set a preference
            above.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--aurum-border)]">
            {items.map((item) => (
              <li key={item.id} className="py-4">
                {editingId === item.id ? (
                  <div className="grid gap-3">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="aurum-focus-ring border-b border-[var(--aurum-border)] bg-transparent py-1 text-[16px] text-[var(--aurum-text)] outline-none"
                    />
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      className="aurum-focus-ring border border-[var(--aurum-border)] bg-transparent p-2 text-[14px] text-[var(--aurum-text)] outline-none"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveEdit()}
                        className="aurum-focus-ring text-[13px] text-[var(--aurum-text)]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditingId(null)}
                        className="aurum-focus-ring text-[13px] text-[var(--aurum-text-dim)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--aurum-text-dim)]">
                        {item.memory_type} · {item.importance_level}
                        {item.canonical_key ? ` · ${item.canonical_key}` : ""}
                      </div>
                      <div className="mt-1 text-[16px] text-[var(--aurum-text)]">
                        {item.title}
                      </div>
                      <p className="mt-1 text-[14px] text-[var(--aurum-text-muted)]">
                        {item.content}
                      </p>
                      <p className="mt-1 text-[12px] text-[var(--aurum-text-dim)]">
                        Updated {new Date(item.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startEdit(item)}
                        className="aurum-focus-ring text-[12px] text-[var(--aurum-text-dim)] hover:text-[var(--aurum-text)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void forget(item.id)}
                        className="aurum-focus-ring text-[12px] text-[var(--aurum-text-dim)] hover:text-[var(--aurum-text)]"
                      >
                        Forget
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkspaceScreen>
  );
}
