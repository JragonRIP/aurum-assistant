import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MICRO_TICK_COUNT,
  PRESENCE_LAYER_IDS,
  PRESENCE_STATES,
  PRESENCE_USES_RASTER_ASSET,
  RADIAL_TICK_COUNT,
  presenceMotionProfile,
} from "@aurum/ui";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

describe("Aurum Core visual", () => {
  it("does not ship or depend on a raster reference image", () => {
    assert.equal(PRESENCE_USES_RASTER_ASSET, false);
    const presence = readFileSync(
      join(ROOT, "packages/ui/src/Presence.tsx"),
      "utf8",
    );
    assert.equal(/\.(png|jpg|webp|gif)/i.test(presence), false);
    assert.equal(/<img/i.test(presence), false);
    assert.equal(/background-image/i.test(presence), false);
  });

  it("exposes independent structural layers", () => {
    for (const id of [
      "housing",
      "ticks",
      "structural",
      "primary-arc",
      "micro",
      "crosshair",
      "core",
    ]) {
      assert.ok(PRESENCE_LAYER_IDS.includes(id as (typeof PRESENCE_LAYER_IDS)[number]));
    }
    assert.ok(RADIAL_TICK_COUNT >= 50 && RADIAL_TICK_COUNT <= 90);
    assert.ok(MICRO_TICK_COUNT >= 90);
  });

  it("maps every existing presence state", () => {
    assert.deepEqual([...PRESENCE_STATES], [
      "IDLE",
      "LISTENING",
      "THINKING",
      "ACTING",
      "SPEAKING",
      "WAITING_FOR_APPROVAL",
      "WAITING_FOR_USER",
      "ERROR",
      "OFFLINE",
    ]);
  });

  it("LISTENING is visually ready as a thinking-class profile", () => {
    const listening = presenceMotionProfile("LISTENING", false);
    assert.equal(listening.thinking, true);
    assert.equal(listening.acting, false);
  });

  it("SPEAKING is visually ready as an acting-class profile", () => {
    const speaking = presenceMotionProfile("SPEAKING", false);
    assert.equal(speaking.acting, true);
  });

  it("IDLE is calm rotation, not a spinner profile", () => {
    const idle = presenceMotionProfile("IDLE", false);
    assert.equal(idle.rotate, true);
    assert.equal(idle.thinking, false);
    assert.equal(idle.acting, false);
    assert.equal(idle.offline, false);
  });

  it("THINKING activates the processing overlay", () => {
    const thinking = presenceMotionProfile("THINKING", false);
    assert.equal(thinking.thinking, true);
    assert.equal(thinking.acting, false);
  });

  it("ACTING activates the purposeful sweep overlay", () => {
    const acting = presenceMotionProfile("ACTING", false);
    assert.equal(acting.acting, true);
  });

  it("WAITING_FOR_APPROVAL holds motion", () => {
    const hold = presenceMotionProfile("WAITING_FOR_APPROVAL", false);
    assert.equal(hold.hold, true);
    assert.equal(hold.rotate, false);
  });

  it("ERROR is a distinct disruption profile", () => {
    const error = presenceMotionProfile("ERROR", false);
    assert.equal(error.error, true);
  });

  it("OFFLINE removes active motion", () => {
    const offline = presenceMotionProfile("OFFLINE", false);
    assert.equal(offline.offline, true);
    assert.equal(offline.rotate, false);
  });

  it("reduced motion disables continuous rotation", () => {
    const idle = presenceMotionProfile("IDLE", true);
    assert.equal(idle.rotate, false);
    assert.equal(idle.thinking, false);
    assert.equal(idle.acting, false);
    const hold = presenceMotionProfile("WAITING_FOR_APPROVAL", true);
    assert.equal(hold.hold, true);
  });

  it("keeps an accessible role contract on the component source", () => {
    const presence = readFileSync(
      join(ROOT, "packages/ui/src/Presence.tsx"),
      "utf8",
    );
    assert.match(presence, /role="img"/);
    assert.match(presence, /aria-label/);
    assert.match(presence, /data-state=\{state\}/);
    assert.match(presence, /data-presentation=/);
  });

  it("disables continuous rotation in reduced-motion CSS", () => {
    const css = readFileSync(join(ROOT, "packages/ui/src/styles.css"), "utf8");
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /\.acv-ticks/);
    assert.match(css, /animation:\s*none/);
  });
});
