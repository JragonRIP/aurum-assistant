/**
 * Task list fetch resilience — never treat a failed fetch as an empty inbox.
 */

export type TaskListFetchResult<T> =
  | { ok: true; tasks: T[]; error: null }
  | { ok: false; tasks: T[]; error: string };

export function applyTaskListFetch<T>(options: {
  previous: T[];
  result: { ok: true; tasks: T[] } | { ok: false; error: string };
}): TaskListFetchResult<T> {
  if (options.result.ok) {
    return { ok: true, tasks: options.result.tasks, error: null };
  }
  return {
    ok: false,
    error: options.result.error,
    tasks: options.previous,
  };
}

export const TASKS_CHANGED_EVENT = "aurum:tasks-changed";
export const NOTES_CHANGED_EVENT = "aurum:notes-changed";

export function notifyTasksChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
}

export function notifyNotesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_CHANGED_EVENT));
}
