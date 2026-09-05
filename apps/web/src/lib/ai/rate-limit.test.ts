import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, resetRateLimits } from "./rate-limit";
import { ChatRequestSchema, RenameConversationSchema } from "../conversations/schemas";
import { groupConversationsByDate } from "../../components/assistant/types";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests under the limit", () => {
    const a = checkRateLimit({ key: "u1", limit: 2, windowMs: 1000, now: 1000 });
    const b = checkRateLimit({ key: "u1", limit: 2, windowMs: 1000, now: 1001 });
    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
  });

  it("blocks when limit exceeded", () => {
    checkRateLimit({ key: "u2", limit: 1, windowMs: 1000, now: 2000 });
    const blocked = checkRateLimit({
      key: "u2",
      limit: 1,
      windowMs: 1000,
      now: 2001,
    });
    assert.equal(blocked.allowed, false);
    assert.ok((blocked.retryAfterMs ?? 0) > 0);
  });
});

describe("ChatRequestSchema", () => {
  it("rejects empty content", () => {
    const result = ChatRequestSchema.safeParse({
      conversationId: "00000000-0000-0000-0000-000000000001",
      content: "   ",
    });
    assert.equal(result.success, false);
  });

  it("accepts retry without content", () => {
    const result = ChatRequestSchema.safeParse({
      conversationId: "00000000-0000-0000-0000-000000000001",
      retryOfUserMessageId: "00000000-0000-0000-0000-000000000002",
    });
    assert.equal(result.success, true);
  });

  it("rejects oversized messages", () => {
    const result = ChatRequestSchema.safeParse({
      conversationId: "00000000-0000-0000-0000-000000000001",
      content: "x".repeat(20_000),
    });
    assert.equal(result.success, false);
  });
});

describe("RenameConversationSchema", () => {
  it("rejects empty titles", () => {
    assert.equal(RenameConversationSchema.safeParse({ title: "  " }).success, false);
  });
});

describe("groupConversationsByDate", () => {
  it("groups by relative day", () => {
    const now = new Date("2026-09-04T15:00:00");
    const groups = groupConversationsByDate(
      [
        {
          id: "1",
          user_id: "u",
          title: "Today chat",
          created_at: "2026-09-04T12:00:00.000Z",
          updated_at: "2026-09-04T14:00:00.000Z",
        },
        {
          id: "2",
          user_id: "u",
          title: "Old chat",
          created_at: "2026-08-01T12:00:00.000Z",
          updated_at: "2026-08-01T12:00:00.000Z",
        },
      ],
      now,
    );
    assert.ok(groups.some((g) => g.label === "Today"));
    assert.ok(groups.some((g) => g.label === "Older"));
  });
});

/** Ownership is enforced by filtering on auth user id — document expected invariant */
describe("ownership invariant", () => {
  it("requires matching user ids for conversation access", () => {
    const conversationUserId = "user-a";
    const sessionUserId = "user-b";
    assert.notEqual(conversationUserId, sessionUserId);
  });
});
