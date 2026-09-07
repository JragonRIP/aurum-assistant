import { z } from "zod";
import {
  ApprovalStatusSchema,
  DeviceTypeSchema,
  LeadStatusSchema,
  MemoryCategorySchema,
  MessageRoleSchema,
  PermissionLevelSchema,
  TaskPrioritySchema,
  TaskStatusSchema,
} from "@aurum/shared";

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
  assistant_name: z.string().default("Aurum"),
  timezone: z.string().default("America/Chicago"),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const DeviceSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  device_type: DeviceTypeSchema,
  name: z.string(),
  last_seen_at: z.string().nullable(),
  is_online: z.boolean().default(false),
  created_at: z.string(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().nullable(),
  device_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  status: z.enum(["complete", "partial", "error"]).default("complete"),
  metadata: z.record(z.unknown()).default({}),
  tool_name: z.string().nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
  created_at: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const AiGenerationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable(),
  message_id: z.string().uuid().nullable(),
  model: z.string(),
  latency_ms: z.number().int().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  total_tokens: z.number().int().nullable(),
  status: z.enum(["success", "error", "cancelled"]),
  error: z.string().nullable(),
  created_at: z.string(),
});
export type AiGeneration = z.infer<typeof AiGenerationSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  due_date: z.string().nullable(),
  due_time: z.string().nullable(),
  project: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  source: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const MemorySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  content: z.string().min(1),
  category: MemoryCategorySchema,
  importance: z.number().int().min(1).max(10).default(5),
  source: z.string().nullable(),
  is_active: z.boolean().default(true),
  title: z.string().optional(),
  memory_type: z.string().optional(),
  importance_level: z.string().optional(),
  status: z.string().optional(),
  canonical_key: z.string().nullable().optional(),
  confidence: z.number().optional(),
  last_accessed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const NoteSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().nullable(),
  content: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;

export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable(),
  tool_id: z.string(),
  action_label: z.string(),
  parameters: z.record(z.unknown()),
  permission_level: PermissionLevelSchema,
  status: ApprovalStatusSchema,
  result: z.unknown().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const LeadSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1),
  company: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  status: LeadStatusSchema,
  source: z.string().nullable(),
  estimated_value: z.number().nullable(),
  notes: z.string().nullable(),
  next_follow_up: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const ActivityLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  device_id: z.string().uuid().nullable(),
  conversation_id: z.string().uuid().nullable(),
  tool_id: z.string().nullable(),
  permission_level: PermissionLevelSchema.nullable(),
  arguments_safe: z.record(z.unknown()).nullable(),
  result_summary: z.string().nullable(),
  error: z.string().nullable(),
  approval_id: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type ActivityLog = z.infer<typeof ActivityLogSchema>;

export const ToolRunSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable(),
  generation_id: z.string().uuid().nullable(),
  execution_id: z.string(),
  tool_name: z.string(),
  permission_level: PermissionLevelSchema,
  status: z.enum([
    "requested",
    "validating",
    "waiting_for_approval",
    "executing",
    "succeeded",
    "failed",
    "rejected",
    "cancelled",
  ]),
  sanitized_input: z.record(z.unknown()).default({}),
  result_summary: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  approval_id: z.string().uuid().nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  created_at: z.string(),
});
export type ToolRun = z.infer<typeof ToolRunSchema>;
