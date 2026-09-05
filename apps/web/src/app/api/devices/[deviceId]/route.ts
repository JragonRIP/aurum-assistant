import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ deviceId: string }> };

export async function PATCH(request: Request, context: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { deviceId } = await context.params;

  const body = z
    .object({
      name: z.string().min(1).max(80).optional(),
      is_default: z.boolean().optional(),
    })
    .safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.data.is_default) {
    await auth.supabase
      .from("devices")
      .update({ is_default: false })
      .eq("user_id", auth.user.id);
  }

  const { data, error } = await auth.supabase
    .from("devices")
    .update({
      ...(body.data.name ? { name: body.data.name } : {}),
      ...(body.data.is_default !== undefined
        ? { is_default: body.data.is_default }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deviceId)
    .eq("user_id", auth.user.id)
    .select("id, name, is_default")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ device: data });
}

/** Revoke / remove device */
export async function DELETE(_request: Request, context: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { deviceId } = await context.params;

  const { data, error } = await auth.supabase
    .from("devices")
    .update({
      status: "disabled",
      credential_hash: null,
      is_online: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deviceId)
    .eq("user_id", auth.user.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
