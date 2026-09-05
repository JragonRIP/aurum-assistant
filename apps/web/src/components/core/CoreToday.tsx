"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { taskHref } from "@aurum/shared";
import type { UiTask } from "@/lib/tasks/queries";
import { TASKS_CHANGED_EVENT } from "@/lib/tasks/list-state";

type TodayPayload = {
  today: string;
  overdue: UiTask[];
  dueToday: UiTask[];
  upcoming: UiTask[];
};

export function CoreToday() {
  const [data, setData] = useState<TodayPayload | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?scope=today");
      if (!res.ok) return;
      const payload = (await res.json()) as TodayPayload;
      setData(payload);
    } catch {
      /* keep previous */
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChange);
  }, [load]);

  const overdue = data?.overdue ?? [];
  const dueToday = data?.dueToday ?? [];
  const upcoming = data?.upcoming ?? [];
  const next = [...overdue, ...dueToday, ...upcoming].slice(0, 4);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
          {next.length > 0 ? "Up next" : "Today"}
        </h2>
        <Link
          href="/today"
          className="aurum-focus-ring text-[12px] text-[var(--aurum-text-dim)] hover:text-[var(--aurum-text-muted)]"
        >
          View today
        </Link>
      </div>
      {next.length === 0 ? (
        <p className="text-[15px] text-[var(--aurum-text-muted)]">
          Nothing needs your attention.
        </p>
      ) : (
        <ul>
          {next.map((task) => {
            const href = taskHref(task.id);
            return (
              <li
                key={task.id}
                className="border-b border-[var(--aurum-border)] py-3 last:border-0"
              >
                {href ? (
                  <Link
                    href={href}
                    className="aurum-focus-ring block rounded-sm"
                  >
                    <div className="text-[12px] text-[var(--aurum-text-dim)]">
                      {task.due_label ?? "Open"}
                    </div>
                    <div className="mt-0.5 text-[15px] text-[var(--aurum-text)]">
                      {task.title}
                    </div>
                  </Link>
                ) : (
                  <div>
                    <div className="text-[12px] text-[var(--aurum-text-dim)]">
                      {task.due_label ?? "Open"}
                    </div>
                    <div className="mt-0.5 text-[15px] text-[var(--aurum-text)]">
                      {task.title}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
