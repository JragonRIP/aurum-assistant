/**
 * Overlay approval bridge contracts — no model re-planning after approve.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("overlay approval security contracts", () => {
  it("device decide route exists and uses shared decideApproval", () => {
    const route = path.join(
      root,
      "apps/web/src/app/api/devices/assistant/approvals/[id]/decide/route.ts",
    );
    const src = fs.readFileSync(route, "utf8");
    assert.match(src, /requireDeviceAuth/);
    assert.match(src, /decideApproval/);
    assert.match(src, /source:\s*"device"/);
    assert.doesNotMatch(src, /createChatStream|generateContent/i);
  });

  it("shared decide executes stored args with skipConfirmation and no updated_at", () => {
    const decide = path.join(root, "apps/web/src/lib/approvals/decide.ts");
    const src = fs.readFileSync(decide, "utf8");
    assert.match(src, /skipConfirmation:\s*true/);
    assert.match(src, /executeToolCall/);
    assert.match(src, /parameters/);
    assert.doesNotMatch(src, /\.update\(\{[\s\S]*?updated_at:/);
    assert.doesNotMatch(src, /createChatStream/);
  });

  it("overlay bridge calls device approvals decide endpoint with Bearer auth", () => {
    const bridge = path.join(root, "apps/desktop/src/main/overlay-chat.ts");
    const src = fs.readFileSync(bridge, "utf8");
    assert.match(src, /\/api\/devices\/assistant\/approvals\//);
    assert.match(src, /decideApproval/);
    assert.match(src, /Authorization:\s*this\.authHeader\(cred\)/);
    assert.match(src, /JSON\.stringify\(\{\s*decision\s*\}\)/);
    assert.match(src, /mapOverlayApprovalError/);
  });

  it("OverlayApp handles approval_required and WAITING_FOR_APPROVAL", () => {
    const app = path.join(root, "apps/desktop/src/overlay/OverlayApp.tsx");
    const src = fs.readFileSync(app, "utf8");
    assert.match(src, /approval_required/);
    assert.match(src, /WAITING_FOR_APPROVAL/);
    assert.match(src, /WAITING_FOR_USER/);
    assert.match(src, /clarification_needed/);
    assert.match(src, /NEED YOUR INPUT/);
    assert.match(src, /decideOverlayApproval/);
    assert.match(src, /never approves/i);
    assert.match(src, /hideOverlay/);
  });

  it("maps structured error codes to safe overlay copy", () => {
    const errors = path.join(
      root,
      "apps/desktop/src/main/overlay-approval-errors.ts",
    );
    const src = fs.readFileSync(errors, "utf8");
    assert.match(src, /DEVICE_AUTH_REQUIRED/);
    assert.match(src, /APPROVAL_EXPIRED/);
    assert.match(src, /APPROVAL_ALREADY_RESOLVED/);
    assert.match(src, /Couldn't execute the approved action/);
  });
});
