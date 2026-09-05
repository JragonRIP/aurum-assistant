import { NextResponse } from "next/server";
import { z } from "zod";
import { isDeviceAuthError, requireDeviceAuth } from "@/lib/devices/auth";

export const dynamic = "force-dynamic";

const ResultSchema = z.object({
  requestId: z.string(),
  executionId: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  completedAt: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) return auth;

  const parsed = ResultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid result" }, { status: 400 });
  }

  const body = parsed.data;
  const completedAt = body.completedAt ?? new Date().toISOString();

  // Idempotent: if already terminal, return prior
  const { data: existing } = await auth.supabase
    .from("device_requests")
    .select("status, result, error_code, error_message, completed_at")
    .eq("device_id", auth.device.id)
    .eq("execution_id", body.executionId)
    .maybeSingle();

  if (
    existing &&
    (existing.status === "succeeded" ||
      existing.status === "failed" ||
      existing.status === "cancelled" ||
      existing.status === "expired")
  ) {
    return NextResponse.json({ ok: true, replayed: true });
  }

  const { error } = await auth.supabase
    .from("device_requests")
    .update({
      status: body.success ? "succeeded" : "failed",
      result: body.success ? (body.data ?? {}) : null,
      error_code: body.success ? null : (body.error?.code ?? "EXECUTION_FAILED"),
      error_message: body.success
        ? null
        : (body.error?.message ?? "Failed"),
      completed_at: completedAt,
    })
    .eq("device_id", auth.device.id)
    .eq("execution_id", body.executionId)
    .in("status", ["pending", "running"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
