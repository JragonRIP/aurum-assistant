import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationContext,
  deriveConversationTitle,
  getTextModel,
  isDefaultConversationTitle,
  MAX_USER_MESSAGE_CHARS,
} from "./index";

describe("getTextModel", () => {
  it("uses default when override missing", () => {
    assert.equal(getTextModel({}), "gemini-3.6-flash");
  });

  it("honors GEMINI_TEXT_MODEL override", () => {
    assert.equal(
      getTextModel({ GEMINI_TEXT_MODEL: "gemini-3.6-flash" }),
      "gemini-3.6-flash",
    );
  });
});

describe("buildConversationContext", () => {
  it("keeps recent messages within limit", () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg ${i}`,
    }));
    const result = buildConversationContext({ history, limit: 3 });
    assert.equal(result.length, 3);
    assert.equal(result[0]?.content, "msg 2");
  });

  it("drops empty content", () => {
    const result = buildConversationContext({
      history: [
        { role: "user", content: "  " },
        { role: "user", content: "hello" },
      ],
    });
    assert.deepEqual(result, [{ role: "user", content: "hello" }]);
  });
});

describe("deriveConversationTitle", () => {
  it("strips hey aurum and capitalizes", () => {
    const title = deriveConversationTitle(
      "Hey Aurum, I'm testing your new assistant system. What can you do?",
    );
    assert.match(title, /testing/i);
    assert.ok(title.length < 80);
  });

  it("falls back for empty", () => {
    assert.equal(deriveConversationTitle("   "), "New conversation");
  });
});

describe("message limits", () => {
  it("exports a positive max message size", () => {
    assert.ok(MAX_USER_MESSAGE_CHARS > 1000);
  });

  it("detects default titles", () => {
    assert.equal(isDefaultConversationTitle("New conversation"), true);
    assert.equal(isDefaultConversationTitle("Weekend planning"), false);
  });
});
