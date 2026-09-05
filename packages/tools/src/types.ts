import type { z } from "zod";
import type {
  ExecutionEnvironment,
  PermissionLevel,
} from "@aurum/shared";

/** Hard loop limits — prevent runaway Gemini/tool cycles */
export const MAX_TOOL_ROUNDS = 6;
export const MAX_TOOL_CALLS_PER_REQUEST = 12;

export type ToolErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "AMBIGUOUS_MATCH"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "EXECUTION_FAILED"
  | "CANCELLED"
  | "LOOP_LIMIT_REACHED"
  | "UNKNOWN_TOOL"
  | "DISABLED_TOOL"
  | "IDEMPOTENT_REPLAY"
  | "DEVICE_OFFLINE"
  | "DEVICE_TIMEOUT"
  | "NOT_APPROVED_PATH"
  | "PATH_BLOCKED"
  | "UNSUPPORTED_FILE_TYPE"
  | "EXECUTABLE_BLOCKED"
  | "INVALID_URL"
  | "APP_BLOCKED"
  | "REQUEST_EXPIRED"
  | "CONFLICT"
  | "NOT_CONNECTED"
  | "TOKEN_EXPIRED"
  | "NO_ACTIVE_DEVICE"
  | "TRACK_NOT_FOUND"
  | "AMBIGUOUS_TRACK"
  | "AMBIGUOUS_PLAYLIST"
  | "PROVIDER_UNAVAILABLE"
  | "PREMIUM_REQUIRED"
  | "RATE_LIMITED"
  | "UNSUPPORTED"
  | "AUDIO_CONTROL_FAILED";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
}

/**
 * Trusted server context. Gemini never supplies userId / credentials.
 */
export interface ToolExecutionContext {
  userId: string;
  conversationId?: string;
  generationId?: string;
  requestId?: string;
  deviceId?: string;
  deviceType?: string;
  timezone: string;
  now: Date;
  signal?: AbortSignal;
  /** Opaque data-access bag implemented by the host app */
  data: ToolDataAccess;
  log?: (event: Record<string, unknown>) => void;
  /** Host injects desktop tool dispatch (never model-provided) */
  dispatchDeviceTool?: (
    tool: string,
    input: Record<string, unknown>,
    executionId: string,
  ) => Promise<ToolResult>;
  listDevices?: () => Promise<unknown>;
  /** Host injects Spotify integration actions (never model-provided; no fetch in tools) */
  runSpotifyAction?: (
    action: string,
    input: Record<string, unknown>,
    toolCtx?: ToolExecutionContext,
  ) => Promise<ToolResult>;
  /** Set by executor for the active tool call */
  currentExecutionId?: string;
  /**
   * When true, CONFIRM tools execute immediately (authenticated user already approved).
   * Never set from model output — host-only after approval API.
   */
  skipConfirmation?: boolean;
}

/** Host-provided persistence — never exposed to Gemini */
export interface ToolDataAccess {
  tasks: TaskDataAccess;
  notes: NoteDataAccess;
  toolRuns: ToolRunDataAccess;
  approvals: ApprovalDataAccess;
}

export interface TaskRecord {
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
}

export interface NoteRecord {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface TaskDataAccess {
  create(input: {
    title: string;
    description?: string | null;
    priority?: string;
    due_date?: string | null;
    due_time?: string | null;
    source?: string | null;
  }): Promise<TaskRecord>;
  list(filter: {
    status?: string | string[];
    dueFrom?: string | null;
    dueTo?: string | null;
    priority?: string | null;
    query?: string | null;
    limit?: number;
  }): Promise<TaskRecord[]>;
  getById(id: string): Promise<TaskRecord | null>;
  update(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      status?: string;
      priority?: string;
      due_date?: string | null;
      due_time?: string | null;
      completed_at?: string | null;
    },
  ): Promise<TaskRecord>;
}

export interface NoteDataAccess {
  create(input: {
    title?: string | null;
    content: string;
  }): Promise<NoteRecord>;
  search(input: { query: string; limit?: number }): Promise<NoteRecord[]>;
  getById(id: string): Promise<NoteRecord | null>;
}

export type ToolRunStatus =
  | "requested"
  | "validating"
  | "waiting_for_approval"
  | "executing"
  | "succeeded"
  | "failed"
  | "rejected"
  | "cancelled";

export interface ToolRunRecord {
  id: string;
  execution_id: string;
  tool_name: string;
  status: ToolRunStatus;
  sanitized_input: Record<string, unknown>;
  result_summary: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface ToolRunDataAccess {
  findByExecutionId(executionId: string): Promise<ToolRunRecord | null>;
  start(input: {
    executionId: string;
    toolName: string;
    permission: PermissionLevel;
    sanitizedInput: Record<string, unknown>;
    status?: ToolRunStatus;
  }): Promise<ToolRunRecord>;
  complete(
    executionId: string,
    patch: {
      status: ToolRunStatus;
      resultSummary?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      approvalId?: string | null;
      durationMs?: number;
    },
  ): Promise<ToolRunRecord>;
}

export interface ApprovalRecord {
  id: string;
  tool_id: string;
  status: string;
  parameters: Record<string, unknown>;
}

export interface ApprovalDataAccess {
  createPending(input: {
    toolId: string;
    actionLabel: string;
    parameters: Record<string, unknown>;
    permissionLevel: PermissionLevel;
    executionId: string;
  }): Promise<ApprovalRecord>;
  getForUser(id: string): Promise<ApprovalRecord | null>;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
  message?: string;
  metadata?: Record<string, unknown>;
  /** UI activity label */
  activityLabel?: string;
  requiresApproval?: boolean;
  approvalId?: string;
}

/** @deprecated Prefer ToolResult.success — kept for older call sites */
export type LegacyToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
  activityLabel?: string;
  requiresApproval?: boolean;
  approvalId?: string;
};

export interface AurumTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  name: string;
  description: string;
  inputSchema: TSchema;
  permission: PermissionLevel;
  environment: ExecutionEnvironment;
  enabled?: boolean;
  activityLabel: string;
  /** Optional Gemini-facing JSON Schema override */
  parametersJsonSchema?: Record<string, unknown>;
  handler: (
    input: z.infer<TSchema>,
    ctx: ToolExecutionContext,
  ) => Promise<ToolResult>;
}

export type AnyAurumTool = AurumTool<z.ZodTypeAny>;

/** Back-compat alias */
export type ToolContext = ToolExecutionContext;
