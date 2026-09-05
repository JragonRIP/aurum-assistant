import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApprovalDataAccess,
  NoteDataAccess,
  TaskDataAccess,
  ToolDataAccess,
  ToolRunDataAccess,
  ToolRunStatus,
  TaskRecord,
  NoteRecord,
} from "@aurum/tools";
import type { PermissionLevel } from "@aurum/shared";

function mapTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    status: String(row.status),
    priority: String(row.priority),
    due_date: row.due_date ? String(row.due_date) : null,
    due_time: row.due_time ? String(row.due_time) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapNote(row: Record<string, unknown>): NoteRecord {
  return {
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    content: String(row.content),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function createSupabaseToolDataAccess(options: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string;
  generationId?: string;
}): ToolDataAccess {
  const { supabase, userId, conversationId, generationId } = options;

  const tasks: TaskDataAccess = {
    async create(input) {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? "NORMAL",
          due_date: input.due_date ?? null,
          due_time: input.due_time ?? null,
          source: input.source ?? "aurum_tool",
          status: "TODO",
        })
        .select(
          "id, title, description, status, priority, due_date, due_time, completed_at, created_at, updated_at",
        )
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create task");
      }
      return mapTask(data as Record<string, unknown>);
    },

    async list(filter) {
      let query = supabase
        .from("tasks")
        .select(
          "id, title, description, status, priority, due_date, due_time, completed_at, created_at, updated_at",
        )
        .eq("user_id", userId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(filter.limit ?? 25);

      if (filter.status) {
        const statuses = Array.isArray(filter.status)
          ? filter.status
          : [filter.status];
        query = query.in("status", statuses);
      }
      if (filter.dueFrom) query = query.gte("due_date", filter.dueFrom);
      if (filter.dueTo) query = query.lte("due_date", filter.dueTo);
      if (filter.priority) query = query.eq("priority", filter.priority);
      if (filter.query) {
        // PostgREST or-filter
        query = query.or(
          `title.ilike.%${escapeIlike(filter.query)}%,description.ilike.%${escapeIlike(filter.query)}%`,
        );
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => mapTask(row as Record<string, unknown>));
    },

    async getById(id) {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, title, description, status, priority, due_date, due_time, completed_at, created_at, updated_at",
        )
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapTask(data as Record<string, unknown>) : null;
    },

    async update(id, patch) {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.title !== undefined) payload.title = patch.title;
      if (patch.description !== undefined) payload.description = patch.description;
      if (patch.status !== undefined) payload.status = patch.status;
      if (patch.priority !== undefined) payload.priority = patch.priority;
      if (patch.due_date !== undefined) payload.due_date = patch.due_date;
      if (patch.due_time !== undefined) payload.due_time = patch.due_time;
      if (patch.completed_at !== undefined) {
        payload.completed_at = patch.completed_at;
      }

      const { data, error } = await supabase
        .from("tasks")
        .update(payload)
        .eq("user_id", userId)
        .eq("id", id)
        .select(
          "id, title, description, status, priority, due_date, due_time, completed_at, created_at, updated_at",
        )
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "Failed to update task");
      }
      return mapTask(data as Record<string, unknown>);
    },
  };

  const notes: NoteDataAccess = {
    async create(input) {
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: userId,
          title: input.title ?? null,
          content: input.content,
        })
        .select("id, title, content, created_at, updated_at")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create note");
      }
      return mapNote(data as Record<string, unknown>);
    },

    async search(input) {
      const q = escapeIlike(input.query);
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, content, created_at, updated_at")
        .eq("user_id", userId)
        .or(`content.ilike.%${q}%,title.ilike.%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(input.limit ?? 10);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => mapNote(row as Record<string, unknown>));
    },

    async getById(id) {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, content, created_at, updated_at")
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapNote(data as Record<string, unknown>) : null;
    },
  };

  const toolRuns: ToolRunDataAccess = {
    async findByExecutionId(executionId) {
      const { data, error } = await supabase
        .from("tool_runs")
        .select(
          "id, execution_id, tool_name, status, sanitized_input, result_summary, error_code, error_message",
        )
        .eq("user_id", userId)
        .eq("execution_id", executionId)
        .maybeSingle();
      if (error) {
        // Table may not exist yet if migration not applied — treat as miss
        if (/tool_runs|schema cache|does not exist/i.test(error.message)) {
          return null;
        }
        throw new Error(error.message);
      }
      if (!data) return null;
      return {
        id: String(data.id),
        execution_id: String(data.execution_id),
        tool_name: String(data.tool_name),
        status: data.status as ToolRunStatus,
        sanitized_input: (data.sanitized_input ?? {}) as Record<string, unknown>,
        result_summary: (data.result_summary as string | null) ?? null,
        error_code: (data.error_code as string | null) ?? null,
        error_message: (data.error_message as string | null) ?? null,
      };
    },

    async start(input) {
      const { data, error } = await supabase
        .from("tool_runs")
        .insert({
          user_id: userId,
          conversation_id: conversationId ?? null,
          generation_id: generationId ?? null,
          execution_id: input.executionId,
          tool_name: input.toolName,
          permission_level: input.permission,
          status: input.status ?? "requested",
          sanitized_input: input.sanitizedInput,
        })
        .select(
          "id, execution_id, tool_name, status, sanitized_input, result_summary, error_code, error_message",
        )
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "Failed to start tool_run");
      }
      return {
        id: String(data.id),
        execution_id: String(data.execution_id),
        tool_name: String(data.tool_name),
        status: data.status as ToolRunStatus,
        sanitized_input: (data.sanitized_input ?? {}) as Record<string, unknown>,
        result_summary: (data.result_summary as string | null) ?? null,
        error_code: (data.error_code as string | null) ?? null,
        error_message: (data.error_message as string | null) ?? null,
      };
    },

    async complete(executionId, patch) {
      const { data, error } = await supabase
        .from("tool_runs")
        .update({
          status: patch.status,
          result_summary: patch.resultSummary ?? null,
          error_code: patch.errorCode ?? null,
          error_message: patch.errorMessage ?? null,
          approval_id: patch.approvalId ?? null,
          duration_ms: patch.durationMs ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("execution_id", executionId)
        .select(
          "id, execution_id, tool_name, status, sanitized_input, result_summary, error_code, error_message",
        )
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        return {
          id: "unknown",
          execution_id: executionId,
          tool_name: "unknown",
          status: patch.status,
          sanitized_input: {},
          result_summary: patch.resultSummary ?? null,
          error_code: patch.errorCode ?? null,
          error_message: patch.errorMessage ?? null,
        };
      }
      return {
        id: String(data.id),
        execution_id: String(data.execution_id),
        tool_name: String(data.tool_name),
        status: data.status as ToolRunStatus,
        sanitized_input: (data.sanitized_input ?? {}) as Record<string, unknown>,
        result_summary: (data.result_summary as string | null) ?? null,
        error_code: (data.error_code as string | null) ?? null,
        error_message: (data.error_message as string | null) ?? null,
      };
    },
  };

  const approvals: ApprovalDataAccess = {
    async createPending(input) {
      const { data, error } = await supabase
        .from("approvals")
        .insert({
          user_id: userId,
          conversation_id: conversationId ?? null,
          generation_id: generationId ?? null,
          execution_id: input.executionId,
          tool_id: input.toolId,
          action_label: input.actionLabel,
          parameters: input.parameters,
          permission_level: input.permissionLevel as PermissionLevel,
          status: "PENDING",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        })
        .select("id, tool_id, status, parameters")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "Failed to create approval");
      }
      return {
        id: String(data.id),
        tool_id: String(data.tool_id),
        status: String(data.status),
        parameters: (data.parameters ?? {}) as Record<string, unknown>,
      };
    },

    async getForUser(id) {
      const { data, error } = await supabase
        .from("approvals")
        .select("id, tool_id, status, parameters")
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: String(data.id),
        tool_id: String(data.tool_id),
        status: String(data.status),
        parameters: (data.parameters ?? {}) as Record<string, unknown>,
      };
    },
  };

  return { tasks, notes, toolRuns, approvals };
}

function escapeIlike(value: string): string {
  return value.replace(/[%_,]/g, " ").trim().slice(0, 120);
}
