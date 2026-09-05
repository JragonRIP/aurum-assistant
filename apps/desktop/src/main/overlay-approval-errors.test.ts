import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapOverlayApprovalError } from "./overlay-approval-errors";

describe("overlay approval error mapping", () => {
  it("maps structured codes to safe copy", () => {
    assert.equal(
      mapOverlayApprovalError("DEVICE_AUTH_REQUIRED", "x", 401),
      "Device authorization failed.",
    );
    assert.equal(
      mapOverlayApprovalError("APPROVAL_EXPIRED", "x", 409),
      "Approval expired.",
    );
    assert.equal(
      mapOverlayApprovalError("APPROVAL_ALREADY_RESOLVED", "x", 409),
      "That approval was already resolved.",
    );
    assert.equal(
      mapOverlayApprovalError("APPROVAL_EXECUTION_FAILED", "x", 500),
      "Couldn't execute the approved action.",
    );
    assert.equal(
      mapOverlayApprovalError("INVALID_DECISION", "x", 422),
      "Invalid approval decision.",
    );
  });

  it("maps legacy Could not approve without leaking internals", () => {
    assert.equal(
      mapOverlayApprovalError(undefined, "Could not approve", 500),
      "Couldn't execute the approved action.",
    );
    assert.equal(
      mapOverlayApprovalError(
        undefined,
        "Bearer secret stack supabase token",
        500,
      ),
      "Could not update approval.",
    );
  });

  it("uses HTTP status when code is missing", () => {
    assert.equal(
      mapOverlayApprovalError(undefined, undefined, 401),
      "Device authorization failed.",
    );
    assert.equal(
      mapOverlayApprovalError(undefined, undefined, 404),
      "Approval not found.",
    );
  });
});
