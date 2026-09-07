import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getResponseDetailPreference,
  setResponseDetailPreference,
} from "@/lib/memory/service";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const responseDetailPreference = await getResponseDetailPreference(
    supabase,
    user.id,
  );

  const { data: settings } = await supabase
    .from("memory_settings")
    .select(
      "enabled, vault_enabled, vault_device_id, vault_root_label, vault_root_path, response_detail_preference",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const { count } = await supabase
    .from("memories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "ACTIVE");

  return NextResponse.json({
    enabled: settings?.enabled ?? true,
    vaultEnabled: settings?.vault_enabled ?? false,
    vaultDeviceId: settings?.vault_device_id ?? null,
    vaultRootLabel: settings?.vault_root_label ?? null,
    vaultRootPath: settings?.vault_root_path ?? null,
    vaultStatus: settings?.vault_enabled
      ? settings?.vault_root_path
        ? "CONFIGURED"
        : "NEEDS_FOLDER"
      : "DISABLED",
    responseDetailPreference,
    memoryCount: count ?? 0,
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (
    body.responseDetailPreference === "concise" ||
    body.responseDetailPreference === "balanced" ||
    body.responseDetailPreference === "detailed"
  ) {
    await setResponseDetailPreference(
      supabase,
      user.id,
      body.responseDetailPreference,
    );
  }

  const patch: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.vaultEnabled === "boolean") {
    patch.vault_enabled = body.vaultEnabled;
  }
  if (typeof body.vaultRootLabel === "string") {
    patch.vault_root_label = body.vaultRootLabel;
  }
  if (typeof body.vaultRootPath === "string") {
    patch.vault_root_path = body.vaultRootPath;
  }
  if (typeof body.vaultDeviceId === "string") {
    patch.vault_device_id = body.vaultDeviceId;
  }

  await supabase.from("memory_settings").upsert(patch, { onConflict: "user_id" });

  return GET();
}
