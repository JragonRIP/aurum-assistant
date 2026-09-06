import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalConfirmVerb,
  approvalDetail,
  approvalPrimaryLabel,
} from "./approval-copy";

describe("overlay approval copy", () => {
  it("builds clear titles for power and destructive tools", () => {
    assert.equal(approvalPrimaryLabel("restart_pc"), "Restart this PC?");
    assert.equal(approvalPrimaryLabel("delete_file"), "Delete this file?");
    assert.equal(
      approvalPrimaryLabel("close_application", "Closing Discord"),
      "Closing Discord?",
    );
    assert.equal(
      approvalPrimaryLabel("terminate_process", "Approval required: Terminate"),
      "Terminate?",
    );
  });

  it("uses contextual confirm verbs", () => {
    assert.equal(approvalConfirmVerb("restart_pc"), "Restart");
    assert.equal(approvalConfirmVerb("delete_file"), "Delete");
    assert.equal(approvalConfirmVerb("sleep_pc"), "Sleep");
    assert.equal(approvalConfirmVerb("unknown_tool"), "Approve");
  });

  it("explains risk briefly", () => {
    assert.match(approvalDetail("delete_file"), /permanently/i);
    assert.match(approvalDetail("restart_pc"), /restart/i);
  });
});

describe("overlay approval presence mapping", () => {
  it("maps awaiting approval to WAITING_FOR_APPROVAL hold state", async () => {
    function mapPresence(opts: {
      streaming: boolean;
      acting: boolean;
      awaitingApproval: boolean;
      awaitingUser: boolean;
      error: string | null;
      offline: boolean;
    }) {
      if (opts.offline) return { state: "OFFLINE", presentation: "offline" };
      if (opts.awaitingApproval) {
        return { state: "WAITING_FOR_APPROVAL", presentation: "hold" };
      }
      if (opts.awaitingUser) {
        return { state: "WAITING_FOR_USER", presentation: "awaiting" };
      }
      if (opts.error && !opts.streaming) {
        return { state: "ERROR", presentation: "error" };
      }
      if (opts.acting) return { state: "ACTING", presentation: "acting" };
      if (opts.streaming) return { state: "THINKING", presentation: "thinking" };
      return { state: "IDLE", presentation: "idle" };
    }

    const pending = mapPresence({
      streaming: false,
      acting: false,
      awaitingApproval: true,
      awaitingUser: false,
      error: null,
      offline: false,
    });
    assert.equal(pending.state, "WAITING_FOR_APPROVAL");
    assert.equal(pending.presentation, "hold");

    const notErrorWhilePending = mapPresence({
      streaming: false,
      acting: false,
      awaitingApproval: true,
      awaitingUser: false,
      error: "stale warning",
      offline: false,
    });
    assert.equal(notErrorWhilePending.state, "WAITING_FOR_APPROVAL");

    const clarify = mapPresence({
      streaming: false,
      acting: false,
      awaitingApproval: false,
      awaitingUser: true,
      error: "Multiple plausible tracks — ask which artist.",
      offline: false,
    });
    assert.equal(clarify.state, "WAITING_FOR_USER");
    assert.equal(clarify.presentation, "awaiting");
  });
});
