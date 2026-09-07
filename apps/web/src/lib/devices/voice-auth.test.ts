/**
 * Device voice route auth contracts (route wiring + middleware allowlist).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isDeviceBearerApiPath } from "./public-paths";

const webRoot = join(__dirname, "../../..");

describe("device voice routes auth", () => {
  it("transcribe and synthesize use requireDeviceAuth", () => {
    for (const rel of [
      "src/app/api/devices/voice/transcribe/route.ts",
      "src/app/api/devices/voice/synthesize/route.ts",
    ]) {
      const src = readFileSync(join(webRoot, rel), "utf8");
      assert.match(src, /requireDeviceAuth/);
      assert.match(src, /isDeviceAuthError/);
    }
  });

  it("middleware allowlist includes voice paths so device Bearer is not blocked", () => {
    assert.equal(
      isDeviceBearerApiPath("/api/devices/voice/transcribe"),
      true,
    );
    assert.equal(
      isDeviceBearerApiPath("/api/devices/voice/synthesize"),
      true,
    );
    const mw = readFileSync(
      join(webRoot, "src/lib/supabase/middleware.ts"),
      "utf8",
    );
    assert.match(mw, /isPublicApiPath/);
  });
});
