/**
 * Canonical approval resolution — used by web session and device overlay.
 * Approving executes the stored validated tool args with skipConfirmation.
 * Never re-plans through the model.
 *
 * IMPORTANT: public.approvals has no `updated_at` column (see Phase 1 migration).
 * Do not write updated_at — PostgREST rejects unknown columns and breaks approve/reject.
 */
import { createDefaultRegistry, executeToolCall } from "@aurum/tools";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseToolDataAccess } from "@/lib/tools/data-access";
import { dispatchDeviceTool } from "@/lib/devices/dispatch";
import { runSpotifyTool } from "@/lib/integrations/spotify/service";
import { listUserDevices } from "@/lib/devices/queries";

export type ApprovalDecision = "approve" | "reject";

export type ApprovalActor = {
  userId: string;
  deviceId?: string;
  source: "web" | "device";
};

export type DecideApprovalErrorCode =
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALREADY_RESOLVED"
  | "APPROVAL_FORBIDDEN"
  | "INVALID_DECISION"
  | "APPROVAL_EXECUTION_FAILED";

export type DecideApprovalResult =
  | {
      ok: true;
      status: "APPROVED" | "REJECTED";
      alreadyResolved?: boolean;
      executionId?: string;
      result?: {
        success: boolean;
        message?: string;
        error?: { code?: string; message?: string } | null;
        activityLabel?: string;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
      code: DecideApprovalErrorCode;
    };

type ApprovalRow = {
  id: string;
  user_id: string;
  tool_id: string;
  action_label: string | null;
  parameters: Record<string, unknown> | null;
  status: string;
  execution_id: string | null;
  conversation_id: string | null;
  generation_id: string | null;
  expires_at: string | null;
  result: unknown;
};

function mapStoredResult(raw: unknown): DecideApprovalResult & { ok: true } {
  const r = (raw ?? {}) as {
    success?: boolean;
    message?: string | null;
    error?: { code?: string; message?: string } | null;
    activityLabel?: string | null;
  };
  return {
    ok: true,
    status: "APPROVED",
    alreadyResolved: true,
    result: {
      success: Boolean(r.success),
      message: r.message ?? undefined,
      error: r.error ?? null,
      activityLabel: r.activityLabel ?? undefined,
    },
  };
}

/** Safe boundary log — never secrets, tokens, or tool parameters. */
export function logApprovalBoundary(
  stage: string,
  info: Record<string, string | number | boolean | undefined | null>,
): void {
  const safe: Record<string, string | number | boolean> = { stage };
  for (const [k, v] of Object.entries(info)) {
    if (v === undefined || v === null) continue;
    const key = k.toLowerCase();
    if (
      key.includes("secret") ||
      key.includes("token") ||
      key.includes("bearer") ||
      key.includes("password") ||
      key.includes("authorization") ||
      key.includes("parameter")
    ) {
      continue;
    }
    safe[k] = v;
  }
  console.info("[aurum:approval]", safe);
}

export async function decideApproval(opts: {
  supabase: SupabaseClient;
  actor: ApprovalActor;
  approvalId: string;
  decision: ApprovalDecision;
}): Promise<DecideApprovalResult> {
  const { supabase, actor, approvalId, decision } = opts;
  const userId = actor.userId;

  logApprovalBoundary("decide_start", {
    approvalId,
    decision,
    source: actor.source,
    deviceId: actor.deviceId ?? null,
    userId,
  });

  if (decision !== "approve" && decision !== "reject") {
    return {
      ok: false,
      status: 422,
      error: "Invalid decision",
      code: "INVALID_DECISION",
    };
  }

  const { data: approval, error } = await supabase
    .from("approvals")
    .select(
      "id, user_id, tool_id, action_label, parameters, status, execution_id, conversation_id, generation_id, expires_at, result",
    )
    .eq("id", approvalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logApprovalBoundary("decide_lookup_error", {
      approvalId,
      source: actor.source,
      // PostgREST code only — never full message (may leak schema)
      dbCode: (error as { code?: string }).code ?? "unknown",
    });
    return {
      ok: false,
      status: 404,
      error: "Approval not found",
      code: "APPROVAL_NOT_FOUND",
    };
  }

  if (!approval) {
    return {
      ok: false,
      status: 404,
      error: "Approval not found",
      code: "APPROVAL_NOT_FOUND",
    };
  }

  const row = approval as ApprovalRow;

  if (row.user_id !== userId) {
    return {
      ok: false,
      status: 403,
      error: "Approval forbidden",
      code: "APPROVAL_FORBIDDEN",
    };
  }

  if (
    row.expires_at &&
    new Date(String(row.expires_at)).getTime() < Date.now() &&
    row.status === "PENDING"
  ) {
    await supabase
      .from("approvals")
      .update({ status: "EXPIRED" })
      .eq("id", approvalId)
      .eq("status", "PENDING");
    return {
      ok: false,
      status: 409,
      error: "Approval expired",
      code: "APPROVAL_EXPIRED",
    };
  }

  if (row.status === "APPROVED" && decision === "approve") {
    logApprovalBoundary("decide_idempotent_approve", { approvalId });
    return mapStoredResult(row.result);
  }

  if (row.status === "REJECTED" && decision === "reject") {
    logApprovalBoundary("decide_idempotent_reject", { approvalId });
    return { ok: true, status: "REJECTED", alreadyResolved: true };
  }

  if (row.status !== "PENDING") {
    return {
      ok: false,
      status: 409,
      error: "That approval was already resolved",
      code: "APPROVAL_ALREADY_RESOLVED",
    };
  }

  if (decision === "reject") {
    const { data: updated, error: updErr } = await supabase
      .from("approvals")
      .update({
        status: "REJECTED",
        approved_at: new Date().toISOString(),
      })
      .eq("id", approvalId)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle();

    if (updErr) {
      logApprovalBoundary("decide_reject_db_error", {
        approvalId,
        dbCode: (updErr as { code?: string }).code ?? "unknown",
      });
      return {
        ok: false,
        status: 500,
        error: "Couldn't cancel the approval",
        code: "APPROVAL_EXECUTION_FAILED",
      };
    }
    if (!updated) {
      const { data: again } = await supabase
        .from("approvals")
        .select("status")
        .eq("id", approvalId)
        .eq("user_id", userId)
        .maybeSingle();
      if (again?.status === "REJECTED") {
        return { ok: true, status: "REJECTED", alreadyResolved: true };
      }
      return {
        ok: false,
        status: 409,
        error: "That approval was already resolved",
        code: "APPROVAL_ALREADY_RESOLVED",
      };
    }
    logApprovalBoundary("decide_rejected", { approvalId, source: actor.source });
    return { ok: true, status: "REJECTED" };
  }

  // Approve — claim PENDING → APPROVED atomically, then execute stored args
  const { data: claimed, error: claimErr } = await supabase
    .from("approvals")
    .update({
      status: "APPROVED",
      approved_at: new Date().toISOString(),
    })
    .eq("id", approvalId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();

  if (claimErr) {
    logApprovalBoundary("decide_claim_db_error", {
      approvalId,
      dbCode: (claimErr as { code?: string }).code ?? "unknown",
    });
    return {
      ok: false,
      status: 500,
      error: "Couldn't execute the approved action",
      code: "APPROVAL_EXECUTION_FAILED",
    };
  }

  if (!claimed) {
    const { data: again } = await supabase
      .from("approvals")
      .select("status, result")
      .eq("id", approvalId)
      .eq("user_id", userId)
      .maybeSingle();
    if (again?.status === "APPROVED") {
      return mapStoredResult(again.result);
    }
    return {
      ok: false,
      status: 409,
      error: "That approval was already resolved",
      code: "APPROVAL_ALREADY_RESOLVED",
    };
  }

  const registry = createDefaultRegistry();
  const toolName = String(row.tool_id);
  const executionId = `approved:${approvalId}:${Date.now()}`;
  const conversationId = row.conversation_id ?? undefined;
  const generationId = row.generation_id ?? undefined;

  logApprovalBoundary("decide_execute_start", {
    approvalId,
    executionId,
    tool: toolName,
    source: actor.source,
    deviceId: actor.deviceId ?? null,
  });

  let result;
  try {
    result = await executeToolCall({
      registry,
      toolName,
      rawArgs: (row.parameters ?? {}) as Record<string, unknown>,
      executionId,
      ctx: {
        userId,
        conversationId,
        generationId,
        timezone: "America/Chicago",
        now: new Date(),
        skipConfirmation: true,
        data: createSupabaseToolDataAccess({
          supabase,
          userId,
          conversationId,
          generationId,
        }),
        dispatchDeviceTool: (tool, input, execId) =>
          dispatchDeviceTool({
            supabase,
            userId,
            tool,
            input,
            executionId: execId,
          }),
        listDevices: () => listUserDevices(supabase, userId),
        runSpotifyAction: (action, input) =>
          runSpotifyTool({
            supabase,
            userId,
            conversationId,
            action,
            input,
          }),
      },
    });
  } catch (err) {
    logApprovalBoundary("decide_execute_throw", {
      approvalId,
      executionId,
      tool: toolName,
    });
    void err;
    await supabase
      .from("approvals")
      .update({
        result: {
          success: false,
          message: null,
          error: { code: "EXECUTION_FAILED", message: "Action failed" },
          activityLabel: null,
        },
      })
      .eq("id", approvalId);
    return {
      ok: false,
      status: 500,
      error: "Couldn't execute the approved action",
      code: "APPROVAL_EXECUTION_FAILED",
    };
  }

  await supabase
    .from("approvals")
    .update({
      result: {
        success: result.success,
        message: result.message ?? null,
        error: result.error ?? null,
        activityLabel: result.activityLabel ?? null,
      },
    })
    .eq("id", approvalId);

  logApprovalBoundary("decide_execute_done", {
    approvalId,
    executionId,
    success: result.success,
    source: actor.source,
  });

  return {
    ok: true,
    status: "APPROVED",
    executionId,
    result: {
      success: result.success,
      message: result.message,
      error: result.error ?? null,
      activityLabel: result.activityLabel,
    },
  };
}

/** Overlay / UI helpers for friendly copy */
export function approvalPrimaryLabel(
  toolId: string,
  actionLabel?: string | null,
): string {
  const label = (actionLabel ?? "").trim();
  if (label) return label.endsWith("?") ? label : `${label}?`;
  const map: Record<string, string> = {
    restart_pc: "Restart this PC?",
    shutdown_pc: "Shut down this PC?",
    sleep_pc: "Put this PC to sleep?",
    close_window: "Close this window?",
    close_application: "Close this application?",
    delete_file: "Delete this file?",
    delete_folder: "Delete this folder?",
    terminate_process: "Terminate this process?",
  };
  return map[toolId] ?? "Confirm this action?";
}

export function approvalDetail(toolId: string): string {
  const map: Record<string, string> = {
    restart_pc: "Aurum will restart this computer now.",
    shutdown_pc: "Aurum will shut down this computer now.",
    sleep_pc: "Aurum will put this computer to sleep.",
    close_window: "This may discard unsaved work.",
    close_application: "This may discard unsaved work.",
    delete_file: "This will permanently remove the file.",
    delete_folder: "This will permanently remove the folder.",
    terminate_process: "This will force-quit the process.",
  };
  return map[toolId] ?? "This action needs your confirmation before it runs.";
}

export function approvalConfirmVerb(toolId: string): string {
  const map: Record<string, string> = {
    restart_pc: "Restart",
    shutdown_pc: "Shut down",
    sleep_pc: "Sleep",
    close_window: "Close",
    close_application: "Close",
    delete_file: "Delete",
    delete_folder: "Delete",
    terminate_process: "Terminate",
  };
  return map[toolId] ?? "Approve";
}

/** Assert helpers for regression: approvals schema must not write updated_at */
export function approvalsUpdatePayloadIsSafe(
  payload: Record<string, unknown>,
): boolean {
  return !("updated_at" in payload);
}
