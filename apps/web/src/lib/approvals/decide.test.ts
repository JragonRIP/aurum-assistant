import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvalConfirmVerb,
  approvalDetail,
  approvalPrimaryLabel,
  approvalsUpdatePayloadIsSafe,
} from "./decide";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

describe("approval decide helpers", () => {
  it("never invents shell-like labels", () => {
    assert.equal(approvalPrimaryLabel("restart_pc"), "Restart this PC?");
    assert.equal(approvalConfirmVerb("shutdown_pc"), "Shut down");
    assert.match(approvalDetail("terminate_process"), /force-quit/i);
  });

  it("rejects approvals update payloads that include updated_at", () => {
    assert.equal(
      approvalsUpdatePayloadIsSafe({
        status: "APPROVED",
        approved_at: new Date().toISOString(),
      }),
      true,
    );
    assert.equal(
      approvalsUpdatePayloadIsSafe({
        status: "APPROVED",
        updated_at: new Date().toISOString(),
      }),
      false,
    );
  });

  it("decide.ts source must not write approvals.updated_at", () => {
    const src = fs.readFileSync(
      path.join(root, "apps/web/src/lib/approvals/decide.ts"),
      "utf8",
    );
    // Allow the documentation warning, but forbid update payloads with updated_at
    assert.doesNotMatch(
      src,
      /\.update\(\{[\s\S]*?updated_at:/,
    );
  });

  it("accepts actor context rather than bare userId-only API", () => {
    const src = fs.readFileSync(
      path.join(root, "apps/web/src/lib/approvals/decide.ts"),
      "utf8",
    );
    assert.match(src, /actor:\s*ApprovalActor/);
    assert.match(src, /source:\s*"web"\s*\|\s*"device"/);
    assert.match(src, /skipConfirmation:\s*true/);
    assert.doesNotMatch(src, /createChatStream/);
  });
});
