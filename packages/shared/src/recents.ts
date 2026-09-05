import type { EntityType } from "./entities";

export type RecentSourceItem = {
  entityType?: EntityType;
  entityId?: string;
  href?: string;
  detail?: string;
  label?: string;
  state: string;
  createdAt: string;
  kindLabel?: string;
  meta?: string;
};

export type RecentObject = {
  entityType: EntityType;
  entityId: string;
  href: string;
  title: string;
  kindLabel: string;
  meta?: string;
  createdAt: string;
};

export function entityKindLabel(type: EntityType): string {
  switch (type) {
    case "task":
      return "Task";
    case "note":
      return "Note";
    case "conversation":
      return "Session";
    default:
      return "Item";
  }
}

/**
 * Presentation-level aggregation. Does not mutate audit/activity records.
 * Newest-first source; first occurrence of each entity wins.
 */
export function dedupeRecents(
  items: readonly RecentSourceItem[],
  limit = 5,
): RecentObject[] {
  const seen = new Set<string>();
  const out: RecentObject[] = [];

  for (const item of items) {
    if (item.state !== "success") continue;
    if (!item.entityType || !item.entityId || !item.href) continue;
    const key = `${item.entityType}:${item.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      entityType: item.entityType,
      entityId: item.entityId,
      href: item.href,
      title: (item.detail || item.label || "Item").trim() || "Item",
      kindLabel: item.kindLabel || entityKindLabel(item.entityType),
      meta: item.meta,
      createdAt: item.createdAt,
    });
    if (out.length >= limit) break;
  }

  return out;
}

export function relativeTimeLabel(
  iso: string,
  now = Date.now(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const m = Math.round(diff / 60_000);
  if (m < 1) return "Now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
