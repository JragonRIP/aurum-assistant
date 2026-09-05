import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isDeviceAuthError,
  requireDeviceAuth,
} from "@/lib/devices/auth";
import { decideApproval, logApprovalBoundary } from "@/lib/approvals/decide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

/**
 * Device-authenticated approval decide (desktop overlay).
 * Same canonical approvals table + execution path as the web Core UI.
 * Never re-plans through the model — executes stored validated args.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) {
    const status = auth.status;
    const code =
      status === 403 ? "APPROVAL_FORBIDDEN" : "DEVICE_AUTH_REQUIRED";
    logApprovalBoundary("device_auth_failed", {
      status,
      code,
    });
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Device revoked"
            : "Device authorization failed",
        code,
      },
      { status: status === 403 ? 403 : 401 },
    );
  }

  const { id: approvalId } = await context.params;
  if (!z.string().uuid().safeParse(approvalId).success) {
    return NextResponse.json(
      { error: "Invalid approval id", code: "APPROVAL_NOT_FOUND" },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid decision", code: "INVALID_DECISION" },
      { status: 422 },
    );
  }

  logApprovalBoundary("device_decide_request", {
    approvalId,
    decision: parsed.data.decision,
    deviceId: auth.device.id,
    userId: auth.device.user_id,
  });

  const outcome = await decideApproval({
    supabase: auth.supabase,
    actor: {
      userId: auth.device.user_id,
      deviceId: auth.device.id,
      source: "device",
    },
    approvalId,
    decision: parsed.data.decision,
  });

  if (!outcome.ok) {
    logApprovalBoundary("device_decide_failed", {
      approvalId,
      decision: parsed.data.decision,
      deviceId: auth.device.id,
      status: outcome.status,
      code: outcome.code,
    });
    return NextResponse.json(
      { error: outcome.error, code: outcome.code },
      { status: outcome.status },
    );
  }

  logApprovalBoundary("device_decide_ok", {
    approvalId,
    decision: parsed.data.decision,
    deviceId: auth.device.id,
    status: outcome.status,
    alreadyResolved: outcome.alreadyResolved ?? false,
    executionId: outcome.executionId ?? null,
  });

  return NextResponse.json({
    ok: true,
    status: outcome.status,
    alreadyResolved: outcome.alreadyResolved ?? false,
    result: outcome.result,
  });
}
