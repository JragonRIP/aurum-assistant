import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { listIntegrationStatuses } from "@/lib/integrations/spotify/service";

export const dynamic = "force-dynamic";

async function list(auth: Awaited<ReturnType<typeof requireAuth>>) {
  if (isAuthError(auth)) return auth;
  try {
    const result = await listIntegrationStatuses(auth.supabase, auth.user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to list integrations",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return list(await requireAuth());
}

export async function POST() {
  return list(await requireAuth());
}
