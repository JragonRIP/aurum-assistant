import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDefaultRegistry, executeToolCall } from "@aurum/tools";
import { createSupabaseToolDataAccess } from "@/lib/tools/data-access";
import { dispatchDeviceTool } from "@/lib/devices/dispatch";
import { runSpotifyTool } from "@/lib/integrations/spotify/service";
import { listUserDevices } from "@/lib/devices/queries";

const BodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

/**
 * Authenticated user approves/rejects a pending CONFIRM tool.
 * Model cannot call this — only the signed-in user via Settings/Core UI.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: approvalId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { data: approval, error } = await supabase
    .from("approvals")
    .select(
      "id, user_id, tool_id, action_label, parameters, status, execution_id, conversation_id, generation_id, expires_at",
    )
    .eq("id", approvalId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  if (approval.status !== "PENDING") {
    return NextResponse.json(
      { error: "Approval is no longer pending" },
      { status: 409 },
    );
  }

  if (
    approval.expires_at &&
    new Date(String(approval.expires_at)).getTime() < Date.now()
  ) {
    await supabase
      .from("approvals")
      .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
      .eq("id", approvalId);
    return NextResponse.json({ error: "Approval expired" }, { status: 410 });
  }

  if (parsed.data.decision === "reject") {
    await supabase
      .from("approvals")
      .update({
        status: "REJECTED",
        approved_at: new Date().toISOString(),
      })
      .eq("id", approvalId);
    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  // Approve → execute with skipConfirmation
  await supabase
    .from("approvals")
    .update({
      status: "APPROVED",
      approved_at: new Date().toISOString(),
    })
    .eq("id", approvalId);

  const registry = createDefaultRegistry();
  const toolName = String(approval.tool_id);
  const executionId = `approved:${approvalId}:${Date.now()}`;
  const conversationId = (approval.conversation_id as string | null) ?? undefined;

  const result = await executeToolCall({
    registry,
    toolName,
    rawArgs: (approval.parameters ?? {}) as Record<string, unknown>,
    executionId,
    ctx: {
      userId: user.id,
      conversationId,
      generationId: (approval.generation_id as string | null) ?? undefined,
      timezone: "America/Chicago",
      now: new Date(),
      skipConfirmation: true,
      data: createSupabaseToolDataAccess({
        supabase,
        userId: user.id,
        conversationId,
        generationId: (approval.generation_id as string | null) ?? undefined,
      }),
      dispatchDeviceTool: (tool, input, execId) =>
        dispatchDeviceTool({
          supabase,
          userId: user.id,
          tool,
          input,
          executionId: execId,
        }),
      listDevices: () => listUserDevices(supabase, user.id),
      runSpotifyAction: (action, input) =>
        runSpotifyTool({
          supabase,
          userId: user.id,
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
      },
    })
    .eq("id", approvalId);

  return NextResponse.json({
    ok: true,
    status: "APPROVED",
    result: {
      success: result.success,
      message: result.message,
      error: result.error,
      activityLabel: result.activityLabel,
    },
  });
}
