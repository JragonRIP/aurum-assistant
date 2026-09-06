import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  derivePresencePresentation,
  derivePresenceState,
  isClarificationUserMessage,
  presenceShowsError,
  presenceStatusLabel,
} from "@aurum/shared";
import { lerpSpin, presenceSpinTargets } from "@aurum/ui";

describe("presence waiting vs error semantics", () => {
  it("approval required → WAITING_FOR_APPROVAL, not ERROR", () => {
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        awaitingApproval: true,
        error: true,
      }),
      "WAITING_FOR_APPROVAL",
    );
    assert.equal(
      presenceShowsError({
        error: "Tool execution failed.",
        awaitingApproval: true,
      }),
      false,
    );
    assert.equal(
      presenceStatusLabel({
        presentation: derivePresencePresentation({
          state: "WAITING_FOR_APPROVAL",
        }),
      }),
      "WAITING FOR APPROVAL",
    );
  });

  it("clarification → WAITING_FOR_USER, not ERROR", () => {
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        awaitingUser: true,
        error: true,
      }),
      "WAITING_FOR_USER",
    );
    assert.equal(
      presenceShowsError({
        error: "Multiple plausible tracks — ask which artist.",
        awaitingUser: true,
      }),
      false,
    );
    assert.equal(
      presenceStatusLabel({
        presentation: derivePresencePresentation({
          state: "WAITING_FOR_USER",
        }),
      }),
      "NEED YOUR INPUT",
    );
  });

  it("genuine failure → ERROR", () => {
    assert.equal(
      derivePresenceState({
        aiConfigured: true,
        error: true,
      }),
      "ERROR",
    );
    assert.equal(
      presenceShowsError({ error: "Spotify rejected this action." }),
      true,
    );
  });

  it("successful idle after tools → IDLE", () => {
    assert.equal(
      derivePresenceState({ aiConfigured: true }),
      "IDLE",
    );
  });

  it("detects clarification copy", () => {
    assert.equal(
      isClarificationUserMessage(
        "Multiple plausible tracks — ask which artist.",
      ),
      true,
    );
    assert.equal(
      isClarificationUserMessage("Spotify rejected this action."),
      false,
    );
  });
});

describe("continuous Core spin interpolation", () => {
  it("does not remount spin targets abruptly between IDLE and THINKING", () => {
    const idle = presenceSpinTargets("IDLE");
    const thinking = presenceSpinTargets("THINKING", "thinking");
    assert.notEqual(idle.ticks, thinking.ticks);
    const mid = lerpSpin(idle.ticks, thinking.ticks, 280);
    assert.ok(mid > idle.ticks);
    assert.ok(mid < thinking.ticks);
  });

  it("WAITING states keep low continuous speed (no hard pause restart)", () => {
    const hold = presenceSpinTargets("WAITING_FOR_APPROVAL");
    const awaitUser = presenceSpinTargets("WAITING_FOR_USER");
    assert.ok(hold.ticks < 2);
    assert.ok(awaitUser.ticks > hold.ticks);
  });
});
