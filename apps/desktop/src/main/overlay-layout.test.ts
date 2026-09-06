import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampOverlaySize,
  OVERLAY_COMPACT_MAX_HEIGHT,
  OVERLAY_IDLE_SIZE,
  positionOverlayBounds,
  resolveOverlaySize,
  shouldOfferShowFull,
} from "./overlay-layout";

describe("overlay layout", () => {
  it("short replies do not offer Show full", () => {
    assert.equal(shouldOfferShowFull("12 × 14 = 168"), false);
  });

  it("long replies offer Show full", () => {
    assert.equal(shouldOfferShowFull("x".repeat(500)), true);
    assert.equal(
      shouldOfferShowFull(Array.from({ length: 12 }, () => "line").join("\n")),
      true,
    );
  });

  it("idle size stays compact", () => {
    const size = resolveOverlaySize({
      mode: "idle",
      workArea: { width: 1920, height: 1080 },
    });
    assert.equal(size.width, OVERLAY_IDLE_SIZE.width);
    assert.equal(size.height, OVERLAY_IDLE_SIZE.height);
  });

  it("compact grows with content but caps", () => {
    const small = resolveOverlaySize({
      mode: "compact",
      contentHeightPx: 40,
      workArea: { width: 1920, height: 1080 },
    });
    const large = resolveOverlaySize({
      mode: "compact",
      contentHeightPx: 2000,
      workArea: { width: 1920, height: 1080 },
    });
    assert.ok(small.height < large.height);
    assert.ok(large.height <= OVERLAY_COMPACT_MAX_HEIGHT);
  });

  it("full mode uses most of work area but stays clamped", () => {
    const size = resolveOverlaySize({
      mode: "full",
      workArea: { width: 1280, height: 720 },
    });
    assert.ok(size.height <= Math.floor(720 * 0.85));
    assert.ok(size.width <= 1280 - 24);
  });

  it("clamp never exceeds work area", () => {
    const size = clampOverlaySize(
      { width: 9999, height: 9999 },
      { width: 800, height: 600 },
    );
    assert.ok(size.width <= 800 - 24);
    assert.ok(size.height <= Math.floor(600 * 0.85));
  });

  it("positions bottom-center inside work area", () => {
    const bounds = positionOverlayBounds(
      { width: 700, height: 300 },
      { x: 100, y: 50, width: 1600, height: 900 },
      36,
    );
    assert.ok(bounds.x >= 100);
    assert.ok(bounds.y + bounds.height <= 50 + 900);
  });
});
