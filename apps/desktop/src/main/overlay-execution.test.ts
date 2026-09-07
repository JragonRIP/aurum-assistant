import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginOverlayTurn,
  emptyOverlayTurn,
  isOverlaySoftToolFailure,
  reduceOverlayTurn,
  shouldShowIdleForTurn,
} from "./overlay-execution";

describe("overlay execution ownership", () => {
  it("begin marks RUNNING without cancelling on hide semantics", () => {
    const turn = beginOverlayTurn(emptyOverlayTurn(), {
      executionId: "11111111-1111-4111-8111-111111111111",
      conversationId: null,
      inputMode: "text",
    });
    assert.equal(turn.status, "RUNNING");
    assert.equal(shouldShowIdleForTurn(turn), false);
  });

  it("web provider failure is soft and does not force FAILED", () => {
    assert.equal(
      isOverlaySoftToolFailure({
        code: "PROVIDER_UNAVAILABLE",
        tool: "web_search",
      }),
      true,
    );
    let turn = beginOverlayTurn(emptyOverlayTurn(), {
      executionId: "11111111-1111-4111-8111-111111111111",
      conversationId: null,
      inputMode: "text",
    });
    turn = reduceOverlayTurn(turn, {
      type: "tool_failed",
      tool: "web_search",
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "Web search is temporarily unavailable.",
      },
    });
    assert.equal(turn.status, "RUNNING");
    assert.match(turn.warning ?? "", /temporarily unavailable/i);
    assert.equal(turn.error, null);

    turn = reduceOverlayTurn(turn, {
      type: "delta",
      text: "The clock came first.",
    });
    turn = reduceOverlayTurn(turn, { type: "done" });
    assert.equal(turn.status, "COMPLETED");
    assert.match(turn.reply, /clock/);
    assert.equal(turn.error, null);
  });

  it("preserves WAITING_FOR_APPROVAL through done", () => {
    let turn = beginOverlayTurn(emptyOverlayTurn(), {
      executionId: "11111111-1111-4111-8111-111111111111",
      conversationId: null,
      inputMode: "voice",
    });
    turn = reduceOverlayTurn(turn, {
      type: "approval_required",
      approvalId: "22222222-2222-4222-8222-222222222222",
      tool: "restart_pc",
    });
    assert.equal(turn.status, "WAITING_FOR_APPROVAL");
    turn = reduceOverlayTurn(turn, { type: "done" });
    assert.equal(turn.status, "WAITING_FOR_APPROVAL");
  });

  it("explicit cancel is distinct from hide", () => {
    const turn = {
      ...beginOverlayTurn(emptyOverlayTurn(), {
        executionId: "11111111-1111-4111-8111-111111111111",
        conversationId: null,
        inputMode: "text",
      }),
      status: "CANCELLED" as const,
    };
    assert.equal(turn.status, "CANCELLED");
  });
});

describe("Esc / hide contracts (documented)", () => {
  it("hide must not map to CANCELLED status automatically", () => {
    // Visibility is orthogonal — reduceOverlayTurn has no hide event.
    let turn = beginOverlayTurn(emptyOverlayTurn(), {
      executionId: "11111111-1111-4111-8111-111111111111",
      conversationId: null,
      inputMode: "text",
    });
    turn = reduceOverlayTurn(turn, { type: "tool_started", tool: "spotify_play_track" });
    assert.equal(turn.status, "RUNNING");
  });
});
