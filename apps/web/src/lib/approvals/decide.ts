/**
 * Canonical approval resolution — used by web session and device overlay.
 * Approving executes the stored validated tool args with skipConfirmation.
 * Never re-plans through the model.
 */
import { createDefaultRegistry, executeToolCall } from "@aurum/tools";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseToolDataAccess } from "@/lib/tools/data-access";
import { dispatchDeviceTool } from "@/lib/devices/dispatch";
import { runSpotifyTool } from "@/lib/integrations/spotify/service";
import { listUserDevices } from "@/lib/devices/queries";

export type ApprovalDecision = "approve" | "reject";

export type DecideApprovalResult =
  | {
      ok: true;
      status: "APPROVED" | "REJECTED";
      alreadyResolved?: boolean;
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
      code?:
        | "NOT_FOUND"
        | "NOT_PENDING"
        | "EXPIRED"
        | "ALREADY_RESOLVED"
        | "EXECUTION_FAILED";
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

export async function decideApproval(opts: {
  supabase: SupabaseClient;
  userId: string;
  approvalId: string;
  decision: ApprovalDecision;
}): Promise<DecideApprovalResult> {
  const { supabase, userId, approvalId, decision } = opts;

  const { data: approval, error } = await supabase
    .from("approvals")
    .select(
      "id, user_id, tool_id, action_label, parameters, status, execution_id, conversation_id, generation_id, expires_at, result",
    )
    .eq("id", approvalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !approval) {
    return {
      ok: false,
      status: 404,
      error: "Approval not found",
      code: "NOT_FOUND",
    };
  }

  const row = approval as ApprovalRow;

  if (
    row.expires_at &&
    new Date(String(row.expires_at)).getTime() < Date.now() &&
    row.status === "PENDING"
  ) {
    await supabase
      .from("approvals")
      .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
      .eq("id", approvalId)
      .eq("status", "PENDING");
    return {
      ok: false,
      status: 410,
      error: "Approval expired",
      code: "EXPIRED",
    };
  }

  if (row.status === "APPROVED" && decision === "approve") {
    return mapStoredResult(row.result);
  }

  if (row.status !== "PENDING") {
    return {
      ok: false,
      status: 409,
      error: "Approval is no longer pending",
      code: "ALREADY_RESOLVED",
    };
  }

  if (decision === "reject") {
    const { data: updated, error: updErr } = await supabase
      .from("approvals")
      .update({
        status: "REJECTED",
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", approvalId)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle();

    if (updErr) {
      return {
        ok: false,
        status: 500,
        error: "Could not reject approval",
        code: "EXECUTION_FAILED",
      };
    }
    if (!updated) {
      // Race: already resolved elsewhere
      return {
        ok: false,
        status: 409,
        error: "Approval is no longer pending",
        code: "ALREADY_RESOLVED",
      };
    }
    return { ok: true, status: "REJECTED" };
  }

  // Approve — claim PENDING → APPROVED atomically, then execute stored args
  const { data: claimed, error: claimErr } = await supabase
    .from("approvals")
    .update({
      status: "APPROVED",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", approvalId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();

  if (claimErr) {
    return {
      ok: false,
      status: 500,
      error: "Could not approve",
      code: "EXECUTION_FAILED",
    };
  }

  if (!claimed) {
    // Another client won the race — return stored result if approved
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
      error: "Approval is no longer pending",
      code: "ALREADY_RESOLVED",
    };
  }

  const registry = createDefaultRegistry();
  const toolName = String(row.tool_id);
  const executionId = `approved:${approvalId}:${Date.now()}`;
  const conversationId = row.conversation_id ?? undefined;
  const generationId = row.generation_id ?? undefined;

  const result = await executeToolCall({
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

  await supabase
    .from("approvals")
    .update({
      result: {
        success: result.success,
        message: result.message ?? null,
        error: result.error ?? null,
        activityLabel: result.activityLabel ?? null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", approvalId);

  return {
    ok: true,
    status: "APPROVED",
    result: {
      success: result.success,
      message: result.message,
      error: result.error ?? null,
      activityLabel: result.activityLabel,
    },
  };
}

/** Overlay / UI helpers for friendly copy */
export function approvalPrimaryLabel(toolId: string, actionLabel?: string | null): string {
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
