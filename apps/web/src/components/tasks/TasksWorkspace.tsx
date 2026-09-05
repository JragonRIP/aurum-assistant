"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NativeError, ObjectList, ObjectSection } from "@aurum/ui";
import { classifyTaskForToday, localDateString, taskHref } from "@aurum/shared";
import type { UiTask } from "@/lib/tasks/queries";
import {
  applyTaskListFetch,
  TASKS_CHANGED_EVENT,
} from "@/lib/tasks/list-state";

function toItem(task: UiTask) {
  const href = taskHref(task.id) ?? undefined;
  const bits = [
    task.due_label,
    task.priority && task.priority !== "NORMAL"
      ? task.priority === "HIGH"
        ? "High"
        : task.priority
      : null,
  ].filter(Boolean);
  return {
    id: task.id,
    title: task.title,
    meta: bits.join(" · ") || undefined,
    href,
  };
}

export function TasksWorkspace() {
  const [openTasks, setOpenTasks] = useState<UiTask[]>([]);
  const [completed, setCompleted] = useState<UiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [openRes, doneRes] = await Promise.all([
        fetch("/api/tasks?scope=open"),
        fetch("/api/tasks?scope=completed"),
      ]);

      if (!openRes.ok) {
        const body = (await openRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Tasks couldn't be loaded.");
      }
      if (!doneRes.ok) {
        const body = (await doneRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Tasks couldn't be loaded.");
      }

      const openData = (await openRes.json()) as { tasks: UiTask[] };
      const doneData = (await doneRes.json()) as { tasks: UiTask[] };

      setOpenTasks(openData.tasks);
      setCompleted(doneData.tasks);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Tasks couldn't be loaded.";
      setOpenTasks((previous) =>
        applyTaskListFetch({
          previous,
          result: { ok: false, error: message },
        }).tasks,
      );
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener(TASKS_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [load]);

  const today = localDateString(new Date());
  const groups = useMemo(() => {
    const dueToday: UiTask[] = [];
    const later: UiTask[] = [];
    const undated: UiTask[] = [];
    for (const task of openTasks) {
      const bucket = classifyTaskForToday({
        dueDate: task.due_date,
        status: task.status,
        today,
      });
      if (bucket === "overdue" || bucket === "today") dueToday.push(task);
      else if (bucket === "upcoming") later.push(task);
      else undated.push(task);
    }
    return { dueToday, later, undated };
  }, [openTasks, today]);

  return (
    <div className="flex flex-col gap-12">
      {error ? <NativeError title={error} onRetry={() => void load()} /> : null}

      {loading && openTasks.length === 0 && !error ? (
        <p className="text-[13px] text-[var(--aurum-text-dim)]">Loading…</p>
      ) : null}

      <ObjectSection label="Today" count={groups.dueToday.length}>
        <ObjectList
          items={groups.dueToday.map(toItem)}
          empty="Nothing due today."
        />
      </ObjectSection>

      {groups.later.length > 0 ? (
        <ObjectSection label="Upcoming" count={groups.later.length}>
          <ObjectList items={groups.later.map(toItem)} />
        </ObjectSection>
      ) : null}

      {groups.undated.length > 0 ? (
        <ObjectSection label="Open" count={groups.undated.length}>
          <ObjectList items={groups.undated.map(toItem)} />
        </ObjectSection>
      ) : null}

      {openTasks.length === 0 && !loading ? (
        <p className="text-[15px] text-[var(--aurum-text-muted)]">
          No open tasks.
        </p>
      ) : null}

      <ObjectSection label="Completed" count={completed.length}>
        <ObjectList
          items={completed.slice(0, 12).map(toItem)}
          empty="Finished work will appear here."
        />
      </ObjectSection>
    </div>
  );
}
