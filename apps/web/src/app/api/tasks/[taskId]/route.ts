import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { getTaskById, toUiTask } from "@/lib/tasks/queries";
import {
  addDaysToDateString,
  isUuid,
  localDateString,
} from "@aurum/shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ taskId: string }> };

export async function GET(_request: Request, context: Params) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { taskId } = await context.params;
  if (!isUuid(taskId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const task = await getTaskById(auth.supabase, auth.user.id, taskId);
    if (!task) {
      // Same response whether missing or other-user (RLS)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const today = localDateString(new Date());
    const tomorrow = addDaysToDateString(today, 1);
    return NextResponse.json({
      task: toUiTask(task, { today, tomorrow }),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
