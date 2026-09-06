import type { AssistantState, PresenceState } from "./types";
import type { EntityType } from "./entities";
import { CORE_HREF } from "./navigation";
import { conversationHref, isUuid, noteHref, taskHref } from "./entities";

export const CONTEXTUAL_SURFACE_KINDS = [
  "task",
  "schedule",
  "client",
  "business",
  "file",
  "memory",
  "approval",
  "search",
  "action",
  "response",
] as const;

export type ContextualSurfaceKind = (typeof CONTEXTUAL_SURFACE_KINDS)[number];

/**
 * Lightweight intent routing for contextual surfaces.
 * Does not invent data — only chooses which surface architecture to show.
 */
export function inferContextualSurface(text: string): ContextualSurfaceKind {
  const t = text.trim().toLowerCase();
  if (!t) return "response";

  if (/\b(approv|permission|confirm this|allow this)\b/.test(t)) {
    return "approval";
  }
  if (/\b(search|find|look up|look for)\b/.test(t)) {
    return "search";
  }
  if (
    /\b(schedule|calendar|agenda|what'?s on|whats on|meeting|appointment|next event)\b/.test(
      t,
    )
  ) {
    return "schedule";
  }
  if (
    /\b(what do i have|what have i got|up next|show (my )?today)\b/.test(t)
  ) {
    return "task";
  }
  if (
    /\b(task|to-?do|todos?|remind me|priorit)/.test(t) ||
    /\bcreate a task\b/.test(t)
  ) {
    return "task";
  }
  if (
    /\b(lead|pipeline|revenue|business|how is the business|how'?s the business)\b/.test(
      t,
    )
  ) {
    return "business";
  }
  if (/\b(client|contact|crm)\b/.test(t) || /^show me [a-z][a-z]+$/.test(t)) {
    return "client";
  }
  if (/\b(file|folder|document|pdf|desktop file)\b/.test(t)) {
    return "file";
  }
  if (/\b(memor(y|ies|ize)|remember|forget that)\b/.test(t)) {
    return "memory";
  }
  return "response";
}

export function greetingForNow(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * A real personal name — never an email, handle, or inferred local-part.
 */
export function isProperDisplayName(
  name: string | null | undefined,
): boolean {
  if (!name) return false;
  const t = name.trim();
  if (t.length < 2) return false;
  if (t.includes("@")) return false;
  if (/[0-9_]/.test(t)) return false;
  if (/\./.test(t) && !/\s/.test(t)) return false;
  if (!/\s/.test(t) && /^[a-z]+$/.test(t)) return false;
  if (!/\s/.test(t) && /^[A-Z]+$/.test(t) && t.length > 3) return false;
  return true;
}

export function firstNameFromDisplayName(
  displayName: string | null | undefined,
): string | null {
  if (!isProperDisplayName(displayName)) return null;
  const first = displayName!.trim().split(/\s+/)[0];
  return first || null;
}

export function formatGreeting(opts: {
  now?: Date;
  displayName?: string | null;
}): string {
  const base = greetingForNow(opts.now);
  const first = firstNameFromDisplayName(opts.displayName);
  return first ? `${base}, ${first}.` : `${base}.`;
}

export function countUnavailableServices(status: {
  memory?: string;
  desktop?: string;
  calendar?: string;
}): number {
  let n = 0;
  if ((status.memory ?? "NOT CONFIGURED") !== "READY") n += 1;
  if ((status.desktop ?? "NOT CONNECTED") !== "CONNECTED") n += 1;
  if ((status.calendar ?? "NOT CONNECTED") !== "CONNECTED") n += 1;
  return n;
}

export function coreStatusLine(opts: {
  aiOnline: boolean;
  unavailableCount?: number;
}): string {
  if (!opts.aiOnline) return "Aurum Core is offline.";
  const n = opts.unavailableCount ?? 0;
  if (n > 0) {
    return `Core online · ${n} service${n === 1 ? "" : "s"} unavailable`;
  }
  return "Aurum Core is online.";
}

/** @deprecated Use coreStatusLine — kept so older copy sites compile. */
export function operationalLine(aiOnline: boolean): string {
  return coreStatusLine({ aiOnline });
}

export function derivePresenceState(opts: {
  aiConfigured: boolean;
  streaming?: boolean;
  acting?: boolean;
  listening?: boolean;
  speaking?: boolean;
  awaitingApproval?: boolean;
  /** Clarification / disambiguation — not a failure */
  awaitingUser?: boolean;
  error?: boolean;
}): PresenceState {
  if (!opts.aiConfigured) return "OFFLINE";
  // Waiting for the user outranks error — pending input is normal control flow
  if (opts.awaitingApproval) return "WAITING_FOR_APPROVAL";
  if (opts.awaitingUser) return "WAITING_FOR_USER";
  if (opts.error && !opts.streaming) return "ERROR";
  if (opts.acting) return "ACTING";
  if (opts.listening) return "LISTENING";
  if (opts.speaking) return "SPEAKING";
  if (opts.streaming) return "THINKING";
  return "IDLE";
}

export function presenceFromAssistantState(
  state: AssistantState,
): PresenceState {
  if (state === "USING_TOOL") return "ACTING";
  return state as PresenceState;
}

export function presenceShouldAnimate(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}

export const FOCUS_COMMAND_EVENT = "aurum:focus-command";

export function isAurumCommandHotkey(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
}): boolean {
  return (e.ctrlKey || e.metaKey) && e.key === " ";
}

export function commandEscapeAction(opts: {
  streaming: boolean;
}): "stop" | "cancel" {
  return opts.streaming ? "stop" : "cancel";
}

export const NAVIGATION_DESTINATIONS = [
  "core",
  "tasks",
  "today",
  "calendar",
  "business",
  "files",
  "settings",
  "search",
  "task",
  "note",
  "session",
] as const;

export type NavigationDestination = (typeof NAVIGATION_DESTINATIONS)[number];

/**
 * Trusted internal navigation. Aurum code builds this — never the model.
 */
export type NavigationIntent = {
  destination: NavigationDestination;
  entityType?: EntityType;
  entityId?: string;
};

export function resolveNavigationIntent(
  intent: NavigationIntent,
): string | null {
  switch (intent.destination) {
    case "core":
      return CORE_HREF;
    case "tasks":
      return "/tasks";
    case "today":
      return "/today";
    case "calendar":
      return "/calendar";
    case "business":
      return "/business";
    case "files":
      return "/files";
    case "settings":
      return "/settings";
    case "search":
      return CORE_HREF;
    case "task":
      return intent.entityId ? taskHref(intent.entityId) : "/tasks";
    case "note":
      return intent.entityId ? noteHref(intent.entityId) : null;
    case "session":
      return intent.entityId ? conversationHref(intent.entityId) : null;
    default:
      return null;
  }
}

/**
 * Resolve navigation from Aurum-owned structured intent only.
 * Model-supplied URLs / hrefs are rejected.
 */
export function resolveTrustedNavigation(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if ("url" in rec || "href" in rec) return null;
  const destination = rec.destination;
  if (
    typeof destination !== "string" ||
    !(NAVIGATION_DESTINATIONS as readonly string[]).includes(destination)
  ) {
    return null;
  }
  const entityId =
    typeof rec.entityId === "string" && isUuid(rec.entityId)
      ? rec.entityId
      : undefined;
  const entityType =
    rec.entityType === "task" ||
    rec.entityType === "note" ||
    rec.entityType === "conversation"
      ? rec.entityType
      : undefined;
  return resolveNavigationIntent({
    destination: destination as NavigationDestination,
    entityType,
    entityId,
  });
}
