import { z } from "zod";
import {
  MemoryImportanceSchema,
  MemoryTypeSchema,
} from "@aurum/shared";
import type { AurumTool, ToolExecutionContext, ToolResult } from "./types";
import type { ToolRegistry } from "./registry";

const searchSchema = z.object({
  query: z.string().min(1).max(200).optional(),
  type: MemoryTypeSchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const getSchema = z.object({
  id: z.string().uuid().optional(),
  canonicalKey: z.string().min(1).max(160).optional(),
});

const rememberSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(4000),
  type: MemoryTypeSchema.default("FACT"),
  importance: MemoryImportanceSchema.default("USEFUL"),
  canonicalKey: z.string().min(1).max(160).optional(),
});

const updateSchema = z.object({
  id: z.string().uuid().optional(),
  canonicalKey: z.string().min(1).max(160).optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(4000).optional(),
  type: MemoryTypeSchema.optional(),
  importance: MemoryImportanceSchema.optional(),
});

const forgetSchema = z.object({
  id: z.string().uuid().optional(),
  canonicalKey: z.string().min(1).max(160).optional(),
  query: z.string().min(1).max(200).optional(),
});

function memoryTool<T extends z.ZodTypeAny>(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: T;
  permission: "READ" | "SAFE_WRITE";
  activityLabel: string;
  action: string;
}): AurumTool<T> {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    permission: def.permission,
    environment: "CLOUD",
    activityLabel: def.activityLabel,
    async handler(input, ctx): Promise<ToolResult> {
      const run = ctx.runMemoryAction;
      if (!run) {
        return {
          success: false,
          error: {
            code: "UNSUPPORTED",
            message: "Memory is not available on this server.",
          },
          activityLabel: def.activityLabel,
        };
      }
      return run(def.action, input as Record<string, unknown>, ctx);
    },
  };
}

export function createMemorySearchTool() {
  return memoryTool({
    id: "memory_search",
    name: "Search memory",
    description:
      "Search the user's long-term memories. Use for personal preferences, goals, projects, and durable facts — not for web research.",
    inputSchema: searchSchema,
    permission: "READ",
    activityLabel: "Searching memory",
    action: "search",
  });
}

export function createMemoryGetTool() {
  return memoryTool({
    id: "memory_get",
    name: "Get memory",
    description: "Get a single memory by id or canonicalKey.",
    inputSchema: getSchema,
    permission: "READ",
    activityLabel: "Loading memory",
    action: "get",
  });
}

export function createMemoryRememberTool() {
  return memoryTool({
    id: "memory_remember",
    name: "Remember",
    description:
      "Store a durable user fact/preference when the user explicitly asks to remember something. Never store secrets, passwords, API keys, or tokens. Confirm only after success.",
    inputSchema: rememberSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Remembering",
    action: "remember",
  });
}

export function createMemoryUpdateTool() {
  return memoryTool({
    id: "memory_update",
    name: "Update memory",
    description:
      "Update or correct an existing memory (canonical key preferred). Use for preference changes and corrections.",
    inputSchema: updateSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Updating memory",
    action: "update",
  });
}

export function createMemoryForgetTool() {
  return memoryTool({
    id: "memory_forget",
    name: "Forget memory",
    description:
      "Remove a memory from active retrieval when the user asks to forget something.",
    inputSchema: forgetSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Forgetting",
    action: "forget",
  });
}

export function registerMemoryTools(registry: ToolRegistry): void {
  registry.register(createMemorySearchTool());
  registry.register(createMemoryGetTool());
  registry.register(createMemoryRememberTool());
  registry.register(createMemoryUpdateTool());
  registry.register(createMemoryForgetTool());
}
