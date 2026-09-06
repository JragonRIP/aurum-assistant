import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultPhaseActivity,
  resolveWorkingActivity,
  resolveWorkingHeadline,
  shouldShowIdlePrompt,
  synthesizeWorkingPhase,
} from "./working-activity";

describe("idle vs working prompt", () => {
  it("IDLE shows idle prompt", () => {
    assert.equal(
      shouldShowIdlePrompt({
        streaming: false,
        acting: false,
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
      }),
      true,
    );
  });

  it("THINKING / ACTING hide idle prompt", () => {
    assert.equal(
      shouldShowIdlePrompt({
        streaming: true,
        acting: false,
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
      }),
      false,
    );
    assert.equal(
      shouldShowIdlePrompt({
        streaming: false,
        acting: true,
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
      }),
      false,
    );
  });

  it("WAITING states hide idle prompt", () => {
    assert.equal(
      shouldShowIdlePrompt({
        streaming: false,
        acting: false,
        awaitingApproval: true,
        awaitingUser: false,
        error: false,
      }),
      false,
    );
    assert.equal(
      shouldShowIdlePrompt({
        streaming: false,
        acting: false,
        awaitingApproval: false,
        awaitingUser: true,
        error: false,
      }),
      false,
    );
  });
});

describe("tool activity mapping", () => {
  it("maps web_search and web_read_page", () => {
    assert.equal(
      resolveWorkingActivity({ tool: "web_search" }),
      "Searching the web...",
    );
    assert.equal(
      resolveWorkingActivity({ tool: "web_read_page" }),
      "Reading sources...",
    );
  });

  it("maps Spotify and Windows actions", () => {
    assert.equal(
      resolveWorkingActivity({ tool: "spotify_play_track" }),
      "Starting playback...",
    );
    assert.equal(
      resolveWorkingActivity({ tool: "spotify_next" }),
      "Skipping track...",
    );
    assert.equal(
      resolveWorkingActivity({ tool: "open_application" }),
      "Opening app...",
    );
    assert.equal(
      resolveWorkingActivity({ tool: "set_system_volume" }),
      "Changing volume...",
    );
  });

  it("unknown tool uses Working on that...", () => {
    assert.equal(
      resolveWorkingActivity({ tool: "totally_unknown_capability" }),
      "Working on that...",
    );
  });

  it("rejects unsafe display labels that look like internals", () => {
    assert.equal(
      resolveWorkingActivity({
        tool: null,
        displayLabel: '{"executionId":"abc","args":{}}',
      }),
      "Working on that...",
    );
  });
});

describe("headlines and phases", () => {
  it("researching / thinking / approval headlines", () => {
    assert.equal(
      resolveWorkingHeadline({
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
        researching: true,
        acting: false,
        streaming: true,
        hasReply: false,
      }),
      "RESEARCHING",
    );
    assert.equal(
      resolveWorkingHeadline({
        awaitingApproval: true,
        awaitingUser: false,
        error: false,
        researching: false,
        acting: false,
        streaming: false,
        hasReply: false,
      }),
      "WAITING FOR APPROVAL",
    );
    assert.equal(
      resolveWorkingHeadline({
        awaitingApproval: false,
        awaitingUser: true,
        error: false,
        researching: false,
        acting: false,
        streaming: false,
        hasReply: true,
      }),
      "NEED YOUR INPUT",
    );
  });

  it("clears activity when responding", () => {
    assert.equal(defaultPhaseActivity("responding"), null);
    assert.equal(defaultPhaseActivity("thinking"), "Looking into that...");
    assert.equal(
      synthesizeWorkingPhase({
        awaitingApproval: false,
        awaitingUser: false,
        error: false,
        researching: false,
        acting: false,
        streaming: true,
        hasReply: true,
      }),
      "responding",
    );
  });
});
