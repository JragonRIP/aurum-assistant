"use client";

import { useMemo, useState } from "react";
import type { UiConversation } from "@/components/assistant/types";
import { ConversationSidebar } from "@/components/assistant/ConversationSidebar";
import { NativeError } from "@aurum/ui";

export function HistoryDrawer({
  open,
  conversations,
  selectedId,
  loading,
  error,
  onClose,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onRetry,
}: {
  open: boolean;
  conversations: UiConversation[];
  selectedId: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => void;
  onRetry?: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      (c.title || "untitled").toLowerCase().includes(q),
    );
  }, [conversations, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Close history"
        onClick={onClose}
      />
      <div className="aurum-drawer absolute inset-y-0 right-0 flex w-[min(360px,100%)] flex-col border-l border-[var(--aurum-border)] bg-[var(--aurum-surface)] shadow-[var(--aurum-shadow-overlay)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="aurum-kicker">History</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="aurum-focus-ring text-[11px] tracking-[0.12em] uppercase text-[var(--aurum-text-muted)]"
              onClick={onNew}
              disabled={loading}
            >
              New session
            </button>
            <button
              type="button"
              className="aurum-focus-ring text-[11px] tracking-[0.12em] uppercase text-[var(--aurum-text-dim)]"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
        <div className="px-4 pb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history"
            className="w-full rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border)] bg-[var(--aurum-graphite)] px-3 py-2 text-[13px] text-[var(--aurum-text)] outline-none placeholder:text-[var(--aurum-text-dim)] focus:shadow-[var(--aurum-illuminate)]"
          />
        </div>
        {error ? (
          <div className="px-4">
            <NativeError
              title="History unavailable"
              onRetry={onRetry}
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <ConversationSidebar
            conversations={filtered}
            selectedId={selectedId}
            loading={loading}
            hideChrome
            onSelect={onSelect}
            onNew={onNew}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}
