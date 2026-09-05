import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decideApproval } from "@/lib/approvals/decide";

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
    return NextResponse.json(
      { error: "Unauthorized", code: "DEVICE_AUTH_REQUIRED" },
      { status: 401 },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid decision", code: "INVALID_DECISION" },
      { status: 422 },
    );
  }

  const outcome = await decideApproval({
    supabase,
    actor: { userId: user.id, source: "web" },
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
