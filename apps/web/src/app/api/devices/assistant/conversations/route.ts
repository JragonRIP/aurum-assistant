import { NextResponse } from "next/server";
import {
  isDeviceAuthError,
  requireDeviceAuth,
} from "@/lib/devices/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create an overlay conversation for the device's user. */
export async function POST(request: Request) {
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) return auth;

  const { data, error } = await auth.supabase
    .from("conversations")
    .insert({
      user_id: auth.device.user_id,
      title: "Overlay",
      device_id: auth.device.id,
    })
    .select("id, title, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Could not create conversation" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    conversation: {
      id: data.id,
      title: data.title,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
  });
}
