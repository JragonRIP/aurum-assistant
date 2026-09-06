import type { PermissionLevel } from "@aurum/shared";
import { evaluatePermission } from "./permission";
import type { ToolRegistry } from "./registry";
import type {
  ToolExecutionContext,
  ToolResult,
  ToolRunStatus,
} from "./types";

export function isClarificationErrorCode(code: string | undefined): boolean {
  return (
    code === "AMBIGUOUS_TRACK" ||
    code === "AMBIGUOUS_PLAYLIST" ||
    code === "AMBIGUOUS_MATCH"
  );
}

/** Soft failures that must not flash ERROR / invent hard failure copy. */
export function isSoftToolErrorCode(code: string | undefined): boolean {
  return (
    isClarificationErrorCode(code) ||
    code === "PLAYBACK_CHANGE_NOT_CONFIRMED" ||
    code === "RATE_LIMITED"
  );
}

export type ToolExecutorEvent =
  | {
      type: "tool_requested";
      tool: string;
      executionId: string;
      permission: PermissionLevel;
      display?: { label: string };
    }
  | {
      type: "tool_started";
      tool: string;
      executionId: string;
      display?: { label: string };
    }
  | {
      type: "tool_succeeded";
      tool: string;
      executionId: string;
      data?: unknown;
      display?: { label: string; detail?: string };
    }
  | {
      type: "tool_failed";
      tool: string;
      executionId: string;
      error: { code: string; message: string };
      display?: { label: string; detail?: string };
    }
  | {
      /** Soft clarification — not a hard failure for UI (AMBIGUOUS_*). */
      type: "clarification_needed";
      tool: string;
      executionId: string;
      error: { code: string; message: string };
      data?: unknown;
      display?: { label: string; detail?: string };
    }
  | {
      type: "approval_required";
      tool: string;
      executionId: string;
      approvalId: string;
      display?: { label: string };
    };

export type ToolExecutorHooks = {
  onEvent?: (event: ToolExecutorEvent) => void;
};

function sanitizeArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // Never persist credential-like keys
    if (/password|token|secret|apikey|authorization/i.test(k)) continue;
    if (k === "userId" || k === "user_id") continue;
    out[k] = v;
  }
  return out;
}

/** Human caption before/during tool run — never raw function ids. */
export function resolveToolActivityLabel(
  toolName: string,
  fallback: string,
  rawArgs?: unknown,
): string {
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  if (
    toolName === "open_application" &&
    typeof args.app === "string" &&
    args.app.trim()
  ) {
    return `Opening ${args.app.trim()}`;
  }
  if (toolName === "open_url") return "Opening URL";
  if (toolName === "spotify_search_track") {
    const q = typeof args.query === "string" ? args.query.trim() : "";
    return q ? `Finding ${q}` : "Searching Spotify";
  }
  if (toolName === "spotify_play_track") return "Playing track";
  if (toolName === "spotify_pause") return "Pausing Spotify";
  if (toolName === "spotify_resume") return "Resuming Spotify";
  if (toolName === "spotify_next") return "Skipping track";
  if (toolName === "spotify_previous") return "Previous track";
  if (toolName === "spotify_set_volume") {
    const p = typeof args.percent === "number" ? args.percent : null;
    return p != null ? `Setting Spotify volume · ${p}%` : "Setting Spotify volume";
  }
  if (toolName === "spotify_get_playback_state") return "Checking playback";
  if (toolName === "get_connected_devices") return "Listing devices";
  if (toolName === "set_system_volume") {
    const p = typeof args.percent === "number" ? args.percent : null;
    return p != null ? `Setting volume · ${p}%` : "Setting volume";
  }
  if (toolName === "mute_system_audio") return "Muting audio";
  if (toolName === "unmute_system_audio") return "Unmuting audio";
  if (toolName === "set_audio_output_device") return "Switching audio";
  if (toolName === "spotify_create_playlist") {
    const n = typeof args.name === "string" ? args.name.trim() : "";
    return n ? `Creating playlist · ${n}` : "Creating playlist";
  }
  if (toolName === "spotify_add_playlist_items") {
    const refs = Array.isArray(args.trackReferences) ? args.trackReferences : [];
    return refs.length ? `Adding ${refs.length} tracks` : "Adding playlist tracks";
  }
  if (toolName === "spotify_play_playlist" || toolName === "spotify_play_album") {
    return toolName === "spotify_play_playlist" ? "Playing playlist" : "Playing album";
  }
  if (toolName === "spotify_set_shuffle") return "Setting shuffle";
  if (toolName === "lock_pc") return "Locking PC";
  if (toolName === "sleep_pc") return "Sleeping PC";
  if (toolName === "shutdown_pc") return "Shutting down PC";
  if (toolName === "restart_pc") return "Restarting PC";
  return fallback;
}

/**
 * Executes a single tool call with validation, permission, idempotency,
 * and audit logging. Model cannot inject userId or change permission.
 */
export async function executeToolCall(options: {
  registry: ToolRegistry;
  toolName: string;
  rawArgs: unknown;
  executionId: string;
  ctx: ToolExecutionContext;
  hooks?: ToolExecutorHooks;
}): Promise<ToolResult> {
  const { registry, toolName, rawArgs, executionId, ctx, hooks } = options;
  const started = Date.now();
  const emit = (event: ToolExecutorEvent) => hooks?.onEvent?.(event);

  const tool = registry.get(toolName);
  if (!tool) {
    return {
      success: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: `Unknown tool: ${toolName}`,
      },
    };
  }

  if (tool.enabled === false) {
    return {
      success: false,
      error: {
        code: "DISABLED_TOOL",
        message: `Tool is disabled: ${toolName}`,
      },
    };
  }

  const liveLabel = resolveToolActivityLabel(
    toolName,
    tool.activityLabel,
    rawArgs,
  );

  emit({
    type: "tool_requested",
    tool: toolName,
    executionId,
    permission: tool.permission,
    display: { label: liveLabel },
  });

  // Idempotent replay of a completed write
  const existing = await ctx.data.toolRuns.findByExecutionId(executionId);
  if (existing?.status === "succeeded") {
    ctx.log?.({
      event: "idempotent_replay",
      tool: toolName,
      executionId,
    });
    return {
      success: true,
      message: existing.result_summary ?? "Already completed (idempotent replay).",
      metadata: { replay: true, toolRunId: existing.id },
      activityLabel: tool.activityLabel,
    };
  }

  const decision = evaluatePermission(tool.permission);
  if (!decision.allowed) {
    await safeStartRun(ctx, {
      executionId,
      toolName,
      permission: tool.permission,
      sanitizedInput: sanitizeArgs(rawArgs),
      status: "failed",
    });
    await ctx.data.toolRuns.complete(executionId, {
      status: "failed",
      errorCode: "PERMISSION_DENIED",
      errorMessage: decision.reason,
      durationMs: Date.now() - started,
    });
    const result: ToolResult = {
      success: false,
      error: { code: "PERMISSION_DENIED", message: decision.reason },
      activityLabel: tool.activityLabel,
    };
    emit({
      type: "tool_failed",
      tool: toolName,
      executionId,
      error: result.error!,
      display: { label: tool.activityLabel, detail: decision.reason },
    });
    return result;
  }

  if (ctx.signal?.aborted) {
    return {
      success: false,
      error: { code: "CANCELLED", message: "Cancelled before execution." },
    };
  }

  if (decision.mode === "confirm" && !ctx.skipConfirmation) {
    const approval = await ctx.data.approvals.createPending({
      toolId: tool.id,
      actionLabel: tool.activityLabel,
      parameters: sanitizeArgs(rawArgs),
      permissionLevel: tool.permission,
      executionId,
    });
    await safeStartRun(ctx, {
      executionId,
      toolName,
      permission: tool.permission,
      sanitizedInput: sanitizeArgs(rawArgs),
      status: "waiting_for_approval",
    });
    await ctx.data.toolRuns.complete(executionId, {
      status: "waiting_for_approval",
      approvalId: approval.id,
      resultSummary: "Waiting for authenticated user approval",
      durationMs: Date.now() - started,
    });
    emit({
      type: "approval_required",
      tool: toolName,
      executionId,
      approvalId: approval.id,
      display: { label: `Approval required: ${tool.name}` },
    });
    return {
      success: false,
      requiresApproval: true,
      approvalId: approval.id,
      activityLabel: `Approval required: ${tool.name}`,
      error: {
        code: "APPROVAL_REQUIRED",
        message:
          "This action requires authenticated user approval before it can run. The model cannot approve it.",
      },
    };
  }

  const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    await safeStartRun(ctx, {
      executionId,
      toolName,
      permission: tool.permission,
      sanitizedInput: sanitizeArgs(rawArgs),
      status: "validating",
    });
    await ctx.data.toolRuns.complete(executionId, {
      status: "failed",
      errorCode: "VALIDATION_ERROR",
      errorMessage: message,
      durationMs: Date.now() - started,
    });
    const result: ToolResult = {
      success: false,
      error: { code: "VALIDATION_ERROR", message },
      activityLabel: tool.activityLabel,
    };
    emit({
      type: "tool_failed",
      tool: toolName,
      executionId,
      error: result.error!,
      display: { label: tool.activityLabel, detail: message },
    });
    return result;
  }

  // Strip any injected ownership fields even if schema somehow allowed them
  const input = { ...(parsed.data as Record<string, unknown>) };
  delete input.userId;
  delete input.user_id;

  await safeStartRun(ctx, {
    executionId,
    toolName,
    permission: tool.permission,
    sanitizedInput: sanitizeArgs(input),
    status: "executing",
  });

  emit({
    type: "tool_started",
    tool: toolName,
    executionId,
    display: { label: liveLabel },
  });

  ctx.log?.({
    event: "tool_executing",
    tool: toolName,
    permission: tool.permission,
    executionId,
    generation: ctx.generationId,
  });

  try {
    if (ctx.signal?.aborted) {
      await ctx.data.toolRuns.complete(executionId, {
        status: "cancelled",
        errorCode: "CANCELLED",
        errorMessage: "Cancelled",
        durationMs: Date.now() - started,
      });
      return {
        success: false,
        error: { code: "CANCELLED", message: "Cancelled before execution." },
      };
    }

    const result = await tool.handler(input as never, {
      ...ctx,
      currentExecutionId: executionId,
    });

    const durationMs = Date.now() - started;
    if (result.success) {
      await ctx.data.toolRuns.complete(executionId, {
        status: "succeeded",
        resultSummary: result.message ?? summarize(result.data),
        durationMs,
      });
      emit({
        type: "tool_succeeded",
        tool: toolName,
        executionId,
        data: result.data,
        display: {
          label: result.activityLabel ?? tool.activityLabel,
          detail: formatSuccessDetail(result) ?? result.message,
        },
      });
      ctx.log?.({
        event: "tool_succeeded",
        tool: toolName,
        executionMs: durationMs,
        generation: ctx.generationId,
      });
    } else if (isClarificationErrorCode(result.error?.code)) {
      await ctx.data.toolRuns.complete(executionId, {
        status: "failed",
        errorCode: result.error?.code ?? "AMBIGUOUS_MATCH",
        errorMessage: result.error?.message ?? "Clarification needed",
        durationMs,
      });
      // Clarification is not a hard UI failure — clients must not flip to ERROR
      // after a successful mutation earlier in the same generation.
      emit({
        type: "clarification_needed",
        tool: toolName,
        executionId,
        error: result.error ?? {
          code: "AMBIGUOUS_MATCH",
          message: "Clarification needed",
        },
        data: result.data,
        display: {
          label: result.activityLabel ?? tool.activityLabel,
          detail: result.error?.message,
        },
      });
    } else {
      await ctx.data.toolRuns.complete(executionId, {
        status: "failed",
        errorCode: result.error?.code ?? "EXECUTION_FAILED",
        errorMessage: result.error?.message ?? "Execution failed",
        durationMs,
      });
      emit({
        type: "tool_failed",
        tool: toolName,
        executionId,
        error: result.error ?? {
          code: "EXECUTION_FAILED",
          message: "Execution failed",
        },
        display: {
          label: tool.activityLabel,
          detail: result.error?.message,
        },
      });
    }

    return {
      ...result,
      activityLabel: result.activityLabel ?? tool.activityLabel,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Tool execution failed";
    await ctx.data.toolRuns.complete(executionId, {
      status: "failed",
      errorCode: "EXECUTION_FAILED",
      errorMessage: message.slice(0, 300),
      durationMs: Date.now() - started,
    });
    const result: ToolResult = {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Tool execution failed." },
      activityLabel: tool.activityLabel,
    };
    emit({
      type: "tool_failed",
      tool: toolName,
      executionId,
      error: result.error!,
      display: { label: tool.activityLabel, detail: "Execution failed" },
    });
    return result;
  }
}

async function safeStartRun(
  ctx: ToolExecutionContext,
  input: {
    executionId: string;
    toolName: string;
    permission: PermissionLevel;
    sanitizedInput: Record<string, unknown>;
    status?: ToolRunStatus;
  },
): Promise<void> {
  try {
    const existing = await ctx.data.toolRuns.findByExecutionId(
      input.executionId,
    );
    if (existing) return;
    await ctx.data.toolRuns.start(input);
  } catch (err) {
    // Unique violation → another writer already started this execution
    ctx.log?.({
      event: "tool_run_start_race",
      executionId: input.executionId,
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
  }
}

function formatSuccessDetail(result: ToolResult): string | undefined {
  const data = result.data as
    | {
        task?: { title?: string; due_label?: string | null };
        note?: { title?: string | null; content?: string };
      }
    | undefined;
  if (!data) return undefined;
  if (data.task?.title) {
    const due = data.task.due_label?.trim();
    return due ? `${data.task.title}\n${due}` : data.task.title;
  }
  if (data.note) {
    if (data.note.title?.trim()) return data.note.title.trim();
    if (data.note.content?.trim()) {
      const c = data.note.content.trim();
      return c.length > 80 ? `${c.slice(0, 77)}…` : c;
    }
  }
  return undefined;
}

function summarize(data: unknown): string {
  if (data == null) return "ok";
  try {
    const s = JSON.stringify(data);
    return s.length > 240 ? `${s.slice(0, 237)}...` : s;
  } catch {
    return "ok";
  }
}

/** Sanitize tool result for Gemini — strip internal metadata */
export function toModelToolResult(result: ToolResult): Record<string, unknown> {
  return {
    success: result.success,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.message ? { message: result.message } : {}),
    ...(result.error
      ? { error: { code: result.error.code, message: result.error.message } }
      : {}),
    ...(result.requiresApproval
      ? { requiresApproval: true, approvalId: result.approvalId }
      : {}),
  };
}

/**
 * Legacy wrapper used by older tests.
 */
export async function executeTool(
  registry: ToolRegistry,
  toolId: string,
  rawInput: unknown,
  ctx: ToolExecutionContext,
): Promise<{
  ok: boolean;
  data?: unknown;
  error?: string;
  activityLabel?: string;
  requiresApproval?: boolean;
  approvalId?: string;
}> {
  const result = await executeToolCall({
    registry,
    toolName: toolId,
    rawArgs: rawInput,
    executionId: `legacy-${toolId}-${Date.now()}`,
    ctx: {
      ...ctx,
      data: ctx.data ?? createInMemoryDataAccess(ctx.userId),
      timezone: ctx.timezone ?? "America/Chicago",
      now: ctx.now ?? new Date(),
    },
  });
  return {
    ok: result.success,
    data: result.data,
    error: result.error?.message,
    activityLabel: result.activityLabel,
    requiresApproval: result.requiresApproval,
    approvalId: result.approvalId,
  };
}

/** Minimal in-memory data access for unit tests without Supabase */
export function createInMemoryDataAccess(userId: string) {
  void userId;
  const runs = new Map<string, {
    id: string;
    execution_id: string;
    tool_name: string;
    status: ToolRunStatus;
    sanitized_input: Record<string, unknown>;
    result_summary: string | null;
    error_code: string | null;
    error_message: string | null;
  }>();

  return {
    tasks: {
      async create() {
        throw new Error("Not implemented in memory");
      },
      async list() {
        return [];
      },
      async getById() {
        return null;
      },
      async update() {
        throw new Error("Not implemented in memory");
      },
    },
    notes: {
      async create() {
        throw new Error("Not implemented in memory");
      },
      async search() {
        return [];
      },
      async getById() {
        return null;
      },
    },
    toolRuns: {
      async findByExecutionId(executionId: string) {
        return runs.get(executionId) ?? null;
      },
      async start(input: {
        executionId: string;
        toolName: string;
        permission: PermissionLevel;
        sanitizedInput: Record<string, unknown>;
        status?: ToolRunStatus;
      }) {
        const row = {
          id: `run-${runs.size + 1}`,
          execution_id: input.executionId,
          tool_name: input.toolName,
          status: input.status ?? ("requested" as ToolRunStatus),
          sanitized_input: input.sanitizedInput,
          result_summary: null,
          error_code: null,
          error_message: null,
        };
        runs.set(input.executionId, row);
        return row;
      },
      async complete(
        executionId: string,
        patch: {
          status: ToolRunStatus;
          resultSummary?: string | null;
          errorCode?: string | null;
          errorMessage?: string | null;
          approvalId?: string | null;
          durationMs?: number;
        },
      ) {
        const row = runs.get(executionId);
        if (!row) throw new Error("missing run");
        row.status = patch.status;
        row.result_summary = patch.resultSummary ?? row.result_summary;
        row.error_code = patch.errorCode ?? null;
        row.error_message = patch.errorMessage ?? null;
        return row;
      },
    },
    approvals: {
      async createPending(input: {
        toolId: string;
        actionLabel: string;
        parameters: Record<string, unknown>;
        permissionLevel: PermissionLevel;
        executionId: string;
      }) {
        return {
          id: `appr-${Date.now()}`,
          tool_id: input.toolId,
          status: "PENDING",
          parameters: input.parameters,
        };
      },
      async getForUser() {
        return null;
      },
    },
  };
}
