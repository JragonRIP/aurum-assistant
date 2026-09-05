import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import { listTasks, toUiTask } from "@/lib/tasks/queries";
import {
  addDaysToDateString,
  localDateString,
} from "@aurum/shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "open";
  const statusParam = url.searchParams.get("status");

  try {
    const today = localDateString(new Date());
    const tomorrow = addDaysToDateString(today, 1);

    if (scope === "today") {
      const { listTasksForToday } = await import("@/lib/tasks/queries");
      const buckets = await listTasksForToday(auth.supabase, auth.user.id);
      return NextResponse.json(buckets);
    }

    let status: string | string[] | undefined;
    if (statusParam) {
      status = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (scope === "completed") {
      status = ["COMPLETED"];
    } else if (scope === "all") {
      status = undefined;
    } else {
      status = ["TODO", "IN_PROGRESS", "WAITING"];
    }

    const tasks = await listTasks(auth.supabase, auth.user.id, {
      status: scope === "all" ? undefined : status,
      includeCompleted: scope === "all" || scope === "completed",
      limit: 100,
    });

    return NextResponse.json({
      tasks: tasks.map((t) => toUiTask(t, { today, tomorrow })),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load tasks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
