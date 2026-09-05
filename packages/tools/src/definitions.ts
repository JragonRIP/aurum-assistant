import { z } from "zod";
import {
  addDaysToDateString,
  formatDueLabel,
  localDateString,
} from "@aurum/shared";
import type { AurumTool, ToolExecutionContext, ToolResult } from "./types";

export const getCurrentTimeInputSchema = z.object({
  timezone: z
    .string()
    .optional()
    .describe("IANA timezone override; defaults to the user profile timezone"),
});

export function createGetCurrentTimeTool(): AurumTool<
  typeof getCurrentTimeInputSchema
> {
  return {
    id: "get_current_time",
    name: "Get current time",
    description:
      "Get the current date and time in the user's timezone. Use for temporal reasoning.",
    inputSchema: getCurrentTimeInputSchema,
    permission: "READ",
    environment: "CLOUD",
    activityLabel: "Checking time",
    async handler(input, ctx): Promise<ToolResult> {
      const tz = input.timezone?.trim() || ctx.timezone || "America/Chicago";
      const now = ctx.now;
      const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const localTime = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now);
      return {
        success: true,
        data: {
          iso: now.toISOString(),
          localDate,
          localTime,
          timezone: tz,
        },
        message: `${localDate} ${localTime} (${tz})`,
        activityLabel: "Checked time",
      };
    },
  };
}

/** DB status values (Phase 1 schema) */
export const DbTaskStatusSchema = z.enum([
  "TODO",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "CANCELLED",
]);

export const DbTaskPrioritySchema = z.enum([
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);

export const createTaskInputSchema = z.object({
  title: z.string().min(1).max(200).describe("Short task title"),
  description: z.string().max(4000).optional().describe("Optional details"),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Due date as YYYY-MM-DD in the user timezone. Prefer date-only when the user did not specify a clock time.",
    ),
  due_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional()
    .describe(
      "Optional local time HH:MM. Only set when the user explicitly provided a time. Do not invent 09:00 for 'tomorrow'.",
    ),
  priority: DbTaskPrioritySchema.optional().describe("Task priority"),
});

export const getTasksInputSchema = z.object({
  status: z
    .union([DbTaskStatusSchema, z.array(DbTaskStatusSchema)])
    .optional()
    .describe("Filter by status. Default: open tasks (TODO, IN_PROGRESS, WAITING)"),
  due_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive due_date lower bound YYYY-MM-DD"),
  due_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive due_date upper bound YYYY-MM-DD"),
  priority: DbTaskPrioritySchema.optional(),
  query: z
    .string()
    .max(120)
    .optional()
    .describe("Optional title/description search substring"),
  limit: z.number().int().min(1).max(50).optional(),
});

export const updateTaskInputSchema = z.object({
  task_id: z.string().uuid().describe("Exact task id to update"),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: DbTaskStatusSchema.optional(),
  priority: DbTaskPrioritySchema.optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  due_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
});

export const completeTaskInputSchema = z.object({
  task_id: z
    .string()
    .uuid()
    .optional()
    .describe("Exact task id when known"),
  query: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Title search when task_id is unknown, e.g. 'Mike'. If multiple match, do not guess.",
    ),
});

export const createNoteInputSchema = z.object({
  content: z.string().min(1).max(8000).describe("Note body"),
  title: z.string().max(200).optional().describe("Optional short title"),
});

export const searchNotesInputSchema = z.object({
  query: z.string().min(1).max(200).describe("Search text"),
  limit: z.number().int().min(1).max(20).optional(),
});

function formatTaskDue(
  task: {
    due_date: string | null;
    due_time: string | null;
  },
  ctx?: Pick<ToolExecutionContext, "now" | "timezone">,
): string | undefined {
  if (!task.due_date) return undefined;
  if (ctx) {
    const today = localDateString(ctx.now, ctx.timezone);
    const tomorrow = addDaysToDateString(today, 1);
    return formatDueLabel({
      dueDate: task.due_date,
      dueTime: task.due_time,
      today,
      tomorrow,
    });
  }
  if (task.due_time) {
    return `${task.due_date} ${task.due_time.slice(0, 5)}`;
  }
  return task.due_date;
}

export function createCreateTaskTool(): AurumTool<typeof createTaskInputSchema> {
  return {
    id: "create_task",
    name: "Create task",
    description:
      "Create a task for the authenticated user. Use due_date for 'tomorrow' without inventing a clock time unless the user specified one.",
    inputSchema: createTaskInputSchema,
    permission: "SAFE_WRITE",
    environment: "CLOUD",
    activityLabel: "Creating task",
    async handler(input, ctx): Promise<ToolResult> {
      const task = await ctx.data.tasks.create({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: input.priority ?? "NORMAL",
        due_date: input.due_date ?? null,
        due_time: input.due_time ? normalizeTime(input.due_time) : null,
        source: "aurum_tool",
      });
      const pub = publicTask(task, ctx);
      const due = pub.due_label;
      return {
        success: true,
        data: { task: pub },
        message: due
          ? `Task created successfully: ${task.title} (${due}).`
          : `Task created successfully: ${task.title}.`,
        activityLabel: "Task created",
        metadata: { surface: "tasks" },
      };
    },
  };
}

export function createGetTasksTool(): AurumTool<typeof getTasksInputSchema> {
  return {
    id: "get_tasks",
    name: "Get tasks",
    description:
      "List the authenticated user's tasks with optional filters. Prefer this over inventing task data.",
    inputSchema: getTasksInputSchema,
    permission: "READ",
    environment: "CLOUD",
    activityLabel: "Loading tasks",
    async handler(input, ctx): Promise<ToolResult> {
      const status =
        input.status ??
        (["TODO", "IN_PROGRESS", "WAITING"] as const);
      const tasks = await ctx.data.tasks.list({
        status: Array.isArray(status) ? [...status] : status,
        dueFrom: input.due_from ?? null,
        dueTo: input.due_to ?? null,
        priority: input.priority ?? null,
        query: input.query?.trim() || null,
        limit: input.limit ?? 25,
      });
      return {
        success: true,
        data: { tasks: tasks.map((t) => publicTask(t, ctx)), count: tasks.length },
        message:
          tasks.length === 0
            ? "No matching tasks."
            : `Found ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`,
        activityLabel: "Tasks loaded",
        metadata: { surface: "tasks" },
      };
    },
  };
}

export function createUpdateTaskTool(): AurumTool<typeof updateTaskInputSchema> {
  return {
    id: "update_task",
    name: "Update task",
    description:
      "Update allowed fields on a task owned by the authenticated user. Cannot change ownership.",
    inputSchema: updateTaskInputSchema,
    permission: "SAFE_WRITE",
    environment: "CLOUD",
    activityLabel: "Updating task",
    async handler(input, ctx): Promise<ToolResult> {
      const existing = await ctx.data.tasks.getById(input.task_id);
      if (!existing) {
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Task not found." },
        };
      }
      const patch: Parameters<ToolExecutionContext["data"]["tasks"]["update"]>[1] =
        {};
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.description !== undefined) patch.description = input.description;
      if (input.status !== undefined) {
        patch.status = input.status;
        if (input.status === "COMPLETED") {
          patch.completed_at = ctx.now.toISOString();
        }
        if (input.status !== "COMPLETED") {
          patch.completed_at = null;
        }
      }
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.due_date !== undefined) patch.due_date = input.due_date;
      if (input.due_time !== undefined) {
        patch.due_time = input.due_time
          ? normalizeTime(input.due_time)
          : null;
      }
      const task = await ctx.data.tasks.update(input.task_id, patch);
      return {
        success: true,
        data: { task: publicTask(task, ctx) },
        message: `Task updated successfully: ${task.title}.`,
        activityLabel: "Task updated",
        metadata: { surface: "tasks" },
      };
    },
  };
}

export function createCompleteTaskTool(): AurumTool<
  typeof completeTaskInputSchema
> {
  return {
    id: "complete_task",
    name: "Complete task",
    description:
      "Mark a task completed. Prefer task_id when known. If using query and multiple tasks match, return AMBIGUOUS_MATCH — never guess.",
    inputSchema: completeTaskInputSchema,
    permission: "SAFE_WRITE",
    environment: "CLOUD",
    activityLabel: "Completing task",
    async handler(input, ctx): Promise<ToolResult> {
      if (!input.task_id && !input.query?.trim()) {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide task_id or query.",
          },
        };
      }

      let taskId = input.task_id;
      if (!taskId && input.query) {
        const matches = await ctx.data.tasks.list({
          status: ["TODO", "IN_PROGRESS", "WAITING"],
          query: input.query.trim(),
          limit: 10,
        });
        if (matches.length === 0) {
          return {
            success: false,
            error: { code: "NOT_FOUND", message: "No matching open tasks." },
          };
        }
        if (matches.length > 1) {
          return {
            success: false,
            error: {
              code: "AMBIGUOUS_MATCH",
              message:
                "Multiple matching tasks. Ask the user which one to complete.",
            },
            data: {
              matches: matches.map((t) => publicTask(t, ctx)),
            },
            message: "Ambiguous task match — clarification required.",
            metadata: { surface: "tasks" },
          };
        }
        taskId = matches[0]!.id;
      }

      const existing = await ctx.data.tasks.getById(taskId!);
      if (!existing) {
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Task not found." },
        };
      }
      if (existing.status === "COMPLETED") {
        return {
          success: true,
          data: { task: publicTask(existing, ctx) },
          message: "Task was already completed.",
          activityLabel: "Task already complete",
          metadata: { surface: "tasks" },
        };
      }

      const task = await ctx.data.tasks.update(taskId!, {
        status: "COMPLETED",
        completed_at: ctx.now.toISOString(),
      });
      return {
        success: true,
        data: { task: publicTask(task, ctx) },
        message: `Task completed successfully: ${task.title}.`,
        activityLabel: "Task completed",
        metadata: { surface: "tasks" },
      };
    },
  };
}

export function createCreateNoteTool(): AurumTool<typeof createNoteInputSchema> {
  return {
    id: "create_note",
    name: "Create note",
    description: "Persist a note for the authenticated user.",
    inputSchema: createNoteInputSchema,
    permission: "SAFE_WRITE",
    environment: "CLOUD",
    activityLabel: "Saving note",
    async handler(input, ctx): Promise<ToolResult> {
      const note = await ctx.data.notes.create({
        title: input.title?.trim() || null,
        content: input.content.trim(),
      });
      return {
        success: true,
        data: { note: publicNote(note) },
        message: "Note saved successfully.",
        activityLabel: "Note saved",
        metadata: { surface: "search" },
      };
    },
  };
}

export function createSearchNotesTool(): AurumTool<
  typeof searchNotesInputSchema
> {
  return {
    id: "search_notes",
    name: "Search notes",
    description:
      "Search the authenticated user's notes by text. Do not invent note contents.",
    inputSchema: searchNotesInputSchema,
    permission: "READ",
    environment: "CLOUD",
    activityLabel: "Searching notes",
    async handler(input, ctx): Promise<ToolResult> {
      const notes = await ctx.data.notes.search({
        query: input.query.trim(),
        limit: input.limit ?? 10,
      });
      return {
        success: true,
        data: { notes: notes.map(publicNote), count: notes.length },
        message:
          notes.length === 0
            ? "No matching notes."
            : `Found ${notes.length} note${notes.length === 1 ? "" : "s"}.`,
        activityLabel: "Notes found",
        metadata: { surface: "search" },
      };
    },
  };
}

function publicTask(
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    due_time: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  },
  ctx?: Pick<ToolExecutionContext, "now" | "timezone">,
) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    due_time: task.due_time,
    due_label: formatTaskDue(task, ctx) ?? null,
    completed_at: task.completed_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

function publicNote(note: {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
}

function normalizeTime(t: string): string {
  const parts = t.split(":");
  if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
  return t;
}

/** Test-only CONFIRM tool — not registered in production registry */
export function createConfirmEchoTool(): AurumTool<
  z.ZodObject<{ message: z.ZodString }>
> {
  const schema = z.object({ message: z.string().min(1) });
  return {
    id: "confirm_echo",
    name: "Confirm echo",
    description: "Test-only CONFIRM tool",
    inputSchema: schema,
    permission: "CONFIRM",
    environment: "CLOUD",
    enabled: true,
    activityLabel: "Needs approval",
    async handler(input): Promise<ToolResult> {
      return { success: true, data: { echoed: input.message } };
    },
  };
}
