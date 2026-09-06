import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("overlay open-in-aurum + hide animation contracts", () => {
  it("showMainWindow restores, shows, focuses, and clears alwaysOnTop", () => {
    const src = fs.readFileSync(
      path.join(root, "apps/desktop/src/main/index.ts"),
      "utf8",
    );
    assert.match(src, /function showMainWindow/);
    assert.match(src, /mainWindow\.restore\(\)/);
    assert.match(src, /mainWindow\.show\(\)/);
    assert.match(src, /mainWindow\.focus\(\)/);
    assert.match(src, /setAlwaysOnTop\(true/);
    assert.match(src, /setAlwaysOnTop\(false\)/);
    assert.match(src, /mainWindowConversationUrl/);
    assert.match(src, /hideOverlayFirst/);
  });

  it("open-in-aurum IPC preserves conversation id", () => {
    const src = fs.readFileSync(
      path.join(root, "apps/desktop/src/main/index.ts"),
      "utf8",
    );
    assert.match(src, /aurum:open-in-aurum/);
    assert.match(src, /getActiveConversationId/);
    assert.match(src, /conversationId/);
  });

  it("hide waits for renderer ACK before BrowserWindow.hide", () => {
    const main = fs.readFileSync(
      path.join(root, "apps/desktop/src/main/index.ts"),
      "utf8",
    );
    const overlay = fs.readFileSync(
      path.join(root, "apps/desktop/src/overlay/OverlayApp.tsx"),
      "utf8",
    );
    assert.match(main, /aurum:overlay-will-hide/);
    assert.match(main, /aurum:overlay-hide-complete/);
    assert.match(overlay, /onOverlayWillHide/);
    assert.match(overlay, /notifyOverlayHideComplete/);
    assert.match(overlay, /prefers-reduced-motion|shellHiding|hiding/);
  });

  it("Show full / Collapse controls exist without resetting presence", () => {
    const overlay = fs.readFileSync(
      path.join(root, "apps/desktop/src/overlay/OverlayApp.tsx"),
      "utf8",
    );
    assert.match(overlay, /Show full/);
    assert.match(overlay, /Collapse/);
    assert.match(overlay, /setLayoutFull/);
    assert.match(overlay, /WAITING_FOR_APPROVAL/);
  });
});
