import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSpeechResponse } from "./speech";

describe("buildSpeechResponse", () => {
  it("does not invent content", () => {
    assert.equal(buildSpeechResponse(""), "");
  });
  it("truncates long prose without a second model", () => {
    const long = "Word. ".repeat(200);
    const out = buildSpeechResponse(long, { maxChars: 120 });
    assert.ok(out.length <= 130);
  });
  it("keeps short personality-bearing confirmations intact", () => {
    assert.equal(buildSpeechResponse("Done."), "Done.");
    assert.equal(
      buildSpeechResponse("Yes. Production is healthy."),
      "Yes. Production is healthy.",
    );
  });
});
