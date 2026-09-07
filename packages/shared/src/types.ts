import { z } from "zod";

/** Device types that can initiate an Aurum session */
export const DeviceTypeSchema = z.enum([
  "WINDOWS_DESKTOP",
  "WEB",
  "IPHONE_PWA",
  "ANDROID_PWA",
  "UNKNOWN",
]);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;

/** Assistant runtime states shown in UI */
export const AssistantStateSchema = z.enum([
  "IDLE",
  "LISTENING",
  "THINKING",
  "ACTING",
  "USING_TOOL",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_USER",
  "SPEAKING",
  "ERROR",
  "OFFLINE",
]);
export type AssistantState = z.infer<typeof AssistantStateSchema>;

/** Visual presence states for Aurum Core (and future overlay) */
export const PresenceStateSchema = z.enum([
  "IDLE",
  "LISTENING",
  "THINKING",
  "ACTING",
  "SPEAKING",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_USER",
  "ERROR",
  "OFFLINE",
]);
export type PresenceState = z.infer<typeof PresenceStateSchema>;

/** Tool permission levels */
export const PermissionLevelSchema = z.enum([
  "READ",
  "SAFE_WRITE",
  "CONFIRM",
  "RESTRICTED",
]);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

/** Where a tool may execute */
export const ExecutionEnvironmentSchema = z.enum([
  "CLOUD",
  "DESKTOP",
  "EITHER",
]);
export type ExecutionEnvironment = z.infer<typeof ExecutionEnvironmentSchema>;

/** Approval request lifecycle */
export const ApprovalStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/** Task statuses */
export const TaskStatusSchema = z.enum([
  "TODO",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "CANCELLED",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Task priorities */
export const TaskPrioritySchema = z.enum([
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

/** Memory categories (legacy Phase 1 — still stored for compatibility) */
export const MemoryCategorySchema = z.enum([
  "PERSONAL_PREFERENCE",
  "BUSINESS",
  "PERSON",
  "PROJECT",
  "WORKFLOW",
  "GENERAL",
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

/** Memory System v1 types */
export const MemoryTypeSchema = z.enum([
  "PROFILE",
  "PREFERENCE",
  "PERSON",
  "BUSINESS",
  "PROJECT",
  "GOAL",
  "DECISION",
  "ROUTINE",
  "FACT",
  "RELATIONSHIP",
  "LOCATION",
  "ASSET",
  "INTEREST",
  "CONSTRAINT",
  "REFERENCE",
  "TEMPORARY",
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryImportanceSchema = z.enum([
  "TEMPORARY",
  "USEFUL",
  "IMPORTANT",
  "PINNED",
]);
export type MemoryImportance = z.infer<typeof MemoryImportanceSchema>;

export const MemoryStatusSchema = z.enum([
  "ACTIVE",
  "SUPERSEDED",
  "ARCHIVED",
  "DELETED",
]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemorySourceTypeSchema = z.enum([
  "USER_EXPLICIT",
  "USER_CORRECTION",
  "INFERRED_FROM_CONVERSATION",
  "SYSTEM_MIGRATED",
  "MANUAL_EDIT",
]);
export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>;

export const RESPONSE_DETAIL_CANONICAL_KEY = "preference:response_detail";

/** Lead pipeline statuses */
export const LeadStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "DEMO",
  "PROPOSAL",
  "WON",
  "LOST",
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

/** Message roles in a conversation */
export const MessageRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** Default desktop global hotkey (Electron accelerator format) */
export const DEFAULT_DESKTOP_HOTKEY = "CommandOrControl+Space";

/** Product metadata */
export const PRODUCT = {
  name: "Aurum",
  description: "AI Executive Assistant / Personal Operating System",
  version: "0.1.0",
} as const;
