import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldShowIdlePrompt, resolveWorkingHeadline } from "./working-activity";

describe("voice working UI", () => {
  it("hides idle prompt while listening", () => {
    assert.equal(
      shouldShowIdlePrompt({
        streaming: false,
        acting: false,
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
        listening: true,
      }),
      false,
    );
  });

  it("shows LISTENING / TRANSCRIBING / SPEAKING headlines", () => {
    assert.equal(
      resolveWorkingHeadline({
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
        researching: false,
        acting: false,
        streaming: false,
        hasReply: false,
        listening: true,
      }),
      "LISTENING",
    );
    assert.equal(
      resolveWorkingHeadline({
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
        researching: false,
        acting: false,
        streaming: false,
        hasReply: false,
        transcribing: true,
      }),
      "TRANSCRIBING",
    );
    assert.equal(
      resolveWorkingHeadline({
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
        researching: false,
        acting: false,
        streaming: false,
        hasReply: true,
        speaking: true,
      }),
      "SPEAKING",
    );
  });
});
