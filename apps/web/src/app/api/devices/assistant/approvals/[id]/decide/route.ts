import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isDeviceAuthError,
  requireDeviceAuth,
} from "@/lib/devices/auth";
import { decideApproval } from "@/lib/approvals/decide";

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
  if (isDeviceAuthError(auth)) return auth;

  const { id: approvalId } = await context.params;
  if (!z.string().uuid().safeParse(approvalId).success) {
    return NextResponse.json({ error: "Invalid approval id" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const outcome = await decideApproval({
    supabase: auth.supabase,
    userId: auth.device.user_id,
    approvalId,
    decision: parsed.data.decision,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, code: outcome.code },
      { status: outcome.status },
    );
  }

  return NextResponse.json({
    ok: true,
    status: outcome.status,
    alreadyResolved: outcome.alreadyResolved ?? false,
    result: outcome.result,
  });
}
