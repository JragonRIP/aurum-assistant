import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StreamingTextController,
  tokenizeForReveal,
} from "./streaming-text";

describe("tokenizeForReveal", () => {
  it("preserves whitespace with words", () => {
    const tokens = tokenizeForReveal("Hello world. Next");
    assert.deepEqual(tokens, ["Hello", " world.", " Next"]);
  });
});

describe("StreamingTextController", () => {
  it("never reveals text not yet enqueued", async () => {
    const seen: string[] = [];
    const c = new StreamingTextController({
      onReveal: (t) => seen.push(t),
      minWordsPerTick: 1,
      maxWordsPerTick: 1,
    });
    c.enqueue("Alpha beta ");
    // Immediately after enqueue, nothing revealed until tick
    assert.equal(c.getVisible(), "");
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(seen.length >= 1);
    assert.ok(c.getVisible().length > 0);
    assert.ok(c.getReceived().startsWith(c.getVisible()));
    assert.ok(!c.getVisible().includes("gamma"));
    c.enqueue("gamma");
    c.finish();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(c.getVisible(), "Alpha beta gamma");
  });

  it("cancel drops pending queue and keeps visible prefix", async () => {
    const c = new StreamingTextController({
      onReveal: () => {},
      minWordsPerTick: 1,
      maxWordsPerTick: 1,
    });
    c.enqueue("One two three four five six");
    await new Promise((r) => setTimeout(r, 35));
    const visibleBefore = c.getVisible();
    c.cancel();
    assert.equal(c.isCancelled(), true);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(c.getVisible(), visibleBefore);
    assert.equal(c.getReceived(), visibleBefore);
  });

  it("finish drains to full received text", async () => {
    let last = "";
    const c = new StreamingTextController({
      onReveal: (t) => {
        last = t;
      },
    });
    c.enqueue("Your schedule tomorrow has three items.");
    await new Promise<void>((resolve) => {
      c.finish(() => resolve());
    });
    assert.equal(last, "Your schedule tomorrow has three items.");
  });
});

describe("assistant message reconcile by generation id", () => {
  type Msg = { id: string; content: string; generationId?: string };

  function reconcile(
    prev: Msg[],
    localId: string,
    generationId: string,
    server: Msg,
  ): Msg[] {
    const serverMsg = { ...server, generationId };
    const idx = prev.findIndex(
      (m) => m.id === localId || m.generationId === generationId,
    );
    if (idx >= 0) {
      return prev
        .map((m, i) => (i === idx ? serverMsg : m))
        .filter(
          (m, i, arr) =>
            m.generationId !== generationId ||
            arr.findIndex((x) => x.generationId === generationId) === i,
        );
    }
    if (prev.some((m) => m.id === server.id)) return prev;
    return [...prev, serverMsg];
  }

  it("replaces local streaming message instead of appending", () => {
    const generationId = "gen-1";
    const localId = `local-assistant-${generationId}`;
    const prev: Msg[] = [
      { id: "user-1", content: "hi" },
      { id: localId, content: "Hello world", generationId },
    ];
    const next = reconcile(prev, localId, generationId, {
      id: "server-uuid",
      content: "Hello world",
    });
    assert.equal(next.length, 2);
    assert.equal(next[1]?.id, "server-uuid");
    assert.equal(next.filter((m) => m.content === "Hello world").length, 1);
  });

  it("does not create a second copy when server id already present", () => {
    const generationId = "gen-2";
    const localId = `local-assistant-${generationId}`;
    const prev: Msg[] = [
      {
        id: "server-uuid",
        content: "Same",
        generationId,
      },
    ];
    const next = reconcile(prev, localId, generationId, {
      id: "server-uuid",
      content: "Same",
    });
    assert.equal(next.length, 1);
  });
});
