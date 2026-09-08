import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSpeechResponse,
  speakClockTimes,
} from "./speech";

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
    assert.equal(buildSpeechResponse("Done.", { skipAddress: true }), "Done.");
    assert.equal(
      buildSpeechResponse("Yes. Production is healthy.", { skipAddress: true }),
      "Yes. Production is healthy.",
    );
    assert.equal(buildSpeechResponse("Done."), "Done, sir.");
  });
  it("strips markdown and does not read URLs", () => {
    const out = buildSpeechResponse(
      "See **Aurum launch** at https://example.com/path for details.",
    );
    assert.equal(out.includes("https"), false);
    assert.match(out, /OR-um launch/);
  });
  it("speaks clock times naturally", () => {
    assert.match(speakClockTimes("at 3:30 PM"), /three-thirty/i);
    assert.match(speakClockTimes("at 4:00"), /four o'clock/i);
  });
  it("example meeting + task becomes speakable", () => {
    const out = buildSpeechResponse(
      "Your meeting is at 3:30 PM. I've also updated task **Aurum launch**.",
    );
    assert.match(out, /three-thirty/i);
    assert.match(out, /OR-um launch/);
    assert.equal(out.includes("**"), false);
  });
});
