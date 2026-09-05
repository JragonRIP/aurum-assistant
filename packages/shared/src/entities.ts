import { z } from "zod";

/**
 * Trusted entity kinds Aurum can navigate to.
 * Navigation hrefs are always built by Aurum — never from model output.
 */
export const EntityTypeSchema = z.enum([
  "task",
  "note",
  "conversation",
  "action",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Canonical task URL — opaque id only */
export function taskHref(taskId: string): string | null {
  if (!isUuid(taskId)) return null;
  return `/tasks/${taskId}`;
}

/** Open note inside Core contextual surface */
export function noteHref(noteId: string): string | null {
  if (!isUuid(noteId)) return null;
  return `/?note=${encodeURIComponent(noteId)}`;
}

/** Restore an Aurum session */
export function conversationHref(conversationId: string): string | null {
  if (!isUuid(conversationId)) return null;
  return `/?c=${encodeURIComponent(conversationId)}`;
}

/**
 * Build a trusted navigation target from entity type + id.
 * Rejects arbitrary URLs — only Aurum-constructed paths.
 */
export function buildEntityHref(
  type: EntityType,
  entityId: string | null | undefined,
): string | null {
  if (!entityId || typeof entityId !== "string") return null;
  switch (type) {
    case "task":
      return taskHref(entityId);
    case "note":
      return noteHref(entityId);
    case "conversation":
      return conversationHref(entityId);
    case "action":
      return null;
    default:
      return null;
  }
}

/**
 * Guard: never trust model-supplied hrefs. Only accept Aurum-built paths.
 */
export function sanitizeEntityHref(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !candidate.startsWith("/")) return null;
  // Absolute URLs / protocol-relative / escapes rejected
  if (/^[a-z]+:/i.test(candidate) || candidate.startsWith("//")) return null;
  if (candidate.includes("://")) return null;

  const taskMatch = candidate.match(/^\/tasks\/([0-9a-f-]{36})$/i);
  if (taskMatch?.[1] && isUuid(taskMatch[1])) return `/tasks/${taskMatch[1]}`;

  try {
    const url = new URL(candidate, "https://aurum.local");
    if (url.pathname === "/" || url.pathname === "/core") {
      const note = url.searchParams.get("note");
      const c = url.searchParams.get("c");
      if (note && isUuid(note)) return noteHref(note);
      if (c && isUuid(c)) return conversationHref(c);
      return "/";
    }
  } catch {
    return null;
  }
  return null;
}

export type ActivityEntityRef = {
  entityType: EntityType;
  entityId: string;
  href: string;
};

/**
 * Derive a clickable activity target from a trusted tool result payload.
 * Never uses Gemini-invented URLs.
 */
export function activityTargetFromToolResult(opts: {
  tool: string;
  data?: unknown;
}): ActivityEntityRef | null {
  const data = opts.data as
    | {
        task?: { id?: string };
        note?: { id?: string };
        tasks?: Array<{ id?: string }>;
        notes?: Array<{ id?: string }>;
      }
    | undefined;
  if (!data) return null;

  const taskId = data.task?.id ?? data.tasks?.[0]?.id;
  if (taskId && isUuid(taskId)) {
    const href = taskHref(taskId);
    if (href) return { entityType: "task", entityId: taskId, href };
  }

  const noteId = data.note?.id ?? data.notes?.[0]?.id;
  if (noteId && isUuid(noteId)) {
    const href = noteHref(noteId);
    if (href) return { entityType: "note", entityId: noteId, href };
  }

  return null;
}

/** Local calendar date YYYY-MM-DD in a timezone (best-effort). */
export function localDateString(now: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Human due label. Date-only dues never invent a clock time.
 */
export function formatDueLabel(opts: {
  dueDate: string | null | undefined;
  dueTime?: string | null | undefined;
  today?: string;
  tomorrow?: string;
}): string | undefined {
  if (!opts.dueDate) return undefined;
  const today = opts.today;
  const tomorrow = opts.tomorrow;
  let dayLabel = opts.dueDate;
  if (today && opts.dueDate === today) dayLabel = "Today";
  else if (tomorrow && opts.dueDate === tomorrow) dayLabel = "Tomorrow";

  if (opts.dueTime) {
    const t = opts.dueTime.slice(0, 5);
    return `${dayLabel} · ${t}`;
  }
  return dayLabel;
}

export type TodayTaskBucket = "overdue" | "today" | "upcoming";

export function classifyTaskForToday(opts: {
  dueDate: string | null;
  status: string;
  today: string;
}): TodayTaskBucket | null {
  const open = ["TODO", "IN_PROGRESS", "WAITING"].includes(opts.status);
  if (!open) return null;
  if (!opts.dueDate) return null;
  if (opts.dueDate < opts.today) return "overdue";
  if (opts.dueDate === opts.today) return "today";
  if (opts.dueDate > opts.today) return "upcoming";
  return null;
}
