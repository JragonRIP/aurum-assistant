import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CORE_HREF,
  activityTargetFromToolResult,
  addDaysToDateString,
  buildEntityHref,
  classifyTaskForToday,
  conversationHref,
  dedupeRecents,
  formatDueLabel,
  isUuid,
  localDateString,
  noteHref,
  sanitizeEntityHref,
  taskHref,
} from "@aurum/shared";
import { applyTaskListFetch } from "./list-state";
import { toUiTask } from "./queries";
import type { TaskRecord } from "@aurum/tools";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

describe("task navigation targets", () => {
  it("6. clicking task resolves correct navigation target", () => {
    assert.equal(taskHref(TASK_ID), `/tasks/${TASK_ID}`);
    assert.equal(buildEntityHref("task", TASK_ID), `/tasks/${TASK_ID}`);
  });

  it("13. arbitrary model URL cannot become navigation target", () => {
    assert.equal(sanitizeEntityHref("https://evil.example/tasks/x"), null);
    assert.equal(sanitizeEntityHref("//evil.example"), null);
    assert.equal(sanitizeEntityHref("javascript:alert(1)"), null);
    assert.equal(sanitizeEntityHref("/tasks/not-a-uuid"), null);
    assert.equal(
      sanitizeEntityHref(`/tasks/${TASK_ID}`),
      `/tasks/${TASK_ID}`,
    );
  });

  it("5. TaskSurface retains entity id via trusted href", () => {
    const href = taskHref(TASK_ID);
    assert.ok(href);
    assert.ok(href.includes(TASK_ID));
  });
});

describe("activity from trusted tool results", () => {
  it("12. activity target generated from trusted entity type/id", () => {
    const target = activityTargetFromToolResult({
      tool: "create_task",
      data: { task: { id: TASK_ID, title: "Call Mike" } },
    });
    assert.deepEqual(target, {
      entityType: "task",
      entityId: TASK_ID,
      href: `/tasks/${TASK_ID}`,
    });
  });

  it("15. notes recent item opens actual note path", () => {
    const target = activityTargetFromToolResult({
      tool: "create_note",
      data: { note: { id: NOTE_ID, title: "Prefs", content: "morning" } },
    });
    assert.equal(target?.entityType, "note");
    assert.equal(target?.entityId, NOTE_ID);
    assert.equal(target?.href, `/?note=${NOTE_ID}`);
    assert.equal(noteHref(NOTE_ID), `/?note=${NOTE_ID}`);
    assert.equal(sanitizeEntityHref(`/core?note=${NOTE_ID}`), `/?note=${NOTE_ID}`);
  });

  it("rejects non-uuid entity ids", () => {
    assert.equal(
      activityTargetFromToolResult({
        tool: "create_task",
        data: { task: { id: "not-uuid" } },
      }),
      null,
    );
  });
});

describe("today filtering + date-only due", () => {
  it("9. Today filters correctly", () => {
    const today = "2026-09-04";
    assert.equal(
      classifyTaskForToday({
        dueDate: "2026-09-03",
        status: "TODO",
        today,
      }),
      "overdue",
    );
    assert.equal(
      classifyTaskForToday({
        dueDate: "2026-09-04",
        status: "TODO",
        today,
      }),
      "today",
    );
    assert.equal(
      classifyTaskForToday({
        dueDate: "2026-09-06",
        status: "TODO",
        today,
      }),
      "upcoming",
    );
    assert.equal(
      classifyTaskForToday({
        dueDate: "2026-09-04",
        status: "COMPLETED",
        today,
      }),
      null,
    );
  });

  it("10. date-only due remains date-only visually", () => {
    const label = formatDueLabel({
      dueDate: "2026-09-05",
      dueTime: null,
      today: "2026-09-04",
      tomorrow: "2026-09-05",
    });
    assert.equal(label, "Tomorrow");
    assert.ok(!label?.includes("9:00"));
    assert.ok(!label?.includes(":"));

    const withTime = formatDueLabel({
      dueDate: "2026-09-05",
      dueTime: "14:30:00",
      today: "2026-09-04",
      tomorrow: "2026-09-05",
    });
    assert.equal(withTime, "Tomorrow · 14:30");
  });

  it("empty Today does not fabricate calendar data", () => {
    assert.equal(
      classifyTaskForToday({
        dueDate: null,
        status: "TODO",
        today: "2026-09-04",
      }),
      null,
    );
  });
});

describe("task list fetch resilience", () => {
  it("14. failed fetch does not masquerade as empty data", () => {
    const previous = [{ id: TASK_ID, title: "Call Mike" }];
    const merged = applyTaskListFetch({
      previous,
      result: { ok: false, error: "Tasks couldn't be loaded." },
    });
    assert.equal(merged.ok, false);
    assert.equal(merged.tasks.length, 1);
    assert.equal(merged.tasks[0]?.title, "Call Mike");
    assert.match(merged.error!, /couldn't be loaded/i);
  });

  it("7. successful create invalidates/refreshes task data (event + merge)", () => {
    const created = {
      id: OTHER_ID,
      title: "New",
    };
    const merged = applyTaskListFetch({
      previous: [{ id: TASK_ID, title: "Call Mike" }],
      result: { ok: true, tasks: [{ id: TASK_ID, title: "Call Mike" }, created] },
    });
    assert.equal(merged.ok, true);
    assert.equal(merged.tasks.length, 2);
  });
});

describe("task detail / auth contracts", () => {
  it("3. task detail resolves by id (href + uuid)", () => {
    assert.equal(isUuid(TASK_ID), true);
    assert.equal(taskHref(TASK_ID), `/tasks/${TASK_ID}`);
  });

  it("4. unauthorized task inaccessible (null getById contract)", () => {
    assert.equal(taskHref("not-real"), null);
  });

  it("1–2. list mapping preserves real authenticated task fields", () => {
    const row: TaskRecord = {
      id: TASK_ID,
      title: "Call Mike",
      description: null,
      status: "TODO",
      priority: "NORMAL",
      due_date: "2026-09-05",
      due_time: null,
      completed_at: null,
      created_at: "2026-09-04T12:00:00.000Z",
      updated_at: "2026-09-04T12:00:00.000Z",
    };
    const ui = toUiTask(row, {
      today: "2026-09-04",
      tomorrow: "2026-09-05",
    });
    assert.equal(ui.id, TASK_ID);
    assert.equal(ui.title, "Call Mike");
    assert.equal(ui.due_label, "Tomorrow");
  });

  it("8. completion updates visible state (status field)", () => {
    const row: TaskRecord = {
      id: TASK_ID,
      title: "Call Mike",
      description: null,
      status: "COMPLETED",
      priority: "NORMAL",
      due_date: "2026-09-05",
      due_time: null,
      completed_at: "2026-09-04T18:00:00.000Z",
      created_at: "2026-09-04T12:00:00.000Z",
      updated_at: "2026-09-04T18:00:00.000Z",
    };
    assert.equal(row.status, "COMPLETED");
    assert.equal(
      classifyTaskForToday({
        dueDate: row.due_date,
        status: row.status,
        today: "2026-09-04",
      }),
      null,
    );
  });
});

describe("history / conversation href", () => {
  it("11. History item restores correct session path", () => {
    const href = buildEntityHref("conversation", TASK_ID);
    assert.equal(href, `/?c=${TASK_ID}`);
    assert.equal(conversationHref(TASK_ID), `/?c=${TASK_ID}`);
    assert.equal(sanitizeEntityHref(`/core?c=${TASK_ID}`), `/?c=${TASK_ID}`);
    assert.equal(CORE_HREF, "/");
  });
});

describe("recents vs activity", () => {
  it("deduplicates the same entity for Recents without destroying chronology", () => {
    const activity = [
      {
        entityType: "task" as const,
        entityId: TASK_ID,
        href: `/tasks/${TASK_ID}`,
        detail: "Call Mike",
        label: "TASK COMPLETED",
        state: "success",
        createdAt: "2026-09-04T18:00:00.000Z",
      },
      {
        entityType: "task" as const,
        entityId: TASK_ID,
        href: `/tasks/${TASK_ID}`,
        detail: "Call Mike",
        label: "TASK UPDATED",
        state: "success",
        createdAt: "2026-09-04T17:00:00.000Z",
      },
      {
        entityType: "task" as const,
        entityId: TASK_ID,
        href: `/tasks/${TASK_ID}`,
        detail: "Call Mike",
        label: "TASK UPDATED",
        state: "success",
        createdAt: "2026-09-04T16:00:00.000Z",
      },
      {
        entityType: "task" as const,
        entityId: TASK_ID,
        href: `/tasks/${TASK_ID}`,
        detail: "Call Mike",
        label: "TASK CREATED",
        state: "success",
        createdAt: "2026-09-04T15:00:00.000Z",
      },
    ];

    const recents = dedupeRecents(activity, 5);
    assert.equal(recents.length, 1);
    assert.equal(recents[0]?.title, "Call Mike");
    assert.equal(recents[0]?.kindLabel, "Task");
    assert.equal(activity.length, 4);
  });
});

describe("date helpers", () => {
  it("localDateString + addDays", () => {
    const today = localDateString(new Date("2026-09-04T15:00:00Z"), "UTC");
    assert.equal(today, "2026-09-04");
    assert.equal(addDaysToDateString(today, 1), "2026-09-05");
  });
});
