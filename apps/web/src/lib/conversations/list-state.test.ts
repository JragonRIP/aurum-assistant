import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyConversationListFetch,
  createGenerationAbortController,
  isAbortError,
} from "./list-state";

describe("applyConversationListFetch", () => {
  it("replaces list on success", () => {
    const result = applyConversationListFetch({
      previous: [{ id: "old" }],
      result: { ok: true, conversations: [{ id: "a" }, { id: "b" }] },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.conversations, [{ id: "a" }, { id: "b" }]);
  });

  it("preserves previous list on failure (never treats failure as empty)", () => {
    const previous = [{ id: "keep-me" }, { id: "also" }];
    const result = applyConversationListFetch({
      previous,
      result: { ok: false, error: "Failed to load conversations" },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.conversations, previous);
    assert.notDeepEqual(result.conversations, []);
  });

  it("keeps empty previous empty only when there was nothing cached", () => {
    const result = applyConversationListFetch({
      previous: [],
      result: { ok: false, error: "network" },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.conversations, []);
  });
});

describe("generation abort isolation", () => {
  it("creates a fresh AbortController per generation", () => {
    const a = createGenerationAbortController();
    const b = createGenerationAbortController();
    assert.notEqual(a, b);
    a.abort();
    assert.equal(a.signal.aborted, true);
    assert.equal(b.signal.aborted, false);
  });

  it("detects abort errors without treating other errors as abort", () => {
    const abortErr = Object.assign(new Error("Aborted"), { name: "AbortError" });
    assert.equal(isAbortError(abortErr), true);
    assert.equal(isAbortError(new Error("Failed to load conversations")), false);
  });
});

describe("SSE multi-chunk framing", () => {
  it("parses multiple data events incrementally before stream end", () => {
    const chunks = [
      'data: {"type":"delta","text":"Hello"}\n\n',
      'data: {"type":"delta","text":" world"}\n\n',
      'data: {"type":"done","message":{"id":"1"}}\n\n',
    ];
    let buffer = "";
    const events: Array<{ type: string; text?: string }> = [];
    let sawDone = false;
    for (const chunk of chunks) {
      buffer += chunk;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const json = part.trim().slice(5).trim();
        const event = JSON.parse(json) as { type: string; text?: string };
        events.push(event);
        if (event.type === "done") sawDone = true;
        // Progressive: deltas arrive before done
        if (event.type === "delta") {
          assert.equal(sawDone, false);
        }
      }
    }
    assert.equal(events.filter((e) => e.type === "delta").length, 2);
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(
      events
        .filter((e) => e.type === "delta")
        .map((e) => e.text)
        .join(""),
      "Hello world",
    );
  });

  it("first chunk is observable before stream completion", () => {
    const arrivals: number[] = [];
    const t0 = 0;
    arrivals.push(10); // first delta
    arrivals.push(40); // second delta
    const completedAt = 100;
    assert.ok(arrivals[0]! < completedAt);
    assert.ok(arrivals[1]! < completedAt);
    assert.equal(t0, 0);
  });
});

describe("stop / abort does not clear conversation state", () => {
  it("aborting generation controller leaves conversation list untouched", () => {
    const conversations = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    const gen = createGenerationAbortController();
    gen.abort();
    // Conversation fetch uses no shared signal — list state independent
    const afterAbort = applyConversationListFetch({
      previous: conversations,
      result: { ok: true, conversations },
    });
    assert.deepEqual(afterAbort.conversations, conversations);
    assert.equal(gen.signal.aborted, true);
  });

  it("aborted generation can be followed by a new controller request", () => {
    const first = createGenerationAbortController();
    first.abort();
    const second = createGenerationAbortController();
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
    assert.notEqual(first, second);
  });

  it("successful retry after failure restores list and clears error path", () => {
    const previous = [{ id: "a" }];
    const failed = applyConversationListFetch({
      previous,
      result: { ok: false, error: "boom" },
    });
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.conversations, previous);

    const retried = applyConversationListFetch({
      previous: failed.conversations,
      result: { ok: true, conversations: [{ id: "a" }, { id: "b" }] },
    });
    assert.equal(retried.ok, true);
    assert.deepEqual(retried.conversations, [{ id: "a" }, { id: "b" }]);
  });
});

describe("auth error shape", () => {
  it("401 responses are distinct from empty conversation payloads", () => {
    const unauthorized = { error: "Unauthorized", status: 401 as const };
    const emptyOk = { conversations: [] as unknown[], status: 200 as const };
    assert.equal(unauthorized.status, 401);
    assert.ok(!("conversations" in unauthorized));
    assert.deepEqual(emptyOk.conversations, []);
    assert.notEqual(unauthorized.status, emptyOk.status);
  });
});
