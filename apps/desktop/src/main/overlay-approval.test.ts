/**
 * Overlay approval bridge contracts — no Gemini re-planning after approve.
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
    assert.doesNotMatch(src, /createChatStream|generateContent/i);
    assert.doesNotMatch(src, /\bGemini\b/);
  });

  it("shared decide executes stored args with skipConfirmation", () => {
    const decide = path.join(root, "apps/web/src/lib/approvals/decide.ts");
    const src = fs.readFileSync(decide, "utf8");
    assert.match(src, /skipConfirmation:\s*true/);
    assert.match(src, /executeToolCall/);
    assert.match(src, /parameters/);
    assert.doesNotMatch(src, /createChatStream/);
  });

  it("overlay bridge calls device approvals decide endpoint", () => {
    const bridge = path.join(
      root,
      "apps/desktop/src/main/overlay-chat.ts",
    );
    const src = fs.readFileSync(bridge, "utf8");
    assert.match(src, /\/api\/devices\/assistant\/approvals\//);
    assert.match(src, /decideApproval/);
  });

  it("OverlayApp handles approval_required and WAITING_FOR_APPROVAL", () => {
    const app = path.join(
      root,
      "apps/desktop/src/overlay/OverlayApp.tsx",
    );
    const src = fs.readFileSync(app, "utf8");
    assert.match(src, /approval_required/);
    assert.match(src, /WAITING_FOR_APPROVAL/);
    assert.match(src, /decideOverlayApproval/);
    // Esc must not approve
    assert.match(src, /never approves/i);
    assert.match(src, /hideOverlay/);
  });
});
