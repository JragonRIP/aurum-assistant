import { z } from "zod";
import {
  AssistantStateSchema,
  DeviceTypeSchema,
  PermissionLevelSchema,
} from "./types";

/** Canonical Aurum home — one Core, not a separate Home/Assistant. */
export const CORE_HREF = "/";

export function isCorePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/core" || pathname === "/assistant";
}

export const NavItemIdSchema = z.enum([
  "core",
  "today",
  "tasks",
  "calendar",
  "clients",
  "leads",
  "devices",
  "files",
  "memory",
  "automations",
  "settings",
  "account",
  "business",
  "search",
  "activity",
]);
export type NavItemId = z.infer<typeof NavItemIdSchema>;

export const NavSectionIdSchema = z.enum([
  "core",
  "business",
  "system",
  "bottom",
]);
export type NavSectionId = z.infer<typeof NavSectionIdSchema>;

export const RailItemKindSchema = z.enum(["link", "search", "activity"]);
export type RailItemKind = z.infer<typeof RailItemKindSchema>;

export interface NavItem {
  id: NavItemId;
  label: string;
  href: string;
  group: NavSectionId;
  /** Phase when this screen becomes functional */
  phase: number;
  /** If true, UI must show "not yet connected" rather than fake data */
  connected: boolean;
}

export interface RailItem {
  id: NavItemId;
  label: string;
  kind: RailItemKind;
  href?: string;
}

export interface NavSection {
  id: NavSectionId;
  label: string;
  items: readonly NavItem[];
}

/** Compact system rail — primary destinations only. */
export const PRIMARY_RAIL: readonly RailItem[] = [
  { id: "core", label: "Core", kind: "link", href: CORE_HREF },
  { id: "search", label: "Search", kind: "search" },
  { id: "tasks", label: "Tasks", kind: "link", href: "/tasks" },
  { id: "calendar", label: "Calendar", kind: "link", href: "/calendar" },
  { id: "business", label: "Business", kind: "link", href: "/business" },
  { id: "files", label: "Files", kind: "link", href: "/files" },
] as const;

export const BOTTOM_RAIL: readonly RailItem[] = [
  { id: "activity", label: "Activity", kind: "activity" },
  { id: "settings", label: "Settings", kind: "link", href: "/settings" },
  { id: "account", label: "Account", kind: "link", href: "/account" },
] as const;

export const RAIL_ITEMS: readonly RailItem[] = [
  ...PRIMARY_RAIL,
  ...BOTTOM_RAIL,
] as const;

export const RAIL_EXPANDED_KEY = "aurum.rail.expanded";

export function parseRailExpanded(raw: string | null | undefined): boolean {
  return raw === "1" || raw === "true";
}

export function serializeRailExpanded(expanded: boolean): string {
  return expanded ? "1" : "0";
}

/** Secondary destinations — not permanent rail items. */
export const BUSINESS_ITEMS: readonly NavItem[] = [
  {
    id: "clients",
    label: "Clients",
    href: "/clients",
    group: "business",
    phase: 10,
    connected: false,
  },
  {
    id: "leads",
    label: "Leads",
    href: "/leads",
    group: "business",
    phase: 10,
    connected: false,
  },
];

export const SYSTEM_ITEMS: readonly NavItem[] = [
  {
    id: "devices",
    label: "Devices",
    href: "/devices",
    group: "system",
    phase: 1,
    connected: true,
  },
  {
    id: "memory",
    label: "Memory",
    href: "/memory",
    group: "system",
    phase: 6,
    connected: false,
  },
  {
    id: "automations",
    label: "Automations",
    href: "/automations",
    group: "system",
    phase: 11,
    connected: false,
  },
];

const SETTINGS_ITEM: NavItem = {
  id: "settings",
  label: "Settings",
  href: "/settings",
  group: "bottom",
  phase: 1,
  connected: true,
};

const ACCOUNT_ITEM: NavItem = {
  id: "account",
  label: "Account",
  href: "/account",
  group: "bottom",
  phase: 1,
  connected: true,
};

const CORE_ITEM: NavItem = {
  id: "core",
  label: "Core",
  href: CORE_HREF,
  group: "core",
  phase: 2,
  connected: true,
};

const TASKS_ITEM: NavItem = {
  id: "tasks",
  label: "Tasks",
  href: "/tasks",
  group: "core",
  phase: 3,
  connected: true,
};

const TODAY_ITEM: NavItem = {
  id: "today",
  label: "Today",
  href: "/today",
  group: "core",
  phase: 3,
  connected: true,
};

const CALENDAR_ITEM: NavItem = {
  id: "calendar",
  label: "Calendar",
  href: "/calendar",
  group: "core",
  phase: 9,
  connected: false,
};

const FILES_ITEM: NavItem = {
  id: "files",
  label: "Files",
  href: "/files",
  group: "system",
  phase: 7,
  connected: false,
};

const BUSINESS_HUB: NavItem = {
  id: "business",
  label: "Business",
  href: "/business",
  group: "business",
  phase: 10,
  connected: false,
};

/** All real destinations (deep links). Not the visible rail. */
export const MAIN_NAV: readonly NavItem[] = [
  CORE_ITEM,
  TODAY_ITEM,
  TASKS_ITEM,
  CALENDAR_ITEM,
  BUSINESS_HUB,
  ...BUSINESS_ITEMS,
  FILES_ITEM,
  ...SYSTEM_ITEMS,
  SETTINGS_ITEM,
  ACCOUNT_ITEM,
];

export const BOTTOM_NAV: readonly NavItem[] = [SETTINGS_ITEM, ACCOUNT_ITEM];

/** Contextual groups for Settings / Business — not the primary rail. */
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: "business", label: "Business", items: BUSINESS_ITEMS },
  { id: "system", label: "System", items: SYSTEM_ITEMS },
] as const;

export function railHasDuplicateHomeAndCore(
  items: readonly { id: string; label: string }[],
): boolean {
  const labels = items.map((i) => i.label.toLowerCase());
  return labels.includes("home") && labels.includes("core");
}

export const SessionContextSchema = z.object({
  userId: z.string().uuid().optional(),
  deviceType: DeviceTypeSchema,
  deviceId: z.string().optional(),
  assistantState: AssistantStateSchema.default("IDLE"),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const ToolActivitySchema = z.object({
  toolId: z.string(),
  label: z.string(),
  permission: PermissionLevelSchema,
  status: z.enum(["running", "success", "error", "awaiting_approval"]),
  detail: z.string().optional(),
});
export type ToolActivity = z.infer<typeof ToolActivitySchema>;
