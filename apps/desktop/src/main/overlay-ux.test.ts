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

  it("working UI hides idle prompt and shows activity from tools", () => {
    const overlay = fs.readFileSync(
      path.join(root, "apps/desktop/src/overlay/OverlayApp.tsx"),
      "utf8",
    );
    assert.match(overlay, /shouldShowIdlePrompt/);
    assert.match(overlay, /resolveWorkingActivity/);
    assert.match(overlay, /activityLine/);
    assert.match(overlay, /defaultPhaseActivity\("thinking"\)/);
    assert.match(overlay, /showIdlePrompt \? "What do you need\?" : ""/);
    assert.match(overlay, /AurumPresence/);
    assert.doesNotMatch(overlay, /chain.of.thought|hidden reasoning/i);
  });

  it("Esc after submit hides without aborting; PTT Esc still cancels recording", () => {
    const overlay = fs.readFileSync(
      path.join(root, "apps/desktop/src/overlay/OverlayApp.tsx"),
      "utf8",
    );
    assert.match(overlay, /listeningRef\.current \|\| captureRef\.current\.isActive/);
    assert.match(overlay, /voiceCancelPtt/);
    assert.match(overlay, /hideOverlay\(\)/);
    // Must not abort streaming on Esc anymore
    assert.doesNotMatch(
      overlay,
      /if \(streaming\) \{\s*abortRef\.current/,
    );
  });

  it("partial web failure uses warning not ERROR presence", () => {
    const overlay = fs.readFileSync(
      path.join(root, "apps/desktop/src/overlay/OverlayApp.tsx"),
      "utf8",
    );
    assert.match(overlay, /setWarning/);
    assert.match(overlay, /PROVIDER_UNAVAILABLE/);
    assert.match(overlay, /isSoftOverlayToolFailure/);
    assert.match(overlay, /normalizeOverlayText/);
  });

  it("transparent shell avoids filter blur that paints white strip", () => {
    const css = fs.readFileSync(
      path.join(root, "apps/desktop/src/overlay/overlay.css"),
      "utf8",
    );
    const main = fs.readFileSync(
      path.join(root, "apps/desktop/src/main/index.ts"),
      "utf8",
    );
    assert.match(main, /hasShadow:\s*false/);
    assert.doesNotMatch(css, /\.overlay-shell\s*\{[^}]*filter:\s*blur/s);
  });

  it("main owns turn snapshot for rehydrate", () => {
    const main = fs.readFileSync(
      path.join(root, "apps/desktop/src/main/index.ts"),
      "utf8",
    );
    assert.match(main, /aurum:overlay-turn-state/);
    assert.match(main, /getTurnSnapshot/);
  });
});
