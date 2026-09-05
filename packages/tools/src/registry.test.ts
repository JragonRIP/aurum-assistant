import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  ToolRegistry,
  evaluatePermission,
  executeToolCall,
  createDefaultRegistry,
  createGetCurrentTimeTool,
  createConfirmEchoTool,
  createInMemoryDataAccess,
  isPathInsideAllowed,
  MAX_TOOL_ROUNDS,
  MAX_TOOL_CALLS_PER_REQUEST,
  type ToolExecutionContext,
  type TaskRecord,
  type NoteRecord,
} from "./index";

function makeCtx(
  overrides?: Partial<ToolExecutionContext>,
): ToolExecutionContext {
  const data = createInMemoryDataAccess("user-1");
  return {
    userId: "user-1",
    timezone: "America/Chicago",
    now: new Date("2026-09-04T15:00:00.000Z"),
    data,
    ...overrides,
  };
}

describe("evaluatePermission", () => {
  it("allows READ and SAFE_WRITE for immediate execution", () => {
    assert.deepEqual(evaluatePermission("READ"), {
      allowed: true,
      mode: "execute",
    });
    assert.deepEqual(evaluatePermission("SAFE_WRITE"), {
      allowed: true,
      mode: "execute",
    });
  });

  it("requires confirm for CONFIRM", () => {
    assert.deepEqual(evaluatePermission("CONFIRM"), {
      allowed: true,
      mode: "confirm",
    });
  });

  it("blocks RESTRICTED", () => {
    const d = evaluatePermission("RESTRICTED");
    assert.equal(d.allowed, false);
  });
});

describe("isPathInsideAllowed", () => {
  it("allows paths inside approved directories", () => {
    assert.equal(
      isPathInsideAllowed("C:\\Users\\me\\Docs\\a.txt", ["C:\\Users\\me\\Docs"]),
      true,
    );
  });

  it("blocks traversal escapes", () => {
    assert.equal(
      isPathInsideAllowed("C:\\Users\\me\\Docs\\..\\Secrets\\x", [
        "C:\\Users\\me\\Docs",
      ]),
      false,
    );
  });

  it("blocks System32 and other system paths", () => {
    assert.equal(
      isPathInsideAllowed("C:\\Windows\\System32\\cmd.exe", [
        "C:\\Users\\me\\Docs",
      ]),
      false,
    );
  });

  it("blocks UNC paths", () => {
    assert.equal(
      isPathInsideAllowed("\\\\server\\share\\file", ["C:\\Users\\me\\Docs"]),
      false,
    );
  });
});

describe("ToolRegistry", () => {
  it("finds registered tools and rejects unknown", async () => {
    const registry = new ToolRegistry();
    registry.register(createGetCurrentTimeTool());
    assert.ok(registry.get("get_current_time"));
    const result = await executeToolCall({
      registry,
      toolName: "nope",
      rawArgs: {},
      executionId: "e1",
      ctx: makeCtx(),
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "UNKNOWN_TOOL");
  });

  it("rejects duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(createGetCurrentTimeTool());
    assert.throws(() => registry.register(createGetCurrentTimeTool()));
  });

  it("rejects disabled tools", async () => {
    const registry = new ToolRegistry();
    const tool = createGetCurrentTimeTool();
    tool.enabled = false;
    registry.register(tool);
    const result = await executeToolCall({
      registry,
      toolName: "get_current_time",
      rawArgs: {},
      executionId: "e-dis",
      ctx: makeCtx(),
    });
    assert.equal(result.error?.code, "DISABLED_TOOL");
  });

  it("exposes Gemini declarations without userId", () => {
    const registry = createDefaultRegistry();
    const decls = registry.toGeminiFunctionDeclarations();
    assert.ok(decls.some((d) => d.name === "create_task"));
    for (const d of decls) {
      const props = (d.parameters.properties ?? {}) as Record<string, unknown>;
      assert.equal("userId" in props, false);
      assert.equal("user_id" in props, false);
    }
  });
});

describe("validation + permissions", () => {
  it("rejects malformed create_task args", async () => {
    const registry = createDefaultRegistry();
    const result = await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "" },
      executionId: "bad-1",
      ctx: makeCtx(),
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "VALIDATION_ERROR");
  });

  it("CONFIRM returns approval required without executing", async () => {
    const registry = new ToolRegistry();
    registry.register(createConfirmEchoTool());
    const events: string[] = [];
    const result = await executeToolCall({
      registry,
      toolName: "confirm_echo",
      rawArgs: { message: "hi" },
      executionId: "conf-1",
      ctx: makeCtx(),
      hooks: { onEvent: (e) => events.push(e.type) },
    });
    assert.equal(result.requiresApproval, true);
    assert.equal(result.error?.code, "APPROVAL_REQUIRED");
    assert.ok(events.includes("approval_required"));
  });

  it("model cannot inject userId into handler via unexpected fields", async () => {
    const registry = createDefaultRegistry();
    const tasks: TaskRecord[] = [];
    const ctx = makeCtx({
      data: {
        ...createInMemoryDataAccess("user-1"),
        tasks: {
          async create(input) {
            const row: TaskRecord = {
              id: `t-${tasks.length + 1}`,
              title: input.title,
              description: input.description ?? null,
              status: "TODO",
              priority: input.priority ?? "NORMAL",
              due_date: input.due_date ?? null,
              due_time: input.due_time ?? null,
              completed_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            tasks.push(row);
            return row;
          },
          async list() {
            return tasks;
          },
          async getById(id) {
            return tasks.find((t) => t.id === id) ?? null;
          },
          async update(id, patch) {
            const t = tasks.find((x) => x.id === id)!;
            Object.assign(t, patch, { updated_at: new Date().toISOString() });
            return t;
          },
        },
      },
    });
    const result = await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: {
        title: "Call Mike",
        userId: "attacker",
        user_id: "attacker",
      },
      executionId: "own-1",
      ctx,
    });
    assert.equal(result.success, true);
    assert.equal(tasks.length, 1);
  });
});

describe("task + note tools with memory store", () => {
  function richCtx() {
    const tasks: TaskRecord[] = [];
    const notes: NoteRecord[] = [];
    const base = createInMemoryDataAccess("user-1");
    return makeCtx({
      data: {
        ...base,
        tasks: {
          async create(input) {
            const row: TaskRecord = {
              id: crypto.randomUUID(),
              title: input.title,
              description: input.description ?? null,
              status: "TODO",
              priority: input.priority ?? "NORMAL",
              due_date: input.due_date ?? null,
              due_time: input.due_time ?? null,
              completed_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            tasks.push(row);
            return row;
          },
          async list(filter) {
            let rows = [...tasks];
            if (filter.status) {
              const set = new Set(
                Array.isArray(filter.status) ? filter.status : [filter.status],
              );
              rows = rows.filter((t) => set.has(t.status));
            }
            if (filter.query) {
              const q = filter.query.toLowerCase();
              rows = rows.filter((t) => t.title.toLowerCase().includes(q));
            }
            return rows.slice(0, filter.limit ?? 25);
          },
          async getById(id) {
            return tasks.find((t) => t.id === id) ?? null;
          },
          async update(id, patch) {
            const t = tasks.find((x) => x.id === id);
            if (!t) throw new Error("missing");
            Object.assign(t, patch, { updated_at: new Date().toISOString() });
            return t;
          },
        },
        notes: {
          async create(input) {
            const row: NoteRecord = {
              id: crypto.randomUUID(),
              title: input.title ?? null,
              content: input.content,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            notes.push(row);
            return row;
          },
          async search(input) {
            const q = input.query.toLowerCase();
            return notes
              .filter(
                (n) =>
                  n.content.toLowerCase().includes(q) ||
                  (n.title ?? "").toLowerCase().includes(q),
              )
              .slice(0, input.limit ?? 10);
          },
          async getById(id) {
            return notes.find((n) => n.id === id) ?? null;
          },
        },
      },
    });
  }

  it("create_task + get_tasks + complete_task", async () => {
    const registry = createDefaultRegistry();
    const ctx = richCtx();
    const created = await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "Call Darnell", due_date: "2026-09-05" },
      executionId: "c1",
      ctx,
    });
    assert.equal(created.success, true);
    const listed = await executeToolCall({
      registry,
      toolName: "get_tasks",
      rawArgs: {},
      executionId: "g1",
      ctx,
    });
    assert.equal(listed.success, true);
    const taskId = (created.data as { task: { id: string } }).task.id;
    const done = await executeToolCall({
      registry,
      toolName: "complete_task",
      rawArgs: { task_id: taskId },
      executionId: "d1",
      ctx,
    });
    assert.equal(done.success, true);
  });

  it("ambiguous complete_task does not guess", async () => {
    const registry = createDefaultRegistry();
    const ctx = richCtx();
    await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "Call Mike about roofing" },
      executionId: "a1",
      ctx,
    });
    await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "Call Mike about invoice" },
      executionId: "a2",
      ctx,
    });
    const result = await executeToolCall({
      registry,
      toolName: "complete_task",
      rawArgs: { query: "Mike" },
      executionId: "a3",
      ctx,
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "AMBIGUOUS_MATCH");
  });

  it("create_note + search_notes", async () => {
    const registry = createDefaultRegistry();
    const ctx = richCtx();
    await executeToolCall({
      registry,
      toolName: "create_note",
      rawArgs: { content: "Darnell prefers morning calls." },
      executionId: "n1",
      ctx,
    });
    const found = await executeToolCall({
      registry,
      toolName: "search_notes",
      rawArgs: { query: "Darnell" },
      executionId: "n2",
      ctx,
    });
    assert.equal(found.success, true);
    assert.equal((found.data as { count: number }).count, 1);
  });

  it("idempotent replay does not duplicate create_task", async () => {
    const registry = createDefaultRegistry();
    const ctx = richCtx();
    const first = await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "Unique idempotent" },
      executionId: "idem-1",
      ctx,
    });
    assert.equal(first.success, true);
    const second = await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "Unique idempotent" },
      executionId: "idem-1",
      ctx,
    });
    assert.equal(second.success, true);
    assert.equal(second.metadata?.replay, true);
    const listed = await executeToolCall({
      registry,
      toolName: "get_tasks",
      rawArgs: { query: "Unique idempotent" },
      executionId: "idem-list",
      ctx,
    });
    assert.equal((listed.data as { count: number }).count, 1);
  });

  it("intentional separate identical requests can create two records", async () => {
    const registry = createDefaultRegistry();
    const ctx = richCtx();
    await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "Buy milk" },
      executionId: "sep-1",
      ctx,
    });
    await executeToolCall({
      registry,
      toolName: "create_task",
      rawArgs: { title: "Buy milk" },
      executionId: "sep-2",
      ctx,
    });
    const listed = await executeToolCall({
      registry,
      toolName: "get_tasks",
      rawArgs: { query: "Buy milk" },
      executionId: "sep-list",
      ctx,
    });
    assert.equal((listed.data as { count: number }).count, 2);
  });
});

describe("loop limits", () => {
  it("exports positive safety limits", () => {
    assert.ok(MAX_TOOL_ROUNDS >= 3);
    assert.ok(MAX_TOOL_CALLS_PER_REQUEST >= MAX_TOOL_ROUNDS);
  });
});

describe("RESTRICTED never executes", () => {
  it("blocks restricted tools", async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: "danger",
      name: "Danger",
      description: "no",
      inputSchema: z.object({}),
      permission: "RESTRICTED",
      environment: "CLOUD",
      activityLabel: "Blocked",
      async handler() {
        return { success: true };
      },
    });
    const result = await executeToolCall({
      registry,
      toolName: "danger",
      rawArgs: {},
      executionId: "r1",
      ctx: makeCtx(),
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "PERMISSION_DENIED");
  });
});
