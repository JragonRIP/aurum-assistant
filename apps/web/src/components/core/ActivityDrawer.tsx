"use client";

import { ActivityPanel } from "./ActivityPanel";
import type { SessionActivity } from "./useAurumSession";

export function ActivityDrawer({
  open,
  items,
  onClose,
  onOpenSessions,
}: {
  open: boolean;
  items: SessionActivity[];
  onClose: () => void;
  onOpenSessions?: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Close activity"
        onClick={onClose}
      />
      <div className="aurum-drawer absolute inset-y-0 right-0 flex w-[min(320px,100%)] flex-col border-l border-[var(--aurum-border)] bg-[var(--aurum-surface)] px-5 py-4 shadow-[var(--aurum-shadow-overlay)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="aurum-kicker">Activity</div>
          <button
            type="button"
            className="aurum-focus-ring text-[11px] tracking-[0.12em] uppercase text-[var(--aurum-text-dim)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <ActivityPanel items={items} />
        <button
          type="button"
          className="aurum-focus-ring mt-6 text-[13px] text-[var(--aurum-text-muted)]"
          onClick={() => {
            onClose();
            onOpenSessions?.();
          }}
        >
          Sessions
        </button>
      </div>
    </div>
  );
}
