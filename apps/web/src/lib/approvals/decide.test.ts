import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalConfirmVerb,
  approvalDetail,
  approvalPrimaryLabel,
} from "./decide";

describe("approval decide helpers", () => {
  it("never invents shell-like labels", () => {
    assert.equal(approvalPrimaryLabel("restart_pc"), "Restart this PC?");
    assert.equal(approvalConfirmVerb("shutdown_pc"), "Shut down");
    assert.match(approvalDetail("terminate_process"), /force-quit/i);
  });
});
