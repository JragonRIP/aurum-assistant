import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRecord } from "@aurum/tools";
import {
  addDaysToDateString,
  formatDueLabel,
  localDateString,
} from "@aurum/shared";

const TASK_COLUMNS =
  "id, title, description, status, priority, due_date, due_time, completed_at, created_at, updated_at";

export type UiTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  due_label?: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function mapTaskRow(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    status: String(row.status),
    priority: String(row.priority),
    due_date: row.due_date ? String(row.due_date) : null,
    due_time: row.due_time ? String(row.due_time) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function toUiTask(
  task: TaskRecord,
  opts?: { today?: string; tomorrow?: string },
): UiTask {
  return {
    ...task,
    due_label: formatDueLabel({
      dueDate: task.due_date,
      dueTime: task.due_time,
      today: opts?.today,
      tomorrow: opts?.tomorrow,
    }),
  };
}

export type ListTasksFilter = {
  status?: string | string[];
  dueFrom?: string | null;
  dueTo?: string | null;
  priority?: string | null;
  query?: string | null;
  limit?: number;
  includeCompleted?: boolean;
};

/**
 * Shared authenticated task list — same rows create_task / get_tasks use.
 */
export async function listTasks(
  supabase: SupabaseClient,
  userId: string,
  filter: ListTasksFilter = {},
): Promise<TaskRecord[]> {
  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("user_id", userId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 50);

  if (filter.status) {
    const statuses = Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
    query = query.in("status", statuses);
  } else if (!filter.includeCompleted) {
    query = query.in("status", ["TODO", "IN_PROGRESS", "WAITING"]);
  }

  if (filter.dueFrom) query = query.gte("due_date", filter.dueFrom);
  if (filter.dueTo) query = query.lte("due_date", filter.dueTo);
  if (filter.priority) query = query.eq("priority", filter.priority);
  if (filter.query) {
    const q = escapeIlike(filter.query);
    query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapTaskRow(row as Record<string, unknown>));
}

export async function getTaskById(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<TaskRecord | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("user_id", userId)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapTaskRow(data as Record<string, unknown>) : null;
}

export type TodayTasksResult = {
  today: string;
  overdue: UiTask[];
  dueToday: UiTask[];
  upcoming: UiTask[];
};

export async function listTasksForToday(
  supabase: SupabaseClient,
  userId: string,
  opts?: { now?: Date; timeZone?: string; upcomingDays?: number },
): Promise<TodayTasksResult> {
  const now = opts?.now ?? new Date();
  const today = localDateString(now, opts?.timeZone);
  const tomorrow = addDaysToDateString(today, 1);
  const upcomingTo = addDaysToDateString(today, opts?.upcomingDays ?? 7);

  const open = await listTasks(supabase, userId, {
    status: ["TODO", "IN_PROGRESS", "WAITING"],
    limit: 100,
  });

  const overdue: UiTask[] = [];
  const dueToday: UiTask[] = [];
  const upcoming: UiTask[] = [];

  for (const task of open) {
    const ui = toUiTask(task, { today, tomorrow });
    if (!task.due_date) continue;
    if (task.due_date < today) overdue.push(ui);
    else if (task.due_date === today) dueToday.push(ui);
    else if (task.due_date <= upcomingTo) upcoming.push(ui);
  }

  return { today, overdue, dueToday, upcoming };
}

function escapeIlike(value: string): string {
  return value.replace(/[%_,]/g, (ch) => `\\${ch}`);
}
