"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NativeError, ObjectList } from "@aurum/ui";
import { taskHref } from "@aurum/shared";
import type { UiTask } from "@/lib/tasks/queries";
import { TASKS_CHANGED_EVENT } from "@/lib/tasks/list-state";

type TodayPayload = {
  today: string;
  overdue: UiTask[];
  dueToday: UiTask[];
  upcoming: UiTask[];
};

function toItems(tasks: UiTask[]) {
  return tasks.flatMap((t) => {
    const href = taskHref(t.id);
    if (!href) return [];
    return [
      {
        id: t.id,
        title: t.title,
        meta: t.due_label ?? undefined,
        href,
      },
    ];
  });
}

export function TodayWorkspace() {
  const [data, setData] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks?scope=today");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Today couldn't be loaded.");
      }
      const payload = (await res.json()) as TodayPayload;
      setData(payload);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Today couldn't be loaded.",
      );
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

  const overdue = data?.overdue ?? [];
  const dueToday = data?.dueToday ?? [];
  const upcoming = data?.upcoming ?? [];
  const hasAny = overdue.length + dueToday.length + upcoming.length > 0;

  return (
    <div className="flex flex-col gap-12">
      {error ? <NativeError title={error} onRetry={() => void load()} /> : null}

      {loading && !data && !error ? (
        <p className="text-[13px] text-[var(--aurum-text-dim)]">Loading…</p>
      ) : null}

      {!error || data ? (
        <>
          {!hasAny && data && !loading ? (
            <p className="text-[16px] text-[var(--aurum-text-muted)]">
              Nothing needs your attention right now.
            </p>
          ) : (
            <>
              {overdue.length > 0 ? (
                <section>
                  <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
                    Overdue
                  </h2>
                  <ObjectList items={toItems(overdue)} />
                </section>
              ) : null}

              <section>
                <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
                  Up next
                </h2>
                <ObjectList
                  items={toItems(dueToday)}
                  empty="Nothing due today."
                />
              </section>

              {upcoming.length > 0 ? (
                <section>
                  <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
                    Later
                  </h2>
                  <ObjectList items={toItems(upcoming)} />
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}

      <section>
        <h2 className="mb-2 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
          Calendar
        </h2>
        <p className="text-[15px] text-[var(--aurum-text-muted)]">
          No calendar connected.
        </p>
        <Link
          href="/settings"
          className="aurum-focus-ring mt-2 inline-block text-[14px] text-[var(--aurum-gold)]"
        >
          Connect Google Calendar →
        </Link>
      </section>
    </div>
  );
}
