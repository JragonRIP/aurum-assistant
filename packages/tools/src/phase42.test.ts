import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampVolumePercent, applyRelativeVolume } from "./volume";
import { createDefaultRegistry } from "./create-registry";
import { evaluatePermission } from "./permission";

describe("volume helpers", () => {
  it("clamps and relatives", () => {
    assert.equal(clampVolumePercent(200), 100);
    assert.equal(applyRelativeVolume(5, -10), 0);
  });
});

describe("phase 4.2 registry", () => {
  it("has no unrestricted shell tools", () => {
    const r = createDefaultRegistry();
    assert.equal(r.get("run_command"), undefined);
    assert.equal(r.get("powershell"), undefined);
    assert.ok(r.get("set_system_volume"));
    assert.ok(r.get("spotify_create_playlist"));
    assert.equal(evaluatePermission("RESTRICTED").allowed, false);
  });
});
