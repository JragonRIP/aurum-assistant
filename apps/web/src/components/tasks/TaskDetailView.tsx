"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NativeError } from "@aurum/ui";
import type { UiTask } from "@/lib/tasks/queries";
import { TASKS_CHANGED_EVENT } from "@/lib/tasks/list-state";

export function TaskDetailView({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<UiTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.status === 404) {
        setNotFound(true);
        setTask(null);
        setError(null);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Task couldn't be loaded.");
      }
      const data = (await res.json()) as { task: UiTask };
      setTask(data.task);
      setNotFound(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Task couldn't be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChange);
  }, [load]);

  if (loading && !task) {
    return (
      <p className="text-[13px] text-[var(--aurum-text-dim)]">Loading…</p>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-lg">
        <h2 className="text-[18px] font-medium text-[var(--aurum-text)]">
          Task unavailable
        </h2>
        <p className="mt-2 text-[13px] text-[var(--aurum-text-muted)]">
          This task could not be found, or you don’t have access to it.
        </p>
        <Link
          href="/tasks"
          className="aurum-focus-ring mt-4 inline-block text-[13px] text-[var(--aurum-gold)]"
        >
          ← All tasks
        </Link>
      </div>
    );
  }

  if (error && !task) {
    return <NativeError title={error} onRetry={() => void load()} />;
  }

  if (!task) return null;

  return (
    <article className="aurum-panel-enter max-w-xl py-2">
      <Link
        href="/tasks"
        className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)]"
      >
        Tasks
      </Link>

      <h1
        className="mt-10 text-[32px] leading-tight text-[var(--aurum-text)]"
        style={{ fontFamily: "var(--aurum-font-display)", fontWeight: 500 }}
      >
        {task.title}
      </h1>

      <dl className="mt-10 space-y-5 text-[14px]">
        <Row label="Status" value={humanStatus(task.status)} />
        {task.due_label ? (
          <Row label="Due" value={task.due_label} />
        ) : (
          <Row label="Due" value="No due date" />
        )}
        {task.priority && task.priority !== "NORMAL" ? (
          <Row label="Priority" value={task.priority} />
        ) : null}
        {task.description ? (
          <div>
            <dt className="text-[11px] tracking-[0.12em] uppercase text-[var(--aurum-text-dim)]">
              Notes
            </dt>
            <dd className="mt-1 whitespace-pre-wrap text-[var(--aurum-text-muted)]">
              {task.description}
            </dd>
          </div>
        ) : null}
        <Row
          label="Created"
          value={new Date(task.created_at).toLocaleString()}
        />
        {task.completed_at ? (
          <Row
            label="Completed"
            value={new Date(task.completed_at).toLocaleString()}
          />
        ) : null}
      </dl>

      {error ? (
        <div className="mt-4">
          <NativeError title={error} onRetry={() => void load()} />
        </div>
      ) : null}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-8 border-b border-[var(--aurum-border)] py-3">
      <dt className="w-24 shrink-0 text-[12px] text-[var(--aurum-text-dim)]">
        {label}
      </dt>
      <dd className="text-[var(--aurum-text)]">{value}</dd>
    </div>
  );
}

function humanStatus(status: string): string {
  switch (status) {
    case "TODO":
      return "To do";
    case "IN_PROGRESS":
      return "In progress";
    case "WAITING":
      return "Waiting";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}
