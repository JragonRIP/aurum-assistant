"use client";

import { ActionStatus, type ActionStatusState } from "@aurum/ui";
import type { SessionActivity } from "./useAurumSession";

export function ActivityPanel({
  items,
  compact,
}: {
  items: SessionActivity[];
  compact?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[12px] text-[var(--aurum-text-dim)]">
        No activity this session.
      </p>
    );
  }

  const shown = compact ? items.slice(0, 4) : items;

  return (
    <div className="flex flex-col">
      {shown.map((item) => (
        <ActionStatus
          key={item.id}
          label={item.label}
          detail={item.detail}
          state={item.state as ActionStatusState}
          href={item.href}
        />
      ))}
    </div>
  );
}
