import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthError, requireAuth } from "@/lib/auth";
import { isDeviceAuthError, requireDeviceAuth } from "@/lib/devices/auth";
import { isBlockedSensitiveLocation, normalizePath } from "@aurum/tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ deviceId: string }> };

/** User lists approved roots */
export async function GET(_request: Request, context: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { deviceId } = await context.params;

  const { data, error } = await auth.supabase
    .from("device_approved_roots")
    .select("id, label, canonical_path, created_at")
    .eq("user_id", auth.user.id)
    .eq("device_id", deviceId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ roots: data ?? [] });
}

/**
 * Register an approved root.
 * - User JWT: path must already be validated by desktop (desktop posts via bridge)
 * - Device auth: preferred path — desktop selected via native picker
 */
export async function POST(request: Request, context: Params) {
  const { deviceId } = await context.params;
  const body = z
    .object({
      label: z.string().min(1).max(80),
      canonicalPath: z.string().min(2).max(500),
    })
    .safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const canonical = normalizePath(body.data.canonicalPath);
  if (isBlockedSensitiveLocation(canonical)) {
    return NextResponse.json(
      { error: "This location cannot be approved." },
      { status: 400 },
    );
  }

  // Prefer device auth (desktop picker)
  const deviceAuth = await requireDeviceAuth(request);
  if (!isDeviceAuthError(deviceAuth)) {
    if (deviceAuth.device.id !== deviceId) {
      return NextResponse.json({ error: "Device mismatch" }, { status: 403 });
    }
    const { data, error } = await deviceAuth.supabase
      .from("device_approved_roots")
      .upsert(
        {
          user_id: deviceAuth.device.user_id,
          device_id: deviceId,
          label: body.data.label,
          canonical_path: canonical,
        },
        { onConflict: "device_id,canonical_path" },
      )
      .select("id, label, canonical_path")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ root: data });
  }

  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { data: device } = await auth.supabase
    .from("devices")
    .select("id")
    .eq("id", deviceId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!device) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await auth.supabase
    .from("device_approved_roots")
    .upsert(
      {
        user_id: auth.user.id,
        device_id: deviceId,
        label: body.data.label,
        canonical_path: canonical,
      },
      { onConflict: "device_id,canonical_path" },
    )
    .select("id, label, canonical_path")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ root: data });
}

export async function DELETE(request: Request, context: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { deviceId } = await context.params;
  const url = new URL(request.url);
  const rootId = url.searchParams.get("rootId");
  if (!rootId) {
    return NextResponse.json({ error: "rootId required" }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("device_approved_roots")
    .delete()
    .eq("id", rootId)
    .eq("device_id", deviceId)
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
