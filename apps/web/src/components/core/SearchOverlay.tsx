"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { conversationHref, noteHref, taskHref } from "@aurum/shared";
import { useAurum } from "./AurumProvider";
import type { UiTask } from "@/lib/tasks/queries";

type NoteHit = {
  id: string;
  title: string | null;
  content: string;
};

type Grouped = {
  tasks: Array<{ id: string; title: string; href: string; meta?: string }>;
  notes: Array<{ id: string; title: string; href: string; meta?: string }>;
  sessions: Array<{ id: string; title: string; href: string; meta?: string }>;
};

export function SearchOverlay() {
  const aurum = useAurum();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<UiTask[]>([]);
  const [notes, setNotes] = useState<NoteHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aurum.searchOpen) return;
    let cancelled = false;

    async function load() {
      try {
        const [taskRes, noteRes] = await Promise.all([
          fetch("/api/tasks?scope=all"),
          fetch("/api/notes"),
        ]);
        if (cancelled) return;
        if (taskRes.ok) {
          const data = (await taskRes.json()) as { tasks: UiTask[] };
          setTasks(data.tasks ?? []);
        }
        if (noteRes.ok) {
          const data = (await noteRes.json()) as { notes: NoteHit[] };
          setNotes(data.notes ?? []);
        }
        setError(null);
      } catch {
        if (!cancelled) setError("Search couldn't load everything.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [aurum.searchOpen]);

  useEffect(() => {
    if (!aurum.searchOpen) {
      setQuery("");
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        aurum.setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aurum.searchOpen, aurum.setSearchOpen]);

  const grouped = useMemo((): Grouped => {
    const q = query.trim().toLowerCase();
    const match = (text: string) =>
      !q || text.toLowerCase().includes(q);

    const taskHits = tasks
      .filter((t) => match(t.title) || match(t.description ?? ""))
      .slice(0, 8)
      .flatMap((t) => {
        const href = taskHref(t.id);
        if (!href) return [];
        return [
          {
            id: t.id,
            title: t.title,
            href,
            meta: t.due_label ?? t.status,
          },
        ];
      });

    const noteHits = notes
      .filter((n) => match(n.title ?? "") || match(n.content))
      .slice(0, 8)
      .flatMap((n) => {
        const href = noteHref(n.id);
        if (!href) return [];
        return [
          {
            id: n.id,
            title: n.title?.trim() || n.content.slice(0, 48) || "Note",
            href,
            meta: "Note",
          },
        ];
      });

    const sessionHits = aurum.conversations
      .filter((c) => match(c.title || "untitled"))
      .slice(0, 8)
      .flatMap((c) => {
        const href = conversationHref(c.id);
        if (!href) return [];
        return [
          {
            id: c.id,
            title: c.title || "Untitled session",
            href,
            meta: "Session",
          },
        ];
      });

    return { tasks: taskHits, notes: noteHits, sessions: sessionHits };
  }, [query, tasks, notes, aurum.conversations]);

  if (!aurum.searchOpen) return null;

  function openHref(href: string) {
    aurum.setSearchOpen(false);
    router.push(href);
  }

  const empty =
    grouped.tasks.length + grouped.notes.length + grouped.sessions.length === 0;

  return (
    <div className="fixed inset-0 z-[55]">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        aria-label="Close search"
        onClick={() => aurum.setSearchOpen(false)}
      />
      <div className="aurum-drawer absolute left-1/2 top-[12vh] w-[min(520px,calc(100%-2rem))] -translate-x-1/2 border border-[var(--aurum-border)] bg-[var(--aurum-bg)] px-6 py-5 shadow-[var(--aurum-shadow-overlay)]">
        <div className="text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
          Search
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tasks, notes, sessions"
          className="mt-3 w-full border-b border-[var(--aurum-border)] bg-transparent py-2 text-[16px] text-[var(--aurum-text)] outline-none placeholder:text-[var(--aurum-text-dim)]"
          aria-label="Search Aurum"
        />
        {error ? (
          <p className="mt-3 text-[13px] text-[var(--aurum-text-muted)]">
            {error}
          </p>
        ) : null}
        <div className="mt-6 max-h-[50vh] space-y-6 overflow-y-auto">
          {empty ? (
            <p className="text-[14px] text-[var(--aurum-text-muted)]">
              {query.trim()
                ? "Nothing matched."
                : "Type to search tasks, notes, and sessions."}
            </p>
          ) : (
            <>
              <ResultGroup
                label="Tasks"
                items={grouped.tasks}
                onOpen={openHref}
              />
              <ResultGroup
                label="Notes"
                items={grouped.notes}
                onOpen={openHref}
              />
              <ResultGroup
                label="Sessions"
                items={grouped.sessions}
                onOpen={openHref}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultGroup({
  label,
  items,
  onOpen,
}: {
  label: string;
  items: Array<{ id: string; title: string; href: string; meta?: string }>;
  onOpen: (href: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
        {label}
      </h2>
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="border-b border-[var(--aurum-border)] last:border-0"
          >
            <button
              type="button"
              onClick={() => onOpen(item.href)}
              className="aurum-focus-ring flex w-full items-baseline justify-between gap-4 py-3 text-left"
            >
              <span className="text-[14px] text-[var(--aurum-text)]">
                {item.title}
              </span>
              {item.meta ? (
                <span className="text-[12px] text-[var(--aurum-text-dim)]">
                  {item.meta}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
