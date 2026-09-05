import { NextResponse } from "next/server";
import { isDeviceAuthError, requireDeviceAuth } from "@/lib/devices/auth";

export const dynamic = "force-dynamic";

/**
 * Long-poll pending device requests for this authenticated device.
 */
export async function GET(request: Request) {
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) return auth;

  const url = new URL(request.url);
  const waitMs = Math.min(
    25_000,
    Math.max(0, Number(url.searchParams.get("wait") ?? "8000")),
  );
  const deadline = Date.now() + waitMs;

  while (Date.now() <= deadline) {
    // Expire stale pending
    await auth.supabase
      .from("device_requests")
      .update({
        status: "expired",
        completed_at: new Date().toISOString(),
        error_code: "REQUEST_EXPIRED",
        error_message: "Device request expired.",
      })
      .eq("device_id", auth.device.id)
      .eq("status", "pending")
      .lt("expires_at", new Date().toISOString());

    const { data, error } = await auth.supabase
      .from("device_requests")
      .select(
        "request_id, execution_id, tool_name, payload, issued_at, expires_at",
      )
      .eq("device_id", auth.device.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("issued_at", { ascending: true })
      .limit(1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = data?.[0];
    if (row) {
      await auth.supabase
        .from("device_requests")
        .update({ status: "running" })
        .eq("device_id", auth.device.id)
        .eq("execution_id", row.execution_id)
        .eq("status", "pending");

      return NextResponse.json({
        request: {
          requestId: row.request_id,
          deviceId: auth.device.id,
          tool: row.tool_name,
          executionId: row.execution_id,
          payload: row.payload ?? {},
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
        },
      });
    }

    if (Date.now() + 400 > deadline) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  return NextResponse.json({ request: null });
}
