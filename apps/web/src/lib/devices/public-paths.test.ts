import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDeviceBearerApiPath,
  isPublicApiPath,
} from "./public-paths";

describe("device bearer API allowlist", () => {
  it("allows bridge, assistant, voice, and pair", () => {
    assert.equal(isDeviceBearerApiPath("/api/devices/pair"), true);
    assert.equal(isDeviceBearerApiPath("/api/devices/bridge/heartbeat"), true);
    assert.equal(isDeviceBearerApiPath("/api/devices/assistant/chat"), true);
    assert.equal(
      isDeviceBearerApiPath("/api/devices/voice/transcribe"),
      true,
    );
    assert.equal(
      isDeviceBearerApiPath("/api/devices/voice/synthesize"),
      true,
    );
    assert.equal(
      isDeviceBearerApiPath("/api/devices/abc/roots"),
      true,
    );
  });

  it("does not open user-session device management APIs", () => {
    assert.equal(isDeviceBearerApiPath("/api/devices"), false);
    assert.equal(isDeviceBearerApiPath("/api/devices/"), false);
    assert.equal(
      isDeviceBearerApiPath("/api/devices/abc-def"),
      false,
    );
    assert.equal(isPublicApiPath("/api/voice/transcribe"), false);
  });

  it("keeps health public", () => {
    assert.equal(isPublicApiPath("/api/health"), true);
  });
});
